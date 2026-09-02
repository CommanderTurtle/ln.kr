import { describe, expect, test } from "bun:test";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetPath
} from "../docs/alphabets.js";
import {
  decodeDirectLinkTarget,
  decodeLinkTarget,
  encodeDirectLinkTarget,
  encodeLinkTarget,
  linkPrefixForMode,
  splitLinkFragment,
  validateLinkTarget
} from "../docs/link-runtime.js";

describe("link routes", () => {
  test("uses explicit guarded, resolved, source, live-source, and native image headers", () => {
    expect(splitLinkFragment("l:payload")).toEqual({ mode: "guarded", payload: "payload" });
    expect(splitLinkFragment("lr:payload")).toEqual({ mode: "resolved", payload: "payload" });
    expect(splitLinkFragment("i:payload")).toEqual({ mode: "image", payload: "payload" });
    expect(splitLinkFragment("s:payload")).toEqual({ mode: "source", payload: "payload" });
    expect(splitLinkFragment("hs:payload")).toEqual({ mode: "source-live", payload: "payload" });
    expect(splitLinkFragment("payload")).toEqual({ mode: "", payload: "payload" });
    expect(linkPrefixForMode("guarded")).toBe("l:");
    expect(linkPrefixForMode("resolved")).toBe("lr:");
    expect(linkPrefixForMode("image")).toBe("i:");
    expect(linkPrefixForMode("source")).toBe("s:");
    expect(linkPrefixForMode("source-live")).toBe("hs:");
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

  test("uses a path-safe alphabet for the direct byte resolver", () => {
    const encoded = encodeDirectLinkTarget("https://images.example.com/source.webp?size=full");
    expect(encoded.payload).toMatch(/^[-0-9A-Z_a-z]+$/);
    expect(decodeDirectLinkTarget(encoded.payload).target).toBe(encoded.target);
    expect(outputAlphabetPath).toHaveLength(64);
  });

  test("rejects non-web protocols and credentials", () => {
    expect(() => validateLinkTarget("javascript:alert(1)")).toThrow();
    expect(() => validateLinkTarget("https://user:secret@example.com/")).toThrow();
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
  expect(source).toContain("imageViewerSource(directResolverURL(target))");
});

test("source routes expand through the normal editable and live HTML formats", async () => {
  const sources = await Promise.all([
    Bun.file(new URL("../docs/index.html", import.meta.url)).text(),
    Bun.file(new URL("../docs/main.js", import.meta.url)).text()
  ]);
  const source = sources.join("\n");
  expect(source).toContain('id="copy-source-link"');
  expect(source).toContain('id="copy-live-source-link"');
  expect(source).toContain('compressText(source, outputAlphabetASCII, "html")');
  expect(source).toContain('outputURL(encoded.payload, live ? "html" : "")');
});
