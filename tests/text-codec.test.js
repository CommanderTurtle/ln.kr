import { describe, expect, test } from "bun:test";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "../docs/alphabets.js";
import {
  compressText,
  decompressText,
  detectKind
} from "../docs/text-compress.js";

const exactInputs = [
  "",
  "plain text",
  "two spaces:  \n\ttab\r\nCRLF\rbare CR\n",
  "🐢 Unicode survives: 你好, दुनिया, مرحبًا, e\u0301, é\n",
  "# Markdown\n\n```js\nconst answer = 42;\n```\n",
  "const block = {\n  repeated: true,\n};\n".repeat(64),
  [
    "## Build one\nconst color = 'blue';\nreturn color;\n",
    "## Build two\nconst color = 'green';\nreturn color;\n",
    "## Build three\nconst color = 'red';\nreturn color;\n"
  ].join("\n")
];

describe("ln.kr exact text codec", () => {
  for (const alphabet of [outputAlphabetASCII, outputAlphabetEmoji, outputAlphabetQR]) {
    for (const input of exactInputs) {
      test(`round trips ${input.length} code units through alphabet ${alphabet.length}`, () => {
        const encoded = compressText(input, alphabet);
        const decoded = decompressText(encoded.payload, alphabet);
        expect(decoded.text).toBe(input);
        expect(decoded.kind).toBe(encoded.kind);
      });
    }
  }

  test("uses prior-output records for exact repetition", () => {
    const source = "function repeat() {\n  return 'same';\n}\n".repeat(100);
    const encoded = compressText(source, outputAlphabetASCII, "javascript");
    expect(encoded.stats.copy).toBeGreaterThan(0);
    expect(encoded.payload.length).toBeLessThan(source.length / 4);
  });

  test("uses prior-output records around sparse line changes", () => {
    const source = Array.from({ length: 30 }, (_, index) => [
      `export function variant${index} () {`,
      "  const shared = 'the same long repeated body';",
      `  const changed = ${index};`,
      "  return { shared, changed };",
      "}"
    ].join("\n")).join("\n\n");
    const encoded = compressText(source, outputAlphabetASCII, "javascript");
    expect(encoded.stats.copy).toBeGreaterThan(20);
    expect(decompressText(encoded.payload, outputAlphabetASCII).text).toBe(source);
  });

  test("detects supported display modes", () => {
    expect(detectKind("# heading\n\nbody")).toBe("markdown");
    expect(detectKind("const value = () => 1;")).toBe("javascript");
    expect(detectKind("<!doctype html><html></html>")).toBe("html");
    expect(detectKind("a regular note")).toBe("text");
  });

  test("rejects a mutated payload", () => {
    const encoded = compressText("integrity", outputAlphabetASCII);
    const last = encoded.payload.at(-1);
    const replacement = last === "!" ? "#" : "!";
    expect(() => decompressText(encoded.payload.slice(0, -1) + replacement, outputAlphabetASCII)).toThrow();
  });
});
