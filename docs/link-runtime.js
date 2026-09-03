import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "./alphabets.js";
import { compress, decompress } from "./compress.js";

const routePrefixes = Object.freeze([
  ["sm:", "source-markdown"],
  ["sj:", "source-javascript"],
  ["sh:", "source-html"],
  ["hs:", "source-live"],
  ["lr:", "resolved"],
  ["i:", "image"],
  ["s:", "source"],
  ["l:", "guarded"]
]);

const imageSuffixes = new Set([
  "apng", "avif", "bmp", "cur", "gif", "heic", "heif", "ico", "jfif",
  "jpeg", "jpg", "jxl", "pjp", "pjpeg", "png", "svg", "tif", "tiff", "webp"
]);

export function splitLinkFragment (fragment) {
  for (const [prefix, mode] of routePrefixes) {
    if (fragment.startsWith(prefix)) {
      return { mode, payload: fragment.slice(prefix.length) };
    }
  }
  return { mode: "", payload: fragment };
}

export function linkPrefixForMode (mode) {
  if (mode === "source-markdown") return "sm:";
  if (mode === "source-javascript") return "sj:";
  if (mode === "source-html") return "sh:";
  if (mode === "source-live") return "hs:";
  if (mode === "resolved") return "lr:";
  if (mode === "image") return "i:";
  if (mode === "source") return "s:";
  if (mode === "guarded") return "l:";
  return "";
}

const sourceSuffixKinds = Object.freeze({
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkdn: "markdown",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "javascript",
  tsx: "javascript",
  css: "text",
  html: "html",
  htm: "html",
  xhtml: "html"
});

const sourceTypeKinds = Object.freeze({
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "application/markdown": "markdown",
  "text/javascript": "javascript",
  "application/javascript": "javascript",
  "text/ecmascript": "javascript",
  "application/ecmascript": "javascript",
  "text/typescript": "javascript",
  "application/typescript": "javascript",
  "text/css": "text"
});

const textualApplicationTypes = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/yaml",
  "application/x-yaml",
  "image/svg+xml"
]);

function normalizedMediaType (contentType) {
  return String(contentType || "").split(";", 1)[0].trim().toLowerCase();
}

function targetSuffix (target) {
  const pathname = new URL(validateLinkTarget(target, { inferProtocol: false })).pathname;
  return pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || "";
}

/** Return only an explicit URL/MIME hint; source-text detection remains the fallback. */
export function sourceKindHint (target, contentType = "") {
  const mediaType = normalizedMediaType(contentType);
  return sourceTypeKinds[mediaType] || sourceSuffixKinds[targetSuffix(target)] || "";
}

/** Keep binary responses in the browser's native resource viewer. */
export function isTextualSourceResponse (target, contentType = "") {
  const mediaType = normalizedMediaType(contentType);
  if (sourceKindHint(target, contentType)) return true;
  if (!mediaType) return true;
  return mediaType.startsWith("text/") || textualApplicationTypes.has(mediaType) ||
    /\+(?:json|xml)$/.test(mediaType);
}

export function validateLinkTarget (input, { inferProtocol = true } = {}) {
  const value = String(input).trim();
  if (!value) throw new Error("Enter a link first");

  const hasProtocol = /^\w+:\/\//i.test(value);
  const parsed = new URL(hasProtocol || !inferProtocol ? value : `http://${value}`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid protocol: ${parsed.protocol}. Only http and https are supported.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credentials in URLs are not supported");
  }
  return parsed.href;
}

function escapeHTMLAttribute (value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;");
}

const cspRelativeResourceDirectives = new Set([
  "base-uri",
  "child-src",
  "connect-src",
  "default-src",
  "font-src",
  "frame-src",
  "img-src",
  "manifest-src",
  "media-src",
  "prefetch-src",
  "script-src",
  "style-src",
  "worker-src"
]);

function allowResolvedOriginsInCSP (policy, origins) {
  const entitySemicolon = "\uE000";
  const protectedPolicy = String(policy).replace(
    /&(?:#39|#x27|apos);/gi,
    entity => entity.slice(0, -1) + entitySemicolon
  );
  const updated = protectedPolicy.split(";").map(segment => {
    const directive = segment.trimStart().match(/^([a-z-]+)/i)?.[1]?.toLowerCase();
    if (!cspRelativeResourceDirectives.has(directive)) return segment;

    const missing = origins.filter(origin => !segment.includes(origin));
    if (!missing.length) return segment;

    const self = /'self'|&(?:#39|#x27|apos)\uE000self&(?:#39|#x27|apos)\uE000/i;
    if (!self.test(segment)) return segment;
    return segment.replace(self, match => `${match} ${missing.join(" ")}`);
  }).join(";");
  return updated.replaceAll(entitySemicolon, ";");
}

function allowResolvedOriginsInMetaCSP (source, origins) {
  return String(source).replace(/<meta\b[^>]*>/gi, tag => {
    const isCSP = /\bhttp-equiv\s*=\s*(?:"content-security-policy"|'content-security-policy'|content-security-policy\b)/i;
    if (!isCSP.test(tag)) return tag;

    return tag.replace(
      /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
      (attribute, doubleQuoted, singleQuoted) => {
        const quote = doubleQuoted === undefined ? "'" : '"';
        const policy = doubleQuoted ?? singleQuoted;
        return `content=${quote}${allowResolvedOriginsInCSP(policy, origins)}${quote}`;
      }
    );
  });
}

/**
 * Give fetched HTML the same URL base it had upstream. The returned source is
 * still a standalone editable document, while relative stylesheets, scripts,
 * images, links, and CSS-nested assets resolve as they did at the destination.
 */
export function anchorResolvedHTML (source, target) {
  const documentURL = validateLinkTarget(target, { inferProtocol: false });
  const text = String(source);
  const baseTag = text.match(/<base\b[^>]*>/i);
  let anchored;
  let baseURL = new URL(documentURL);

  if (baseTag) {
    const href = baseTag[0].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/i);
    if (href) {
      const resolved = new URL(href[1] ?? href[2] ?? href[3], documentURL).href;
      baseURL = new URL(resolved);
      const replacement = baseTag[0].replace(
        href[0],
        `href="${escapeHTMLAttribute(resolved)}"`
      );
      anchored = text.slice(0, baseTag.index) + replacement +
        text.slice(baseTag.index + baseTag[0].length);
    }
  }

  if (!anchored) {
    const declaration = `<base href="${escapeHTMLAttribute(documentURL)}">`;
    const head = /<head\b[^>]*>/i.exec(text);
    if (head) {
      const index = head.index + head[0].length;
      anchored = `${text.slice(0, index)}\n  ${declaration}${text.slice(index)}`;
    } else {
      const html = /<html\b[^>]*>/i.exec(text);
      if (html) {
        const index = html.index + html[0].length;
        anchored = `${text.slice(0, index)}\n<head>${declaration}</head>${text.slice(index)}`;
      } else {
        const doctype = /^\s*<!doctype\b[^>]*>/i.exec(text);
        if (doctype) {
          const index = doctype.index + doctype[0].length;
          anchored = `${text.slice(0, index)}\n<head>${declaration}</head>${text.slice(index)}`;
        } else {
          anchored = `<head>${declaration}</head>\n${text}`;
        }
      }
    }
  }

  const origins = [...new Set([new URL(documentURL).origin, baseURL.origin])];
  return allowResolvedOriginsInMetaCSP(anchored, origins);
}

export function isImageLinkTarget (target) {
  const pathname = new URL(validateLinkTarget(target, { inferProtocol: false })).pathname;
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return Boolean(match && imageSuffixes.has(match[1].toLowerCase()));
}

export function encodeLinkTarget (input, alphabet = outputAlphabetASCII) {
  validateLinkTarget(input);
  const payload = compress(String(input).trim(), alphabet);
  const target = decompress(payload, alphabet);
  validateLinkTarget(target, { inferProtocol: false });
  return { payload, target };
}

/** Resolve a fragment payload to its original public resource without paths. */
export function resolvedResourceURL (input) {
  return validateLinkTarget(input, { inferProtocol: false });
}

function decodeCandidates (raw) {
  const candidates = [String(raw).replaceAll(" ", "")];
  try {
    const decoded = decodeURIComponent(raw).replaceAll(" ", "");
    if (!candidates.includes(decoded)) candidates.push(decoded);
  } catch {
    // A literal codec payload is still a valid candidate.
  }
  return candidates.filter(Boolean);
}

function inferredAlphabet (payload) {
  return Array.from(payload).some(character => !outputAlphabetASCII.includes(character))
    ? outputAlphabetEmoji
    : outputAlphabetASCII;
}

export function decodeLinkTarget (raw, alphabetHint = null) {
  let lastError = new Error("Empty link payload");
  for (const payload of decodeCandidates(raw)) {
    const alphabets = alphabetHint
      ? [alphabetHint]
      : [inferredAlphabet(payload)];

    for (const alphabet of alphabets) {
      try {
        const target = decompress(payload, alphabet);
        validateLinkTarget(target, { inferProtocol: false });
        return { target, payload, alphabet };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError;
}

export function decodeQRLinkTarget (raw) {
  return decodeLinkTarget(raw, outputAlphabetQR);
}
