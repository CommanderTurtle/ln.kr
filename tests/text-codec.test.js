import { describe, expect, test } from "bun:test";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "../docs/alphabets.js";
import {
  countAlphabetSymbols
} from "../docs/compress.js";
import {
  compressText,
  compressTextV1,
  compressTextV2,
  decompressText,
  detectKind,
  textDictionary
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
  test("keeps every versioned dictionary entry unique", () => {
    expect(new Set(textDictionary).size).toBe(textDictionary.length);
  });

  test("keeps the frozen v1 text stream byte-for-byte compatible", () => {
    expect(compressTextV1(
      "const answer = 42;",
      outputAlphabetASCII,
      "javascript"
    ).payload).toBe("_/7KJ?mPwor/O=(ew=v,a2hf*");
  });

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
    expect(encoded.stats.copy + encoded.stats.patch).toBeGreaterThan(20);
    expect(decompressText(encoded.payload, outputAlphabetASCII).text).toBe(source);
  });

  test("uses one exact structural record for a prior block plus sparse residuals", () => {
    const source = Array.from({ length: 120 }, (_, index) => JSON.stringify({
      id: index,
      component: "generic-workflow-node",
      position: [index % 12, Math.floor(index / 12)],
      options: {
        enabled: index % 7 !== 0,
        sampler: "shared-sampler",
        path: "models/shared/model.safetensors",
        values: Array.from({ length: 10 }, (__, value) => value === index % 10 ? index : value)
      }
    }, null, 2)).join("\n");
    const legacy = compressTextV1(source, outputAlphabetASCII, "text");
    const encoded = compressTextV2(source, outputAlphabetASCII, "text");

    expect(encoded.stats.version).toBe(2);
    expect(encoded.stats.patch).toBeGreaterThan(0);
    expect(encoded.payload.length).toBeLessThan(legacy.payload.length);
    expect(decompressText(encoded.payload, outputAlphabetASCII).text).toBe(source);
  });

  test("reuses recurring structural layouts as document-local grammar shapes", () => {
    const source = Array.from({ length: 180 }, (_, index) => [
      `.card-${index} {`,
      "  display: grid;",
      "  grid-template-columns: 1fr auto;",
      "  align-items: center;",
      `  --accent: hsl(${index % 360} 70% 50%);`,
      `  padding: ${8 + index % 4}px;`,
      "  border: 1px solid var(--accent);",
      "}"
    ].join("\n")).join("\n\n");
    const legacy = compressTextV1(source, outputAlphabetASCII, "text");
    const encoded = compressTextV2(source, outputAlphabetASCII, "text");

    expect(encoded.stats.patchReuse).toBeGreaterThan(0);
    expect(encoded.stats.patchDefinition + encoded.stats.patchReuse)
      .toBe(encoded.stats.patch);
    expect(encoded.payload.length).toBeLessThan(legacy.payload.length);
    expect(decompressText(encoded.payload, outputAlphabetASCII).text).toBe(source);
  });

  test("maps recurring word and punctuation phrases to a local grammar symbol", () => {
    let state = 0x12345678;
    const random = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };
    const noise = length => Array.from(
      { length },
      () => String.fromCharCode(33 + ((random() >>> 16) % 90))
    ).join("");
    const phrase = "alpha beta gamma delta epsilon zeta theta";
    const source = Array.from(
      { length: 50 },
      () => `${noise(30)} ${phrase} ${noise(30)}`
    ).join("\n");
    const legacy = compressTextV1(source, outputAlphabetASCII, "text");
    for (const alphabet of [outputAlphabetASCII, outputAlphabetEmoji, outputAlphabetQR]) {
      const encoded = compressTextV2(source, alphabet, "text");
      expect(encoded.stats.lexicon).toBeGreaterThan(0);
      expect(encoded.stats.lexiconUse).toBeGreaterThanOrEqual(45);
      expect(decompressText(encoded.payload, alphabet).text).toBe(source);
      if (alphabet === outputAlphabetASCII) {
        expect(encoded.payload.length).toBeLessThan(legacy.payload.length);
      }
    }
  });

  test("maps code sectors and remaining line families through exact templates", () => {
    const css = Array.from({ length: 80 }, (_, index) => [
      `.card-${index} {`,
      `  color: hsl(${index} 70% 50%);`,
      `  padding: ${8 + index % 4}px;`,
      `  border: 1px solid var(--accent-${index});`,
      "}"
    ].join("\n")).join("\n\n");
    const html = `<!doctype html><html><head><style>${css}</style></head><body>${Array.from(
      { length: 80 },
      (_, index) => `<article class="card card-${index}" data-index="${index}"><h2>Entry ${index}</h2><p>Stable descriptive body ${index}.</p></article>`
    ).join("\n")}</body></html>`;
    const javascript = Array.from(
      { length: 100 },
      (_, index) => `const handler_${index} = registry.create("channel-${index}", ${index * 7919});`
    ).join("\n");

    const htmlV1 = compressTextV1(html, outputAlphabetASCII, "html");
    const htmlV2 = compressTextV2(html, outputAlphabetASCII, "html");
    const cssV2 = compressTextV2(css, outputAlphabetASCII, "text");
    const jsV1 = compressTextV1(javascript, outputAlphabetASCII, "javascript");
    const jsV2 = compressTextV2(javascript, outputAlphabetASCII, "javascript");

    expect(cssV2.stats.sectorTemplateUse).toBeGreaterThan(0);
    expect(jsV2.stats.lineTemplateUse).toBeGreaterThan(0);
    expect(htmlV2.payload.length).toBeLessThan(htmlV1.payload.length);
    expect(jsV2.payload.length).toBeLessThan(jsV1.payload.length);
    expect(decompressText(htmlV2.payload, outputAlphabetASCII).text).toBe(html);
    expect(decompressText(jsV2.payload, outputAlphabetASCII).text).toBe(javascript);
  });

  test("compresses Markdown line families without normalizing authored bytes", () => {
    const list = Array.from(
      { length: 100 },
      (_, index) => `- **Item ${index}** uses profile \`variant-${index}\` with threshold ${index % 7}.  `
    ).join("\r\n");
    const authoredHTML = Array.from(
      { length: 40 },
      (_, index) => `<details><summary>Item ${index}</summary><img src="./asset-${index}.webp"><p>Record ${index}</p></details>`
    ).join("\r\n");
    const source = `${list}\r\n\r\n${authoredHTML}`;
    const legacy = compressTextV1(source, outputAlphabetASCII, "markdown");
    const encoded = compressTextV2(source, outputAlphabetASCII, "markdown");
    const authored = compressTextV2(`# Report\r\n\r\n${authoredHTML}`, outputAlphabetASCII, "markdown");

    expect(encoded.stats.lineTemplateUse).toBeGreaterThan(0);
    expect(encoded.payload.length).toBeLessThan(legacy.payload.length);
    expect(decompressText(encoded.payload, outputAlphabetASCII).text).toBe(source);
    expect(decompressText(authored.payload, outputAlphabetASCII).text)
      .toBe(`# Report\r\n\r\n${authoredHTML}`);
  });

  test("lets v1 copies own exact Markdown repetition while v2 targets changed blocks", () => {
    const block = `## Firewall rules\n\n\`\`\`bash\niptables -A INPUT -p tcp --dport 443 -j ACCEPT\niptables -A INPUT -j DROP\n\`\`\`\n\n`;
    const exact = block.repeat(32);
    const varied = Array.from({ length: 32 }, (_, index) =>
      index % 3 === 0 ? block.replaceAll("INPUT", "OUTPUT") : block
    ).join("");
    const exactV1 = compressTextV1(exact, outputAlphabetASCII, "markdown");
    const exactV2 = compressTextV2(exact, outputAlphabetASCII, "markdown");
    const variedV1 = compressTextV1(varied, outputAlphabetASCII, "markdown");
    const variedV2 = compressTextV2(varied, outputAlphabetASCII, "markdown");

    // Identical blocks are already represented by one v1 prior-output copy.
    // Empty v2 grammar headers are two bits and can round to one URL symbol.
    expect(exactV2.payload.length).toBeLessThanOrEqual(exactV1.payload.length + 1);
    expect(variedV2.payload.length).toBeLessThanOrEqual(variedV1.payload.length + 1);
    expect(decompressText(exactV2.payload, outputAlphabetASCII).text).toBe(exact);
    expect(decompressText(variedV2.payload, outputAlphabetASCII).text).toBe(varied);
  });

  test("decodes chained structural generations through every transport alphabet", () => {
    const source = Array.from({ length: 80 }, (_, index) => [
      `section-${index} {`,
      "  display: grid;",
      "  grid-template-columns: 1fr auto;",
      `  color: rgb(${index % 255} 80 120);`,
      `  padding: ${8 + index % 4}px;`,
      "  border: 1px solid currentColor;",
      "}"
    ].join("\n")).join("\n\n");

    for (const alphabet of [outputAlphabetASCII, outputAlphabetEmoji, outputAlphabetQR]) {
      const encoded = compressTextV2(source, alphabet, "text");
      expect(encoded.stats.patch).toBeGreaterThan(1);
      expect(decompressText(encoded.payload, alphabet).text).toBe(source);
    }
  });

  test("frames only ambiguous emoji boundaries and counts them as digits", () => {
    let state = 1;
    const pieces = ["a", " ", "\n", "{}", "🐢", "界", "é", "☝", "🏻"];
    let foundFraming = false;

    for (let sample = 0; sample < 400; sample ++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      let source = "";
      for (let index = 0; index < 20 + state % 180; index ++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        source += pieces[state % pieces.length];
      }
      const encoded = compressTextV1(source, outputAlphabetEmoji, "text");
      foundFraming ||= encoded.payload.includes(".");
      expect(countAlphabetSymbols(encoded.payload, outputAlphabetEmoji)).toBe(encoded.stats.symbols);
      expect(decompressText(encoded.payload, outputAlphabetEmoji).text).toBe(source);
    }

    expect(foundFraming).toBe(true);
  });

  test("detects supported display modes", () => {
    expect(detectKind("# heading\n\nbody")).toBe("markdown");
    expect(detectKind("# heading\n\n```js\nconst x = 1;\n```")).toBe("markdown");
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

  test("round trips deterministic mixed-Unicode fuzz cases", () => {
    let state = 0x1a2b3c4d;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state;
    };
    const pieces = ["a", "Z", "0", " ", "  ", "\n", "\r\n", "\t", "{}", "```", "🐢", "界", "e\u0301", "\0"];
    for (let sample = 0; sample < 120; sample ++) {
      let source = "";
      const length = 1 + random() % 180;
      for (let index = 0; index < length; index ++) {
        source += pieces[random() % pieces.length];
      }
      const encoded = compressText(source, outputAlphabetASCII, "text");
      const legacy = compressTextV1(source, outputAlphabetASCII, "text");
      const structured = compressTextV2(source, outputAlphabetASCII, "text");
      expect(encoded.payload.length).toBeLessThanOrEqual(legacy.payload.length);
      expect(decompressText(encoded.payload, outputAlphabetASCII).text).toBe(source);
      expect(decompressText(structured.payload, outputAlphabetASCII).text).toBe(source);
    }
  });
});
