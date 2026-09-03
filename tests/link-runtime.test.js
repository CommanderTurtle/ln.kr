import { describe, expect, test } from "bun:test";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji
} from "../docs/alphabets.js";
import {
  anchorResolvedHTML,
  decodeLinkTarget,
  encodeLinkTarget,
  isTextualSourceResponse,
  linkPrefixForMode,
  resolvedResourceURL,
  sourceKindHint,
  splitLinkFragment,
  validateLinkTarget
} from "../docs/link-runtime.js";

describe("link routes", () => {
  test("uses explicit guarded, resolved, source, live-source, and native image headers", () => {
    expect(splitLinkFragment("l:payload")).toEqual({ mode: "guarded", payload: "payload" });
    expect(splitLinkFragment("lr:payload")).toEqual({ mode: "resolved", payload: "payload" });
    expect(splitLinkFragment("i:payload")).toEqual({ mode: "image", payload: "payload" });
    expect(splitLinkFragment("s:payload")).toEqual({ mode: "source", payload: "payload" });
    expect(splitLinkFragment("sm:payload")).toEqual({ mode: "source-markdown", payload: "payload" });
    expect(splitLinkFragment("sj:payload")).toEqual({ mode: "source-javascript", payload: "payload" });
    expect(splitLinkFragment("sh:payload")).toEqual({ mode: "source-html", payload: "payload" });
    expect(splitLinkFragment("hs:payload")).toEqual({ mode: "source-live", payload: "payload" });
    expect(splitLinkFragment("payload")).toEqual({ mode: "", payload: "payload" });
    expect(linkPrefixForMode("guarded")).toBe("l:");
    expect(linkPrefixForMode("resolved")).toBe("lr:");
    expect(linkPrefixForMode("image")).toBe("i:");
    expect(linkPrefixForMode("source")).toBe("s:");
    expect(linkPrefixForMode("source-markdown")).toBe("sm:");
    expect(linkPrefixForMode("source-javascript")).toBe("sj:");
    expect(linkPrefixForMode("source-html")).toBe("sh:");
    expect(linkPrefixForMode("source-live")).toBe("hs:");
  });

  test("classifies textual source without treating binary resources as UTF-8", () => {
    expect(sourceKindHint("https://raw.example.test/README.md", "text/plain")).toBe("markdown");
    expect(sourceKindHint("https://cdn.example.test/app", "application/javascript; charset=utf-8"))
      .toBe("javascript");
    expect(sourceKindHint("https://example.test/page", "text/html")).toBe("html");
    expect(sourceKindHint("https://example.test/theme.css", "text/plain")).toBe("text");
    expect(isTextualSourceResponse("https://example.test/theme.css", "text/css")).toBe(true);
    expect(isTextualSourceResponse("https://example.test/report.pdf", "application/pdf")).toBe(false);
    expect(isTextualSourceResponse("https://example.test/README.md", "application/octet-stream"))
      .toBe(true);
  });

  for (const alphabet of [outputAlphabetASCII, outputAlphabetEmoji]) {
    test(`round trips an image source through alphabet ${alphabet.length}`, () => {
      const encoded = encodeLinkTarget(
        "https://images.example.com/gallery/source.webp?size=full#view",
        alphabet
      );
      expect(decodeLinkTarget(encoded.payload).target).toBe(encoded.target);
      expect(decodeLinkTarget(encodeURIComponent(encoded.payload)).target).toBe(encoded.target);
    });
  }

  test("retains ha.mr's inferred http input behavior", () => {
    const encoded = encodeLinkTarget("example.com/image.webp", outputAlphabetASCII);
    expect(encoded.target).toBe("http://example.com/image.webp");
  });

  test("never invents a physical resolver path or hostname", () => {
    const target = "https://images.example.com/source.webp?size=full";
    expect(resolvedResourceURL(target)).toBe(target);
  });

  test("rejects non-web protocols and credentials", () => {
    expect(() => validateLinkTarget("javascript:alert(1)")).toThrow();
    expect(() => validateLinkTarget("https://user:secret@example.com/")).toThrow();
  });

  test("anchors fetched HTML to its final upstream URL", () => {
    expect(anchorResolvedHTML(
      "<!doctype html><html><head><link rel=\"stylesheet\" href=\"./site.css\"></head></html>",
      "https://example.com/reports/index.html"
    )).toContain('<head>\n  <base href="https://example.com/reports/index.html">');

    expect(anchorResolvedHTML(
      "<html><head><base href=\"../assets/\"></head><body></body></html>",
      "https://example.com/reports/current/index.html"
    )).toContain('<base href="https://example.com/reports/assets/">');
  });

  test("lets an upstream meta CSP load resources resolved by the standalone base", () => {
    const source = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; object-src 'none'; form-action 'self'">
      <link rel="stylesheet" href="./app.css">
    </head><body></body></html>`;
    const anchored = anchorResolvedHTML(source, "https://example.test/docs/page.html");

    expect(anchored).toContain("default-src 'self' https://example.test");
    expect(anchored).toContain("style-src 'self' https://example.test 'unsafe-inline'");
    expect(anchored).toContain("object-src 'none'");
    expect(anchored).toContain("form-action 'self'");

    const encoded = anchorResolvedHTML(
      '<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; style-src &#39;self&#39;">',
      "https://assets.example.test/page.html"
    );
    expect(encoded).toContain("default-src &#39;self&#39; https://assets.example.test");
    expect(encoded).toContain("style-src &#39;self&#39; https://assets.example.test");
  });
});

test("the deployable page has no analytics beacon", async () => {
  const sources = await Promise.all([
    Bun.file(new URL("../docs/index.html", import.meta.url)).text(),
    Bun.file(new URL("../docs/main.js", import.meta.url)).text()
  ]);
  expect(sources.join("\n")).not.toMatch(/cloudflareinsights|beacon\.min\.js|data-cf-beacon/i);
});

test("the image alias expands to the established editable JavaScript viewer", async () => {
  const source = await Bun.file(new URL("../docs/main.js", import.meta.url)).text();
  expect(source).toContain("function imageViewerSource (target)");
  expect(source).toContain("img.referrerPolicy = 'no-referrer'");
  expect(source).toContain("showViewer(decoded, payload, alphabet)");
  expect(source).toContain("window.queueMicrotask(runInParentScope)");
  expect(source).toContain("imageViewerSource(resourceURLForTarget(target))");
  expect(source).toContain('currentResolvedLink = outputLinkURL(encoded.payload, "resolved")');
  expect(source).not.toContain("lr.a.shel.sh");
});

test("source routes detect text kinds, anchor only HTML, and reuse existing viewers", async () => {
  const sources = await Promise.all([
    Bun.file(new URL("../docs/index.html", import.meta.url)).text(),
    Bun.file(new URL("../docs/main.js", import.meta.url)).text()
  ]);
  const source = sources.join("\n");
  expect(source).toContain('id="copy-source-link"');
  expect(source).toContain('id="copy-live-source-link"');
  expect(source).toContain('id="link-source-format"');
  expect(source).toContain('currentSourceLink = outputLinkURL(encoded.payload, selectedSourceMode())');
  expect(source).toContain('sourceKindHint(sourceURL, contentType) || detectKind(fetchedSource)');
  expect(source).toContain('kind === "html"');
  expect(source).toContain('anchorResolvedHTML(fetchedSource, sourceURL)');
  expect(source).toContain('compressTextV1(source, outputAlphabetASCII, kind)');
  expect(source).toContain('["markdown", "html"].includes(kind)');
});
