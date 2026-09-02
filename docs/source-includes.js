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
  let target;
  try {
    ({ target } = decodeLinkTarget(linkage.payload));
  } catch {
    return null;
  }
  return {
    indent: match[1],
    ending: match[3] || "",
    key: target,
    target
  };
}

function linesWithEndings (source) {
  return String(source).match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)
    ?.filter((line, index, lines) => line || index < lines.length - 1) || [];
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
  resolverURLForTarget,
  fetchImpl = globalThis.fetch,
  limits = defaultLimits
}) {
  if (!appURL || typeof resolverURLForTarget !== "function" || typeof fetchImpl !== "function") {
    throw new Error("Source inclusion requires an app URL, resolver, and fetch implementation");
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
      const response = await fetchImpl(resolverURLForTarget(target), {
        headers: { accept: "text/plain, text/markdown, text/css, text/javascript, */*;q=0.1" }
      });
      if (!response.ok) {
        throw new Error(`Source include failed: ${response.status} ${response.statusText}`.trim());
      }

      const sourceURL = response.headers.get("x-lnkr-source-url") || target;
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
      const imported = await fetchSource(include.target);
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

export { sourceLinkFromLine };
