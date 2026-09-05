import { describe, expect, test } from "bun:test";
import { outputAlphabetASCII } from "../docs/alphabets.js";
import { encodeLinkTarget } from "../docs/link-runtime.js";
import {
  applySourceLineSlice,
  expandResolvedResourceLinks,
  expandSourceIncludes,
  sourceLinkFromLine,
  splitSourceLineSlice
} from "../docs/source-includes.js";

const appURL = "https://a.shel.sh/";
const sourceLink = (target, prefix = "s:") => {
  const { payload } = encodeLinkTarget(target, outputAlphabetASCII);
  return `${appURL}#${prefix}${payload}`;
};

function sourceHarness (sources, overrides = {}) {
  let fetches = 0;
  return {
    get fetches () { return fetches; },
    options: {
      appURL,
      resourceURLForTarget: target => target,
      fetchImpl: async url => {
        fetches ++;
        const target = String(url);
        const record = sources.get(target);
        if (!record) return new Response("missing", { status: 404, statusText: "Not Found" });
        return new Response(record.body, {
          headers: {
            "content-type": record.type || "text/plain; charset=utf-8",
            "x-lnkr-source-url": target
          }
        });
      },
      ...overrides
    }
  };
}

describe("source includes", () => {
  test("expands route-two URLs only in a private runtime copy", () => {
    const target = "https://raw.example.test/image.webp";
    const direct = sourceLink(target, "lr:");
    const authored = [
      `<img src="${direct}">`,
      `const source = ${JSON.stringify(direct)};`,
      `![animated source](${direct})`,
      `.hero { background-image: url(${direct}); }`,
      sourceLink(target, "l:"),
      "https://elsewhere.test/#lr:not-this-app"
    ].join("\n");

    const runtime = expandResolvedResourceLinks(authored, { appURL });
    expect(runtime).toContain(`<img src="${target}">`);
    expect(runtime).toContain(`const source = ${JSON.stringify(target)};`);
    expect(runtime).toContain(`![animated source](${target})`);
    expect(runtime).toContain(`background-image: url(${target})`);
    expect(runtime).toContain(sourceLink(target, "l:"));
    expect(runtime).toContain("https://elsewhere.test/#lr:not-this-app");
    expect(authored).toContain(direct);
  });

  test("expands route-two URLs after safe HTML attribute escaping", () => {
    let target = "";
    let direct = "";
    for (let index = 0; index < 10_000; index ++) {
      target = `https://raw.example.test/image.webp?variant=${index}`;
      direct = sourceLink(target, "lr:");
      if (direct.includes("&")) break;
    }
    expect(direct).toContain("&");

    const authored = `<img src="${direct.replaceAll("&", "&amp;")}">`;
    const runtime = expandResolvedResourceLinks(authored, { appURL });
    expect(runtime).toBe(`<img src="${target.replaceAll("&", "&amp;")}">`);
  });

  test("parses and applies CMD-style zero-based line slices exactly", () => {
    expect(splitSourceLineSlice("payload")).toEqual({ payload: "payload", lineSlice: null });
    expect(splitSourceLineSlice("payload::~0:5")).toEqual({
      payload: "payload",
      lineSlice: { start: 0, span: 5 }
    });
    expect(splitSourceLineSlice("payload::~3")).toEqual({
      payload: "payload",
      lineSlice: { start: 3, span: null }
    });
    expect(splitSourceLineSlice("payload::~2:-2")).toEqual({
      payload: "payload",
      lineSlice: { start: 2, span: -2 }
    });

    const mixedEndings = "zero\r\none\ntwo\rthree\r\nfour\n";
    expect(applySourceLineSlice(mixedEndings, { start: 0, span: 2 }))
      .toBe("zero\r\none\n");
    expect(applySourceLineSlice(mixedEndings, { start: 2, span: null }))
      .toBe("two\rthree\r\nfour\n");
    expect(applySourceLineSlice(mixedEndings, { start: 1, span: -2 }))
      .toBe("one\ntwo\r");
    expect(applySourceLineSlice(mixedEndings, { start: -2, span: null }))
      .toBe("three\r\nfour\n");
    expect(applySourceLineSlice(mixedEndings, { start: 50, span: null })).toBe("");
  });

  test("recognizes only bare source-route lines from this app", () => {
    const target = "https://raw.example.test/module.js";
    const link = sourceLink(target, "sj:");
    expect(sourceLinkFromLine(`  ${link}\r\n`, appURL)).toMatchObject({
      indent: "  ",
      ending: "\r\n",
      lineSlice: null,
      target
    });
    expect(sourceLinkFromLine(`${link}::~4:-2\n`, appURL)).toMatchObject({
      ending: "\n",
      lineSlice: { start: 4, span: -2 },
      target
    });
    expect(sourceLinkFromLine(`[module](${link})\n`, appURL)).toBeNull();
    expect(sourceLinkFromLine(`${appURL}#s:`, appURL)).toBeNull();
    expect(sourceLinkFromLine(sourceLink(target, "lr:"), appURL)).toBeNull();
    expect(sourceLinkFromLine(sourceLink(target, "hs:"), appURL)?.mode).toBe("source-live");
    expect(sourceLinkFromLine(sourceLink("https://raw.example.test/image.webp", "i:"), appURL)?.mode).toBe("image");
    expect(sourceLinkFromLine(sourceLink("https://raw.example.test/paper.pdf", "pdf:"), appURL)?.mode).toBe("pdf");
    expect(sourceLinkFromLine(`https://elsewhere.test/${link.slice(link.indexOf("#"))}`, appURL))
      .toBeNull();
  });

  test("expands Markdown, JavaScript, and CSS through the existing source route", async () => {
    const markdown = "https://raw.example.test/readme.md";
    const javascript = "https://raw.example.test/module.js";
    const css = "https://raw.example.test/theme.css";
    const sources = new Map([
      [markdown, { body: "## Imported\n\nExact Markdown.\n", type: "text/markdown" }],
      [javascript, { body: "const imported = 42;\n", type: "text/javascript" }],
      [css, { body: ".imported { color: rebeccapurple; }", type: "text/css" }]
    ]);
    const harness = sourceHarness(sources);
    const authored = [
      "# Parent",
      sourceLink(markdown, "sm:"),
      `  ${sourceLink(javascript, "sj:")}`,
      sourceLink(css),
      ""
    ].join("\n");

    const expanded = await expandSourceIncludes(authored, harness.options);
    expect(expanded.text).toBe([
      "# Parent",
      "## Imported",
      "",
      "Exact Markdown.",
      "  const imported = 42;",
      ".imported { color: rebeccapurple; }",
      ""
    ].join("\n"));
    expect(expanded.modules).toBe(3);
    expect(harness.fetches).toBe(3);
  });

  test("turns bare source and media routes into runtime media modules", async () => {
    const image = "https://raw.example.test/animated.avif";
    const video = "https://raw.example.test/clip.webm";
    const pdf = "https://raw.example.test/paper.pdf";
    const harness = sourceHarness(new Map(), {
      documentKind: "markdown",
      resourceLinkForTarget: target => sourceLink(target, "lr:")
    });
    const authored = [
      sourceLink(image, "s:"),
      sourceLink(video, "media:"),
      sourceLink(pdf, "pdf:")
    ].join("\n");

    const expanded = await expandSourceIncludes(authored, harness.options);
    expect(harness.fetches).toBe(0);
    expect(expanded.text).toContain("lnkr-module-image");
    expect(expanded.text).toContain("<img src=\"");
    expect(expanded.text).toContain("lnkr-module-video");
    expect(expanded.text).toContain("<video src=\"");
    expect(expanded.text).toContain("data-lnkr-pdf-source");
    expect(expanded.text).toContain("new Blob([bytes],{type:'application/pdf'})");
    expect(expanded.text).toContain("#lr:");
  });

  test("adds a hoverable exact-source capsule without changing authored shorthand", async () => {
    const target = "https://raw.example.test/module.md";
    const link = sourceLink(target, "sm:");
    const harness = sourceHarness(new Map([
      [target, { body: "## Imported\n", type: "text/markdown" }]
    ]), { documentKind: "markdown", showModuleSource: true });

    const expanded = await expandSourceIncludes(link, harness.options);
    expect(expanded.text).toContain("## Imported\n");
    expect(expanded.text).toContain("lnkr-module-source");
    expect(expanded.text).toContain(link.replaceAll("&", "&amp;"));
    expect(link).toContain("#sm:");
  });

  test("supports nested modules, detects cycles, and fetches repeated targets once", async () => {
    const first = "https://raw.example.test/first.md";
    const second = "https://raw.example.test/second.md";
    const sources = new Map([
      [first, { body: `before\n${sourceLink(second)}\nafter` }],
      [second, { body: "nested" }]
    ]);
    const harness = sourceHarness(sources);
    const expanded = await expandSourceIncludes(
      `${sourceLink(first)}\n${sourceLink(second)}`,
      harness.options
    );
    expect(expanded.text).toBe("before\nnested\nafter\nnested");
    expect(expanded.modules).toBe(3);
    expect(harness.fetches).toBe(2);

    sources.set(second, { body: sourceLink(first) });
    await expect(expandSourceIncludes(sourceLink(first), sourceHarness(sources).options))
      .rejects.toThrow("Circular source include");
  });

  test("slices repeated raw modules before nested expansion and fetches each target once", async () => {
    const target = "https://raw.example.test/large-module.js";
    const sources = new Map([
      [target, { body: "zero\r\none\r\ntwo\r\nthree\r\nfour\r\n", type: "text/javascript" }]
    ]);
    const harness = sourceHarness(sources);
    const link = sourceLink(target, "sj:");
    const authored = [
      `${link}::~0:2`,
      `${link}::~2:-1`,
      `${link}::~4`
    ].join("\n");

    const expanded = await expandSourceIncludes(authored, harness.options);
    expect(expanded.text).toBe("zero\r\none\r\ntwo\r\nthree\r\nfour\r\n");
    expect(expanded.modules).toBe(3);
    expect(harness.fetches).toBe(1);
  });

  test("keeps #lr links literal and restricts binary modules to rendered documents", async () => {
    const binary = "https://raw.example.test/manual.pdf";
    const direct = sourceLink("https://images.example.test/image.webp", "lr:");
    const harness = sourceHarness(new Map([
      [binary, { body: new Uint8Array([0x25, 0x50, 0x44, 0x46]), type: "application/pdf" }]
    ]));

    const untouched = await expandSourceIncludes(direct, harness.options);
    expect(untouched.text).toBe(direct);
    expect(untouched.modules).toBe(0);
    expect(harness.fetches).toBe(0);

    await expect(expandSourceIncludes(sourceLink(binary), harness.options))
      .rejects.toThrow("A pdf module requires a Markdown or HTML document");
  });

  test("double-resolves a superlink into its route-three source module", async () => {
    const pointer = "https://raw.example.test/one-line-link.html";
    const module = "https://raw.example.test/large-paper.md";
    const inner = sourceLink(module, "sm:");
    const sources = new Map([
      [pointer, { body: `<a href="${inner}">large document</a>`, type: "text/html" }],
      [module, { body: "# Expanded only at runtime\n\nExact source.\n", type: "text/markdown" }]
    ]);
    const harness = sourceHarness(sources, {
      documentKind: "markdown",
      showModuleSource: true
    });
    const authored = sourceLink(pointer, "ss:");
    const expanded = await expandSourceIncludes(authored, harness.options);

    expect(expanded.text).toContain("# Expanded only at runtime");
    expect(expanded.text).toContain("lnkr-module-source");
    expect(expanded.text).toContain(`href="${authored}`);
    expect(expanded.modules).toBe(2);
    expect(harness.fetches).toBe(2);
  });

  test("accepts the enabled snippets spelling for absolute source modules", async () => {
    const target = "https://raw.example.test/snippet.md";
    const link = sourceLink(target, "sm:");
    const harness = sourceHarness(new Map([
      [target, { body: "snippet body\n", type: "text/markdown" }]
    ]));
    const expanded = await expandSourceIncludes(`--8<-- "${link}"\n`, harness.options);
    expect(expanded.text).toBe("snippet body\n");
  });
});

test("the existing preview and runners use expansions while source actions stay exact", async () => {
  const main = await Bun.file(new URL("../docs/main.js", import.meta.url)).text();
  expect(main).toContain("splitSourceLineSlice(linkage.payload)");
  expect(main).toContain("applySourceLineSlice(rawSource ?? await response.text(), lineSlice)");
  expect(main).toContain("const runtime = await prepareResources(expanded.text)");
  expect(main).toContain("currentRuntimeSource = runtime");
  expect(main).toContain('currentRuntimeKind = decoded.kind');
  expect(main).toContain('const displaySource = ["markdown", "html"].includes(currentRuntimeKind)');
  expect(main).toContain("renderContent(elements.preview, displaySource, currentRuntimeKind)");
  expect(main).toContain("elements.preview.textContent = decoded.text");
  expect(main).toContain("window.eval(currentRuntimeSource)");
  expect(main).toContain("JSON.stringify(currentRuntimeSource)");
  expect(main).toContain("await copyText(currentDocument.text)");
  expect(main).toContain("elements.sourceView.textContent = decoded.text");
});
