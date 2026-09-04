import {
  decodeLinkTarget,
  encodeLinkTarget,
  extractSingleLinkDocument,
  isTextualSourceResponse,
  mediaLinkKind,
  splitLinkFragment
} from "./link-runtime.js";

const slicedSourceModes = new Set([
  "source",
  "source-markdown",
  "source-javascript",
  "source-html",
  "source-live"
]);

const moduleModes = new Set([
  ...slicedSourceModes,
  "super-source",
  "image",
  "media",
  "pdf"
]);

const defaultLimits = Object.freeze({
  depth: 16,
  modules: 128,
  bytes: 32 * 1024 * 1024
});

const sourceLineSlicePattern = /^(.*)::~(-?\d+)(?::(-?\d+))?$/s;
const webURLCandidatePattern = /https?:\/\/[^\s"<>\u0060]+/gi;

function safeLineOffset (value) {
  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) {
    throw new Error(`Source line offset is outside the safe integer range: ${value}`);
  }
  return offset;
}

/**
 * Split the optional CMD-style line suffix from a compressed source payload.
 * `::~start:length` counts `length` lines forward; a negative length is an
 * end-relative delimiter. `::~start` continues through the final line.
 */
function splitSourceLineSlice (value) {
  const raw = String(value);
  const match = raw.match(sourceLineSlicePattern);
  if (!match) return { payload: raw, lineSlice: null };

  return {
    payload: match[1],
    lineSlice: {
      start: safeLineOffset(match[2]),
      span: match[3] === undefined ? null : safeLineOffset(match[3])
    }
  };
}

function sourceLinkFromLine (line, appURL) {
  const text = String(line);
  const direct = text.match(/^(\s*)(\S+?)(\r\n|\n|\r)?$/);
  const snippet = text.match(/^(\s*)--8<--\s+(["'])(https?:\/\/.*?)\2\s*(\r\n|\n|\r)?$/);
  const match = direct || (snippet && [snippet[0], snippet[1], snippet[3], snippet[4]]);
  if (!match) return null;

  let url;
  try {
    url = new URL(match[2]);
  } catch {
    return null;
  }

  const app = new URL(appURL);
  if (url.origin !== app.origin && url.hostname.toLowerCase() !== "a.shel.sh") {
    return null;
  }

  const linkage = splitLinkFragment(url.hash.slice(1));
  if (!moduleModes.has(linkage.mode)) return null;
  let lineSlice;
  let target;
  try {
    const sliced = slicedSourceModes.has(linkage.mode)
      ? splitSourceLineSlice(linkage.payload)
      : { payload: linkage.payload, lineSlice: null };
    lineSlice = sliced.lineSlice;
    ({ target } = decodeLinkTarget(sliced.payload));
  } catch {
    return null;
  }
  return {
    indent: match[1],
    ending: match[3] || "",
    href: match[2],
    key: target,
    lineSlice,
    mode: linkage.mode,
    target
  };
}

function decodedResolvedCandidate (raw, app) {
  const marker = raw.indexOf("#lr:");
  if (marker < 0) return null;

  for (let end = raw.length; end > marker + 4; end --) {
    const candidate = raw.slice(0, end);
    const decodedCandidate = candidate
      .replaceAll("&amp;", "&")
      .replaceAll("&#38;", "&")
      .replaceAll("&#x26;", "&")
      .replaceAll("&#X26;", "&");
    let url;
    try {
      url = new URL(decodedCandidate);
    } catch {
      continue;
    }
    if (url.origin !== app.origin && url.hostname.toLowerCase() !== "a.shel.sh") {
      return null;
    }
    const linkage = splitLinkFragment(url.hash.slice(1));
    if (linkage.mode !== "resolved") return null;
    try {
      const decoded = decodeLinkTarget(linkage.payload);
      const canonical = encodeLinkTarget(decoded.target, decoded.alphabet);
      if (canonical.payload !== decoded.payload) continue;
      const { target } = decoded;
      return { htmlEscaped: decodedCandidate !== candidate, target, end };
    } catch {
      // The URL may include closing Markdown/CSS punctuation. Retry without it.
    }
  }
  return null;
}

/**
 * Resolve #lr references only in the private runtime copy. The exact authored
 * source continues to contain its short a.shel.sh URL.
 */
export function expandResolvedResourceLinks (source, { appURL }) {
  if (!appURL) throw new Error("Resolved resource expansion requires an app URL");
  const app = new URL(appURL);
  const text = String(source);
  return text.replace(webURLCandidatePattern, (raw, offset) => {
    let candidate = raw;
    let syntax = "";
    if (text[offset - 1] === "(") {
      const closing = raw.lastIndexOf(")");
      if (closing > raw.indexOf("#lr:")) {
        candidate = raw.slice(0, closing);
        syntax = raw.slice(closing);
      }
    }

    const resolved = decodedResolvedCandidate(candidate, app);
    if (!resolved) return raw;
    const target = resolved.htmlEscaped
      ? resolved.target.replaceAll("&", "&amp;")
      : resolved.target;
    return `${target}${candidate.slice(resolved.end)}${syntax}`;
  });
}

function linesWithEndings (source) {
  return String(source).match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)
    ?.filter((line, index, lines) => line || index < lines.length - 1) || [];
}

/** Preserve the selected lines and their original LF/CRLF/CR endings exactly. */
function applySourceLineSlice (source, lineSlice) {
  const text = String(source);
  if (!lineSlice) return text;

  const lines = linesWithEndings(text);
  const lineCount = lines.length;
  const start = lineSlice.start < 0
    ? Math.max(lineCount + lineSlice.start, 0)
    : Math.min(lineSlice.start, lineCount);
  let end = lineCount;

  if (lineSlice.span !== null) {
    end = lineSlice.span < 0
      ? Math.max(lineCount + lineSlice.span, 0)
      : Math.min(start + lineSlice.span, lineCount);
  }

  return lines.slice(start, Math.max(start, end)).join("");
}

function indentSource (source, indent) {
  if (!indent || !source) return source;
  return String(source).replace(/(^|\r\n|\n|\r)(?=.)/g, `$1${indent}`);
}

function escapeHTML (value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function includeMediaKind (include, contentType = "", sourceURL = include.target) {
  if (include.mode === "image") return "image";
  if (include.mode === "pdf") return "pdf";
  return mediaLinkKind(sourceURL, contentType) || mediaLinkKind(include.target, contentType);
}

function modulePeek (include, source, language = "html") {
  return `<aside class="lnkr-module-source" tabindex="0">
<a class="lnkr-module-token" href="${escapeHTML(include.href)}" target="_blank" rel="noopener noreferrer">${escapeHTML(include.href)}</a>
<pre><code class="language-${escapeHTML(language)}">${escapeHTML(source)}</code></pre>
</aside>`;
}

function pdfModuleLoader () {
  return `<script>(function(module){
var host=module&&module.querySelector('[data-lnkr-pdf-host]');
if(!host||module.dataset.lnkrReady)return;
module.dataset.lnkrReady='loading';
fetch(module.dataset.lnkrPdfSource).then(function(response){
if(!response.ok)throw new Error(response.status+' '+response.statusText);
return response.arrayBuffer();
}).then(function(bytes){
var url=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
var frame=document.createElement('iframe');
frame.src=url;frame.title='PDF preview';frame.style='width:100%;height:42rem;border:0;background:white';
host.replaceChildren(frame);module.dataset.lnkrReady='true';
addEventListener('pagehide',function(){URL.revokeObjectURL(url)},{once:true});
}).catch(function(error){host.textContent='PDF could not be loaded: '+(error.message||error);module.dataset.lnkrReady='error';});
})(document.currentScript.previousElementSibling);<\/script>`;
}

function mediaModuleMarkup (include, kind, resourceLinkForTarget) {
  if (typeof resourceLinkForTarget !== "function") {
    throw new Error("Media source inclusion requires a route-two resource builder");
  }
  const resource = resourceLinkForTarget(include.target);
  const encodedLabel = new URL(include.target).pathname.split("/").filter(Boolean).at(-1) || kind;
  let label = encodedLabel;
  try {
    label = decodeURIComponent(encodedLabel);
  } catch {
    // A malformed percent escape is still a legal URL path; keep it verbatim.
  }
  let element;
  if (kind === "image") {
    element = `<img src="${escapeHTML(resource)}" alt="${escapeHTML(label)}" loading="eager" decoding="async" referrerpolicy="no-referrer">`;
  } else if (kind === "video") {
    element = `<video src="${escapeHTML(resource)}" controls preload="metadata"></video>`;
  } else if (kind === "audio") {
    element = `<audio src="${escapeHTML(resource)}" controls preload="metadata"></audio>`;
  } else {
    element = `<iframe src="${escapeHTML(resource)}" title="${escapeHTML(label)}"></iframe>`;
  }

  if (kind === "pdf") {
    return `<figure class="lnkr-module lnkr-module-pdf" data-lnkr-pdf-source="${escapeHTML(resource)}">
<div class="lnkr-pdf-host" data-lnkr-pdf-host>Loading PDF...</div>
${modulePeek(include, element)}
</figure>
${pdfModuleLoader()}`;
  }

  return `<figure class="lnkr-module lnkr-module-${kind}">
${element}
${modulePeek(include, element)}
</figure>`;
}

/**
 * Resolve bare #s/#sm/#sj/#sh link lines before the existing renderer or
 * runner sees them. The authored document is not changed; callers keep this
 * returned runtime text separately from their exact source.
 */
export async function expandSourceIncludes (source, {
  appURL,
  documentKind = "text",
  resourceLinkForTarget,
  resourceURLForTarget,
  showModuleSource = false,
  fetchImpl = globalThis.fetch,
  limits = defaultLimits
}) {
  if (!appURL || typeof resourceURLForTarget !== "function" || typeof fetchImpl !== "function") {
    throw new Error("Source inclusion requires an app URL, resource URL, and fetch implementation");
  }

  const state = {
    bytes: 0,
    modules: 0,
    raw: new Map()
  };
  const encoder = new TextEncoder();

  async function fetchSource (target) {
    if (state.raw.has(target)) return state.raw.get(target);

    const pending = (async () => {
      const response = await fetchImpl(resourceURLForTarget(target), {
        headers: { accept: "text/plain, text/markdown, text/css, text/javascript, */*;q=0.1" }
      });
      if (!response.ok) {
        throw new Error(`Source include failed: ${response.status} ${response.statusText}`.trim());
      }

      const sourceURL = response.headers.get("x-lnkr-source-url") || response.url || target;
      const contentType = response.headers.get("content-type") || "";
      const mediaKind = mediaLinkKind(sourceURL, contentType);
      if (mediaKind) {
        return { contentType, mediaKind, sourceURL, text: "" };
      }
      if (!isTextualSourceResponse(sourceURL, contentType)) {
        throw new Error(`Source include is not text: ${sourceURL}`);
      }

      const text = await response.text();
      state.bytes += encoder.encode(text).length;
      if (state.bytes > limits.bytes) {
        throw new Error(`Source includes exceed the ${limits.bytes.toLocaleString()}-byte limit`);
      }
      return { contentType, mediaKind: "", sourceURL, text };
    })();

    state.raw.set(target, pending);
    return pending;
  }

  async function expand (text, depth, ancestors) {
    if (depth > limits.depth) {
      throw new Error(`Source includes exceed the ${limits.depth}-level nesting limit`);
    }

    const output = [];
    for (const line of linesWithEndings(text)) {
      const include = sourceLinkFromLine(line, appURL);
      if (!include) {
        output.push(line);
        continue;
      }

      if (ancestors.has(include.key)) {
        throw new Error(`Circular source include: ${include.target}`);
      }
      state.modules ++;
      if (state.modules > limits.modules) {
        throw new Error(`Source includes exceed the ${limits.modules}-module limit`);
      }

      const nestedAncestors = new Set(ancestors);
      nestedAncestors.add(include.key);
      if (include.mode === "super-source") {
        const outer = await fetchSource(include.target);
        const innerHref = extractSingleLinkDocument(outer.text);
        const inner = innerHref && sourceLinkFromLine(innerHref, appURL);
        if (!inner || !slicedSourceModes.has(inner.mode)) {
          throw new Error("A superlink must contain exactly one route-three or route-four source link");
        }
        if (nestedAncestors.has(inner.key)) {
          throw new Error(`Circular source include: ${inner.target}`);
        }
        state.modules ++;
        if (state.modules > limits.modules) {
          throw new Error(`Source includes exceed the ${limits.modules}-module limit`);
        }
        nestedAncestors.add(inner.key);
        const record = await fetchSource(inner.target);
        if (includeMediaKind(inner, record.contentType, record.sourceURL)) {
          throw new Error("A superlink source route must resolve to textual source");
        }
        const imported = applySourceLineSlice(record.text, inner.lineSlice);
        let replacement = await expand(imported, depth + 2, nestedAncestors);
        if (showModuleSource && documentKind === "markdown") {
          const spacer = replacement && !/(?:\r\n|\n|\r)$/.test(replacement) ? "\n" : "";
          replacement += `${spacer}${modulePeek(include, imported, "text")}\n`;
        }
        replacement = indentSource(replacement, include.indent);
        if (include.ending && !/(?:\r\n|\n|\r)$/.test(replacement)) replacement += include.ending;
        output.push(replacement);
        continue;
      }
      const declaredMedia = includeMediaKind(include);
      if (declaredMedia) {
        if (!["markdown", "html"].includes(documentKind)) {
          throw new Error(`A ${declaredMedia} module requires a Markdown or HTML document`);
        }
        let replacement = mediaModuleMarkup(include, declaredMedia, resourceLinkForTarget);
        replacement = indentSource(replacement, include.indent);
        if (include.ending && !/(?:\r\n|\n|\r)$/.test(replacement)) replacement += include.ending;
        output.push(replacement);
        continue;
      }

      const record = await fetchSource(include.target);
      const fetchedMedia = includeMediaKind(include, record.contentType, record.sourceURL);
      if (fetchedMedia) {
        if (!["markdown", "html"].includes(documentKind)) {
          throw new Error(`A ${fetchedMedia} module requires a Markdown or HTML document`);
        }
        let replacement = mediaModuleMarkup(include, fetchedMedia, resourceLinkForTarget);
        replacement = indentSource(replacement, include.indent);
        if (include.ending && !/(?:\r\n|\n|\r)$/.test(replacement)) replacement += include.ending;
        output.push(replacement);
        continue;
      }
      const imported = applySourceLineSlice(
        record.text,
        include.lineSlice
      );
      let replacement = await expand(imported, depth + 1, nestedAncestors);
      if (showModuleSource && documentKind === "markdown") {
        const spacer = replacement && !/(?:\r\n|\n|\r)$/.test(replacement) ? "\n" : "";
        replacement += `${spacer}${modulePeek(include, imported, "text")}\n`;
      }
      replacement = indentSource(replacement, include.indent);
      if (include.ending && !/(?:\r\n|\n|\r)$/.test(replacement)) {
        replacement += include.ending;
      }
      output.push(replacement);
    }
    return output.join("");
  }

  return {
    text: await expand(String(source), 0, new Set()),
    modules: state.modules,
    bytes: state.bytes
  };
}

export { applySourceLineSlice, sourceLinkFromLine, splitSourceLineSlice };
