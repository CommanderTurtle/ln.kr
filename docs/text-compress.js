import {
  countAlphabetSymbols,
  huffmanEncode,
  numberToString,
  stringToNumber
} from "./compress.js";

const MAGIC = 0x4c4e; // "LN", read least-significant bit first.
const LEGACY_VERSION = 1;
const STRUCTURED_VERSION = 2;
const MIN_COPY = 4;
const MAX_CHAIN = 64;
const MIN_PATCH = 32;
const MAX_PATCH = 4096;
const MAX_PATCH_RUNS = 128;
const PATCH_PROBE_STEP = 16;
const PATCH_COPY_THRESHOLD = 128;
const PATCH_OFFSETS = Object.freeze([0, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]);

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
  " the ", " and ", " that ", " with ", " this ", " for ", " are ", " not ",
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

function patchBitLength (distance, length, runs, runBits) {
  return 4 + gammaBitLength(distance) +
    gammaBitLength(length - MIN_PATCH + 1) +
    gammaBitLength(runs) + runBits;
}

function evaluatePatchCandidate (bytes, position, source, legacyCosts) {
  const distance = position - source;
  const maxLength = Math.min(bytes.length - position, distance, MAX_PATCH);
  if (distance < MIN_PATCH || maxLength < MIN_PATCH) return null;

  // A small evenly-spaced sample rejects unrelated occurrences of a common
  // four-byte anchor before the exact residual scan does any substantial work.
  let sampleMatches = 0;
  const sampleCount = Math.min(24, maxLength);
  for (let sample = 0; sample < sampleCount; sample ++) {
    const offset = Math.floor(sample * (maxLength - 1) / Math.max(1, sampleCount - 1));
    if (bytes[source + offset] === bytes[position + offset]) sampleMatches ++;
  }
  if (sampleMatches / sampleCount < 0.45) return null;

  const runs = [];
  let runBits = 0;
  let different = 0;
  let matchingStreak = 0;
  let previousRunEnd = 0;
  let best = null;

  for (let offset = 0; offset < maxLength; offset ++) {
    if (bytes[source + offset] !== bytes[position + offset]) {
      matchingStreak = 0;
      different ++;
      const current = runs.at(-1);
      if (current && current.end === offset) {
        const oldLength = current.end - current.start;
        current.end ++;
        runBits += gammaBitLength(oldLength + 1) - gammaBitLength(oldLength) + 8;
      } else {
        if (runs.length >= MAX_PATCH_RUNS) break;
        const gap = offset - previousRunEnd;
        runs.push({ start: offset, end: offset + 1 });
        runBits += gammaBitLength(gap + 1) + gammaBitLength(1) + 8;
      }
      previousRunEnd = runs.at(-1).end;
    } else {
      matchingStreak ++;
    }

    const length = offset + 1;
    if (
      length < MIN_PATCH ||
      different === 0 ||
      different / length > 0.30 ||
      (matchingStreak < MIN_COPY && length !== maxLength)
    ) continue;

    const bitLength = patchBitLength(distance, length, runs.length, runBits);
    const legacyBitLength = legacyCosts[position + length] - legacyCosts[position];
    const legacySavings = legacyBitLength - bitLength;
    const savings = length * 8 - bitLength;
    if (
      legacySavings > 2 &&
      (!best || legacySavings > best.legacySavings ||
        (legacySavings === best.legacySavings && savings > best.savings))
    ) {
      best = {
        distance,
        length,
        bitLength,
        savings,
        legacySavings
      };
    }
  }

  if (best) {
    best.runs = runs
      .filter(run => run.start < best.length)
      .map(run => ({
        start: run.start,
        bytes: bytes.slice(
          position + run.start,
          position + Math.min(run.end, best.length)
        )
      }));
  }
  return best;
}

function findPatchMatch (bytes, position, chains, legacyCosts) {
  if (position < MIN_PATCH || position + MIN_PATCH > bytes.length) return null;

  const sourceVotes = new Map();
  for (const offset of PATCH_OFFSETS) {
    if (position + offset + MIN_COPY > bytes.length) break;
    const candidates = chains.get(hash4(bytes, position + offset));
    if (!candidates) continue;
    const offsetSources = new Set();
    for (let item = candidates.length - 1, taken = 0; item >= 0 && taken < 4; item --, taken ++) {
      const source = candidates[item] - offset;
      const distance = position - source;
      if (source >= 0 && distance >= MIN_PATCH && offset + MIN_COPY <= distance) {
        offsetSources.add(source);
      }
    }
    for (const source of offsetSources) {
      sourceVotes.set(source, (sourceVotes.get(source) || 0) + 1);
    }
  }

  // Matching anchors at several exponentially-spaced offsets form a cheap,
  // multiscale fingerprint.  A real aligned structure accrues votes; a common
  // word or brace sequence normally does not.  Only the two strongest prior
  // blocks receive the exact residual scan.
  const sources = [...sourceVotes]
    .filter(([, votes]) => votes >= 2)
    .sort(([sourceA, votesA], [sourceB, votesB]) =>
      votesB - votesA || sourceB - sourceA)
    .slice(0, 2)
    .map(([source]) => source);

  let best = null;
  for (const source of sources) {
    const candidate = evaluatePatchCandidate(bytes, position, source, legacyCosts);
    if (
      candidate &&
      (!best || candidate.legacySavings > best.legacySavings ||
        (candidate.legacySavings === best.legacySavings && candidate.distance < best.distance))
    ) best = candidate;
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

function tokenize (bytes, structured = false, legacyCosts = null) {
  const tokens = [];
  const chains = new Map();
  let position = 0;
  let lastPatchProbe = -PATCH_PROBE_STEP;

  while (position < bytes.length) {
    const dictionary = findDictionaryMatch(bytes, position);
    const copy = findCopyMatch(bytes, position, chains);
    let patch = null;
    if (
      structured &&
      position - lastPatchProbe >= PATCH_PROBE_STEP &&
      (!copy || copy.length < PATCH_COPY_THRESHOLD)
    ) {
      lastPatchProbe = position;
      patch = findPatchMatch(bytes, position, chains, legacyCosts);
    }
    const start = position;

    if (patch) {
      tokens.push({ type: "patch", ...patch });
      position += patch.length;
    } else if (copy && (!dictionary || copy.savings > dictionary.savings)) {
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

    tokens.at(-1).start = start;
    addChains(bytes, chains, start, position);
  }

  return tokens;
}

function buildLegacyCostPrefix (byteLength, tokens) {
  const costs = new Float64Array(byteLength + 1);
  let position = 0;
  let accumulated = 0;

  for (const token of tokens) {
    while (position < token.start) costs[++position] = accumulated;
    const rate = tokenBits(token, LEGACY_VERSION).length / token.length;
    for (let offset = 0; offset < token.length; offset ++) {
      accumulated += rate;
      costs[++position] = accumulated;
    }
  }
  while (position < byteLength) costs[++position] = accumulated;
  return costs;
}

function tokenBits (token, version) {
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
    let bits = (version === LEGACY_VERSION ? "111" : "1110") +
      gammaBits(token.bytes.length);
    for (const byte of token.bytes) bits += fixedBits(byte, 8);
    return bits;
  }
  if (token.type === "patch") {
    let bits = "1111" + gammaBits(token.distance) +
      gammaBits(token.length - MIN_PATCH + 1) + gammaBits(token.runs.length);
    let previousEnd = 0;
    for (const run of token.runs) {
      bits += gammaBits(run.start - previousEnd + 1) + gammaBits(run.bytes.length);
      for (const byte of run.bytes) bits += fixedBits(byte, 8);
      previousEnd = run.start + run.bytes.length;
    }
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
    /(^|\n)(?:#{1,6}\s|```|>\s|[-*+]\s|\d+\.\s)/.test(text) ||
    /\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/.test(text)
  ) return "markdown";
  if (
    /(^|\n)\s*(?:import|export|const|let|var|function|class)\s/.test(text) ||
    /(?:=>|document\.querySelector|addEventListener\s*\()/.test(text)
  ) return "javascript";
  return "text";
}

function createEncodingPlan (text, kind, version, bytes = null, legacyTokens = null) {
  bytes ||= encoder.encode(text);
  let tokens;
  if (version === STRUCTURED_VERSION) {
    legacyTokens ||= tokenize(bytes);
    const legacyCosts = buildLegacyCostPrefix(bytes.length, legacyTokens);
    tokens = tokenize(bytes, true, legacyCosts);
  } else {
    tokens = tokenize(bytes);
  }
  const checksum = crc32(bytes);
  const lengthBits = gammaBits(bytes.length + 1);
  const tokenSequences = tokens.map(token => tokenBits(token, version));
  const tokenBitLength = tokenSequences.reduce((total, bits) => total + bits.length, 0);
  const counts = { ascii: 0, dictionary: 0, copy: 0, raw: 0, patch: 0 };
  for (const token of tokens) counts[token.type] ++;

  return {
    kind,
    version,
    bytes,
    tokens,
    tokenSequences,
    checksum,
    lengthBits,
    bitLength: 16 + 3 + 2 + lengthBits.length + 32 + tokenBitLength,
    counts
  };
}

function encodePlan (plan, alphabet) {
  let number = 1n;
  for (let index = plan.tokenSequences.length - 1; index >= 0; index --) {
    number = huffmanEncode(number, plan.tokenSequences[index]);
  }

  const { checksum, lengthBits, kind, version, bytes, tokens, counts } = plan;
  number = huffmanEncode(number, fixedBits(checksum, 32));
  number = huffmanEncode(number, lengthBits);
  number = huffmanEncode(number, fixedBits(KIND_TO_NUMBER[kind], 2));
  number = huffmanEncode(number, fixedBits(version, 3));
  number = huffmanEncode(number, fixedBits(MAGIC, 16));

  const payload = numberToString(number, alphabet);

  return {
    payload,
    kind,
    stats: {
      version,
      bytes: bytes.length,
      bits: plan.bitLength,
      symbols: countAlphabetSymbols(payload, alphabet),
      tokens: tokens.length,
      ...counts
    }
  };
}

function minimumSymbolsForBitLength (bitLength, alphabetSize) {
  let number = 1n << BigInt(bitLength);
  const base = BigInt(alphabetSize);
  let symbols = 0;
  while (number > 0) {
    number = (number - 1n) / base;
    symbols ++;
  }
  return symbols;
}

function resolveKind (text, requestedKind) {
  if (typeof text !== "string") throw new TypeError("Text must be a string");
  const kind = requestedKind === "auto" ? detectKind(text) : requestedKind;
  if (!(kind in KIND_TO_NUMBER)) throw new Error(`Unsupported content kind: ${kind}`);
  return kind;
}

/** Frozen v1 encoder, retained for compatibility and size comparisons. */
export function compressTextV1 (text, alphabet, requestedKind = "auto") {
  const kind = resolveKind(text, requestedKind);
  return encodePlan(createEncodingPlan(text, kind, LEGACY_VERSION), alphabet);
}

/** Structural v2 encoder for diagnostics and format conformance tests. */
export function compressTextV2 (text, alphabet, requestedKind = "auto") {
  const kind = resolveKind(text, requestedKind);
  return encodePlan(createEncodingPlan(text, kind, STRUCTURED_VERSION), alphabet);
}

/**
 * Compress exact UTF-8 text.  v1 is always planned first; the structural v2
 * candidate is selected only when it has fewer transport symbols and decodes
 * back to the exact source.  Thus optimization cannot enlarge or corrupt a
 * document, and old decoders remain sufficient for every v1-selected link.
 * @returns {{payload: string, kind: string, stats: object}}
 */
export function compressText (text, alphabet, requestedKind = "auto") {
  const kind = resolveKind(text, requestedKind);
  const bytes = encoder.encode(text);
  const legacyPlan = createEncodingPlan(text, kind, LEGACY_VERSION, bytes);
  if (bytes.length < MIN_PATCH * 2) return encodePlan(legacyPlan, alphabet);

  const structuredPlan = createEncodingPlan(
    text,
    kind,
    STRUCTURED_VERSION,
    bytes,
    legacyPlan.tokens
  );
  if (
    structuredPlan.counts.patch === 0 ||
    structuredPlan.bitLength >= legacyPlan.bitLength
  ) return encodePlan(legacyPlan, alphabet);

  const structured = encodePlan(structuredPlan, alphabet);
  const minimumLegacySymbols = minimumSymbolsForBitLength(
    legacyPlan.bitLength,
    alphabet.length
  );
  let legacy = null;
  if (structured.stats.symbols >= minimumLegacySymbols) {
    legacy = encodePlan(legacyPlan, alphabet);
    if (structured.stats.symbols >= legacy.stats.symbols) return legacy;
  }

  try {
    if (decompressText(structured.payload, alphabet).text !== text) {
      return legacy || encodePlan(legacyPlan, alphabet);
    }
  } catch {
    return legacy || encodePlan(legacyPlan, alphabet);
  }

  structured.stats.baselineBits = legacyPlan.bitLength;
  structured.stats.savedBits = legacyPlan.bitLength - structuredPlan.bitLength;
  if (legacy) {
    structured.stats.baselineSymbols = legacy.stats.symbols;
    structured.stats.savedSymbols = legacy.stats.symbols - structured.stats.symbols;
  }
  return structured;
}

/**
 * Decode an ln.kr versioned text payload. Throws on a bad version, malformed record,
 * invalid UTF-8, trailing data, incorrect byte count, or checksum mismatch.
 */
export function decompressText (payload, alphabet) {
  const reader = new BitReader(stringToNumber(payload, alphabet));
  const magic = Number(reader.readFixed(16));
  if (magic !== MAGIC) throw new Error("Not an ln.kr text payload");

  const version = Number(reader.readFixed(3));
  if (![LEGACY_VERSION, STRUCTURED_VERSION].includes(version)) {
    throw new Error(`Unsupported ln.kr version: ${version}`);
  }

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

    if (version === STRUCTURED_VERSION && reader.readBit() === 1) {
      const distance = reader.readGamma();
      const length = reader.readGamma() + MIN_PATCH - 1;
      const runCount = reader.readGamma();
      if (distance < 1 || distance > output.length || length > distance) {
        throw new Error("Invalid ln.kr structural reference");
      }
      if (runCount < 1 || runCount > Math.min(MAX_PATCH_RUNS, length)) {
        throw new Error("Invalid ln.kr structural residual count");
      }
      ensureLength(length);
      const sourceStart = output.length - distance;
      const block = output.slice(sourceStart, sourceStart + length);
      let previousEnd = 0;
      for (let run = 0; run < runCount; run ++) {
        const start = previousEnd + reader.readGamma() - 1;
        const runLength = reader.readGamma();
        if (start < previousEnd || start + runLength > length) {
          throw new Error("Invalid ln.kr structural residual range");
        }
        for (let index = 0; index < runLength; index ++) {
          block[start + index] = Number(reader.readFixed(8));
        }
        previousEnd = start + runLength;
      }
      output.push(...block);
      continue;
    }

    const rawLength = reader.readGamma();
    ensureLength(rawLength);
    for (let index = 0; index < rawLength; index ++) {
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
