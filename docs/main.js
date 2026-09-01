import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "./alphabets.js";
import { compressText, decompressText } from "./text-compress.js";
import { renderContent } from "./render.js";

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
  run: document.querySelector("#run-code"),
  runner: document.querySelector("#runner"),
  runnerFrame: document.querySelector("#runner-frame"),
  runnerLog: document.querySelector("#runner-log"),
  stopRun: document.querySelector("#stop-run"),
  nativeDialog: document.querySelector("#native-run-dialog"),
  nativeClose: document.querySelector("#native-run-close"),
  nativeCancel: document.querySelector("#native-run-cancel"),
  nativeConfirm: document.querySelector("#native-run-confirm"),
  toast: document.querySelector("#toast")
};

let currentLink = "";
let currentDocument = null;
let qrModule = null;
let toastTimer = null;
let runToken = null;

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

function outputURL (payload) {
  return `${rootURL().href}#${payload}`;
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

function stopRunner () {
  runToken = null;
  elements.runnerFrame.removeAttribute("srcdoc");
  elements.runnerFrame.src = "about:blank";
  elements.runner.hidden = true;
  elements.runnerLog.textContent = "";
}

function updateRunMode () {
  const native = currentDocument?.kind === "javascript" && elements.parentScope.checked;
  elements.run.textContent = native ? "Run on page" : "Run in sandbox";
  elements.run.classList.toggle("native-run-button", native);
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
  renderContent(elements.preview, decoded.text, decoded.kind);
  elements.copyJSFuck.hidden = decoded.kind !== "javascript";
  elements.copyInvisible.hidden = decoded.kind !== "javascript";
  elements.runScopeControl.hidden = decoded.kind !== "javascript";
  if (decoded.kind !== "javascript") elements.parentScope.checked = false;
  elements.run.hidden = !["javascript", "html"].includes(decoded.kind);
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

  try {
    if (window.location.hash.length > 1) {
      const fragment = window.location.hash.slice(1);
      if (fragment.startsWith("q:")) {
        payload = decodeURIComponent(fragment.slice(2));
        alphabet = outputAlphabetQR;
      } else {
        payload = decodeURIComponent(fragment);
        alphabet = alphabetFromFragment(payload);
      }
    }

    if (!payload) return false;
    showViewer(decompressText(payload, alphabet), payload, alphabet);
    return true;
  } catch (error) {
    showToast(`This link is not a valid ln.kr document: ${error.message || error}`, "error");
    return false;
  }
}

async function copyRich () {
  if (!currentDocument) return;
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

function runCurrentDocument () {
  if (!currentDocument) return;
  runToken = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  elements.runner.hidden = false;
  elements.runnerLog.textContent = "";

  const policy = "default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
  if (currentDocument.kind === "html") {
    elements.runnerFrame.srcdoc = `<meta http-equiv="Content-Security-Policy" content="${policy}">${currentDocument.text}`;
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
}

function requestRun () {
  if (currentDocument?.kind === "javascript" && elements.parentScope.checked) {
    openDialog(elements.nativeDialog);
    return;
  }
  runCurrentDocument();
}

async function runInParentScope () {
  if (!currentDocument || currentDocument.kind !== "javascript") return;
  closeDialog(elements.nativeDialog);
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
elements.run.addEventListener("click", requestRun);
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
elements.nativeClose.addEventListener("click", () => closeDialog(elements.nativeDialog));
elements.nativeCancel.addEventListener("click", () => closeDialog(elements.nativeDialog));
elements.nativeConfirm.addEventListener("click", runInParentScope);
elements.nativeDialog.addEventListener("click", event => closeOnBackdrop(elements.nativeDialog, event));
window.addEventListener("message", event => {
  const data = event.data;
  if (
    event.source !== elements.runnerFrame.contentWindow ||
    !data || data.source !== "ln.kr-runner" || data.token !== runToken
  ) return;
  const line = document.createElement("div");
  line.dataset.level = data.level;
  line.textContent = `[${data.level}] ${data.args.join(" ")}`;
  elements.runnerLog.append(line);
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
