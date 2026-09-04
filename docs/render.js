import {
  renderZensicalMarkdown,
  zensicalInteractionBootstrap
} from "./zensical.js";
import { installPreviewNavigation } from "./preview-navigation.js";

let mermaidLoad = null;
let mermaidReady = false;
let mathJaxLoad = null;

function requireRenderer (name, value) {
  if (!value) throw new Error(`${name} did not load`);
  return value;
}

function isJavaScriptLink (link) {
  return /^\s*javascript\s*:/i.test(link.getAttribute("href") || "");
}

export function hardenRenderedLinks (container) {
  for (const link of container.querySelectorAll("a[href]")) {
    if (isJavaScriptLink(link) || (link.getAttribute("href") || "").trim().startsWith("#")) continue;
    if (!link.hasAttribute("target")) link.setAttribute("target", "_blank");

    const rel = new Set((link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
    rel.add("noopener");
    rel.add("noreferrer");
    link.setAttribute("rel", Array.from(rel).join(" "));
  }
}

async function copyCode (code, button) {
  try {
    await navigator.clipboard.writeText(code.textContent || "");
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("copy");
    selection.removeAllRanges();
  }

  const original = button.textContent;
  button.textContent = "Copied";
  window.setTimeout(() => { button.textContent = original; }, 1200);
}

function selectCode (code, button) {
  const range = document.createRange();
  range.selectNodeContents(code);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  const original = button.textContent;
  button.textContent = "Selected";
  window.setTimeout(() => { button.textContent = original; }, 1200);
}

function makeCodeToolbar (label, findCode, selectable = false) {
  const toolbar = document.createElement("div");
  toolbar.className = "code-toolbar";

  const language = document.createElement("span");
  language.textContent = label || "code";

  const copy = document.createElement("button");
  copy.type = "button";
  copy.dataset.copyCode = "";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => {
    const code = findCode();
    if (code) copyCode(code, copy);
  });

  const actions = document.createElement("span");
  actions.className = "code-toolbar-actions";
  if (selectable) {
    const select = document.createElement("button");
    select.type = "button";
    select.dataset.selectCode = "";
    select.textContent = "Select";
    select.addEventListener("click", () => {
      const code = findCode();
      if (code) selectCode(code, select);
    });
    actions.append(select);
  }
  actions.append(copy);
  toolbar.append(language, actions);
  return toolbar;
}

function languageOf (code) {
  const className = Array.from(code.classList)
    .find(value => value.startsWith("language-"));
  return className?.slice("language-".length) || code.dataset.language || "";
}

function highlightCode (code, language) {
  const highlighter = requireRenderer("highlight.js", window.hljs);
  const source = code.textContent || "";

  try {
    const result = language && highlighter.getLanguage(language)
      ? highlighter.highlight(source, { language, ignoreIllegals: true })
      : highlighter.highlightAuto(source);
    code.innerHTML = result.value;
    code.classList.add("hljs");
  } catch {
    code.textContent = source;
  }
}

function highlightedLine (source, language) {
  const highlighter = requireRenderer("highlight.js", window.hljs);
  try {
    return language && highlighter.getLanguage(language)
      ? highlighter.highlight(source, { language, ignoreIllegals: true }).value
      : highlighter.highlightAuto(source).value;
  } catch {
    const span = document.createElement("span");
    span.textContent = source;
    return span.innerHTML;
  }
}

function highlightedLines (code, language, metadata) {
  const source = code.textContent || "";
  const start = Number.parseInt(metadata.linenums, 10) || 1;
  const selected = new Set();
  for (const token of String(metadata.highlights || "").split(/\s+/).filter(Boolean)) {
    const range = token.match(/^(\d+)-(\d+)$/);
    if (range) {
      for (let line = Number(range[1]); line <= Number(range[2]); line++) selected.add(line);
    } else if (/^\d+$/.test(token)) selected.add(Number(token));
  }

  code.replaceChildren();
  code.classList.add("hljs", "zensical-numbered-code");
  const lines = source.endsWith("\n") ? source.slice(0, -1).split("\n") : source.split("\n");
  for (const [index, line] of lines.entries()) {
    const number = start + index;
    const wrapper = document.createElement("span");
    wrapper.className = `zensical-code-line${selected.has(index + 1) || selected.has(number) ? " is-highlighted" : ""}`;
    wrapper.id = `__span-${number}`;
    wrapper.dataset.line = String(number);
    wrapper.innerHTML = highlightedLine(line, language) || " ";
    code.append(wrapper);
  }
}

function codeMetadata (pre) {
  try {
    return JSON.parse(pre.dataset.zensicalCode || "{}");
  } catch {
    return {};
  }
}

function decorateCodeBlock (pre, language = "") {
  const code = pre.querySelector(":scope > code");
  if (!code || pre.parentElement?.classList.contains("code-block")) return;

  const metadata = codeMetadata(pre);
  const actualLanguage = metadata.language || language;
  if (metadata.linenums || metadata.highlights) highlightedLines(code, actualLanguage, metadata);
  else highlightCode(code, actualLanguage);
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  if (metadata.id) wrapper.id = metadata.id;
  if (metadata.classes?.length) wrapper.classList.add(...metadata.classes);
  pre.replaceWith(wrapper);
  wrapper.append(
    makeCodeToolbar(metadata.title || actualLanguage || "code", () => wrapper.querySelector("pre code"), true),
    pre
  );
}

function decorateCodeAnnotations (container) {
  for (const block of container.querySelectorAll(".code-block")) {
    const notes = block.nextElementSibling;
    if (!notes?.matches("ol")) continue;
    const labels = Array.from(notes.children).filter(item => item.matches("li"));
    if (!labels.length) continue;
    const code = block.querySelector("pre code");
    const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
    const walker = document.createTreeWalker(code, showText);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (!/\((\d+)\)!?/.test(node.data)) continue;
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      for (const match of node.data.matchAll(/\((\d+)\)!?/g)) {
        const position = Number(match[1]) - 1;
        if (!labels[position]) {
          fragment.append(node.data.slice(cursor, match.index + match[0].length));
          cursor = match.index + match[0].length;
          continue;
        }
        fragment.append(node.data.slice(cursor, match.index));
        const marker = document.createElement("button");
        marker.type = "button";
        marker.className = "code-annotation";
        marker.textContent = match[1];
        marker.title = labels[position].textContent.trim();
        marker.addEventListener("click", () => labels[position].scrollIntoView({ block: "center" }));
        fragment.append(marker);
        cursor = match.index + match[0].length;
      }
      if (!cursor) continue;
      fragment.append(node.data.slice(cursor));
      node.replaceWith(fragment);
    }
    notes.classList.add("code-annotations");
  }
}

function loadMermaid () {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (mermaidLoad) return mermaidLoad;

  mermaidLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./vendor/mermaid.min.js", import.meta.url).href;
    script.async = true;
    script.addEventListener("load", () => resolve(requireRenderer("Mermaid", window.mermaid)), { once: true });
    script.addEventListener("error", () => reject(new Error("Mermaid did not load")), { once: true });
    document.head.append(script);
  });

  return mermaidLoad;
}

function createMermaidBlock (pre, source) {
  const wrapper = document.createElement("section");
  wrapper.className = "mermaid-block";

  const diagram = document.createElement("div");
  diagram.className = "mermaid-diagram mermaid";
  diagram.textContent = source;

  const sourceDetails = document.createElement("details");
  sourceDetails.className = "mermaid-source";
  const summary = document.createElement("summary");
  summary.textContent = "Diagram source";
  sourceDetails.append(summary);

  wrapper.append(
    makeCodeToolbar("mermaid", () => wrapper.querySelector(".mermaid-source code")),
    diagram,
    sourceDetails
  );
  return { diagram, sourceDetails, wrapper };
}

async function renderMermaidBlocks (container) {
  const records = [];
  for (const code of container.querySelectorAll("pre > code")) {
    if (languageOf(code).toLowerCase() !== "mermaid") continue;
    const pre = code.parentElement;
    const source = code.textContent || "";
    const record = createMermaidBlock(pre, source);
    pre.replaceWith(record.wrapper);
    record.sourceDetails.append(pre);
    records.push(record);
  }

  if (!records.length) return;

  const mermaid = await loadMermaid();
  if (!mermaidReady) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "dark",
      suppressErrorRendering: true,
      maxTextSize: 100000,
      maxEdges: 2000
    });
    mermaidReady = true;
  }

  for (const { diagram, wrapper } of records) {
    try {
      await mermaid.run({ nodes: [diagram], suppressErrors: true });
    } catch (error) {
      diagram.classList.remove("mermaid");
      diagram.classList.add("mermaid-error");
      diagram.textContent = `Mermaid could not render this diagram: ${error.message || error}`;
      wrapper.querySelector(".mermaid-source").open = true;
    }
  }
}

function loadMathJax () {
  if (window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);
  if (mathJaxLoad) return mathJaxLoad;
  window.MathJax = {
    tex: { inlineMath: [["\\(", "\\)"]], displayMath: [["\\[", "\\]"]] },
    options: { ignoreHtmlClass: ".*|", processHtmlClass: "arithmatex" }
  };
  mathJaxLoad = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://unpkg.com/mathjax@3.2.2/es5/tex-mml-chtml.js";
    script.async = true;
    script.addEventListener("load", () => resolve(window.MathJax), { once: true });
    script.addEventListener("error", () => reject(new Error("MathJax did not load")), { once: true });
    document.head.append(script);
  });
  return mathJaxLoad;
}

export async function renderMarkdown (container, source) {
  const parser = requireRenderer("Marked", window.marked);
  const zensical = await renderZensicalMarkdown(container, source, parser);
  installPreviewNavigation(container);
  hardenRenderedLinks(container);
  await renderMermaidBlocks(container);
  hardenRenderedLinks(container);

  for (const code of container.querySelectorAll("code[data-inline-language]")) {
    highlightCode(code, code.dataset.inlineLanguage);
  }

  for (const code of Array.from(container.querySelectorAll("pre > code"))) {
    if (code.closest(".mermaid-source")) continue;
    decorateCodeBlock(code.parentElement, languageOf(code));
  }
  decorateCodeAnnotations(container);
  if (zensical.hasMath) {
    try {
      const mathJax = await loadMathJax();
      await mathJax.typesetPromise([container]);
    } catch {
      // Formulas remain readable TeX when the optional network renderer is unavailable.
    }
  }
}

export { zensicalInteractionBootstrap };

const javascriptPattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|return|class|new|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|async|await|import|export|from|true|false|null|undefined|this|typeof|instanceof)\b|\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b)/gi;

export function renderCode (container, source, language = "text") {
  container.replaceChildren();
  const pre = document.createElement("pre");
  pre.className = "source-code";
  const code = document.createElement("code");
  code.dataset.language = language;

  if (language !== "javascript") {
    code.textContent = source;
  } else {
    let cursor = 0;
    for (const match of source.matchAll(javascriptPattern)) {
      code.append(document.createTextNode(source.slice(cursor, match.index)));
      const span = document.createElement("span");
      const token = match[0];
      span.className = token.startsWith("/") ? "tok-comment" :
        /^[`"']/.test(token) ? "tok-string" :
          /^\d|^0x/i.test(token) ? "tok-number" : "tok-keyword";
      span.textContent = token;
      code.append(span);
      cursor = match.index + token.length;
    }
    code.append(document.createTextNode(source.slice(cursor)));
  }

  pre.append(code);
  container.append(pre);
}

export async function renderContent (container, source, kind) {
  if (kind === "markdown") {
    await renderMarkdown(container, source);
  } else {
    renderCode(container, source, kind);
  }
}
