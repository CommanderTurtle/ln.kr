import {
  huffmanEncode,
  numberToString,
  stringToNumber
} from "./compress.js";

const MAGIC = 0x4c4e; // "LN", read least-significant bit first.
const VERSION = 1;
const MIN_COPY = 4;
const MAX_CHAIN = 64;

const KIND_TO_NUMBER = Object.freeze({
  text: 0,
  markdown: 1,
  javascript: 2,
  html: 3
});

const NUMBER_TO_KIND = Object.freeze([
  "text",
  "markdown",
  "javascript",
  "html"
]);

// This order is part of the v1 wire format. Put broadly useful and cheap
// entries first: the index is Elias-gamma coded, so earlier entries cost less.
// Literal bytes and prior-output copies cover everything outside this list.
export const textDictionary = Object.freeze([
  " ", "\n", "  ", "    ", "\r\n", "\t", "\n\n", "```",
  "# ", "## ", "### ", "- ", "* ", "> ", "](", ")\n",
  "const ", "let ", "function ", "return ", " => ", " = ", " === ", " !== ",
  "import ", "export ", " from ", "async ", "await ", "if (", "else ", "for (", "while (",
  "try {", "} catch (", "class ", "new ", "this.", "throw new ", "typeof ", "instanceof ",
  "true", "false", "null", "undefined", "switch (", "case ", "break;", "continue;",
  "document.", "window.", "querySelector(", "querySelectorAll(", "addEventListener(", "textContent",
  "console.log(", "console.error(", "JSON.stringify(", "JSON.parse(", "Object.", "Array.",
  "</", "<!--", "-->", "<!DOCTYPE html>", "<html", "<head>", "<body", "<div", "</div>",
  "<span", "</span>", "<button", "</button>", "<script", "</script>", "<style>", "</style>",
  " class=\"", " id=\"", " href=\"", " src=\"", " aria-", " data-", " role=\"",
  "display: ", "position: ", "color: ", "background: ", "border: ", "padding: ", "margin: ",
  "width: ", "height: ", "font-size: ", "font-family: ", "align-items: ", "justify-content: ",
  "```javascript", "```js", "```html", "```css", "```json", "```bash", "```text",
  "**", "__", "~~", "![", "https://", "http://", "www.", "README", "LICENSE",
  " the ", " and ", " that ", " with ", " from ", " this ", " for ", " are ", " not ",
  "The ", "This ", "There ", " can ", " will ", " into ", " when ", " then ", "ing ",
  "()", "[]", "{}", "();", ");", ", ", ": ", ";\n", " {\n", "}\n", "},\n", "\";",
  "?.", "??", "...", "${", "?.(", "?.[", "Promise", "resolve", "reject",
  "interface ", "type ", "extends ", "implements ", "public ", "private ", "readonly ",
  "def ", "self.", "None", "elif ", "except ", "finally:", "lambda ", "yield ",
  "fn ", "pub ", "mut ", "impl ", "struct ", "enum ", "match ", "Result<", "Option<",
  "package ", "func ", "defer ", "select {", "range ", "context.", "error",
  "SELECT ", "FROM ", "WHERE ", "INSERT ", "UPDATE ", "DELETE ", "CREATE ", "JOIN ",
  "{\n", "\n}", "\n  ", "\n    ", "\n      ", "\r\n  ", "\r\n    "
]);

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const dictionaryBytes = textDictionary.map(value => encoder.encode(value));

function buildDictionaryTrie () {
  const root = { children: new Map(), index: -1 };
  dictionaryBytes.forEach((bytes, index) => {
    let node = root;
    for (const byte of bytes) {
      if (!node.children.has(byte)) {
        node.children.set(byte, { children: new Map(), index: -1 });
      }
      node = node.children.get(byte);
    }
    node.index = index;
  });
  return root;
}

const dictionaryTrie = buildDictionaryTrie();

function gammaBitLength (value) {
  const length = BigInt(value).toString(2).length;
  return length * 2 - 1;
}

function gammaBits (value) {
  const binary = BigInt(value).toString(2);
  return "0".repeat(binary.length - 1) + binary;
}

function fixedBits (value, width) {
  let number = BigInt(value);
  let output = "";
  for (let bit = 0; bit < width; bit ++) {
    output += (number & 1n) ? "1" : "0";
    number >>= 1n;
  }
  return output;
}

function crc32 (bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit ++) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hash4 (bytes, index) {
  return (
    (bytes[index] << 24) |
    (bytes[index + 1] << 16) |
    (bytes[index + 2] << 8) |
    bytes[index + 3]
  );
}

function findDictionaryMatch (bytes, position) {
  let node = dictionaryTrie;
  let best = null;

  for (let index = position; index < bytes.length; index ++) {
    node = node.children.get(bytes[index]);
    if (!node) break;
    if (node.index >= 0) {
      const length = index - position + 1;
      const bitLength = 2 + gammaBitLength(node.index + 1);
      const savings = length * 8 - bitLength;
      if (savings > 0 && (!best || savings > best.savings)) {
        best = { index: node.index, length, bitLength, savings };
      }
    }
  }

  return best;
}

function findCopyMatch (bytes, position, chains) {
  if (position + MIN_COPY > bytes.length) return null;
  const candidates = chains.get(hash4(bytes, position));
  if (!candidates) return null;

  let best = null;
  for (let item = candidates.length - 1; item >= 0; item --) {
    const source = candidates[item];
    const distance = position - source;
    if (distance <= 0) continue;

    let length = MIN_COPY;
    while (
      position + length < bytes.length &&
      bytes[source + (length % distance)] === bytes[position + length]
    ) {
      length ++;
    }

    const bitLength = 3 + gammaBitLength(distance) +
      gammaBitLength(length - MIN_COPY + 1);
    const savings = length * 8 - bitLength;
    if (
      savings > 0 &&
      (!best || savings > best.savings ||
        (savings === best.savings && distance < best.distance))
    ) {
      best = { distance, length, bitLength, savings };
    }
  }

  return best;
}

function addChains (bytes, chains, start, end) {
  for (let position = start; position < end; position ++) {
    if (position + MIN_COPY > bytes.length) break;
    const key = hash4(bytes, position);
    const positions = chains.get(key) || [];
    positions.push(position);
    if (positions.length > MAX_CHAIN) positions.shift();
    chains.set(key, positions);
  }
}

function tokenize (bytes) {
  const tokens = [];
  const chains = new Map();
  let position = 0;

  while (position < bytes.length) {
    const dictionary = findDictionaryMatch(bytes, position);
    const copy = findCopyMatch(bytes, position, chains);
    const start = position;

    if (copy && (!dictionary || copy.savings > dictionary.savings)) {
      tokens.push({ type: "copy", ...copy });
      position += copy.length;
    } else if (dictionary) {
      tokens.push({ type: "dictionary", ...dictionary });
      position += dictionary.length;
    } else if (bytes[position] < 128) {
      tokens.push({ type: "ascii", byte: bytes[position], length: 1, bitLength: 8 });
      position ++;
    } else {
      position ++;
      // Keep first-seen Unicode runs bounded so a repeated glyph/word can
      // immediately become a prior-output copy. UTF-8 itself stays untouched.
      while (
        position < bytes.length &&
        position - start < 16 &&
        bytes[position] >= 128 &&
        !findCopyMatch(bytes, position, chains)
      ) {
        position ++;
      }
      const raw = bytes.slice(start, position);
      tokens.push({
        type: "raw",
        bytes: raw,
        length: raw.length,
        bitLength: 3 + gammaBitLength(raw.length) + raw.length * 8
      });
    }

    addChains(bytes, chains, start, position);
  }

  return tokens;
}

function tokenBits (token) {
  if (token.type === "ascii") {
    return "0" + fixedBits(token.byte, 7);
  }
  if (token.type === "dictionary") {
    return "10" + gammaBits(token.index + 1);
  }
  if (token.type === "copy") {
    return "110" + gammaBits(token.distance) +
      gammaBits(token.length - MIN_COPY + 1);
  }
  if (token.type === "raw") {
    let bits = "111" + gammaBits(token.bytes.length);
    for (const byte of token.bytes) bits += fixedBits(byte, 8);
    return bits;
  }
  throw new Error(`Unknown token type: ${token.type}`);
}

class BitReader {
  constructor (number) {
    this.number = number;
  }

  readBit () {
    if (this.number <= 1n) throw new Error("Unexpected end of ln.kr payload");
    const value = Number(this.number & 1n);
    this.number >>= 1n;
    return value;
  }

  readFixed (width) {
    let value = 0n;
    for (let bit = 0; bit < width; bit ++) {
      value |= BigInt(this.readBit()) << BigInt(bit);
    }
    return value;
  }

  readGamma () {
    let zeroes = 0;
    while (this.readBit() === 0) {
      zeroes ++;
      if (zeroes > 52) throw new Error("ln.kr integer exceeds the safe range");
    }
    let value = 1;
    for (let bit = 0; bit < zeroes; bit ++) {
      value = value * 2 + this.readBit();
    }
    if (!Number.isSafeInteger(value)) {
      throw new Error("ln.kr integer exceeds the safe range");
    }
    return value;
  }
}

export function detectKind (text) {
  if (/<!doctype\s+html|<html[\s>]|<body[\s>]|<div[\s>]/i.test(text)) return "html";
  if (
    /(^|\n)\s*(?:import|export|const|let|var|function|class)\s/.test(text) ||
    /(?:=>|document\.querySelector|addEventListener\s*\()/.test(text)
  ) return "javascript";
  if (
    /(^|\n)(?:#{1,6}\s|```|>\s|[-*+]\s|\d+\.\s)/.test(text) ||
    /\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/.test(text)
  ) return "markdown";
  return "text";
}

/**
 * Compress exact UTF-8 text with the ln.kr v1 dictionary/reference grammar.
 * @returns {{payload: string, kind: string, stats: object}}
 */
export function compressText (text, alphabet, requestedKind = "auto") {
  if (typeof text !== "string") throw new TypeError("Text must be a string");
  const kind = requestedKind === "auto" ? detectKind(text) : requestedKind;
  if (!(kind in KIND_TO_NUMBER)) throw new Error(`Unsupported content kind: ${kind}`);

  const bytes = encoder.encode(text);
  const tokens = tokenize(bytes);
  let number = 1n;
  let tokenBitLength = 0;

  for (let index = tokens.length - 1; index >= 0; index --) {
    const bits = tokenBits(tokens[index]);
    tokenBitLength += bits.length;
    number = huffmanEncode(number, bits);
  }

  const checksum = crc32(bytes);
  const lengthBits = gammaBits(bytes.length + 1);
  number = huffmanEncode(number, fixedBits(checksum, 32));
  number = huffmanEncode(number, lengthBits);
  number = huffmanEncode(number, fixedBits(KIND_TO_NUMBER[kind], 2));
  number = huffmanEncode(number, fixedBits(VERSION, 3));
  number = huffmanEncode(number, fixedBits(MAGIC, 16));

  const payload = numberToString(number, alphabet);
  const counts = { ascii: 0, dictionary: 0, copy: 0, raw: 0 };
  for (const token of tokens) counts[token.type] ++;

  return {
    payload,
    kind,
    stats: {
      bytes: bytes.length,
      bits: 16 + 3 + 2 + lengthBits.length + 32 + tokenBitLength,
      tokens: tokens.length,
      ...counts
    }
  };
}

/**
 * Decode an ln.kr v1 text payload. Throws on a bad version, malformed record,
 * invalid UTF-8, trailing data, incorrect byte count, or checksum mismatch.
 */
export function decompressText (payload, alphabet) {
  const reader = new BitReader(stringToNumber(payload, alphabet));
  const magic = Number(reader.readFixed(16));
  if (magic !== MAGIC) throw new Error("Not an ln.kr text payload");

  const version = Number(reader.readFixed(3));
  if (version !== VERSION) throw new Error(`Unsupported ln.kr version: ${version}`);

  const kindNumber = Number(reader.readFixed(2));
  const expectedLength = reader.readGamma() - 1;
  const expectedChecksum = Number(reader.readFixed(32));
  const output = [];

  const ensureLength = amount => {
    if (amount < 0 || output.length + amount > expectedLength) {
      throw new Error("ln.kr record exceeds its declared byte length");
    }
  };

  while (output.length < expectedLength) {
    if (reader.readBit() === 0) {
      ensureLength(1);
      output.push(Number(reader.readFixed(7)));
      continue;
    }

    if (reader.readBit() === 0) {
      const index = reader.readGamma() - 1;
      const bytes = dictionaryBytes[index];
      if (!bytes) throw new Error(`Unknown ln.kr dictionary entry: ${index}`);
      ensureLength(bytes.length);
      output.push(...bytes);
      continue;
    }

    if (reader.readBit() === 0) {
      const distance = reader.readGamma();
      const length = reader.readGamma() + MIN_COPY - 1;
      if (distance < 1 || distance > output.length) {
        throw new Error("Invalid ln.kr copy distance");
      }
      ensureLength(length);
      for (let index = 0; index < length; index ++) {
        output.push(output[output.length - distance]);
      }
      continue;
    }

    const length = reader.readGamma();
    ensureLength(length);
    for (let index = 0; index < length; index ++) {
      output.push(Number(reader.readFixed(8)));
    }
  }

  if (reader.number !== 1n) throw new Error("ln.kr payload has trailing data");
  const bytes = Uint8Array.from(output);
  if (crc32(bytes) !== expectedChecksum) throw new Error("ln.kr checksum mismatch");

  return {
    text: decoder.decode(bytes),
    kind: NUMBER_TO_KIND[kindNumber],
    version
  };
}
