import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { installPreviewNavigation, previewNavigationBootstrap } from "../docs/preview-navigation.js";
import { hardenRenderedLinks } from "../docs/render.js";

function fixture () {
  const calls = [];
  const handlers = {};
  const attributes = new Map();
  const target = {
    id: "the-cordis-research-paper",
    getAttribute: name => attributes.get(name) ?? null,
    hasAttribute: name => attributes.has(name),
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: name => attributes.delete(name),
    focus: options => calls.push(["focus", options]),
    scrollIntoView: options => calls.push(["scroll", options])
  };
  const root = {
    ...target,
    contains: element => element.inside !== false,
    querySelectorAll: () => [target],
    addEventListener: (type, handler) => { (handlers[type] ||= []).push(handler); }
  };
  const click = (href, options = {}) => {
    const link = { getAttribute: () => href, closest: () => link, ...options };
    const event = new Event(options.type || "click", { cancelable: true });
    Object.defineProperties(event, {
      target: { value: options.nested ? { nodeType: 3, parentElement: link } : link },
      button: { value: options.button ?? 0 },
      ctrlKey: { value: options.ctrlKey ?? false }
    });
    for (const handler of handlers[event.type] || []) handler(event);
    return event;
  };
  return { root, target, calls, handlers, click };
}

for (const mode of ["inline", "expanded", "expanded-loading"]) {
  test(`${mode} bookmarks jump without default fragment navigation`, () => {
    const f = fixture();
    let ready;
    const document = {
      readyState: mode === "expanded-loading" ? "loading" : "complete",
      querySelector: () => f.root,
      addEventListener: (type, fn) => { if (type === "DOMContentLoaded") ready = fn; }
    };
    const install = () => mode === "inline" ? installPreviewNavigation(f.root) :
      runInNewContext(previewNavigationBootstrap(), { document });
    install();
    ready?.();
    install();
    ready?.();
    expect(f.handlers.click).toHaveLength(1);
    expect(f.click("#the-cordis-research-paper", { nested: true }).defaultPrevented).toBe(true);
    expect(f.calls).toEqual([
      ["focus", { preventScroll: true }],
      ["scroll", { behavior: "instant", block: "start", inline: "nearest" }]
    ]);
    expect(f.target.hasAttribute("tabindex")).toBe(false);
    f.calls.length = 0;
    expect(f.click("#missing").defaultPrevented).toBe(true);
    expect(f.click("#bad%zz").defaultPrevented).toBe(true);
    expect(f.calls).toHaveLength(0);
    expect(f.click("#the-cordis-research-paper", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(f.click("#the-cordis-research-paper", { type: "auxclick", button: 1 }).defaultPrevented).toBe(true);
    expect(f.click("#the-cordis-research-paper", { inside: false }).defaultPrevented).toBe(false);
    expect(f.click("https://a.shel.sh/#document").defaultPrevented).toBe(false);
    expect(f.click("javascript:example()").defaultPrevented).toBe(false);
    f.target.id = "脚注:a.b";
    expect(f.click("#%E8%84%9A%E6%B3%A8%3Aa.b").defaultPrevented).toBe(true);
    expect(f.calls).toHaveLength(6);
    expect(f.click("#").defaultPrevented).toBe(true);
  });
}

test("fragment links are not assigned external-link attributes", () => {
  const link = href => {
    const attributes = new Map([["href", href]]);
    return {
      getAttribute: name => attributes.get(name) ?? null,
      hasAttribute: name => attributes.has(name),
      setAttribute: (name, value) => attributes.set(name, value)
    };
  };
  const local = link("#section");
  const external = link("https://example.com/#section");
  hardenRenderedLinks({ querySelectorAll: () => [local, external] });
  expect(local.getAttribute("href")).toBe("#section");
  expect(local.getAttribute("target")).toBeNull();
  expect(local.getAttribute("rel")).toBeNull();
  expect(external.getAttribute("target")).toBe("_blank");
  expect(external.getAttribute("rel")).toBe("noopener noreferrer");
});
