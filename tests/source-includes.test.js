import { describe, expect, test } from "bun:test";
import { outputAlphabetASCII } from "../docs/alphabets.js";
import { encodeLinkTarget } from "../docs/link-runtime.js";
import { expandSourceIncludes, sourceLinkFromLine } from "../docs/source-includes.js";

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
      resolverURLForTarget: target => `https://resolver.test/source?target=${encodeURIComponent(target)}`,
      fetchImpl: async url => {
        fetches ++;
        const target = new URL(url).searchParams.get("target");
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
  test("recognizes only bare source-route lines from this app", () => {
    const target = "https://raw.example.test/module.js";
    const link = sourceLink(target, "sj:");
    expect(sourceLinkFromLine(`  ${link}\r\n`, appURL)).toMatchObject({
      indent: "  ",
      ending: "\r\n",
      target
    });
    expect(sourceLinkFromLine(`[module](${link})\n`, appURL)).toBeNull();
    expect(sourceLinkFromLine(`${appURL}#s:`, appURL)).toBeNull();
    expect(sourceLinkFromLine(sourceLink(target, "lr:"), appURL)).toBeNull();
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

  test("keeps direct resolver links literal and rejects binary source modules", async () => {
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
      .rejects.toThrow("Source include is not text");
  });
});

test("the existing preview and runners use expansions while source actions stay exact", async () => {
  const main = await Bun.file(new URL("../docs/main.js", import.meta.url)).text();
  expect(main).toContain("currentRuntimeSource = expanded.text");
  expect(main).toContain("renderContent(elements.preview, expanded.text, decoded.kind)");
  expect(main).toContain("window.eval(currentRuntimeSource)");
  expect(main).toContain("JSON.stringify(currentRuntimeSource)");
  expect(main).toContain("await copyText(currentDocument.text)");
  expect(main).toContain("elements.sourceView.textContent = decoded.text");
});
