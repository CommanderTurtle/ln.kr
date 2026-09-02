import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "./alphabets.js";
import { countAlphabetSymbols } from "./compress.js";
import {
  decodeLinkTarget,
  encodeDirectLinkTarget,
  encodeLinkTarget,
  isImageLinkTarget,
  linkPrefixForMode,
  splitLinkFragment
} from "./link-runtime.js";
import { decodeDocumentPayload } from "./payload.js";
import { compressText } from "./text-compress.js";
import { renderContent } from "./render.js";
import {
  executablePrefixForKind,
  splitExecutableFragment
} from "./viewer-runtime.js";

const elements = {
  composer: document.querySelector("#composer"),
  linkComposer: document.querySelector("#link-composer"),
  linkModeToggle: document.querySelector("#link-mode-toggle"),
  siteModeLabel: document.querySelector("#site-mode-label"),
  linkForm: document.querySelector("#link-composer-form"),
  linkInput: document.querySelector("#link-source-input"),
  linkEmoji: document.querySelector("#link-setting-emoji"),
  linkCreate: document.querySelector("#create-link-link"),
  urlResult: document.querySelector("#url-result"),
  guardedOutput: document.querySelector("#guarded-link-output"),
  copyGuarded: document.querySelector("#copy-guarded-link"),
  copyResolved: document.querySelector("#copy-resolved-link"),
  copySource: document.querySelector("#copy-source-link"),
  copyLiveSource: document.querySelector("#copy-live-source-link"),
  copyImage: document.querySelector("#copy-image-link"),
  urlResultMeta: document.querySelector("#url-result-meta"),
  linkQueryWarning: document.querySelector("#link-query-warning"),
  linkQR: document.querySelector("#link-setting-qr"),
  linkQRLevelContainer: document.querySelector("#link-qr-correct-container"),
  linkQRLevel: document.querySelector("#link-qr-correct"),
  linkQRLevelLabel: document.querySelector("#link-qr-correct-label"),
  linkQRCanvas: document.querySelector("#link-qrcode"),
  linkQRWrap: document.querySelector("#link-qr-wrap"),
  linkGate: document.querySelector("#link-gate"),
  linkGateTarget: document.querySelector("#link-gate-target"),
  linkGateProceed: document.querySelector("#link-gate-proceed"),
  linkResolved: document.querySelector("#link-resolved"),
  linkResolvedLabel: document.querySelector("#link-resolved-label"),
  linkResolvedTarget: document.querySelector("#link-resolved-target"),
  linkResolvedCopy: document.querySelector("#link-resolved-copy"),
  linkResolvedOpen: document.querySelector("#link-resolved-open"),
  linkResolvedFrame: document.querySelector("#link-resolved-frame"),
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
let currentGuardedLink = "";
let currentResolvedLink = "";
let currentSourceLink = "";
let currentLiveSourceLink = "";
let currentImageLink = "";
let currentTarget = "";
let currentDocument = null;
let qrModule = null;
let toastTimer = null;
let runToken = null;
let currentRender = Promise.resolve();
let renderGeneration = 0;
let sourceResolveGeneration = 0;

function rootURL () {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/[^/]*$/, "");
  }
  return url;
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

function outputLinkURL (payload, mode) {
  return `${rootURL().href}#${linkPrefixForMode(mode)}${payload}`;
}

function resolverOrigin () {
  const root = rootURL();
  if (["localhost", "127.0.0.1", "::1"].includes(root.hostname)) return root.origin;
  return "https://lr.a.shel.sh";
}

function directResolverURL (target) {
  const encoded = encodeDirectLinkTarget(target);
  return `${resolverOrigin()}/lr/${encoded.payload}`;
}

function setHeaderMode (mode) {
  const linkMode = mode === "link";
  elements.siteModeLabel.textContent = linkMode ? "link in the link" : "text in the link";
  elements.linkModeToggle.textContent = linkMode ? "Text" : "Link";
  elements.linkModeToggle.setAttribute("aria-pressed", String(linkMode));
}

function hidePrimarySections ({ clearResolvedSource = true } = {}) {
  stopRunner();
  elements.composer.hidden = true;
  elements.linkComposer.hidden = true;
  elements.viewer.hidden = true;
  elements.linkGate.hidden = true;
  elements.linkResolved.hidden = true;
  if (clearResolvedSource) {
    elements.linkResolvedFrame.removeAttribute("src");
  }
}

function showComposerMode (mode) {
  hidePrimarySections();
  const linkMode = mode === "link";
  setHeaderMode(linkMode ? "link" : "text");
  elements.linkComposer.hidden = !linkMode;
  elements.composer.hidden = linkMode;
  document.title = linkMode ? "ln.kr · link in the link" : "ln.kr · text in the link";
  window.requestAnimationFrame(() => {
    (linkMode ? elements.linkInput : elements.input).focus();
  });
}

function qrURL (payload) {
  const root = rootURL();
  const path = `${root.pathname}T/${payload}`.toUpperCase();
  return `HTTPS://${root.host.toUpperCase()}${path}`;
}

function linkQRURL (payload) {
  const root = rootURL();
  const path = `${root.pathname}L/${payload}`.toUpperCase();
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

async function drawLinkQR (target) {
  elements.linkQRLevelContainer.hidden = !elements.linkQR.checked;
  if (!elements.linkQR.checked) {
    elements.linkQRWrap.hidden = true;
    return;
  }

  try {
    qrModule ||= await import("./lean-qr/lean-qr.js");
    const encoded = encodeLinkTarget(target, outputAlphabetQR).payload;
    const link = linkQRURL(encoded);
    const levels = [
      qrModule.correction.L,
      qrModule.correction.M,
      qrModule.correction.Q,
      qrModule.correction.H
    ];
    const names = ["L", "M", "Q", "H"];
    const levelIndex = Number(elements.linkQRLevel.value);
    elements.linkQRLevelLabel.textContent = names[levelIndex];
    const qr = qrModule.generate(
      qrModule.mode.alphaNumeric(link),
      {
        minVersion: 1,
        maxVersion: 40,
        minCorrectionLevel: levels[levelIndex],
        maxCorrectionLevel: qrModule.correction.H
      }
    );
    qr.toCanvas(elements.linkQRCanvas, {
      on: [18, 22, 20, 255],
      off: [244, 247, 243, 255],
      pad: 2
    });
    elements.linkQRCanvas.title = link;
    elements.linkQRWrap.hidden = false;
  } catch (error) {
    elements.linkQRWrap.hidden = true;
    showToast(`QR could not fit this link: ${error.message || error}`, "error");
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
    const symbols = countAlphabetSymbols(encoded.payload, alphabet);
    const ratio = source.length
      ? Math.round((1 - symbols / source.length) * 100)
      : 0;

    elements.outputLink.value = currentLink;
    const recordSummary = [
      `${symbols.toLocaleString()} payload symbols`,
      `${encoded.stats.dictionary} dictionary records`,
      `${encoded.stats.copy} repetition records`
    ];
    if (encoded.stats.patch) {
      recordSummary.push(`${encoded.stats.patch} structural delta records`);
    }
    recordSummary.push(
      ratio >= 0 ? `${ratio}% fewer symbols than source` : `${-ratio}% more symbols than source`
    );
    elements.resultMeta.textContent = recordSummary.join(" · ");
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

async function generateURLLinks () {
  const source = elements.linkInput.value;
  if (!source.trim()) {
    elements.urlResult.hidden = true;
    showToast("Enter a link first", "error");
    return;
  }

  elements.linkCreate.disabled = true;
  elements.linkCreate.textContent = "Compressing…";
  await new Promise(resolve => window.requestAnimationFrame(resolve));

  try {
    const alphabet = elements.linkEmoji.checked ? outputAlphabetEmoji : outputAlphabetASCII;
    const encoded = encodeLinkTarget(source, alphabet);
    currentGuardedLink = outputLinkURL(encoded.payload, "guarded");
    currentResolvedLink = directResolverURL(encoded.target);
    currentSourceLink = outputLinkURL(encoded.payload, "source");
    currentLiveSourceLink = outputLinkURL(encoded.payload, "source-live");
    currentImageLink = outputLinkURL(encoded.payload, "image");
    currentTarget = encoded.target;

    elements.guardedOutput.textContent = currentGuardedLink;
    elements.guardedOutput.href = currentGuardedLink;
    elements.copyImage.hidden = !isImageLinkTarget(encoded.target);
    elements.linkQueryWarning.hidden = new URL(encoded.target).searchParams.size <= 1;

    const symbols = countAlphabetSymbols(encoded.payload, alphabet);
    const sourceLength = encoded.target.length;
    const ratio = sourceLength ? Math.round((1 - symbols / sourceLength) * 100) : 0;
    elements.urlResultMeta.textContent = ratio > 0
      ? `Output is ${ratio}% smaller than the input`
      : ratio < 0
        ? `Output is ${-ratio}% larger than the input`
        : "Output is the same length as the input";
    elements.urlResult.hidden = false;
    await drawLinkQR(encoded.target);
  } catch (error) {
    elements.urlResult.hidden = true;
    showToast(error.message || String(error), "error");
  } finally {
    elements.linkCreate.disabled = false;
    elements.linkCreate.textContent = "Compress link";
  }
}

function showGuardedLink (target) {
  hidePrimarySections();
  setHeaderMode("link");
  currentTarget = target;
  elements.linkGateTarget.textContent = target;
  elements.linkGateTarget.href = target;
  elements.linkGateProceed.href = target;
  elements.linkGate.hidden = false;
  document.title = "ln.kr · continue to link";
}

function showResolvedLink (target) {
  hidePrimarySections();
  setHeaderMode("link");
  currentTarget = target;
  const direct = directResolverURL(target);
  elements.linkResolvedLabel.textContent = "Linkage · #lr:";
  elements.linkResolvedTarget.textContent = target;
  elements.linkResolvedOpen.href = direct;
  elements.linkResolvedFrame.src = direct;
  elements.linkResolved.hidden = false;
  document.title = "ln.kr · resolved link";
}

async function resolveSourceLink (target, live, generation) {
  hidePrimarySections();
  setHeaderMode("link");
  currentTarget = target;
  const direct = directResolverURL(target);
  elements.linkResolvedLabel.textContent = `Linkage · #${live ? "hs" : "s"}:`;
  elements.linkResolvedTarget.textContent = target;
  elements.linkResolvedOpen.href = direct;
  elements.linkResolvedFrame.src = "about:blank";
  elements.linkResolved.hidden = false;
  document.title = "ln.kr · resolving source";
  showToast("Resolving source…");

  try {
    const response = await fetch(direct, {
      headers: { accept: "text/html, application/xhtml+xml, text/plain;q=0.9, */*;q=0.1" }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    const source = await response.text();
    if (generation !== sourceResolveGeneration) return;
    await new Promise(resolve => window.requestAnimationFrame(resolve));
    const encoded = compressText(source, outputAlphabetASCII, "html");
    if (generation !== sourceResolveGeneration) return;
    history.replaceState(null, "", outputURL(encoded.payload, live ? "html" : ""));
    decodeLocation();
  } catch (error) {
    if (generation !== sourceResolveGeneration) return;
    elements.linkResolvedFrame.src = direct;
    showToast(`Source could not be resolved: ${error.message || error}`, "error");
  }
}

function imageViewerSource (target) {
  return `(function (src) {
    var d = document,
    o = d.createElement('div');
    o.style = 'position:fixed;inset:0;background:rgba(0,0,0,0.85);display:flex;align-items:center;justify-content:center;z-index:999999';
    var box = d.createElement('div');
    box.style = 'position:relative;width:100%;height:100%;overflow:hidden';
    var x = d.createElement('button');
    x.textContent = '✕';
    x.style = 'position:absolute;top:10px;right:10px;font-size:22px;padding:4px 10px;z-index:10';
    x.onclick = function () {
        o.remove();
    };
    var zi = d.createElement('button');
    zi.textContent = '+';
    zi.style = 'position:absolute;top:10px;left:10px;font-size:22px;padding:4px 10px;z-index:10';
    var zo = d.createElement('button');
    zo.textContent = '-';
    zo.style = 'position:absolute;top:10px;left:60px;font-size:22px;padding:4px 10px;z-index:10';
    var img = d.createElement('img');
    img.src = src;
    var img = d.createElement('img');
    img.src = src;
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.loading = 'eager';
    img.style = 'position:absolute;top:0;left:0;transform-origin:0 0;transform:translate(0px,0px) scale(1);cursor:grab';
    box.appendChild(img);
    box.appendChild(x);
    box.appendChild(zi);
    box.appendChild(zo);
    o.appendChild(box);
    d.body.appendChild(o);
    var scale = 1,
    tx = 0,
    ty = 0;
    function apply() {
        img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
    }
    zi.onclick = function () {
        scale = Math.min(10, scale * 1.25);
        apply();
    };
    zo.onclick = function () {
        scale = Math.max(0.1, scale / 1.25);
        apply();
    };
    var drag = false,
    px = 0,
    py = 0;
    box.addEventListener('mousedown', e => {
        drag = true;
        img.style.cursor = 'grabbing';
        px = e.clientX;
        py = e.clientY;
    });
    box.addEventListener('mouseup', () => {
        drag = false;
        img.style.cursor = 'grab';
    });
    box.addEventListener('mouseleave', () => {
        drag = false;
        img.style.cursor = 'grab';
    });
    box.addEventListener('mousemove', e => {
        if (!drag)
            return;
        tx += e.clientX - px;
        ty += e.clientY - py;
        px = e.clientX;
        py = e.clientY;
        apply();
    });
    box.addEventListener('wheel', e => {
        e.preventDefault();
        var rect = box.getBoundingClientRect(),
        cx = e.clientX - rect.left,
        cy = e.clientY - rect.top,
        old = scale;
        scale = e.deltaY < 0 ? Math.min(10, scale * 1.1) : Math.max(0.1, scale / 1.1);
        tx = cx - (cx - tx) * (scale / old);
        ty = cy - (cy - ty) * (scale / old);
        apply();
    });
})(${JSON.stringify(target)});`;
}

function showImageAlias (target) {
  const virtual = compressText(
    imageViewerSource(directResolverURL(target)),
    outputAlphabetASCII,
    "javascript"
  );
  const { decoded, payload, alphabet } = decodeDocumentPayload(
    virtual.payload,
    outputAlphabetASCII
  );
  showViewer(decoded, payload, alphabet);
  elements.parentScope.checked = true;
  updateRunMode();
  window.queueMicrotask(runInParentScope);
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
  hidePrimarySections();
  currentDocument = decoded;
  setHeaderMode("text");
  elements.viewer.hidden = false;
  elements.viewerKind.textContent = decoded.kind;
  const symbolCount = countAlphabetSymbols(payload, alphabet);
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
  const navigationGeneration = ++sourceResolveGeneration;
  let fragment = "";
  let alphabetHint = null;
  let executableKind = "";

  try {
    if (window.location.hash.length > 1) {
      fragment = window.location.hash.slice(1);

      const linkage = splitLinkFragment(fragment);
      if (linkage.mode) {
        fragment = linkage.payload;
        if (fragment.startsWith("q:")) {
          fragment = fragment.slice(2);
          alphabetHint = outputAlphabetQR;
        }
        const { target } = decodeLinkTarget(fragment, alphabetHint);
        if (linkage.mode === "resolved") showResolvedLink(target);
        else if (linkage.mode === "image") showImageAlias(target);
        else if (linkage.mode === "source" || linkage.mode === "source-live") {
          void resolveSourceLink(target, linkage.mode === "source-live", navigationGeneration);
        }
        else showGuardedLink(target);
        return true;
      }

      const executable = splitExecutableFragment(fragment);
      executableKind = executable.executableKind;
      fragment = executable.payload;
      if (fragment.startsWith("q:")) {
        fragment = fragment.slice(2);
        alphabetHint = outputAlphabetQR;
      }
    }

    if (!fragment) return false;
    let documentPayload;
    try {
      documentPayload = decodeDocumentPayload(fragment, alphabetHint);
    } catch (documentError) {
      if (executableKind || alphabetHint) throw documentError;
      const { target } = decodeLinkTarget(fragment);
      showGuardedLink(target);
      return true;
    }
    const { decoded, payload, alphabet } = documentPayload;
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
    showToast(`This is not a valid ln.kr payload: ${error.message || error}`, "error");
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
elements.linkForm.addEventListener("submit", event => {
  event.preventDefault();
  generateURLLinks();
});
elements.linkModeToggle.addEventListener("click", () => {
  const linkMode = elements.linkModeToggle.getAttribute("aria-pressed") !== "true";
  history.replaceState(null, "", rootURL());
  showComposerMode(linkMode ? "link" : "text");
});
elements.input.addEventListener("input", updateSourceCount);
elements.emoji.addEventListener("change", () => {
  if (!elements.result.hidden) generateLink();
});
elements.qr.addEventListener("change", () => {
  if (!elements.result.hidden) generateLink();
});
elements.linkEmoji.addEventListener("change", () => {
  if (!elements.urlResult.hidden) generateURLLinks();
});
elements.linkQR.addEventListener("change", () => {
  elements.linkQRLevelContainer.hidden = !elements.linkQR.checked;
  if (!elements.urlResult.hidden) drawLinkQR(currentTarget);
});
elements.linkQRLevel.addEventListener("input", () => {
  const names = ["L", "M", "Q", "H"];
  elements.linkQRLevelLabel.textContent = names[Number(elements.linkQRLevel.value)];
  if (!elements.urlResult.hidden && elements.linkQR.checked) drawLinkQR(currentTarget);
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
elements.copyGuarded.addEventListener("click", async () => {
  try {
    await copyText(currentGuardedLink);
    showToast("Guarded link copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.copyResolved.addEventListener("click", async () => {
  try {
    await copyText(currentResolvedLink);
    showToast("Direct source copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.copySource.addEventListener("click", async () => {
  try {
    await copyText(currentSourceLink);
    showToast("Editable source link copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.copyLiveSource.addEventListener("click", async () => {
  try {
    await copyText(currentLiveSourceLink);
    showToast("Live source link copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.copyImage.addEventListener("click", async () => {
  try {
    await copyText(currentImageLink);
    showToast("Image link copied");
  } catch (error) {
    showToast(error.message || String(error), "error");
  }
});
elements.linkResolvedCopy.addEventListener("click", async () => {
  try {
    await copyText(elements.linkResolvedFrame.src);
    showToast("Direct source copied");
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
  history.replaceState(null, "", rootURL());
  elements.input.value = source;
  elements.format.value = kind;
  updateSourceCount();
  showComposerMode("text");
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
  else showComposerMode("text");
});

if (!decodeLocation()) {
  elements.format.value = "auto";
  updateSourceCount();
  showComposerMode("text");
}
