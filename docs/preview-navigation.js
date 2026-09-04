/** Self-contained so the same handler can run in serialized Markdown previews. */
export function installPreviewNavigation (root) {
  if (!root || root.__lnkrPreviewNavigation) return;
  root.__lnkrPreviewNavigation = true;

  const jump = event => {
    if (event.defaultPrevented || (event.type === "auxclick" && event.button !== 1)) return;
    const origin = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    const control = origin?.closest?.("a[href]");
    if (!control || !root.contains(control)) return;
    const href = (control.getAttribute("href") || "").trim();
    if (!href.startsWith("#")) return;

    // Even a missing bookmark must not replace ln.kr's document payload or open a tab.
    event.preventDefault();
    const fragment = href.slice(1);
    let id = fragment;
    try { id = decodeURIComponent(fragment); } catch { /* Literal percent in an ID. */ }
    const targets = Array.from(root.querySelectorAll("[id],a[name]"));
    const matches = (node, value) => node.id === value || node.getAttribute("name") === value;
    const target = !fragment ? root :
      targets.find(node => matches(node, id)) || targets.find(node => matches(node, fragment));
    if (!target) return;

    const temporaryFocus = !target.hasAttribute("tabindex");
    if (temporaryFocus) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: "instant", block: "start", inline: "nearest" });
    if (temporaryFocus) target.removeAttribute("tabindex");
  };
  root.addEventListener("click", jump);
  root.addEventListener("auxclick", jump);
}

export function previewNavigationBootstrap () {
  return `(() => {
    const install = ${installPreviewNavigation.toString()};
    const ready = () => install(document.querySelector(".frame-preview"));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready, { once: true });
    else ready();
  })();`;
}
