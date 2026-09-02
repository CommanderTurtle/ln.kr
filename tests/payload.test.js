import { expect, test } from "bun:test";
import { outputAlphabetASCII, outputAlphabetEmoji } from "../docs/alphabets.js";
import { stringToNumber } from "../docs/compress.js";
import { decodeDocumentPayload } from "../docs/payload.js";
import { compressTextV1 } from "../docs/text-compress.js";

test("decodes raw and percent-encoded emoji fragments by validated content", () => {
  const source = "A raw URL fragment can contain exact emoji digits 🐢 without guessing.";
  const encoded = compressTextV1(source, outputAlphabetEmoji, "text");

  expect(decodeDocumentPayload(encoded.payload).decoded.text).toBe(source);
  expect(decodeDocumentPayload(encodeURIComponent(encoded.payload)).decoded.text).toBe(source);
});

test("does not accept framing punctuation in fixed-width alphabets", () => {
  expect(() => stringToNumber("a|b", outputAlphabetASCII)).toThrow();
});
