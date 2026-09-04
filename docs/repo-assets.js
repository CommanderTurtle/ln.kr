// Only loaded for an explicit repository recipe. Raw hosts often serve JS/CSS
// as text/plain + nosniff; materialize those bytes with their executable MIME.
import { parse } from "./vendor/es-module-lexer.js";

const dataURL = (text, mime) => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
};
const scriptJSON = value => JSON.stringify(value).replaceAll("<", "\\u003c");

export async function materializeRepositoryHTML (document, baseURL, { root, bases = {}, mount, read, resolve, parser, navigate, depth = 0 }) {
  if (depth > 16) throw new Error("Repository frame nesting exceeds 16 levels");
  const base = document.querySelector("base[href]");
  const documentURL = bases.body || (base ? resolve(base.getAttribute("href"), baseURL, root, mount) : baseURL);
  const modules = new Map();
  const importMap = { imports: {} };
  const maps = Array.from(document.querySelectorAll('script[type="importmap"]'));
  const resolveAt = (value, parent = documentURL, assetRoot = root) => resolve(value, parent, assetRoot, mount);
  const originalImports = {};
  const scopes = {};
  for (const map of maps) {
    const config = JSON.parse(map.textContent);
    Object.assign(originalImports, config.imports || {});
    for (const [scope, entries] of Object.entries(config.scopes || {})) {
      Object.assign(scopes[resolveAt(scope)] ||= {}, entries);
    }
  }

  async function css (text, parent, seen = new Set()) {
    // Tokenize strings/comments so sample CSS text is not rewritten as a URL.
    const pattern = /\/\*[\s\S]*?\*\/|@import\s+(?:url\(\s*)?(?:"([^"\r\n]+)"|'([^'\r\n]+)'|([^\s);]+))\s*\)?|url\(\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s)]*))\s*\)|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/gi;
    const edits = [];
    for (const match of text.matchAll(pattern)) {
      const imported = /^@import/i.test(match[0]);
      const value = imported ? match[1] ?? match[2] ?? match[3] : match[4] ?? match[5] ?? match[6];
      if (value === undefined || /^(?:data:|blob:|#)/i.test(value)) continue;
      const url = resolveAt(value, parent, bases.css || root);
      let replacement = url;
      if (imported) {
        if (seen.has(url)) throw new Error(`Circular CSS import: ${url}`);
        const nested = new Set(seen); nested.add(url);
        replacement = dataURL(await css((await read(url)).source, url, nested), "text/css");
      }
      edits.push({ start: match.index, end: match.index + match[0].length,
        text: `${imported ? "@import " : ""}url(${JSON.stringify(replacement)})` });
    }
    return replaceRanges(text, edits);
  }
  function condition (value) {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(condition).find(Boolean);
    return value && ["browser", "import", "default"].map(key => condition(value[key])).find(Boolean);
  }
  async function moduleURL (name, parent) {
    const tables = Object.keys(scopes).filter(scope => parent.startsWith(scope)).sort((a, b) => b.length - a.length)
      .map(scope => scopes[scope]).concat(originalImports);
    for (const table of tables) {
      const mapping = Object.keys(table).filter(key => key === name || key.endsWith("/") && name.startsWith(key))
        .sort((a, b) => b.length - a.length)[0];
      if (mapping) {
        if (typeof table[mapping] !== "string") throw new Error(`Import map blocks ${name}`);
        return resolveAt(table[mapping] + name.slice(mapping.length), documentURL);
      }
    }
    if (/^(?:[./]|[a-z][a-z\d+.-]*:)/i.test(name)) return resolveAt(name, parent, bases.script || root);
    const pieces = name.split("/");
    const pkgName = pieces.splice(0, name.startsWith("@") ? 2 : 1).join("/");
    const pkgRoot = new URL(`node_modules/${pkgName}/`, root).href;
    const pkg = JSON.parse((await read(new URL("package.json", pkgRoot).href)).source);
    const subpath = pieces.length ? "./" + pieces.join("/") : ".";
    const entry = condition(pkg.exports?.[subpath] || (subpath === "." ? pkg.exports : null)) ||
      (subpath !== "." ? subpath : typeof pkg.browser === "string" ? pkg.browser : pkg.module);
    if (!entry) throw new Error(`No browser ESM entry for ${name}; provide a built artifact or import map`);
    return resolveAt(entry, pkgRoot);
  }
  async function module (url, supplied, type = "javascript") {
    if (/^(?:data:|blob:)/i.test(url)) return url;
    if (modules.has(url)) return url; // reserve first: cyclic ESM graphs stay cyclic
    modules.set(url, null);
    let text = supplied ?? (await read(url)).source;
    if (type === "json") {
      JSON.parse(text);
      importMap.imports[url] = dataURL(text, "application/json");
      return url;
    }
    const edits = [];
    const [imports] = parse(text, url);
    for (const item of imports) {
      if (item.d === -2) {
        const suffix = /^\s*\.\s*url\b/.exec(text.slice(item.e));
        if (suffix) edits.push({ start: item.s, end: item.e + suffix[0].length, text: scriptJSON(url) });
        continue;
      }
      if (!item.n) throw new Error(`Computed dynamic import needs a built literal chunk map: ${url}`);
      const target = await moduleURL(item.n, url);
      const json = item.a >= 0 && /\btype\s*:\s*["']json["']/.test(text.slice(item.a, item.se));
      await module(target, undefined, json ? "json" : "javascript");
      edits.push({ start: item.s, end: item.e, text: item.d >= 0 ? scriptJSON(target) : scriptJSON(target).slice(1, -1) });
    }
    text = replaceRanges(text, edits);
    importMap.imports[url] = dataURL(text, "text/javascript");
    return url;
  }

  for (const link of Array.from(document.querySelectorAll('link[rel="stylesheet"]'))) {
    const url = resolveAt(link.getAttribute("href"), link.dataset.lnkrBase || bases.css || documentURL, bases.css || root);
    if (/^(?:data:|blob:)/i.test(url)) continue;
    const style = document.createElement("style");
    if (link.hasAttribute("media")) style.setAttribute("media", link.getAttribute("media"));
    style.textContent = await css((await read(url)).source, url, new Set([url]));
    style.dataset.lnkrCompiled = "";
    link.replaceWith(style);
  }
  for (const style of document.querySelectorAll("style[data-lnkr-base], style:not([data-lnkr-compiled])")) {
    style.textContent = await css(style.textContent, style.dataset.lnkrBase || bases.css || documentURL);
    delete style.dataset.lnkrBase;
  }
  for (const style of document.querySelectorAll("style[data-lnkr-compiled]")) delete style.dataset.lnkrCompiled;
  const scripts = Array.from(document.querySelectorAll("script"));
  for (const [index, script] of scripts.entries()) {
    if (["importmap", "application/ld+json", "application/json"].includes(script.type)) continue;
    if (script.type && !["module", "text/javascript", "application/javascript"].includes(script.type)) continue;
    const external = script.getAttribute("src");
    if (external && /^(?:data:|blob:)/i.test(external)) continue;
    const scriptBase = script.dataset.lnkrBase || bases.script || documentURL;
    const url = external ? resolveAt(external, scriptBase, bases.script || root) : script.dataset.lnkrSource || `${scriptBase}#inline-${index}`;
    const text = external ? (await read(url)).source : script.textContent;
    delete script.dataset.lnkrBase;
    delete script.dataset.lnkrSource;
    script.removeAttribute("integrity"); // original SRI cannot describe transformed runtime bytes
    script.removeAttribute("crossorigin");
    if (script.type === "module") {
      await module(url, text);
      script.removeAttribute("src");
      script.textContent = `import ${scriptJSON(url)};`;
    } else {
      script.setAttribute("src", dataURL(text, "text/javascript"));
      script.textContent = "";
    }
  }
  for (const old of maps) old.remove();
  if (modules.size) {
    const map = document.createElement("script");
    map.type = "importmap";
    map.textContent = scriptJSON(importMap);
    document.head.insertBefore(map, document.head.firstChild);
  }
  for (const preload of document.querySelectorAll('link[rel="modulepreload"], link[rel="preload"][as="script"], link[rel="preload"][as="style"]')) preload.remove();
  for (const element of document.querySelectorAll("[src], [href], [poster], [data], [style], [srcset]")) {
    const elementBase = element.dataset.lnkrBase || documentURL;
    for (const attribute of ["src", "href", "poster", "data"]) {
      const value = element.getAttribute(attribute);
      if (!value || /^(?:data:|blob:|#|mailto:|tel:|javascript:)/i.test(value)) continue;
      const url = resolveAt(value, elementBase, bases.body || root);
      if (navigate && attribute === "href" && element.localName === "a" && !element.hasAttribute("download") &&
          url.startsWith(root) && /(?:\.html?|\/)(?:[?#]|$)/i.test(url)) {
        element.setAttribute(attribute, await navigate(url));
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", `${element.getAttribute("rel") || ""} noopener noreferrer`.trim());
      } else element.setAttribute(attribute, url);
    }
    if (element.hasAttribute("style")) element.setAttribute("style", await css(element.getAttribute("style"), elementBase));
    if (element.hasAttribute("srcset") && !element.getAttribute("srcset").includes("data:")) {
      element.setAttribute("srcset", element.getAttribute("srcset").split(",").map(part =>
        part.trim().replace(/^\S+/, url => resolveAt(url, elementBase, bases.body || root))).join(", "));
    }
  }
  for (const frame of document.querySelectorAll("iframe[src]")) {
    const url = frame.getAttribute("src");
    if (!url.startsWith(root) || !/\.html?(?:[?#]|$)/i.test(url)) continue;
    const nested = parser().parseFromString((await read(url)).source, "text/html");
    frame.removeAttribute("src");
    frame.setAttribute("srcdoc", await materializeRepositoryHTML(nested, url, { root, mount, read, resolve, parser, navigate, depth: depth + 1 }));
  }
  for (const node of document.querySelectorAll("[data-lnkr-base]")) delete node.dataset.lnkrBase;
  if (base) base.setAttribute("href", documentURL);
  else {
    const element = document.createElement("base"); element.setAttribute("href", documentURL);
    document.head.insertBefore(element, document.head.firstChild);
  }
  return "<!doctype html>\n" + document.documentElement.outerHTML;
}

function replaceRanges (text, edits) {
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  return text;
}
