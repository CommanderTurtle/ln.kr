// Opt-in render recipes. None of these instructions enter the wire codec.
import { decodeLinkTarget, encodeLinkTarget, sourceResourceURL, splitLinkFragment, extractSingleLinkDocument } from "./link-runtime.js";
import { decodeDocumentPayload } from "./payload.js";
import { splitExecutableFragment } from "./viewer-runtime.js";
import { applySourceLineSlice, splitSourceLineSlice } from "./source-includes.js";
import { decorateJekyllMarkdown, themePalette } from "./repo-theme.js";
import { installPreviewAppearance, previewAppearanceBootstrap } from "./preview-appearance.js";
import { previewNavigationBootstrap } from "./preview-navigation.js";

const firstLine = /^\uFEFF?(?:style|theme)=(jekyll|zensical|node)[ \t]*(?:\r\n|\n|\r|$)/;
const keys = new Set(["repo", "artifact", "css", "body", "script", "base"]);
export const hasRepositoryHeader = source => firstLine.test(String(source));

export function parseRepositoryHeader (source) {
  const text = String(source);
  const first = firstLine.exec(text);
  if (!first) return null;
  const recipe = { theme: first[1], css: [], script: [] };
  let offset = first[0].length;
  for (const match of text.slice(offset).matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (!match[0]) break;
    const line = match[0].replace(/[\r\n]+$/, "");
    if (!line.trim()) { offset += match[0].length; break; }
    const entry = /^([a-z]+)=(.+)$/.exec(line);
    if (!entry || !keys.has(entry[1])) break;
    const [, key, raw] = entry;
    const value = raw.trim();
    if (["css", "script"].includes(key)) recipe[key].push(value);
    else {
      if (key in recipe) throw new Error(`Duplicate repository header: ${key}`);
      recipe[key] = value;
    }
    offset += match[0].length;
  }
  return { ...recipe, source: text.slice(offset) };
}

export function repositoryDocumentKind (source, fallback = "auto") {
  const recipe = parseRepositoryHeader(source);
  if (!recipe) return fallback;
  return recipe.theme === "node" || recipe.artifact || recipe.body || recipe.css.length || recipe.script.length ||
    /^\s*(?:<!doctype html|<html\b)/i.test(recipe.source) ? "html" : "markdown";
}

// A fetched recipe can become a self-contained editable link without losing
// the raw file's directory when the browser later reloads that new link.
export function anchorRepositoryHeader (source, sourceURL) {
  const recipe = parseRepositoryHeader(source);
  if (!recipe) return source;
  if (recipe.repo) return source.replace(/^(repo=)([^\r\n]+)/m, (_, key, value) => key + new URL(value.trim(), sourceURL).href);
  const first = firstLine.exec(source)[0];
  const newline = first.match(/\r\n|\n|\r/)?.[0] || "\n";
  return first.replace(/[\r\n]*$/, newline) + `repo=${new URL(".", sourceURL).href}${newline}` + source.slice(first.length);
}

/** Resolve a tree explicitly, without changing the established file-link router. */
export function repositoryDirectory (input) {
  const url = new URL(input);
  let match;
  if (/^(?:www\.)?github\.com$/i.test(url.hostname)) {
    match = /^\/([^/]+)\/([^/]+)(?:\/tree\/(.+))?\/?$/.exec(url.pathname);
    if (!match) throw new Error("Use a GitHub repository/tree directory, not a file, for repo/artifact.");
    url.href = `https://raw.githubusercontent.com/${match[1]}/${match[2]}/${match[3] || "HEAD"}`;
  } else if (/^(?:www\.)?huggingface\.co$/i.test(url.hostname)) {
    match = /^(\/(?:(?:datasets|spaces)\/)?[^/]+\/[^/]+)(?:\/tree\/(.+))?\/?$/.exec(url.pathname);
    if (match) url.pathname = `${match[1]}/resolve/${match[2] || "main"}`;
  }
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

export function isRepositoryTree (input) {
  const url = new URL(input);
  return /^(?:www\.)?(?:github\.com|huggingface\.co)$/i.test(url.hostname) &&
    /\/tree\//.test(url.pathname);
}

export function repositoryAssetURL (value, parent, root, mount = "/") {
  if (/^(?:data:|blob:|#)/i.test(value)) return value;
  if (value.startsWith("/") && !value.startsWith("//") && root) {
    const prefix = mount.endsWith("/") ? mount : mount + "/";
    return new URL(value.startsWith(prefix) ? value.slice(prefix.length) : value.slice(1), root).href;
  }
  return sourceResourceURL(new URL(value, parent).href);
}

const escape = value => String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
export function repositoryFrame (html) {
  // Authored scripts stay inert before Run. A nonce permits only our Markdown
  // appearance/bookmark controls in that otherwise inert preview.
  const controls = html.includes('data-lnkr-appearance=');
  const nonce = controls ? crypto.randomUUID().replaceAll('-', '') : '';
  const prefix = controls ? `<!--lnkr-controls--><meta http-equiv="Content-Security-Policy" content="script-src 'nonce-${nonce}'; script-src-elem 'nonce-${nonce}'; script-src-attr 'none'"><script nonce="${nonce}">${previewAppearanceBootstrap()}${previewNavigationBootstrap()}<\/script><!--/lnkr-controls-->` : '';
  return `<iframe data-lnkr-repository sandbox="${controls ? 'allow-scripts' : ''}" title="Repository preview" style="width:100%;height:75vh;border:0" srcdoc="${escape(prefix + html)}"></iframe>`;
}
export const activateRepositoryFrames = `document.querySelectorAll('iframe[data-lnkr-repository]').forEach(frame=>{frame.setAttribute('sandbox','allow-scripts allow-popups allow-popups-to-escape-sandbox');const source=frame.srcdoc;const end='<!--/lnkr-controls-->';frame.srcdoc=source.startsWith('<!--lnkr-controls-->')?source.slice(source.indexOf(end)+end.length):source;});`;

export function createRepositoryRenderer ({ appURL, fetchImpl = globalThis.fetch, renderMarkdown,
  expandModules = async text => text, styles = () => "", parser = () => new DOMParser(), limits = {} }) {
  const cap = { files: 256, bytes: 32 * 1024 * 1024, depth: 16, ...limits };
  const cache = new Map();
  const stack = new Set();
  const decodedLinks = new Map();
  let bytes = 0;
  const app = new URL(appURL);

  function shel (href) {
    const url = new URL(href);
    return url.origin === app.origin || url.hostname === "a.shel.sh";
  }
  function unwrap (pointer, base = appURL) {
    let url = new URL(pointer, base).href;
    for (let depth = 0; depth < cap.depth; depth++) {
      if (!shel(url)) return url;
      const route = splitLinkFragment(new URL(url).hash.slice(1));
      if (!route.mode) return url;
      url = decodeLinkTarget(splitSourceLineSlice(route.payload).payload).target;
    }
    throw new Error("Repository pointer nesting limit exceeded");
  }
  async function readURL (url, optional = false) {
    url = sourceResourceURL(url);
    if (!cache.has(url)) {
      if (cache.size >= cap.files) throw new Error(`Repository exceeds ${cap.files} files`);
      cache.set(url, (async () => {
        const response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
        if (response.status === 404) return null;
        if (!response.ok) throw new Error(`Repository file: ${response.status} ${url}`);
        const source = await response.text();
        bytes += new TextEncoder().encode(source).length;
        if (bytes > cap.bytes) throw new Error(`Repository exceeds ${cap.bytes} text bytes`);
        // Keep the repository path as the base; HF may redirect to signed CDN URLs.
        return { source, url, type: response.headers.get("content-type") || "" };
      })());
    }
    const result = await cache.get(url);
    if (!result && !optional) throw new Error(`Repository file not found: ${url}`);
    return result;
  }
  async function read (pointer, base = appURL, depth = 0) {
    if (depth > cap.depth) throw new Error("Repository pointer nesting limit exceeded");
    const href = new URL(pointer, base).href;
    if (shel(href) && new URL(href).hash) {
      const fragment = new URL(href).hash.slice(1);
      const route = splitLinkFragment(fragment);
      if (!route.mode) {
        if (!decodedLinks.has(fragment)) {
          const decoded = decodeDocumentPayload(splitExecutableFragment(fragment).payload).decoded;
          bytes += new TextEncoder().encode(decoded.text).length;
          if (bytes > cap.bytes) throw new Error(`Repository exceeds ${cap.bytes} text bytes`);
          decodedLinks.set(fragment, decoded);
        }
        const decoded = decodedLinks.get(fragment);
        return { source: decoded.text, url: base, kind: decoded.kind, type: "text/plain" };
      }
      const slice = splitSourceLineSlice(route.payload);
      const target = decodeLinkTarget(slice.payload).target;
      const record = await read(target, base, depth + 1);
      if (route.mode === "super-source" && !hasRepositoryHeader(record.source)) {
        const inner = extractSingleLinkDocument(record.source);
        // A raw pointer file may already have expanded to the document.
        if (!inner) return { ...record, source: applySourceLineSlice(record.source, slice.lineSlice) };
        return read(inner, record.url, depth + 1);
      }
      return { ...record, source: applySourceLineSlice(record.source, slice.lineSlice) };
    }
    const target = isRepositoryTree(href) ? new URL("index.html", repositoryDirectory(href)).href : href;
    const record = await readURL(target);
    return { ...record, ...await expandStoredSource(record.source, record.url, depth + 1) };
  }
  async function expandStoredSource (source, sourceURL, depth = 0) {
    // Only a bare shel URL denotes a compressed file. An authored <a> or a
    // sentence containing a link remains document content.
    const pointer = String(source).trim();
    if (!/^https?:\/\/[^\s]+$/i.test(pointer) || !shel(pointer) || !new URL(pointer).hash) return { source };
    const record = await read(pointer, sourceURL, depth + 1);
    return { ...record, url: sourceURL };
  }
  function directory (value, base) { return repositoryDirectory(unwrap(value, base)); }
  function resourceBase (value, base) {
    const url = unwrap(value, base);
    return isRepositoryTree(url) || url.endsWith("/") ? directory(url, base) :
      new URL(".", sourceResourceURL(url)).href;
  }
  async function configDirectory (theme, root) {
    const names = theme === "jekyll" ? ["_config.yml", "_config.yaml"] : ["zensical.toml", "mkdocs.yml", "mkdocs.yaml"];
    for (const name of names) {
      const record = await readURL(new URL(name, root).href, true);
      if (!record) continue;
      const key = theme === "jekyll" ? "destination" : "site_dir";
      const value = record.source.match(new RegExp(`^\\s*${key}\\s*[:=]\\s*["']?([^"'\\r\\n#]+)`, "m"))?.[1].trim();
      return new URL((value || (theme === "jekyll" ? "_site" : "site")) + "/", root).href;
    }
    return null;
  }

  async function prepare (source, kind, sourceURL = appURL, depth = 0) {
    const recipe = parseRepositoryHeader(source);
    if (!recipe) return null;
    const key = sourceURL + "\n" + source;
    if (depth > cap.depth || stack.has(key)) throw new Error("Circular/nested repository recipe");
    stack.add(key);
    try {
      const root = recipe.repo ? directory(recipe.repo, sourceURL) : new URL(".", sourceURL).href;
      let artifact = recipe.artifact ? directory(recipe.artifact, root) : null;
      let themeIndex = null;
      if (!artifact && recipe.repo && recipe.theme !== "node") artifact = await configDirectory(recipe.theme, root);
      if (artifact && recipe.theme !== "node") themeIndex = await readURL(new URL("index.html", artifact).href, true);
      const pointerBase = recipe.repo ? root : artifact || root;
      const bases = { body: recipe.body ? resourceBase(recipe.body, pointerBase) : null };
      const markdown = async text => renderMarkdown(await expandModules(text, "markdown"));
      const external = recipe.repo || artifact || bases.body || recipe.css.length || recipe.script.length || recipe.theme === "node";
      if (!external) return { source: recipe.source, kind: /^\s*(?:<!doctype html|<html\b)/i.test(recipe.source) ? "html" : "markdown", theme: recipe.theme };
      let text = await expandModules(recipe.source, "html");
      const htmlBody = /^\s*(?:<!doctype html|<html\b|<body\b)/i.test(text);
      const baseURL = new URL("index.html", bases.body || artifact || root).href;
      let document = parser().parseFromString(htmlBody ? text : "<!doctype html><html><head></head><body></body></html>", "text/html");
      if (htmlBody) text = "";
      if (text.trim()) {
        const target = document.querySelector("article.md-content__inner, article.md-typeset, .post-content, main article, main") || document.body;
        target.innerHTML = await markdown(text);
        target.classList.add("preview", "frame-preview", "md-typeset", "post-content");
        if (!themeIndex) target.classList.add(`lnkr-theme-${recipe.theme}`);
        if (recipe.theme === 'jekyll') decorateJekyllMarkdown(target);
        installPreviewAppearance(target);
        if (!htmlBody) {
          const style = document.createElement("style"); style.textContent = styles();
          document.head.insertBefore(style, document.head.firstChild);
        }
      }
      // Artifact discovery supplies styling only. Importing a page body or its
      // scripts always requires authored content or an explicit pointer.
      if (themeIndex) {
        const theme = parser().parseFromString(themeIndex.source, "text/html");
        if (!htmlBody) {
          for (const attribute of ["data-md-color-scheme", "data-md-color-primary", "data-md-color-accent"]) {
            const value = theme.body.getAttribute(attribute);
            if (value) document.body.setAttribute(attribute, value);
          }
          themePalette(theme, document);
          const content = document.querySelector('.frame-preview');
          if (content && document.body.dataset.lnkrPalettes) {
            content.dataset.lnkrAppearance = 'system';
            installPreviewAppearance(content);
          }
        }
        for (const node of theme.querySelectorAll('link[rel="stylesheet"], style')) {
          const clone = node.cloneNode(true);
          clone.dataset.lnkrBase = themeIndex.url;
          document.head.append(clone);
        }
      }
      for (const pointer of recipe.css) {
        const url = unwrap(pointer, pointerBase);
        if (isRepositoryTree(url) || url.endsWith("/")) {
          if (bases.css) throw new Error("Only one css directory base may be declared");
          bases.css = directory(url, pointerBase);
        } else {
          const record = await read(pointer, pointerBase);
          const style = document.createElement("style");
          style.textContent = record.source;
          style.dataset.lnkrBase = record.url;
          document.head.append(style);
        }
      }
      for (const pointer of recipe.script) {
        const url = unwrap(pointer, pointerBase);
        if (isRepositoryTree(url) || url.endsWith("/")) {
          if (bases.script) throw new Error("Only one script directory base may be declared");
          bases.script = directory(url, pointerBase);
        } else {
          const record = await read(pointer, pointerBase);
          const script = document.createElement("script");
          script.type = "module";
          script.textContent = record.source;
          script.dataset.lnkrBase = record.url;
          script.dataset.lnkrSource = record.url;
          document.body.append(script);
        }
      }
      const { materializeRepositoryHTML } = await import("./repo-assets.js");
      const navigate = async url => {
        const [{ compressTextV1 }, { outputAlphabetASCII }] = await Promise.all([import("./text-compress.js"), import("./alphabets.js")]);
        const target = new URL(url);
        if (target.pathname.endsWith("/")) target.pathname += "index.html";
        const link = appURL.split("#")[0] + "#sh:" + encodeLinkTarget(target.href).payload;
        const next = `style=node\nrepo=${artifact || root}\nbody=${new URL(".", target).href}\nbase=${recipeBase}\n\n${link}`;
        return appURL.split("#")[0] + "#h:" + compressTextV1(next, outputAlphabetASCII, "html").payload;
      };
      const recipeBase = recipe.base || "/";
      const html = await materializeRepositoryHTML(document, baseURL, {
        root: artifact || root, bases, mount: recipeBase, read: url => read(url), parser, navigate, depth,
        resolve: (value, parent, assetRoot, mount) => repositoryAssetURL(
          /^https?:/i.test(value) ? unwrap(value, parent) : value, parent, assetRoot, mount)
      });
      return { source: html.replace(/<\/body>/i, () => `<script>${activateRepositoryFrames}${previewAppearanceBootstrap()}${previewNavigationBootstrap()}<\/script></body>`), kind: "html", theme: recipe.theme };
    } finally { stack.delete(key); }
  }
  return { prepare, read, expandStoredSource, get files () { return cache.size; } };
}
