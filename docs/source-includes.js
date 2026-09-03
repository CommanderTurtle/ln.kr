import {
  decodeLinkTarget,
  isTextualSourceResponse,
  splitLinkFragment
} from "./link-runtime.js";

const sourceModes = new Set([
  "source",
  "source-markdown",
  "source-javascript",
  "source-html"
]);

const defaultLimits = Object.freeze({
  depth: 16,
  modules: 128,
  bytes: 32 * 1024 * 1024
});

const sourceLineSlicePattern = /^(.*)::~(-?\d+)(?::(-?\d+))?$/s;

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
  const match = String(line).match(/^(\s*)(\S+?)(\r\n|\n|\r)?$/);
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
  if (!sourceModes.has(linkage.mode)) return null;
  let lineSlice;
  let target;
  try {
    const sliced = splitSourceLineSlice(linkage.payload);
    lineSlice = sliced.lineSlice;
    ({ target } = decodeLinkTarget(sliced.payload));
  } catch {
    return null;
  }
  return {
    indent: match[1],
    ending: match[3] || "",
    key: target,
    lineSlice,
    target
  };
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

/**
 * Resolve bare #s/#sm/#sj/#sh link lines before the existing renderer or
 * runner sees them. The authored document is not changed; callers keep this
 * returned runtime text separately from their exact source.
 */
export async function expandSourceIncludes (source, {
  appURL,
  resourceURLForTarget,
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
      if (!isTextualSourceResponse(sourceURL, contentType)) {
        throw new Error(`Source include is not text: ${sourceURL}`);
      }

      const text = await response.text();
      state.bytes += encoder.encode(text).length;
      if (state.bytes > limits.bytes) {
        throw new Error(`Source includes exceed the ${limits.bytes.toLocaleString()}-byte limit`);
      }
      return text;
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
      const imported = applySourceLineSlice(
        await fetchSource(include.target),
        include.lineSlice
      );
      let replacement = await expand(imported, depth + 1, nestedAncestors);
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
