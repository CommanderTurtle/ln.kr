import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "./alphabets.js";
import { compressText, decompressText } from "./text-compress.js";
import { renderContent } from "./render.js";
import {
  executablePrefixForKind,
  splitExecutableFragment
} from "./viewer-runtime.js";

const elements = {
  composer: document.querySelector("#composer"),
  viewer: document.querySelector("#viewer"),
  form: document.querySelector("#composer-form"),
  input: document.querySelector("#source-input"),
  format: document.querySelector("#source-format"),
  emoji: document.querySelector("#setting-emoji"),
  qr: document.querySelector("#setting-qr"),
  sourceCount: document.querySelector("#source-count"),
  create: document.querySelector("#create-link"),
  result: document.querySelector("#link-result"),
  outputLink: document.querySelector("#output-link"),
  resultMeta: document.querySelector("#result-meta"),
  resultWarning: document.querySelector("#result-warning"),
  copyLink: document.querySelector("#copy-link"),
  copyRunLink: document.querySelector("#copy-run-link"),
  openLink: document.querySelector("#open-link"),
  qrCanvas: document.querySelector("#qrcode"),
  qrWrap: document.querySelector("#qr-wrap"),
  aboutOpen: document.querySelector("#about-open"),
  aboutDialog: document.querySelector("#about-dialog"),
  aboutClose: document.querySelector("#about-close"),
  viewerKind: document.querySelector("#viewer-kind"),
  viewerMeta: document.querySelector("#viewer-meta"),
  viewerSummary: document.querySelector("#viewer-summary"),
  preview: document.querySelector("#preview"),
  sourceView: document.querySelector("#source-view"),
  renderTab: document.querySelector("#tab-rendered"),
  sourceTab: document.querySelector("#tab-source"),
  edit: document.querySelector("#edit-source"),
  copyRaw: document.querySelector("#copy-raw"),
  copyRich: document.querySelector("#copy-rich"),
  copyJSFuck: document.querySelector("#copy-jsfuck"),
  copyInvisible: document.querySelector("#copy-invisible"),
  runScopeControl: document.querySelector("#run-scope-control"),
  parentScope: document.querySelector("#run-parent-scope"),
  networkControl: document.querySelector("#network-control"),
  network: document.querySelector("#run-network"),
  run: document.querySelector("#run-code"),
  runner: document.querySelector("#runner"),
  runnerFrame: document.querySelector("#runner-frame"),
  runnerStatus: document.querySelector("#runner-status"),
  runnerLog: document.querySelector("#runner-log"),
  expandRun: document.querySelector("#expand-run"),
  collapseRun: document.querySelector("#collapse-run"),
  stopRun: document.querySelector("#stop-run"),
  toast: document.querySelector("#toast")
};

let currentLink = "";
let currentRunLink = "";
let currentDocument = null;
let qrModule = null;
let toastTimer = null;
let runToken = null;
let currentRender = Promise.resolve();
let renderGeneration = 0;

function rootURL () {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/[^/]*$/, "");
  }
  return url;
}

function countSymbols (string, alphabet) {
  let count = 0;
  while (string) {
    const symbol = alphabet.find(value => string.endsWith(value));
    if (!symbol) throw new Error("Payload contains a symbol outside its alphabet");
    string = string.slice(0, -symbol.length);
    count ++;
  }
  return count;
}

function showToast (message, tone = "ok") {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.dataset.tone = tone;
  elements.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    elements.toast.hidden = true;
  }, 2600);
}

function openDialog (dialog) {
  if (!dialog.open) dialog.showModal();
}

function closeDialog (dialog) {
  if (dialog.open) dialog.close();
}

function closeOnBackdrop (dialog, event) {
  if (event.target === dialog) dialog.close();
}

async function copyText (value) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Clipboard access was denied");
  }
}

function updateSourceCount () {
  const text = elements.input.value;
  const bytes = new TextEncoder().encode(text).length;
  elements.sourceCount.textContent = `${text.length.toLocaleString()} characters · ${bytes.toLocaleString()} UTF-8 bytes`;
}

function outputURL (payload, executableKind = "") {
  return `${rootURL().href}#${executablePrefixForKind(executableKind)}${payload}`;
}

function qrURL (payload) {
  const root = rootURL();
  const path = `${root.pathname}T/${payload}`.toUpperCase();
  return `HTTPS://${root.host.toUpperCase()}${path}`;
}

async function drawQR () {
  if (!elements.qr.checked) {
    elements.qrWrap.hidden = true;
    return;
  }

  try {
    qrModule ||= await import("./lean-qr/lean-qr.js");
    const encoded = compressText(
      elements.input.value,
      outputAlphabetQR,
      elements.format.value
    ).payload;
    const link = qrURL(encoded);
    const qr = qrModule.generate(
      qrModule.mode.alphaNumeric(link),
      {
        minVersion: 1,
        maxVersion: 40,
        minCorrectionLevel: qrModule.correction.M,
        maxCorrectionLevel: qrModule.correction.H
      }
    );
    qr.toCanvas(elements.qrCanvas, {
      on: [18, 22, 20, 255],
      off: [244, 247, 243, 255],
      pad: 2
    });
    elements.qrCanvas.title = link;
    elements.qrWrap.hidden = false;
  } catch (error) {
    elements.qrWrap.hidden = true;
    showToast(`QR could not fit this document: ${error.message || error}`, "error");
  }
}

async function generateLink () {
  const source = elements.input.value;
  if (!source) {
    elements.result.hidden = true;
    showToast("Write or paste something first", "error");
    return;
  }

  elements.create.disabled = true;
  elements.create.textContent = "Encoding…";
  await new Promise(resolve => window.requestAnimationFrame(resolve));

  try {
    const alphabet = elements.emoji.checked ? outputAlphabetEmoji : outputAlphabetASCII;
    const encoded = compressText(source, alphabet, elements.format.value);
    currentLink = outputURL(encoded.payload);
    currentRunLink = executablePrefixForKind(encoded.kind)
      ? outputURL(encoded.payload, encoded.kind)
      : "";
    const symbols = countSymbols(encoded.payload, alphabet);
    const ratio = source.length
      ? Math.round((1 - symbols / source.length) * 100)
      : 0;

    elements.outputLink.value = currentLink;
    elements.resultMeta.textContent = [
      `${symbols.toLocaleString()} payload symbols`,
      `${encoded.stats.dictionary} dictionary records`,
      `${encoded.stats.copy} repetition records`,
      ratio >= 0 ? `${ratio}% fewer symbols than source` : `${-ratio}% more symbols than source`
    ].join(" · ");
    elements.resultWarning.hidden = currentLink.length <= 8000;
    elements.openLink.href = currentLink;
    elements.copyRunLink.hidden = !currentRunLink;
    elements.copyRunLink.dataset.kind = encoded.kind;
    elements.copyRunLink.textContent = encoded.kind === "javascript"
      ? "Copy auto-run link"
      : "Copy live-view link";
    elements.result.hidden = false;
    await drawQR();
  } catch (error) {
    elements.result.hidden = true;
    showToast(error.message || String(error), "error");
  } finally {
    elements.create.disabled = false;
    elements.create.textContent = "Create ln.kr link";
  }
}

function alphabetFromFragment (payload) {
  return Array.from(payload).some(character => !outputAlphabetASCII.includes(character))
    ? outputAlphabetEmoji
    : outputAlphabetASCII;
}

function setRunnerExpanded (expanded) {
  elements.runner.classList.toggle("runner-expanded", expanded);
  document.body.classList.toggle("runner-is-expanded", expanded);
  elements.expandRun.hidden = expanded;
  elements.expandRun.setAttribute("aria-expanded", String(expanded));
  elements.collapseRun.hidden = !expanded;
  if (expanded) elements.collapseRun.focus({ preventScroll: true });
}

function stopRunner () {
  runToken = null;
  setRunnerExpanded(false);
  elements.runnerFrame.setAttribute("sandbox", "allow-scripts");
  elements.runnerFrame.removeAttribute("srcdoc");
  elements.runnerFrame.src = "about:blank";
  elements.runner.hidden = true;
  elements.runnerLog.textContent = "";
}

function updateRunMode () {
  const native = currentDocument?.kind === "javascript" && elements.parentScope.checked;
  const documentViewer = ["markdown", "html"].includes(currentDocument?.kind);
  elements.run.textContent = native ? "Run on page" : "Run in sandbox";
  elements.run.classList.toggle("native-run-button", native);
  elements.networkControl.hidden = !documentViewer;
  elements.runnerStatus.textContent = documentViewer && elements.network.checked
    ? "Scripts allowed · network allowed · unique origin"
    : "Scripts allowed · network blocked · unique origin";
}

function showViewer (decoded, payload, alphabet) {
  currentDocument = decoded;
  stopRunner();
  elements.composer.hidden = true;
  elements.viewer.hidden = false;
  elements.viewerKind.textContent = decoded.kind;
  const symbolCount = countSymbols(payload, alphabet);
  elements.viewerMeta.textContent = `${decoded.text.length.toLocaleString()} characters · ${symbolCount.toLocaleString()} link symbols · format v${decoded.version}`;
  elements.viewerSummary.textContent = `${decoded.kind} · ${decoded.text.length.toLocaleString()} characters · format v${decoded.version}`;
  elements.sourceView.textContent = decoded.text;
  const generation = ++renderGeneration;
  currentRender = renderContent(elements.preview, decoded.text, decoded.kind)
    .catch(error => {
      if (generation !== renderGeneration) return;
      elements.preview.textContent = decoded.text;
      showToast(`Rendered preview failed: ${error.message || error}`, "error");
    });
  elements.copyJSFuck.hidden = decoded.kind !== "javascript";
  elements.copyInvisible.hidden = decoded.kind !== "javascript";
  elements.runScopeControl.hidden = decoded.kind !== "javascript";
  if (decoded.kind !== "javascript") elements.parentScope.checked = false;
  elements.networkControl.hidden = false;
  elements.network.checked = false;
  elements.run.hidden = !["javascript", "markdown", "html"].includes(decoded.kind);
  updateRunMode();
  selectTab("rendered");
  document.title = `ln.kr · ${decoded.kind}`;
}

function selectTab (tab) {
  const rendered = tab === "rendered";
  elements.preview.hidden = !rendered;
  elements.sourceView.hidden = rendered;
  elements.renderTab.setAttribute("aria-selected", String(rendered));
  elements.sourceTab.setAttribute("aria-selected", String(!rendered));
}

function decodeLocation () {
  let payload = "";
  let alphabet = outputAlphabetASCII;
  let executableKind = "";

  try {
    if (window.location.hash.length > 1) {
      let fragment = window.location.hash.slice(1);
      const executable = splitExecutableFragment(fragment);
      executableKind = executable.executableKind;
      fragment = executable.payload;
      if (fragment.startsWith("q:")) {
        payload = decodeURIComponent(fragment.slice(2));
        alphabet = outputAlphabetQR;
      } else {
        payload = decodeURIComponent(fragment);
        alphabet = alphabetFromFragment(payload);
      }
    }

    if (!payload) return false;
    const decoded = decompressText(payload, alphabet);
    if (executableKind && decoded.kind !== executableKind) {
      throw new Error(`The ${executablePrefixForKind(executableKind)} link marker requires ${executableKind}`);
    }
    showViewer(decoded, payload, alphabet);
    if (executableKind === "javascript") {
      elements.parentScope.checked = true;
      updateRunMode();
      window.queueMicrotask(runInParentScope);
    } else if (["markdown", "html"].includes(executableKind)) {
      elements.network.checked = true;
      updateRunMode();
      window.queueMicrotask(async () => {
        await currentRender;
        await runCurrentDocument({ expand: true, scroll: false });
      });
    }
    return true;
  } catch (error) {
    showToast(`This link is not a valid ln.kr document: ${error.message || error}`, "error");
    return false;
  }
}

async function copyRich () {
  if (!currentDocument) return;
  await currentRender;
  const html = elements.preview.innerHTML;
  try {
    if (!window.ClipboardItem || !navigator.clipboard?.write) {
      throw new Error("Rich clipboard is unavailable");
    }
    const item = new ClipboardItem({
      "text/plain": new Blob([currentDocument.text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" })
    });
    await navigator.clipboard.write([item]);
    showToast("Rich rendering copied");
  } catch {
    await copyText(currentDocument.text);
    showToast("Raw source copied (rich clipboard unavailable)");
  }
}

function invisibleJavaScript (source) {
  const invisible = [...source].map(character => {
    const binary = character.charCodeAt(0).toString(2).padStart(8, "0");
    return [...binary].map(bit => bit === "0" ? "\uffa0" : "\u3164").join("");
  }).join("");
  return `new Proxy({},{get:(_,n)=>eval([...n].map(n=>+("ﾠ">n)).join\`\`.replace(/.{8}/g,n=>String.fromCharCode(+("0b"+n))))}).\n${invisible}`;
}

function collectFrameStyles () {
  const rules = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) rules.push(rule.cssText);
    } catch {
      // Every renderer stylesheet is local. Ignore a browser that withholds one.
    }
  }
  rules.push("html,body{min-height:100%;margin:0}");
  rules.push("body{padding:clamp(1rem,3vw,2.5rem);background:#111512}");
  rules.push(".frame-preview{min-height:0;padding:0;overflow:visible}");
  return rules.join("\n");
}

function documentLinkBootstrap (token, copyCode = false) {
  const serializedToken = JSON.stringify(token);
  return `
(() => {
  const harden = root => {
    const links = root.matches?.("a[href]") ? [root] : root.querySelectorAll?.("a[href]") || [];
    for (const link of links) {
      if (/^\\s*javascript\\s*:/i.test(link.getAttribute("href") || "")) continue;
      if (!link.hasAttribute("target")) link.setAttribute("target", "_blank");
      const rel = new Set((link.getAttribute("rel") || "").split(/\\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      link.setAttribute("rel", Array.from(rel).join(" "));
    }
  };
  addEventListener("DOMContentLoaded", () => harden(document));
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) harden(node);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  ${copyCode ? `const copyText = async text => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      try {
        return document.execCommand("copy");
      } finally {
        textarea.remove();
      }
    }
  };
  document.addEventListener("click", async event => {
    const copy = event.target.closest?.("[data-copy-code]");
    if (copy) {
      const block = copy.closest(".code-block, .mermaid-block");
      const code = block?.querySelector("pre code");
      if (code) {
        const text = code.textContent || "";
        let copied = false;
        try {
          copied = await copyText(text);
        } catch {
          copied = false;
        }
        if (!copied) {
          parent.postMessage({ source: "ln.kr-copy", token: ${serializedToken}, text }, "*");
        }
        const original = copy.textContent;
        copy.textContent = "Copied";
        setTimeout(() => { copy.textContent = original; }, 1200);
      }
      return;
    }
  });` : ""}
  harden(document);
})();`;
}

function revealRunner ({ expand, scroll }) {
  if (expand) setRunnerExpanded(true);
  if (scroll && !elements.runner.classList.contains("runner-expanded")) {
    window.requestAnimationFrame(() => {
      elements.runner.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

async function runCurrentDocument ({ expand = false, scroll = true } = {}) {
  if (!currentDocument) return;
  if (currentDocument.kind === "markdown") await currentRender;
  runToken = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  elements.runner.hidden = false;
  elements.runnerLog.textContent = "";
  updateRunMode();

  const policy = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
  if (currentDocument.kind === "html") {
    const allowNetwork = elements.network.checked;
    elements.runnerFrame.setAttribute("sandbox", allowNetwork
      ? "allow-scripts allow-popups allow-popups-to-escape-sandbox"
      : "allow-scripts");
    elements.runnerFrame.srcdoc = allowNetwork
      ? currentDocument.text
      : `<meta http-equiv="Content-Security-Policy" content="${policy}"><script>${documentLinkBootstrap(runToken)}<\/script>${currentDocument.text}`;
    revealRunner({ expand, scroll });
    return;
  }

  if (currentDocument.kind === "markdown") {
    const allowNetwork = elements.network.checked;
    elements.runnerFrame.setAttribute("sandbox", allowNetwork
      ? "allow-scripts allow-popups allow-popups-to-escape-sandbox"
      : "allow-scripts");
    const meta = allowNetwork
      ? ""
      : `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
    const bootstrap = `<script>${documentLinkBootstrap(runToken, true)}<\/script>`;
    elements.runnerFrame.srcdoc = `<!doctype html><html><head>${meta}<style>${collectFrameStyles()}</style>${bootstrap}</head><body><article class="preview frame-preview">${elements.preview.innerHTML}</article></body></html>`;
    revealRunner({ expand, scroll });
    return;
  }

  const source = JSON.stringify(currentDocument.text).replaceAll("<", "\\u003c");
  const token = JSON.stringify(runToken);
  elements.runnerFrame.srcdoc = `<!doctype html>
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>body{font:15px/1.5 system-ui;padding:20px;color:#e7eee8;background:#111512}#app{min-height:4rem}</style>
<div id="app"></div>
<script>
const token=${token};
const send=(level,args)=>parent.postMessage({source:"ln.kr-runner",token,level,args:args.map(value=>{try{return typeof value==="string"?value:JSON.stringify(value)}catch{return String(value)}})},"*");
for(const level of ["log","info","warn","error"]){console[level]=(...args)=>send(level,args)}
addEventListener("error",event=>send("error",[event.message]));
const executable=document.createElement("script");
executable.textContent=${source};
document.body.append(executable);
<\/script>`;
  revealRunner({ expand, scroll });
}

async function requestRun () {
  if (currentDocument?.kind === "javascript" && elements.parentScope.checked) {
    await runInParentScope();
    return;
  }
  await runCurrentDocument();
}

async function runInParentScope () {
  if (!currentDocument || currentDocument.kind !== "javascript") return;
  stopRunner();

  try {
    const result = window.eval(currentDocument.text);
    if (result && typeof result.then === "function") await result;
    showToast("JavaScript finished in parent scope");
  } catch (error) {
    showToast(`Parent-scope error: ${error.message || error}`, "error");
  }
}

elements.form.addEventListener("submit", event => {
  event.preventDefault();
  generateLink();
});
elements.input.addEventListener("input", updateSourceCount);
elements.emoji.addEventListener("change", () => {
  if (!elements.result.hidden) generateLink();
});
elements.qr.addEventListener("change", () => {
  if (!elements.result.hidden) generateLink();
});
elements.copyLink.addEventListener("click", async () => {
  try {
    await copyText(currentLink);
    showToast("Link copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.copyRunLink.addEventListener("click", async () => {
  try {
    await copyText(currentRunLink);
    showToast(elements.copyRunLink.dataset.kind === "javascript"
      ? "Auto-run link copied"
      : "Live-view link copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.renderTab.addEventListener("click", () => selectTab("rendered"));
elements.sourceTab.addEventListener("click", () => selectTab("source"));
elements.copyRaw.addEventListener("click", async () => {
  try {
    await copyText(currentDocument.text);
    showToast("Exact source copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.copyRich.addEventListener("click", copyRich);
elements.copyJSFuck.addEventListener("click", async () => {
  if (!window.JSFuck) return showToast("JSFuck encoder did not load", "error");
  elements.copyJSFuck.disabled = true;
  showToast("Encoding JSFuck…");
  await new Promise(resolve => window.setTimeout(resolve, 0));
  try {
    await copyText(window.JSFuck.encode(
      currentDocument.text,
      true,
      elements.parentScope.checked
    ));
    showToast(elements.parentScope.checked
      ? "Parent-scope JSFuck copied"
      : "Executable JSFuck copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  } finally {
    elements.copyJSFuck.disabled = false;
  }
});
elements.copyInvisible.addEventListener("click", async () => {
  try {
    await copyText(invisibleJavaScript(currentDocument.text));
    showToast("AEM1K-style invisible JavaScript copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.parentScope.addEventListener("change", updateRunMode);
elements.network.addEventListener("change", updateRunMode);
elements.run.addEventListener("click", requestRun);
elements.expandRun.addEventListener("click", () => setRunnerExpanded(true));
elements.collapseRun.addEventListener("click", () => setRunnerExpanded(false));
elements.stopRun.addEventListener("click", stopRunner);
elements.edit.addEventListener("click", () => {
  const source = currentDocument.text;
  const kind = currentDocument.kind;
  stopRunner();
  history.replaceState(null, "", rootURL());
  elements.viewer.hidden = true;
  elements.composer.hidden = false;
  elements.input.value = source;
  elements.format.value = kind;
  updateSourceCount();
  elements.input.focus();
  document.title = "ln.kr · text in the link";
});
elements.aboutOpen.addEventListener("click", () => openDialog(elements.aboutDialog));
elements.aboutClose.addEventListener("click", () => closeDialog(elements.aboutDialog));
elements.aboutDialog.addEventListener("click", event => closeOnBackdrop(elements.aboutDialog, event));
window.addEventListener("message", event => {
  const data = event.data;
  if (
    event.source !== elements.runnerFrame.contentWindow ||
    !data || data.token !== runToken
  ) return;

  if (data.source === "ln.kr-copy" && typeof data.text === "string") {
    copyText(data.text).catch(error => showToast(error.message || String(error), "error"));
    return;
  }
  if (data.source !== "ln.kr-runner") return;
  const line = document.createElement("div");
  line.dataset.level = data.level;
  line.textContent = `[${data.level}] ${data.args.join(" ")}`;
  elements.runnerLog.append(line);
});
window.addEventListener("keydown", event => {
  if (event.key === "Escape" && elements.runner.classList.contains("runner-expanded")) {
    setRunnerExpanded(false);
  }
});
window.addEventListener("hashchange", () => {
  if (window.location.hash) decodeLocation();
});

if (!decodeLocation()) {
  elements.composer.hidden = false;
  elements.viewer.hidden = true;
  elements.format.value = "auto";
  updateSourceCount();
}
