import { describe, expect, test } from "bun:test";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji
} from "../docs/alphabets.js";
import {
  anchorResolvedHTML,
  decodeLinkTarget,
  encodeLinkTarget,
  extractSingleLinkDocument,
  isPdfLinkTarget,
  isTextualSourceResponse,
  linkPrefixForMode,
  mediaLinkKind,
  resolvedResourceURL,
  sourceResourceURL,
  sourceKindHint,
  splitLinkFragment,
  validateLinkTarget
} from "../docs/link-runtime.js";

describe("link routes", () => {
  test("uses explicit headers for every link-route family", () => {
    expect(splitLinkFragment("ss:payload")).toEqual({ mode: "super-source", payload: "payload" });
    expect(splitLinkFragment("l:payload")).toEqual({ mode: "guarded", payload: "payload" });
    expect(splitLinkFragment("lr:payload")).toEqual({ mode: "resolved", payload: "payload" });
    expect(splitLinkFragment("lf:payload")).toEqual({ mode: "framed", payload: "payload" });
    expect(splitLinkFragment("i:payload")).toEqual({ mode: "image", payload: "payload" });
    expect(splitLinkFragment("media:payload")).toEqual({ mode: "media", payload: "payload" });
    expect(splitLinkFragment("pdf:payload")).toEqual({ mode: "pdf", payload: "payload" });
    expect(splitLinkFragment("s:payload")).toEqual({ mode: "source", payload: "payload" });
    expect(splitLinkFragment("sm:payload")).toEqual({ mode: "source-markdown", payload: "payload" });
    expect(splitLinkFragment("sj:payload")).toEqual({ mode: "source-javascript", payload: "payload" });
    expect(splitLinkFragment("sh:payload")).toEqual({ mode: "source-html", payload: "payload" });
    expect(splitLinkFragment("hs:payload")).toEqual({ mode: "source-live", payload: "payload" });
    expect(splitLinkFragment("payload")).toEqual({ mode: "", payload: "payload" });
    expect(linkPrefixForMode("guarded")).toBe("l:");
    expect(linkPrefixForMode("super-source")).toBe("ss:");
    expect(linkPrefixForMode("resolved")).toBe("lr:");
    expect(linkPrefixForMode("framed")).toBe("lf:");
    expect(linkPrefixForMode("image")).toBe("i:");
    expect(linkPrefixForMode("media")).toBe("media:");
    expect(linkPrefixForMode("pdf")).toBe("pdf:");
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

  test("accepts only exact one-line superlink documents", () => {
    const target = "https://a.shel.sh/#sm:large-payload?still-part-of-fragment";
    expect(extractSingleLinkDocument(target)).toBe(target);
    expect(extractSingleLinkDocument(`<a class="large" href="${target.replace("&", "&amp;")}">paper</a>`))
      .toBe(target);
    expect(extractSingleLinkDocument(`[paper](${target})`)).toBe(target);
    expect(extractSingleLinkDocument(`${target}\nsecond line`)).toBe("");
    expect(extractSingleLinkDocument(`<p>${target}</p>`)).toBe("");
  });

  test("selects official repository file endpoints entirely in-browser", () => {
    expect(sourceResourceURL(
      "https://github.com/CommanderTurtle/vox/blob/main/README.md"
    )).toBe("https://raw.githubusercontent.com/CommanderTurtle/vox/main/README.md");
    expect(sourceResourceURL(
      "https://github.com/ayuanwong/dsh-ux/raw/main/docs/cordis-paper.pdf"
    )).toBe("https://raw.githubusercontent.com/ayuanwong/dsh-ux/main/docs/cordis-paper.pdf");
    expect(sourceResourceURL(
      "https://github.com/CommanderTurtle/vox"
    )).toBe("https://raw.githubusercontent.com/CommanderTurtle/vox/HEAD/README.md");
    expect(sourceResourceURL(
      "https://huggingface.co/example/model/blob/main/site/index.html"
    )).toBe("https://huggingface.co/example/model/resolve/main/site/index.html");
    expect(sourceResourceURL(
      "https://huggingface.co/example/model"
    )).toBe("https://huggingface.co/example/model/resolve/main/README.md");
    expect(sourceResourceURL(
      "https://raw.example.test/existing.js?exact=1#keep"
    )).toBe("https://raw.example.test/existing.js?exact=1#keep");
  });

  test("detects PDF link targets without mistaking query text for a suffix", () => {
    expect(isPdfLinkTarget("https://example.test/research.PDF?download=1")).toBe(true);
    expect(isPdfLinkTarget("https://example.test/view?file=research.pdf")).toBe(false);
  });

  test("classifies image, video, audio, and PDF resources from suffixes or MIME", () => {
    expect(mediaLinkKind("https://example.test/animated.avif")).toBe("image");
    expect(mediaLinkKind("https://example.test/movie.webm?raw=1")).toBe("video");
    expect(mediaLinkKind("https://example.test/sound.opus#play")).toBe("audio");
    expect(mediaLinkKind("https://example.test/download", "application/pdf; charset=binary"))
      .toBe("pdf");
    expect(mediaLinkKind("https://example.test/README.md", "text/markdown")).toBe("");
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
  expect(source).toContain("imageViewerSource(shortResourceURL(target))");
  expect(source).toContain("prepareResources(expanded.text)");
  expect(source).toContain('currentResolvedLink = outputLinkURL(encoded.payload, "resolved")');
  expect(source).not.toContain("lr.a.shel.sh");
});

test("the PDF alias fetches exact bytes into the browser's native PDF viewer", async () => {
  const sources = await Promise.all([
    Bun.file(new URL("../docs/index.html", import.meta.url)).text(),
    Bun.file(new URL("../docs/main.js", import.meta.url)).text()
  ]);
  const source = sources.join("\n");
  expect(source).toContain('id="copy-pdf-link"');
  expect(source).toContain("function pdfViewerSource (target)");
  expect(source).toContain("response.arrayBuffer()");
  expect(source).toContain("new Blob([bytes], { type: 'application/pdf' })");
  expect(source).toContain("pdfViewerSource(shortResourceURL(target))");
  expect(source).toContain("Previous page");
  expect(source).toContain("Switch between single-page and book spread");
  expect(source).toContain("Open native ↗");
  expect(source).not.toContain("lr.a.shel.sh");
});

test("detected audio and video aliases use editable live JavaScript viewers", async () => {
  const sources = await Promise.all([
    Bun.file(new URL("../docs/index.html", import.meta.url)).text(),
    Bun.file(new URL("../docs/main.js", import.meta.url)).text()
  ]);
  const source = sources.join("\n");
  expect(source).toContain('id="copy-media-link"');
  expect(source).toContain("function mediaViewerSource (target, kind)");
  expect(source).toContain("mediaViewerSource(shortResourceURL(target), kind)");
  expect(source).toContain("media.controls = true");
  expect(source).toContain("window.queueMicrotask(runInParentScope)");
});

test("source routes detect text kinds, anchor only HTML, and reuse existing viewers", async () => {
  const sources = await Promise.all([
    Bun.file(new URL("../docs/index.html", import.meta.url)).text(),
    Bun.file(new URL("../docs/main.js", import.meta.url)).text()
  ]);
  const source = sources.join("\n");
  expect(source).toContain('id="copy-source-link"');
  expect(source).toContain('id="copy-live-source-link"');
  expect(source).toContain('id="copy-framed-link"');
  expect(source).toContain('id="copy-super-link"');
  expect(source).toContain('id="link-source-format"');
  expect(source).toContain('currentSourceLink = outputLinkURL(encoded.payload, selectedSourceMode())');
  expect(source).toContain("window.location.replace(resourceURLForTarget(target))");
  expect(source).toContain('currentFramedLink = outputLinkURL(encoded.payload, "framed")');
  expect(source).toContain('elements.linkResolvedLabel.textContent = "Linkage · #lf:"');
  expect(source).toContain('id="link-resolved-copy"');
  expect(source).toContain('id="link-resolved-download"');
  expect(source).toContain('id="link-resolved-expand"');
  expect(source).toContain("serializedFramedDocument()");
  expect(source).toContain("fetch(resourceURLForTarget(currentTarget)");
  expect(source).toContain("await response.arrayBuffer()");
  expect(source).toContain("const direct = sourceURLForTarget(target)");
  expect(source).toContain('sourceKindHint(sourceURL, contentType) || detectKind(fetchedSource)');
  expect(source).toContain('kind === "html"');
  expect(source).toContain('anchorResolvedHTML(fetchedSource, sourceURL)');
  expect(source).toContain('compressTextV1(source, outputAlphabetASCII, kind)');
  expect(source).toContain('["markdown", "html", "javascript"].includes(kind)');
});
