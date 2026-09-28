import { combinedZipBytes, downloadCombinedFile } from "./combined-markdown.js";

/** A local file browser. renderFile must not execute source code. */
export function createCombinedBrowser(bundle, source, renderFile) {
  const root = document.createElement("section");
  root.className = "combined-browser";
  root.setAttribute("aria-label", "Combined Markdown files");
  const style = document.createElement("style");
  style.textContent = `
.combined-browser{border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:10px;overflow:hidden;min-width:0;font:14px/1.5 system-ui}
.combined-browser .cb-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}
.combined-browser button,.combined-browser input{font:inherit;color:inherit;background:transparent;border:1px solid color-mix(in srgb,currentColor 25%,transparent);border-radius:5px;padding:5px 9px;cursor:pointer}
.combined-browser button:disabled{opacity:.5;cursor:default}.combined-browser button[aria-pressed=true]{background:color-mix(in srgb,currentColor 12%,transparent)}
.combined-browser .cb-notice{margin:0;padding:0 10px 10px;font-size:12px;opacity:.8}.combined-browser .cb-layout{display:grid;grid-template-columns:minmax(160px,25%) minmax(0,1fr)}
.combined-browser .cb-sidebar{padding:10px;border-right:1px solid color-mix(in srgb,currentColor 18%,transparent);max-height:65vh;overflow:auto}.combined-browser .cb-filter{width:100%;box-sizing:border-box;margin-bottom:10px;cursor:text}
.combined-browser .cb-tree details{margin:3px 0 3px 8px}.combined-browser .cb-tree summary{cursor:pointer;overflow-wrap:anywhere}.combined-browser .cb-file{display:block;text-align:left;border:0;width:100%;overflow-wrap:anywhere;margin:2px 0}
.combined-browser .cb-main{min-width:0}.combined-browser .cb-path{flex:1;overflow-wrap:anywhere;min-width:100px}.combined-browser .cb-content{padding:12px;min-height:250px;max-height:65vh;overflow:auto}.combined-browser .cb-content pre{margin:0;overflow:auto;white-space:pre;font:13px/1.6 ui-monospace,monospace}
.combined-browser .cb-full{margin:0;padding:12px;max-height:70vh;overflow:auto;white-space:pre-wrap}.combined-browser [hidden]{display:none!important}
@media(max-width:600px){.combined-browser .cb-layout{grid-template-columns:1fr}.combined-browser .cb-sidebar{max-height:190px;border-right:0;border-bottom:1px solid color-mix(in srgb,currentColor 18%,transparent)}}`;
  const make = (tag, className = "", text = "") => {
    const element = document.createElement(tag);
    element.className = className; element.textContent = text;
    return element;
  };
  const button = (text, action) => {
    const element = make("button", "", text);
    element.type = "button"; element.addEventListener("click", action); return element;
  };
  const toolbar = make("div", "cb-toolbar");
  const title = make("strong", "cb-path", `${bundle.entries.length} files · combined.md`);
  const notice = make("p", "cb-notice");
  notice.setAttribute("role", "status");
  notice.textContent = `${bundle.omitted ? `${bundle.omitted} omitted file(s) cannot be recovered. ` : ""}ZIP contains preserved text files as UTF-8.${bundle.legacyNewlines ? " Older combined documents may include an added final newline." : ""}`;
  const zip = button("Download ZIP", () => {
    try { downloadCombinedFile(combinedZipBytes(bundle.entries), "combined.zip", "application/zip"); }
    catch (error) { notice.textContent = error.message; }
  });
  zip.disabled = bundle.included === 0;
  const layout = make("div", "cb-layout");
  const full = make("pre", "cb-full", source);
  full.hidden = true;
  const fullButton = button("Full source", () => {
    full.hidden = !full.hidden; layout.hidden = !full.hidden;
    fullButton.textContent = full.hidden ? "Full source" : "Browse files";
  });
  toolbar.append(title, fullButton, zip);
  const sidebar = make("aside", "cb-sidebar");
  const filter = make("input", "cb-filter");
  filter.type = "search"; filter.placeholder = "Filter files…";
  filter.setAttribute("aria-label", "Filter combined files");
  const tree = make("nav", "cb-tree");
  tree.setAttribute("aria-label", "File tree");
  sidebar.append(filter, tree);
  const main = make("div", "cb-main");
  const fileToolbar = make("div", "cb-toolbar");
  const pathLabel = make("strong", "cb-path");
  let selected = bundle.entries.find(entry => entry.text !== undefined) || bundle.entries[0];
  let preview = true;
  let revision = 0;
  const content = make("div", "cb-content");
  const show = async () => {
    const generation = ++revision;
    pathLabel.textContent = selected.path;
    sourceButton.setAttribute("aria-pressed", String(!preview));
    previewButton.setAttribute("aria-pressed", String(preview));
    fileDownload.disabled = selected.text === undefined;
    // Each selection gets its own host, so slow diagrams cannot replace a newer file.
    const host = make("div");
    content.replaceChildren(host);
    if (selected.text === undefined) { host.textContent = `Omitted: ${selected.omittedReason}`; return; }
    if (!preview) { host.append(make("pre", "", selected.text)); return; }
    try { await renderFile(host, selected); }
    catch (error) {
      if (generation === revision) { host.replaceChildren(make("pre", "", selected.text)); notice.textContent = `Preview unavailable: ${error.message}`; }
    }
  };
  const sourceButton = button("Source", () => { preview = false; void show(); });
  const previewButton = button("Preview", () => { preview = true; void show(); });
  const fileDownload = button("Download file", () => {
    if (selected.text !== undefined) downloadCombinedFile(selected.text, selected.path.split("/").at(-1), "text/plain;charset=utf-8");
  });
  fileToolbar.append(pathLabel, sourceButton, previewButton, fileDownload);
  main.append(fileToolbar, content); layout.append(sidebar, main);
  const drawTree = () => {
    tree.replaceChildren();
    const folders = new Map([["", tree]]);
    let matches = 0;
    for (const entry of bundle.entries) {
      if (!entry.path.toLowerCase().includes(filter.value.toLowerCase())) continue;
      matches++;
      const parts = entry.path.split("/");
      let parentPath = "";
      for (const part of parts.slice(0, -1)) {
        const folderPath = `${parentPath}${part}/`;
        if (!folders.has(folderPath)) {
          const details = make("details"); details.open = true;
          details.append(make("summary", "", part));
          folders.get(parentPath).append(details); folders.set(folderPath, details);
        }
        parentPath = folderPath;
      }
      const leaf = button(`${parts.at(-1)}${entry.omittedReason ? " (omitted)" : ""}`, () => {
        selected = entry;
        for (const item of tree.querySelectorAll("button")) item.setAttribute("aria-pressed", String(item === leaf));
        void show();
      });
      leaf.className = "cb-file"; leaf.title = entry.path;
      leaf.setAttribute("aria-pressed", String(entry === selected));
      folders.get(parentPath).append(leaf);
    }
    if (!matches) tree.append(make("p", "", "No matching files."));
  };
  filter.addEventListener("input", drawTree);
  root.append(style, toolbar, notice, layout, full);
  drawTree(); void show();
  return root;
}
