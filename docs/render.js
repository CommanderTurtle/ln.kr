let mermaidLoad = null;
let mermaidReady = false;

function requireRenderer (name, value) {
  if (!value) throw new Error(`${name} did not load`);
  return value;
}

function isJavaScriptLink (link) {
  return /^\s*javascript\s*:/i.test(link.getAttribute("href") || "");
}

export function hardenRenderedLinks (container) {
  for (const link of container.querySelectorAll("a[href]")) {
    if (isJavaScriptLink(link)) continue;
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

function makeCodeToolbar (label, findCode) {
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

  toolbar.append(language, copy);
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

function decorateCodeBlock (pre, language = "") {
  const code = pre.querySelector(":scope > code");
  if (!code || pre.parentElement?.classList.contains("code-block")) return;

  highlightCode(code, language);
  const wrapper = document.createElement("div");
  wrapper.className = "code-block";
  pre.replaceWith(wrapper);
  wrapper.append(
    makeCodeToolbar(language || "code", () => wrapper.querySelector("pre code")),
    pre
  );
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

export async function renderMarkdown (container, source) {
  const parser = requireRenderer("Marked", window.marked);
  const parsed = parser.parse(source, {
    gfm: true,
    breaks: false,
    pedantic: false,
    silent: false
  });

  container.innerHTML = parsed;
  hardenRenderedLinks(container);
  await renderMermaidBlocks(container);
  hardenRenderedLinks(container);

  for (const code of Array.from(container.querySelectorAll("pre > code"))) {
    if (code.closest(".mermaid-source")) continue;
    decorateCodeBlock(code.parentElement, languageOf(code));
  }
}

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
