import { decodeDirectLinkTarget } from "../docs/link-runtime.js";

const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "if-modified-since",
  "if-none-match",
  "if-range",
  "range"
];
const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
];

const corsHeaders = Object.freeze({
  "access-control-allow-headers": "Accept, Range, If-Range, If-None-Match, If-Modified-Since",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-origin": "*",
  "access-control-expose-headers": "Accept-Ranges, Cache-Control, Content-Length, Content-Range, Content-Type, ETag, Last-Modified, X-Lnkr-Source-URL",
  "access-control-max-age": "86400"
});

function errorResponse (message, status) {
  return new Response(message, {
    status,
    headers: {
      ...corsHeaders,
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff"
    }
  });
}

function ipv4Octets (hostname) {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some(part => !/^\d+$/.test(part))) return null;
  const octets = parts.map(Number);
  return octets.every(part => part >= 0 && part <= 255) ? octets : null;
}

function isBlockedIPv4 (hostname) {
  const octets = ipv4Octets(hostname);
  if (!octets) return false;
  const [a, b] = octets;
  return a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

function isBlockedIPv6 (hostname) {
  const value = hostname.replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
  if (!value.includes(":")) return false;
  if (value === "::" || value === "::1") return true;
  if (/^f[cd]/.test(value) || /^fe[89ab]/.test(value) || /^ff/.test(value)) return true;
  if (value.startsWith("::ffff:")) return true;
  return false;
}

function validatePublicTarget (value) {
  const target = new URL(value);
  if (!["http:", "https:"].includes(target.protocol)) {
    throw new Error("Only http and https targets are supported");
  }
  if (target.username || target.password) {
    throw new Error("Credentials in target URLs are not supported");
  }

  const hostname = canonicalHostname(target.hostname);
  const blockedName = hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".localdomain");
  if (!hostname || blockedName || isBlockedIPv4(hostname) || isBlockedIPv6(hostname)) {
    throw new Error("Private and local network targets are not supported");
  }
  return target;
}

function canonicalHostname (value) {
  return String(value).replace(/^\[|\]$/g, "").replace(/\.+$/, "").toLowerCase();
}

function rejectResolverLoop (target, resolverHostname) {
  if (canonicalHostname(target.hostname) === resolverHostname) {
    throw new Error("Resolver targets cannot point back to this resolver");
  }
  return target;
}

function resolverPayload (pathname) {
  const marker = "/lr/";
  const index = pathname.indexOf(marker);
  if (index < 0) return "";
  return pathname.slice(index + marker.length).replace(/\/+$/, "");
}

function upstreamRequestHeaders (request) {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  return headers;
}

function proxyResponseHeaders (upstream, sourceURL) {
  const headers = new Headers(upstream.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.delete("set-cookie");
  headers.delete("set-cookie2");
  // Fetch runtimes expose a decoded body even when the origin response was
  // content-encoded. Keeping those wire headers would make the recipient try
  // to decode the already-decoded stream a second time.
  if (headers.has("content-encoding")) {
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  for (const [name, value] of Object.entries(corsHeaders)) headers.set(name, value);
  headers.set("cross-origin-resource-policy", "cross-origin");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-lnkr-source-url", sourceURL);
  return headers;
}

export async function handleResolverRequest (
  request,
  { fetchImpl = globalThis.fetch } = {}
) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (!["GET", "HEAD"].includes(request.method)) {
    return errorResponse("Method not allowed", 405);
  }

  let target;
  let resolverHostname;
  try {
    const incoming = new URL(request.url);
    resolverHostname = canonicalHostname(incoming.hostname);
    const payload = resolverPayload(incoming.pathname);
    if (!payload || !/^[-0-9A-Z_a-z]+$/.test(payload)) {
      return errorResponse("Missing or invalid resolver payload", 400);
    }
    target = rejectResolverLoop(
      validatePublicTarget(decodeDirectLinkTarget(payload).target),
      resolverHostname
    );
  } catch (error) {
    return errorResponse(`Invalid resolver target: ${error.message || error}`, 400);
  }

  const headers = upstreamRequestHeaders(request);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects ++) {
      const upstream = await fetchImpl(target, {
        method: request.method,
        headers,
        redirect: "manual"
      });

      if (REDIRECT_STATUSES.has(upstream.status)) {
        const location = upstream.headers.get("location");
        if (!location) {
          return errorResponse("Upstream redirect had no destination", 502);
        }
        if (redirects === MAX_REDIRECTS) {
          return errorResponse("Too many upstream redirects", 508);
        }
        target = rejectResolverLoop(
          validatePublicTarget(new URL(location, target).href),
          resolverHostname
        );
        continue;
      }

      return new Response(request.method === "HEAD" ? null : upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: proxyResponseHeaders(upstream, target.href)
      });
    }
  } catch (error) {
    return errorResponse(`Resolver fetch failed: ${error.message || error}`, 502);
  }

  return errorResponse("Resolver fetch failed", 502);
}
