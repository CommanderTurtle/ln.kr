import {
  countAlphabetSymbols,
  huffmanEncode,
  numberToString,
  stringToNumber
} from "./compress.js";
import { deflate, inflate } from "./vendor/pako.esm.min.js";

const MAGIC = 0x4c4e; // "LN", read least-significant bit first.
const LEGACY_VERSION = 1;
const STRUCTURED_VERSION = 2;
const DICTIONARY_VERSION = 3;
const DEFLATE_VERSION = 4;
const MIN_COPY = 4;
const MAX_CHAIN = 64;
const MIN_PATCH = 32;
const MAX_PATCH = 4096;
const MAX_PATCH_RUNS = 128;
const PATCH_PROBE_STEP = 16;
const PATCH_COPY_THRESHOLD = 128;
const PATCH_OFFSETS = Object.freeze([0, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048]);
const MIN_LEXEME_BYTES = 2;
const MAX_LEXEME_BYTES = 192;
const MIN_LEXEME_OCCURRENCES = 3;
const MAX_LEXICON_ENTRIES = 512;
const MAX_V3_LEXICON_ENTRIES = 7225;
const MAX_V3_LEXEME_BYTES = 512;
const MAX_V3_GRAMMAR_UNITS = 32;
const MAX_V3_PHRASE_ENTRIES = 2048;
const MAX_GRAMMAR_UNITS = 16;
const GRAMMAR_SEEN_SIZE = 1 << 19;
const MIN_TEMPLATE_OCCURRENCES = 3;
const MIN_TEMPLATE_BYTES = 12;
const MAX_TEMPLATE_BYTES = 8192;
const MAX_TEMPLATE_TOKENS = 512;
const MAX_TEMPLATE_ENTRIES = 256;
const MAX_TEMPLATE_GROUP_OCCURRENCES = 2048;
const TEMPLATE_SCAN_MULTIPLIER = 4;

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
const byteHex = Array.from({ length: 256 }, (_, value) => value.toString(16).padStart(2, "0"));
const dictionaryValues = new Set(textDictionary);

function buildDictionaryTrie (extraEntries = []) {
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
    node.type = "dictionary";
  });
  extraEntries.forEach((bytes, index) => {
    let node = root;
    for (const byte of bytes) {
      if (!node.children.has(byte)) {
        node.children.set(byte, { children: new Map(), index: -1 });
      }
      node = node.children.get(byte);
    }
    node.index = index;
    node.type = "lexeme";
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

function findDictionaryMatch (bytes, position, trie = dictionaryTrie, lexemeBitCosts = null) {
  let node = trie;
  let best = null;

  for (let index = position; index < bytes.length; index ++) {
    node = node.children.get(bytes[index]);
    if (!node) break;
    if (node.index >= 0) {
      const length = index - position + 1;
      const lexemeBits = typeof lexemeBitCosts === "number"
        ? lexemeBitCosts
        : lexemeBitCosts?.[node.index];
      const bitLength = node.type === "lexeme" && lexemeBits !== undefined
        ? 4 + lexemeBits
        : (node.type === "lexeme" ? 4 : 2) + gammaBitLength(node.index + 1);
      const savings = length * 8 - bitLength;
      if (savings > 0 && (!best || savings > best.savings)) {
        best = { type: node.type, index: node.index, length, bitLength, savings };
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
  return 6 + gammaBitLength(distance) +
    gammaBitLength(length - MIN_PATCH + 1) +
    gammaBitLength(runs) + runBits;
}

function patchShapeKey (token) {
  return `${token.length}:${token.runs
    .map(run => `${run.start},${run.bytes.length}`)
    .join(";")}`;
}

function patchResidualBytes (token) {
  return token.runs.reduce((total, run) => total + run.bytes.length, 0);
}

/**
 * A full structural delta also defines its run layout. Later deltas with the
 * same block length and residual positions can reference that layout and send
 * only a prior-output distance plus their exact changed bytes. This is a
 * document-local grammar: definitions never leave the payload and decoding
 * remains a single forward pass.
 */
function assignPatchGrammar (tokens) {
  const definitions = [];
  const latestDefinition = new Map();
  let patchDefinition = 0;
  let patchReuse = 0;

  for (const token of tokens) {
    if (token.type !== "patch") continue;

    const key = patchShapeKey(token);
    const previous = latestDefinition.get(key);
    const fullBits = patchBitLength(
      token.distance,
      token.length,
      token.runs.length,
      token.runs.reduce((total, run, index) => {
        const previousEnd = index
          ? token.runs[index - 1].start + token.runs[index - 1].bytes.length
          : 0;
        return total + gammaBitLength(run.start - previousEnd + 1) +
          gammaBitLength(run.bytes.length) + run.bytes.length * 8;
      }, 0)
    );

    if (previous !== undefined) {
      const templateDistance = definitions.length - previous;
      const reuseBits = 6 + gammaBitLength(token.distance) +
        gammaBitLength(templateDistance) + patchResidualBytes(token) * 8;
      if (reuseBits < fullBits) {
        token.templateDistance = templateDistance;
        token.bitLength = reuseBits;
        patchReuse ++;
        continue;
      }
    }

    delete token.templateDistance;
    token.bitLength = fullBits;
    latestDefinition.set(key, definitions.length);
    definitions.push(key);
    patchDefinition ++;
  }

  return { patchDefinition, patchReuse };
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

function findLexemePath (bytes, position, trie, lexemeBitCosts = null) {
  let cursor = position;
  let first = null;
  let savings = 0;

  // A long exact copy can begin one space or punctuation byte before a much
  // cheaper grammar symbol and hide it from a purely greedy parser.  Look
  // through a few already-cheap prefix tokens.  If their combined guaranteed
  // saving beats the competing range record, taking the first step is safe;
  // the lexeme will be reconsidered at the following position.
  for (let step = 0; step < 4 && cursor < bytes.length; step ++) {
    const match = findDictionaryMatch(bytes, cursor, trie, lexemeBitCosts);
    if (match?.type === "lexeme") {
      return { first: first || match, savings: savings + match.savings };
    }

    let token = match;
    if (!token) {
      if (bytes[cursor] >= 128) return null;
      token = { type: "ascii", byte: bytes[cursor], length: 1, bitLength: 8, savings: 0 };
    }
    first ||= token;
    savings += token.savings;
    cursor += token.length;
  }
  return null;
}

function tokenize (
  bytes,
  structured = false,
  legacyCosts = null,
  activeDictionaryTrie = dictionaryTrie,
  templateCandidates = null,
  lexemeBitCosts = null
) {
  const tokens = [];
  const chains = new Map();
  let position = 0;
  let lastPatchProbe = -PATCH_PROBE_STEP;

  while (position < bytes.length) {
    const dictionary = findDictionaryMatch(
      bytes,
      position,
      activeDictionaryTrie,
      lexemeBitCosts
    );
    const copy = findCopyMatch(bytes, position, chains);
    const lexemePath = activeDictionaryTrie === dictionaryTrie
      ? null
      : findLexemePath(bytes, position, activeDictionaryTrie, lexemeBitCosts);
    const template = templateCandidates?.get(position)?.[0] || null;
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
    const structural = template && (!patch || template.legacySavings >= patch.legacySavings)
      ? template
      : patch && { type: "patch", ...patch };
    const ordinarySavings = Math.max(
      lexemePath?.savings || 0,
      copy?.savings || 0,
      dictionary?.savings || 0
    );

    if (structural && structural.savings >= ordinarySavings) {
      tokens.push(structural);
      position += structural.length;
    } else if (
      lexemePath &&
      (!copy || lexemePath.savings > copy.savings) &&
      (!dictionary || lexemePath.savings > dictionary.savings)
    ) {
      tokens.push(lexemePath.first);
      position += lexemePath.first.length;
    } else if (copy && (!dictionary || copy.savings > dictionary.savings)) {
      tokens.push({ type: "copy", ...copy });
      position += copy.length;
    } else if (dictionary) {
      tokens.push(dictionary);
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

function codeUnitByteOffsets (text) {
  const offsets = new Uint32Array(text.length + 1);
  let byteOffset = 0;

  for (let index = 0; index < text.length;) {
    offsets[index] = byteOffset;
    const point = text.codePointAt(index);
    const width = point > 0xffff ? 2 : 1;
    if (width === 2) offsets[index + 1] = byteOffset;
    byteOffset += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    index += width;
    offsets[index] = byteOffset;
  }
  return offsets;
}

function lineRanges (text) {
  const ranges = [];
  const breaks = /\r\n|\n|\r/g;
  let start = 0;
  let match;

  while ((match = breaks.exec(text))) {
    ranges.push({ start, contentEnd: match.index, end: match.index + match[0].length });
    start = match.index + match[0].length;
  }
  if (start < text.length) ranges.push({ start, contentEnd: text.length, end: text.length });
  return ranges;
}

function inferredStructuralKind (text, kind) {
  if (kind === "html") return "html";
  if (kind === "markdown") return "markdown";
  if (kind === "javascript") return "javascript";

  const trimmed = text.trimStart();
  if (
    /^(?:\{|\[)/.test(trimmed) &&
    ((text.match(/^\s*"(?:[^"\\]|\\.)+"\s*:/gm) || []).length >= 2)
  ) return "json";

  const cssProperties = (text.match(/^\s*(?:--[\w-]+|[a-z-]{2,})\s*:\s*[^\n;{}]+;/gim) || []).length;
  const cssRules = (text.match(/(?:^|\n)\s*[.#@:\w\[\]="'()>+~*-][^\n{}]{0,255}\{/g) || []).length;
  if (cssProperties >= 3 && cssRules >= 1) return "css";
  return "text";
}

function classifyFenceLanguage (info) {
  const language = String(info).trim().toLowerCase().split(/\s+/)[0];
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx", "javascript", "typescript"].includes(language)) {
    return "javascript";
  }
  if (["css", "scss", "sass", "less"].includes(language)) return "css";
  if (["html", "htm", "xml", "svg", "vue", "svelte"].includes(language)) return "html";
  if (["json", "jsonc", "json5"].includes(language)) return "json";
  if (["md", "markdown", "mdx"].includes(language)) return "markdown";
  return language ? `code:${language}` : "code";
}

function collectExplicitStructuralZones (text, kind) {
  const ranges = [];
  const addElementBodies = (name, zoneKind) => {
    const expression = new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}\\s*>`, "gi");
    for (const match of text.matchAll(expression)) {
      const opening = match[0].match(new RegExp(`^<${name}\\b[^>]*>`, "i"));
      const close = match[0].toLowerCase().lastIndexOf(`</${name}`);
      if (!opening || close < opening[0].length) continue;
      let detectedKind = zoneKind;
      if (name === "script" && /\btype\s*=\s*["']?(?:application\/)?(?:ld\+)?json/i.test(opening[0])) {
        detectedKind = "json";
      }
      ranges.push({
        start: match.index + opening[0].length,
        end: match.index + close,
        kind: detectedKind,
        priority: 2
      });
    }
  };

  addElementBodies("style", "css");
  addElementBodies("script", "javascript");

  if (kind === "markdown" || /(^|\n)```/.test(text)) {
    const fences = /^```([^\r\n]*)\r?\n([\s\S]*?)^```[^\r\n]*(?:\r?\n|$)/gm;
    for (const match of text.matchAll(fences)) {
      const openingEnd = match[0].indexOf("\n") + 1;
      const contentOffset = match[0].indexOf(match[2], openingEnd);
      ranges.push({
        start: match.index + contentOffset,
        end: match.index + contentOffset + match[2].length,
        kind: classifyFenceLanguage(match[1]),
        priority: 1
      });
    }

    const authoredBlocks = /<(details|summary|div|section|article|table|picture|figure|video|audio)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
    for (const match of text.matchAll(authoredBlocks)) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
        kind: "html",
        priority: 1
      });
    }
    const authoredVoidElements = /<(?:img|source|track|br|hr)\b[^>]*>/gi;
    for (const match of text.matchAll(authoredVoidElements)) {
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
        kind: "html",
        priority: 1
      });
    }
  }
  return ranges;
}

function classifyStructuralLine (value) {
  const trimmed = value.trim();
  if (/^\s*<\/?[a-z][^>]*>/i.test(value)) return "html";
  if (/^\s*(?:--[\w-]+|[a-z-]{2,})\s*:\s*[^;{}]+;\s*$/i.test(value)) return "css";
  if (
    trimmed.length <= 512 && trimmed.endsWith("{") &&
    /^[.#@:\w\[\]="'()>+~*-]/.test(trimmed)
  ) return "css";
  if (/^\s*"(?:[^"\\]|\\.)+"\s*:/.test(value)) return "json";
  if (/^\s*(?:import|export|const|let|var|function|class|interface|type|if|for|while|return)\b/.test(value)) {
    return "javascript";
  }
  if (/(?:=>|\b(?:document|window)\.|\.addEventListener\s*\()/.test(value)) return "javascript";
  return "text";
}

function scanStructuralZones (text, kind) {
  const offsets = codeUnitByteOffsets(text);
  const baseKind = inferredStructuralKind(text, kind);
  const explicit = collectExplicitStructuralZones(text, kind)
    .filter(range => range.start < range.end)
    .sort((left, right) => left.start - right.start || right.priority - left.priority || right.end - left.end);
  const characterZones = [];
  const push = (start, end, zoneKind) => {
    if (start >= end) return;
    const previous = characterZones.at(-1);
    if (previous && previous.end === start && previous.kind === zoneKind) {
      previous.end = end;
    } else {
      characterZones.push({ start, end, kind: zoneKind });
    }
  };

  const boundaries = [...new Set([
    0,
    text.length,
    ...explicit.flatMap(range => [range.start, range.end])
  ])].sort((left, right) => left - right);
  for (let index = 0; index + 1 < boundaries.length; index ++) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const active = explicit
      .filter(range => range.start <= start && range.end >= end)
      .sort((left, right) => right.priority - left.priority ||
        (left.end - left.start) - (right.end - right.start))[0];
    push(start, end, active?.kind || baseKind);
  }

  // Generic text can still contain a pasted CSS/JS/JSON sector. Promote only
  // sustained runs so one incidental colon or brace cannot relabel prose.
  let refined = characterZones;
  if (baseKind === "text") {
    refined = [];
    for (const zone of characterZones) {
      if (zone.kind !== "text") {
        refined.push(zone);
        continue;
      }
      const lines = lineRanges(text.slice(zone.start, zone.end));
      let runStart = 0;
      while (runStart < lines.length) {
        const first = lines[runStart];
        const firstValue = text.slice(zone.start + first.start, zone.start + first.contentEnd);
        const label = classifyStructuralLine(firstValue);
        let runEnd = runStart + 1;
        let meaningful = firstValue.trim() ? 1 : 0;
        while (runEnd < lines.length) {
          const current = lines[runEnd];
          const value = text.slice(zone.start + current.start, zone.start + current.contentEnd);
          const currentLabel = value.trim() ? classifyStructuralLine(value) : label;
          if (currentLabel !== label) break;
          if (value.trim()) meaningful ++;
          runEnd ++;
        }
        const start = zone.start + first.start;
        const end = zone.start + lines[runEnd - 1].end;
        const promoted = label !== "text" && meaningful >= 2 && end - start >= 96;
        const previous = refined.at(-1);
        const zoneKind = promoted ? label : "text";
        if (previous && previous.end === start && previous.kind === zoneKind) previous.end = end;
        else refined.push({ start, end, kind: zoneKind });
        runStart = runEnd;
      }
    }
  }

  return refined.map(zone => ({
    ...zone,
    byteStart: offsets[zone.start],
    byteEnd: offsets[zone.end]
  }));
}

function structuralZoneAt (zones, codeIndex) {
  let low = 0;
  let high = zones.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const zone = zones[middle];
    if (codeIndex < zone.start) high = middle - 1;
    else if (codeIndex >= zone.end) low = middle + 1;
    else return zone;
  }
  return zones.at(-1) || { start: 0, end: 0, byteStart: 0, byteEnd: 0, kind: "text" };
}

function scanBraceSectors (text, zone) {
  if (!["css", "javascript", "json"].includes(zone.kind) && !zone.kind.startsWith("code:")) return [];
  const sectors = [];
  const stack = [];
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = zone.start; index < zone.end; index ++) {
    const character = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (character === "\n" || character === "\r") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index ++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index ++;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index ++;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") {
      stack.push(index);
      continue;
    }
    if (character !== "}" || !stack.length) continue;

    const opening = stack.pop();
    const lineStart = Math.max(zone.start, text.lastIndexOf("\n", opening - 1) + 1);
    const newline = text.indexOf("\n", index + 1);
    const end = newline >= 0 && newline < zone.end ? newline + 1 : index + 1;
    const start = lineStart < opening && text.slice(lineStart, opening).trim() ? lineStart : opening;
    if (end - start >= 32 && end - start <= MAX_TEMPLATE_BYTES) {
      sectors.push({ start, end, zoneKind: zone.kind, type: "sector" });
    }
  }
  return sectors;
}

function scanHTMLSectors (text, zone) {
  if (zone.kind !== "html") return [];
  const sectors = [];
  const stack = [];
  const voidElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
    "param", "source", "track", "wbr"
  ]);
  const tags = /<\/?([a-z][\w:-]*)\b[^>]*>/gi;
  tags.lastIndex = zone.start;
  let match;
  while ((match = tags.exec(text)) && match.index < zone.end) {
    if (tags.lastIndex > zone.end) break;
    const name = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    const selfClosing = /\/\s*>$/.test(match[0]) || voidElements.has(name);
    if (!closing && !selfClosing) {
      stack.push({ name, start: match.index });
      continue;
    }
    if (!closing) continue;
    let openingIndex = stack.length - 1;
    while (openingIndex >= 0 && stack[openingIndex].name !== name) openingIndex --;
    if (openingIndex < 0) continue;
    const opening = stack[openingIndex];
    stack.length = openingIndex;
    const end = tags.lastIndex;
    if (end - opening.start >= 32 && end - opening.start <= MAX_TEMPLATE_BYTES) {
      sectors.push({ start: opening.start, end, zoneKind: "html", type: "sector" });
    }
  }
  return sectors;
}

function collectStructuralRanges (text, zones, offsets) {
  const ranges = [];
  for (const line of lineRanges(text)) {
    const value = text.slice(line.start, line.contentEnd);
    if (!value.trim() || line.end - line.start < MIN_TEMPLATE_BYTES || line.end - line.start > 2048) continue;
    const zone = structuralZoneAt(zones, line.start);
    ranges.push({
      start: line.start,
      end: line.end,
      zoneKind: zone.kind,
      type: "line"
    });
  }

  for (const zone of zones) {
    ranges.push(...scanBraceSectors(text, zone), ...scanHTMLSectors(text, zone));
  }

  // Markdown lists, tables, block quotes, and ordinary multi-line paragraphs
  // become sector candidates even when they contain no programming braces.
  const lines = lineRanges(text);
  let paragraphStart = -1;
  let paragraphZone = null;
  const flushParagraph = end => {
    if (paragraphStart < 0 || !paragraphZone) return;
    if (end - paragraphStart >= 48 && end - paragraphStart <= MAX_TEMPLATE_BYTES) {
      ranges.push({
        start: paragraphStart,
        end,
        zoneKind: paragraphZone.kind,
        type: "sector"
      });
    }
    paragraphStart = -1;
    paragraphZone = null;
  };
  for (const line of lines) {
    const value = text.slice(line.start, line.contentEnd);
    const zone = structuralZoneAt(zones, line.start);
    if (!value.trim() || zone.kind !== "markdown") {
      flushParagraph(line.start);
      continue;
    }
    if (paragraphStart < 0) {
      paragraphStart = line.start;
      paragraphZone = zone;
    }
  }
  flushParagraph(text.length);

  const unique = new Map();
  for (const range of ranges) {
    const byteStart = offsets[range.start];
    const byteEnd = offsets[range.end];
    const byteLength = byteEnd - byteStart;
    if (byteLength < MIN_TEMPLATE_BYTES || byteLength > MAX_TEMPLATE_BYTES) continue;
    unique.set(`${range.type}:${byteStart}:${byteEnd}`, { ...range, byteStart, byteEnd });
  }
  return [...unique.values()].sort((left, right) =>
    (left.type === right.type ? 0 : left.type === "sector" ? -1 : 1) ||
    left.byteStart - right.byteStart || right.byteEnd - left.byteEnd);
}

function hashTemplateShape (hash, value) {
  for (let index = 0; index < value.length; index ++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function templatePatternUnits (value) {
  const expression = /("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)|([\p{L}_$-]+)|(\p{N}+(?:\.\p{N}+)*)|(\s+)|([^\p{L}\p{N}_$\s-]+)/gu;
  const units = [];
  let hash = 2166136261;
  for (const match of value.matchAll(expression)) {
    let shape;
    if (match[1] !== undefined) shape = `q${match[0][0]}`;
    else if (match[2] !== undefined) shape = "w";
    else if (match[3] !== undefined) shape = "n";
    else if (match[4] !== undefined) shape = `s${match[0]}`;
    else shape = `p${match[0]}`;
    hash = hashTemplateShape(hash, shape);
    units.push({ value: match[0], bytes: encoder.encode(match[0]), shape });
    if (units.length > MAX_TEMPLATE_TOKENS) return null;
  }
  return { units, hash };
}

function commonByteEdges (values) {
  const minimum = Math.min(...values.map(value => value.length));
  let prefix = 0;
  while (prefix < minimum && values.every(value => value[prefix] === values[0][prefix])) prefix ++;
  let suffix = 0;
  while (
    suffix < minimum - prefix &&
    values.every(value => value[value.length - suffix - 1] === values[0][values[0].length - suffix - 1])
  ) suffix ++;
  return { prefix, suffix };
}

function templateReferenceBitLength (index, holes) {
  return 7 + gammaBitLength(index + 1) + holes.reduce(
    (total, hole) => total + gammaBitLength(hole.length + 1) + hole.length * 8,
    0
  );
}

function templateDefinitionBitLength (template) {
  const staticLength = template.staticSegments.reduce((total, segment) => total + segment.length, 0);
  const definitions = new Uint8Array(staticLength);
  let offset = 0;
  let bits = gammaBitLength(template.holeCount);
  for (const segment of template.staticSegments) {
    bits += gammaBitLength(segment.length + 1);
    definitions.set(segment, offset);
    offset += segment.length;
  }
  return bits + tokenize(definitions).reduce(
    (total, token) => total + tokenBits(token, LEGACY_VERSION).length,
    0
  );
}

function deriveStructuralTemplate (group, legacyCosts) {
  const unitCount = group[0].units.length;
  if (!unitCount || group.some(occurrence => occurrence.units.length !== unitCount)) return null;

  const staticSegments = [];
  const holesByOccurrence = group.map(() => []);
  let currentStatic = [];
  let lastWasHole = false;
  const appendStatic = bytes => {
    if (bytes.length) currentStatic.push(...bytes);
  };
  const appendHole = values => {
    if (lastWasHole && currentStatic.length === 0) {
      values.forEach((value, index) => {
        const previous = holesByOccurrence[index].at(-1);
        const combined = new Uint8Array(previous.length + value.length);
        combined.set(previous);
        combined.set(value, previous.length);
        holesByOccurrence[index][holesByOccurrence[index].length - 1] = combined;
      });
      return;
    }
    staticSegments.push(Uint8Array.from(currentStatic));
    currentStatic = [];
    values.forEach((value, index) => holesByOccurrence[index].push(value));
    lastWasHole = true;
  };

  for (let unit = 0; unit < unitCount; unit ++) {
    const values = group.map(occurrence => occurrence.units[unit].bytes);
    const first = values[0];
    const identical = values.every(value =>
      value.length === first.length && value.every((byte, index) => byte === first[index]));
    if (identical) {
      appendStatic(first);
      continue;
    }
    const { prefix, suffix } = commonByteEdges(values);
    appendStatic(first.slice(0, prefix));
    appendHole(values.map(value => value.slice(prefix, value.length - suffix)));
    appendStatic(first.slice(first.length - suffix));
  }
  staticSegments.push(Uint8Array.from(currentStatic));
  const holeCount = holesByOccurrence[0].length;
  if (!holeCount || staticSegments.length !== holeCount + 1) return null;

  const staticBytes = staticSegments.reduce((total, segment) => total + segment.length, 0);
  if (staticBytes < 8) return null;
  const occurrences = group.map((occurrence, index) => ({
    start: occurrence.byteStart,
    length: occurrence.byteEnd - occurrence.byteStart,
    holes: holesByOccurrence[index]
  }));
  for (const occurrence of occurrences) {
    const rebuiltLength = staticBytes + occurrence.holes.reduce((total, hole) => total + hole.length, 0);
    if (rebuiltLength !== occurrence.length) return null;
  }

  const template = {
    type: group[0].type,
    zoneKind: group[0].zoneKind,
    staticSegments,
    staticBytes,
    holeCount,
    occurrences
  };
  template.definitionBits = templateDefinitionBitLength(template);
  template.estimatedGain = occurrences.reduce((total, occurrence) =>
    total + legacyCosts[occurrence.start + occurrence.length] - legacyCosts[occurrence.start] -
      templateReferenceBitLength(0, occurrence.holes), 0) - template.definitionBits;
  return template.estimatedGain > 2 ? template : null;
}

function collectStructuralTemplates (text, bytes, zones, legacyCosts) {
  const offsets = codeUnitByteOffsets(text);
  const ranges = collectStructuralRanges(text, zones, offsets);
  const groups = new Map();
  const scanBudget = Math.max(bytes.length, 4096) * TEMPLATE_SCAN_MULTIPLIER;
  let scanned = 0;

  for (const range of ranges) {
    const length = range.byteEnd - range.byteStart;
    if (scanned + length > scanBudget) continue;
    const patterned = templatePatternUnits(text.slice(range.start, range.end));
    if (!patterned || patterned.units.length < 2) continue;
    scanned += length;
    const key = `${range.type}:${range.zoneKind}:${patterned.units.length}:${patterned.hash}`;
    const group = groups.get(key) || [];
    if (group.length < MAX_TEMPLATE_GROUP_OCCURRENCES) {
      group.push({ ...range, units: patterned.units });
      groups.set(key, group);
    }
  }

  const ranked = [];
  for (const group of groups.values()) {
    if (group.length < MIN_TEMPLATE_OCCURRENCES) continue;
    const template = deriveStructuralTemplate(group, legacyCosts);
    if (template) ranked.push(template);
  }
  ranked.sort((left, right) =>
    right.estimatedGain - left.estimatedGain ||
    right.occurrences.length - left.occurrences.length ||
    right.staticBytes - left.staticBytes);

  const templates = [];
  let definitionBytes = 0;
  for (const template of ranked) {
    if (templates.length >= MAX_TEMPLATE_ENTRIES) break;
    if (definitionBytes + template.staticBytes > bytes.length) continue;
    const index = templates.length;
    const gain = template.occurrences.reduce((total, occurrence) =>
      total + legacyCosts[occurrence.start + occurrence.length] - legacyCosts[occurrence.start] -
        templateReferenceBitLength(index, occurrence.holes), 0) - template.definitionBits;
    if (gain <= 2) continue;
    template.estimatedGain = gain;
    templates.push(template);
    definitionBytes += template.staticBytes;
  }
  return templates;
}

function buildTemplateCandidateMap (templates, legacyCosts) {
  const candidates = new Map();
  templates.forEach((template, index) => {
    for (const occurrence of template.occurrences) {
      const bitLength = templateReferenceBitLength(index, occurrence.holes);
      const baseline = legacyCosts[occurrence.start + occurrence.length] - legacyCosts[occurrence.start];
      const legacySavings = baseline - bitLength;
      if (legacySavings <= 2) continue;
      const candidate = {
        type: "template",
        index,
        templateType: template.type,
        zoneKind: template.zoneKind,
        length: occurrence.length,
        holes: occurrence.holes,
        bitLength,
        legacySavings,
        savings: occurrence.length * 8 - bitLength
      };
      const list = candidates.get(occurrence.start) || [];
      list.push(candidate);
      list.sort((left, right) =>
        right.legacySavings - left.legacySavings || right.length - left.length);
      candidates.set(occurrence.start, list);
    }
  });
  return candidates;
}

function hashUnit (value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index ++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function phrasesCompete (left, right) {
  if (left.includes(right) || right.includes(left)) return true;
  const minimum = Math.max(6, Math.ceil(Math.min(left.length, right.length) * 0.6));
  const maximum = Math.min(left.length, right.length);
  for (let length = maximum; length >= minimum; length --) {
    if (
      left.endsWith(right.slice(0, length)) ||
      right.endsWith(left.slice(0, length))
    ) return true;
  }
  return false;
}

function selectLexiconCandidates (candidates, legacyCosts) {
  const ranked = [];
  for (const [value, candidate] of candidates) {
    if (candidate.positions.length < candidate.minimumOccurrences) continue;
    const baseline = candidate.positions.reduce(
      (total, start) => total + legacyCosts[start + candidate.bytes.length] - legacyCosts[start],
      0
    );
    const first = candidate.positions[0];
    const firstOccurrenceCost = legacyCosts[first + candidate.bytes.length] - legacyCosts[first];
    const definitionCost = gammaBitLength(candidate.bytes.length) +
      Math.min(candidate.bytes.length * 8, firstOccurrenceCost);
    const optimisticGain = baseline - candidate.positions.length * 5 - definitionCost;
    if (optimisticGain > 2) {
      ranked.push({ ...candidate, value, baseline, definitionCost, optimisticGain });
    }
  }

  const byGain = (a, b) =>
    b.optimisticGain - a.optimisticGain || b.bytes.length - a.bytes.length;
  ranked.sort(byGain);
  const words = ranked.filter(candidate => !candidate.phrase);
  const phrases = ranked.filter(candidate => candidate.phrase);
  const selected = [];
  const admit = pool => {
    for (const candidate of pool) {
      if (selected.length >= MAX_LEXICON_ENTRIES) break;
      // Overlapping n-grams otherwise fragment one high-frequency phrase into
      // dozens of low-frequency one-token extensions. Keep the strongest
      // member of each phrase family, while the word phase retains its stable
      // low indices before any phrase is admitted.
      if (
        candidate.phrase &&
        selected.some(existing => existing.phrase && phrasesCompete(candidate.value, existing.value))
      ) continue;
      const tokenCost = 4 + gammaBitLength(selected.length + 1);
      const gain = candidate.baseline -
        candidate.positions.length * tokenCost - candidate.definitionCost;
      if (gain > 2) selected.push(candidate);
    }
  };

  const firstWordPhase = words.slice(0, 320);
  admit(firstWordPhase);
  admit(phrases);
  admit(words.slice(firstWordPhase.length));
  return selected.map(candidate => candidate.bytes);
}

function collectLexemeCandidates (text, legacyCosts, zones) {
  const candidates = new Map();
  const units = [];
  let byteCursor = 0;

  for (const match of text.matchAll(/([\p{L}\p{N}_$-]+)|(\s+)|([^\p{L}\p{N}_$\s-]+)/gu)) {
    const value = match[0];
    const byteLength = /^[\x00-\x7f]*$/.test(value)
      ? value.length
      : encoder.encode(value).length;
    const unit = {
      value,
      word: match[1] !== undefined,
      whitespace: match[2] !== undefined,
      zoneKind: structuralZoneAt(zones, match.index).kind,
      codeStart: match.index,
      codeEnd: match.index + value.length,
      byteStart: byteCursor,
      byteEnd: byteCursor + byteLength,
      hash: hashUnit(value)
    };
    units.push(unit);
    byteCursor += byteLength;

    if (
      !unit.word ||
      byteLength < MIN_LEXEME_BYTES ||
      byteLength > MAX_LEXEME_BYTES ||
      dictionaryValues.has(value)
    ) continue;

    const candidate = candidates.get(value) || {
      bytes: encoder.encode(value),
      positions: [],
      minimumOccurrences: MIN_LEXEME_OCCURRENCES,
      phrase: false
    };
    candidate.positions.push(unit.byteStart);
    candidates.set(value, candidate);
  }
  // A fixed-size first-seen table makes repeated phrase discovery bounded.
  // It stores only hashes and source offsets; actual strings enter the map
  // after a second exact occurrence proves that the sector is reusable.
  const occupied = new Uint8Array(GRAMMAR_SEEN_SIZE);
  const hashes = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const firstCodeStart = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const firstCodeEnd = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const firstByteStart = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const seenMask = GRAMMAR_SEEN_SIZE - 1;

  for (let start = 0; start < units.length; start ++) {
    if (units[start].whitespace) continue;
    let sequenceHash = 2166136261;
    let words = 0;

    for (
      let end = start;
      end < Math.min(units.length, start + MAX_GRAMMAR_UNITS);
      end ++
    ) {
      const unit = units[end];
      if (unit.zoneKind !== units[start].zoneKind) break;
      sequenceHash = Math.imul(sequenceHash ^ unit.hash, 16777619) >>> 0;
      if (unit.word) words ++;
      const count = end - start + 1;
      const byteLength = unit.byteEnd - units[start].byteStart;
      if (byteLength > MAX_LEXEME_BYTES) break;
      if (
        count < 2 ||
        unit.whitespace ||
        words === 0 ||
        byteLength < 6
      ) continue;

      const hash = Math.imul(sequenceHash ^ count, 2246822519) >>> 0;
      const slot = hash & seenMask;
      if (!occupied[slot]) {
        occupied[slot] = 1;
        hashes[slot] = hash;
        firstCodeStart[slot] = units[start].codeStart;
        firstCodeEnd[slot] = unit.codeEnd;
        firstByteStart[slot] = units[start].byteStart;
        continue;
      }
      if (hashes[slot] !== hash) continue;

      const value = text.slice(units[start].codeStart, unit.codeEnd);
      if (text.slice(firstCodeStart[slot], firstCodeEnd[slot]) !== value) continue;
      if (dictionaryValues.has(value)) continue;
      const candidate = candidates.get(value) || {
        bytes: encoder.encode(value),
        positions: [firstByteStart[slot]],
        minimumOccurrences: 3,
        phrase: true
      };
      if (candidate.positions.at(-1) !== units[start].byteStart) {
        candidate.positions.push(units[start].byteStart);
      }
      candidate.minimumOccurrences = Math.min(candidate.minimumOccurrences, 3);
      candidates.set(value, candidate);
    }
  }

  return selectLexiconCandidates(candidates, legacyCosts);
}

function compareByteEntries (left, right) {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index ++) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return left.length - right.length;
}

function lexiconBitWidth (entryCount) {
  return Math.max(1, Math.ceil(Math.log2(Math.max(1, entryCount))));
}

function sameCodeLengths (left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function buildV3Codebook (entryCount, tokens = []) {
  if (!entryCount) return { lengths: new Uint8Array(), codes: [] };

  const frequencies = new Uint32Array(entryCount);
  frequencies.fill(1);
  for (const token of tokens) {
    if (token.type === "lexeme" && token.index < entryCount) frequencies[token.index] ++;
  }

  const ranked = Array.from(
    { length: entryCount },
    (_, index) => ({ index, weight: frequencies[index] })
  ).sort((left, right) => right.weight - left.weight || left.index - right.index);
  const lengths = new Uint8Array(entryCount);

  const assign = (start, end, depth) => {
    if (end - start === 1) {
      lengths[ranked[start].index] = Math.max(1, depth);
      return;
    }

    const childCapacity = 2 ** (13 - depth - 1);
    const minimumSplit = Math.max(start + 1, end - childCapacity);
    const maximumSplit = Math.min(end - 1, start + childCapacity);
    let totalWeight = 0;
    for (let index = start; index < end; index ++) totalWeight += ranked[index].weight;
    const target = totalWeight / 2;
    let leftWeight = 0;
    let split = minimumSplit;
    let bestDistance = Infinity;
    for (let index = start; index < end - 1; index ++) {
      leftWeight += ranked[index].weight;
      const candidate = index + 1;
      if (candidate < minimumSplit || candidate > maximumSplit) continue;
      const distance = Math.abs(target - leftWeight);
      if (distance < bestDistance) {
        bestDistance = distance;
        split = candidate;
      }
    }
    assign(start, split, depth + 1);
    assign(split, end, depth + 1);
  };
  assign(0, ranked.length, 0);

  const canonical = Array.from(
    { length: entryCount },
    (_, index) => ({ index, length: lengths[index] })
  ).sort((left, right) => left.length - right.length || left.index - right.index);
  const codes = new Array(entryCount);
  let code = 0;
  let previousLength = 0;
  for (const item of canonical) {
    code *= 2 ** (item.length - previousLength);
    codes[item.index] = code.toString(2).padStart(item.length, "0");
    code ++;
    previousLength = item.length;
  }
  return { lengths, codes };
}

function buildV3DecodeTable (lengths) {
  if (!lengths.length) return new Map();
  const canonical = Array.from(lengths, (length, index) => ({ index, length }))
    .sort((left, right) => left.length - right.length || left.index - right.index);
  const table = new Map();
  let code = 0;
  let previousLength = 0;
  for (const item of canonical) {
    if (item.length < 1 || item.length > 13) {
      throw new Error("Invalid ln.kr v3 dictionary code length");
    }
    code *= 2 ** (item.length - previousLength);
    if (code >= 2 ** item.length) {
      throw new Error("Invalid ln.kr v3 dictionary codebook");
    }
    const bits = code.toString(2).padStart(item.length, "0");
    if (table.has(bits)) throw new Error("Duplicate ln.kr v3 dictionary code");
    table.set(bits, item.index);
    code ++;
    previousLength = item.length;
  }
  return table;
}

/**
 * v3 prices a document vocabulary at each possible fixed-width boundary.
 * The identifier itself is never wider than 13 bits (7,225 entries), while
 * definitions that do not repay their header bytes are never admitted.
 */
function selectV3LexiconCandidates (candidates, legacyCosts) {
  const ranked = [];
  for (const [value, candidate] of candidates) {
    if (candidate.positions.length < candidate.minimumOccurrences) continue;
    const baseline = candidate.positions.reduce(
      (total, start) => total + legacyCosts[start + candidate.bytes.length] - legacyCosts[start],
      0
    );
    const first = candidate.positions[0];
    const firstCost = legacyCosts[first + candidate.bytes.length] - legacyCosts[first];
    const definitionCost = gammaBitLength(candidate.bytes.length) +
      Math.min(candidate.bytes.length * 8, firstCost);
    const optimisticGain = baseline - candidate.positions.length * 5 - definitionCost;
    if (optimisticGain > 2) {
      ranked.push({ ...candidate, value, baseline, definitionCost, optimisticGain });
    }
  }

  const byGainAtWidth = width => (left, right) => {
    const leftGain = left.baseline - left.positions.length * (4 + width) - left.definitionCost;
    const rightGain = right.baseline - right.positions.length * (4 + width) - right.definitionCost;
    return rightGain - leftGain ||
      right.positions.length - left.positions.length ||
      right.bytes.length - left.bytes.length ||
      (left.value < right.value ? -1 : left.value > right.value ? 1 : 0);
  };

  let best = [];
  let bestGain = 0;
  for (let width = 1; width <= 13; width ++) {
    const capacity = Math.min(2 ** width, MAX_V3_LEXICON_ENTRIES);
    const ordered = [...ranked].sort(byGainAtWidth(width));
    const selected = [];
    const selectedPhrases = [];
    for (const candidate of ordered) {
      if (selected.length >= capacity) break;
      const gain = candidate.baseline -
        candidate.positions.length * (4 + width) - candidate.definitionCost;
      if (gain <= 2) continue;
      if (candidate.phrase) {
        if (selectedPhrases.length >= MAX_V3_PHRASE_ENTRIES) continue;
        if (selectedPhrases.some(existing => phrasesCompete(candidate.value, existing.value))) {
          continue;
        }
        selectedPhrases.push(candidate);
      }
      selected.push(candidate);
    }

    const actualWidth = lexiconBitWidth(selected.length);
    if (actualWidth > width) continue;
    const gain = selected.reduce(
      (total, candidate) => total + candidate.baseline -
        candidate.positions.length * (4 + actualWidth) - candidate.definitionCost,
      0
    );
    if (gain > bestGain || (gain === bestGain && selected.length < best.length)) {
      best = selected;
      bestGain = gain;
    }
  }

  return best.map(candidate => candidate.bytes).sort(compareByteEntries);
}

/**
 * v3 starts from the same read-only structural zones as v2, then discovers a
 * broader exact vocabulary: words/identifiers, repeated punctuation atoms,
 * and compatible-zone phrases up to 32 generic units. No syntax is rewritten.
 */
function collectV3LexemeCandidates (text, legacyCosts, zones) {
  const candidates = new Map();
  const units = [];
  let byteCursor = 0;

  for (const match of text.matchAll(/([\p{L}\p{N}_$-]+)|(\s+)|([^\p{L}\p{N}_$\s-]+)/gu)) {
    const value = match[0];
    const byteLength = /^[\x00-\x7f]*$/.test(value)
      ? value.length
      : encoder.encode(value).length;
    const unit = {
      value,
      word: match[1] !== undefined,
      whitespace: match[2] !== undefined,
      zoneKind: structuralZoneAt(zones, match.index).kind,
      codeStart: match.index,
      codeEnd: match.index + value.length,
      byteStart: byteCursor,
      byteEnd: byteCursor + byteLength,
      hash: hashUnit(value)
    };
    units.push(unit);
    byteCursor += byteLength;

    if (
      unit.whitespace ||
      byteLength < MIN_LEXEME_BYTES ||
      byteLength > MAX_V3_LEXEME_BYTES ||
      dictionaryValues.has(value)
    ) continue;

    const candidate = candidates.get(value) || {
      bytes: encoder.encode(value),
      positions: [],
      minimumOccurrences: 2,
      phrase: false
    };
    candidate.positions.push(unit.byteStart);
    candidates.set(value, candidate);
  }

  const occupied = new Uint8Array(GRAMMAR_SEEN_SIZE);
  const hashes = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const firstCodeStart = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const firstCodeEnd = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const firstByteStart = new Uint32Array(GRAMMAR_SEEN_SIZE);
  const seenMask = GRAMMAR_SEEN_SIZE - 1;

  for (let start = 0; start < units.length; start ++) {
    if (units[start].whitespace) continue;
    let sequenceHash = 2166136261;
    let contentUnits = 0;

    for (
      let end = start;
      end < Math.min(units.length, start + MAX_V3_GRAMMAR_UNITS);
      end ++
    ) {
      const unit = units[end];
      if (unit.zoneKind !== units[start].zoneKind) break;
      sequenceHash = Math.imul(sequenceHash ^ unit.hash, 16777619) >>> 0;
      if (!unit.whitespace) contentUnits ++;
      const count = end - start + 1;
      const byteLength = unit.byteEnd - units[start].byteStart;
      if (byteLength > MAX_V3_LEXEME_BYTES) break;
      if (count < 2 || unit.whitespace || contentUnits < 2 || byteLength < 6) continue;

      const hash = Math.imul(sequenceHash ^ count, 2246822519) >>> 0;
      const slot = hash & seenMask;
      if (!occupied[slot]) {
        occupied[slot] = 1;
        hashes[slot] = hash;
        firstCodeStart[slot] = units[start].codeStart;
        firstCodeEnd[slot] = unit.codeEnd;
        firstByteStart[slot] = units[start].byteStart;
        continue;
      }
      if (hashes[slot] !== hash) continue;

      const value = text.slice(units[start].codeStart, unit.codeEnd);
      if (text.slice(firstCodeStart[slot], firstCodeEnd[slot]) !== value) continue;
      if (dictionaryValues.has(value)) continue;
      const candidate = candidates.get(value) || {
        bytes: encoder.encode(value),
        positions: [firstByteStart[slot]],
        minimumOccurrences: 2,
        phrase: true
      };
      if (candidate.positions.at(-1) !== units[start].byteStart) {
        candidate.positions.push(units[start].byteStart);
      }
      candidates.set(value, candidate);
    }
  }

  return selectV3LexiconCandidates(candidates, legacyCosts);
}

function pruneLexicon (entries, tokens, legacyCosts, countReserve = 2) {
  if (!entries.length) return entries;
  const gains = new Float64Array(entries.length);
  const uses = new Uint32Array(entries.length);

  for (const token of tokens) {
    if (token.type !== "lexeme") continue;
    uses[token.index] ++;
    gains[token.index] += legacyCosts[token.start + token.length] - legacyCosts[token.start] -
      tokenBits(token, STRUCTURED_VERSION).length;
  }

  // The cleanup passes reserve two bits for the largest one-entry increase in
  // the shared table count. The initial set uses zero so the exact whole-v2
  // costing step can retain a borderline symbol when it helps later records.
  return entries.map((entry, index) => {
    const definitionTokens = tokenize(entry);
    const definitionBits = definitionTokens.reduce(
      (total, token) => total + tokenBits(token, LEGACY_VERSION).length,
      gammaBitLength(entry.length)
    );
    return { entry, gain: gains[index], uses: uses[index], definitionBits };
  }).filter(candidate => candidate.gain > candidate.definitionBits + countReserve)
    .sort((a, b) => b.uses - a.uses || b.gain - a.gain || b.entry.length - a.entry.length)
    .map(candidate => candidate.entry);
}

function pruneV3Lexicon (entries, tokens, legacyCosts, codeLengths = null) {
  if (!entries.length) return entries;
  const bitCosts = codeLengths || lexiconBitWidth(entries.length);
  const gains = new Float64Array(entries.length);
  const uses = new Uint32Array(entries.length);

  for (const token of tokens) {
    if (token.type !== "lexeme") continue;
    uses[token.index] ++;
    gains[token.index] += legacyCosts[token.start + token.length] - legacyCosts[token.start] -
      tokenBits(token, DICTIONARY_VERSION, bitCosts).length;
  }

  return entries.map((entry, index) => {
    const definitionTokens = tokenize(entry);
    const definitionBits = definitionTokens.reduce(
      (total, token) => total + tokenBits(token, LEGACY_VERSION).length,
      gammaBitLength(entry.length)
    );
    return { entry, gain: gains[index], uses: uses[index], definitionBits };
  }).filter(candidate => candidate.uses > 0 && candidate.gain > candidate.definitionBits + 2)
    .sort((left, right) => compareByteEntries(left.entry, right.entry))
    .map(candidate => candidate.entry);
}

function buildLexiconHeaderBits (entries, codeLengths = null) {
  let bits = gammaBits(entries.length + 1);
  let byteLength = 0;
  for (const entry of entries) {
    bits += gammaBits(entry.length);
    byteLength += entry.length;
  }
  if (codeLengths) {
    if (codeLengths.length !== entries.length) {
      throw new Error("ln.kr v3 dictionary codebook does not match its entries");
    }
    for (const length of codeLengths) {
      bits += fixedBits(length, 4);
    }
  }

  // Definitions are themselves a tiny v1 stream.  A phrase such as an HTML
  // element or JS statement can therefore be assembled from the same static
  // words and prior definition ranges instead of paying eight bits for every
  // byte again.  Entry lengths make the concatenation unambiguous.
  const definitions = new Uint8Array(byteLength);
  let offset = 0;
  for (const entry of entries) {
    definitions.set(entry, offset);
    offset += entry.length;
  }
  for (const token of tokenize(definitions)) {
    bits += tokenBits(token, LEGACY_VERSION);
  }
  return bits;
}

function buildTemplateHeaderBits (templates) {
  let bits = gammaBits(templates.length + 1);
  let byteLength = 0;
  for (const template of templates) {
    bits += gammaBits(template.holeCount);
    for (const segment of template.staticSegments) {
      bits += gammaBits(segment.length + 1);
      byteLength += segment.length;
    }
  }

  const definitions = new Uint8Array(byteLength);
  let offset = 0;
  for (const template of templates) {
    for (const segment of template.staticSegments) {
      definitions.set(segment, offset);
      offset += segment.length;
    }
  }
  for (const token of tokenize(definitions)) {
    bits += tokenBits(token, LEGACY_VERSION);
  }
  return bits;
}

function sameEntries (left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function settleLexicon (initialLexicon, bytes, legacyCosts) {
  let lexicon = initialLexicon;
  for (let pass = 0; pass < 3; pass ++) {
    const trie = lexicon.length ? buildDictionaryTrie(lexicon) : dictionaryTrie;
    const tokens = tokenize(bytes, false, null, trie);
    const pruned = pruneLexicon(lexicon, tokens, legacyCosts, 0);
    if (sameEntries(pruned, lexicon)) break;
    lexicon = pruned;
  }
  return lexicon;
}

function settleV3Lexicon (initialLexicon, bytes, legacyCosts) {
  let lexicon = initialLexicon;
  for (let pass = 0; pass < 6; pass ++) {
    const width = lexiconBitWidth(lexicon.length);
    const trie = lexicon.length ? buildDictionaryTrie(lexicon) : dictionaryTrie;
    const tokens = tokenize(bytes, false, null, trie, null, width);
    const pruned = pruneV3Lexicon(lexicon, tokens, legacyCosts);
    if (sameEntries(pruned, lexicon)) break;
    lexicon = pruned;
  }
  return lexicon;
}

function pruneTemplateEntries (templates, tokens, legacyCosts) {
  if (!templates.length) return templates;
  const gains = new Float64Array(templates.length);
  const uses = new Uint32Array(templates.length);

  for (const token of tokens) {
    if (token.type !== "template") continue;
    uses[token.index] ++;
    gains[token.index] += legacyCosts[token.start + token.length] - legacyCosts[token.start] -
      tokenBits(token, STRUCTURED_VERSION).length;
  }

  return templates.filter((template, index) =>
    uses[index] > 0 && gains[index] > template.definitionBits + 2);
}

function pruneV3TemplateEntries (templates, tokens, legacyCosts, lexiconWidth) {
  if (!templates.length) return templates;
  const gains = new Float64Array(templates.length);
  const uses = new Uint32Array(templates.length);

  for (const token of tokens) {
    if (token.type !== "template") continue;
    uses[token.index] ++;
    gains[token.index] += legacyCosts[token.start + token.length] - legacyCosts[token.start] -
      tokenBits(token, DICTIONARY_VERSION, lexiconWidth).length;
  }

  return templates.filter((template, index) =>
    uses[index] > 0 && gains[index] > template.definitionBits + 2);
}

function structuredPlanBitLength (tokens, lexicon, templates) {
  // Residual-shape reuse changes patch record lengths. Cost a disposable copy
  // so choosing a grammar fixed point reflects the exact stream that would be
  // serialized without mutating tokens still needed by later pruning passes.
  const pricedTokens = tokens.map(token => token.type === "patch" ? { ...token } : token);
  assignPatchGrammar(pricedTokens);
  return buildLexiconHeaderBits(lexicon).length +
    buildTemplateHeaderBits(templates).length +
    pricedTokens.reduce(
      // Raw records have the v2 structural discriminator (two bits longer
      // than the legacy raw candidate price); every other candidate already
      // carries its exact v2 bit length.
      (total, token) => total + token.bitLength + (token.type === "raw" ? 2 : 0),
      0
    );
}

function dictionaryPlanBitLength (tokens, lexicon, templates, codebook) {
  const pricedTokens = tokens.map(token => token.type === "patch" ? { ...token } : token);
  assignPatchGrammar(pricedTokens);
  return buildLexiconHeaderBits(lexicon, codebook.lengths).length +
    buildTemplateHeaderBits(templates).length +
    pricedTokens.reduce(
      (total, token) => total + tokenBits(token, DICTIONARY_VERSION, codebook.codes).length,
      0
    );
}

function buildStructuredTokens (text, bytes, legacyCosts, kind) {
  const zones = scanStructuralZones(text, kind);
  let lexicon = settleLexicon(
    collectLexemeCandidates(text, legacyCosts, zones),
    bytes,
    legacyCosts
  );
  let templates = collectStructuralTemplates(text, bytes, zones, legacyCosts);
  let tokens = [];
  let best = null;
  let converged = false;

  // Every v2 phase runs in a fixed order. These passes only garbage-collect
  // definitions that no emitted record references; they never run or select
  // the v1 encoder as a competing whole-document result. Each monotonic
  // grammar fixed point is priced as its exact v2 stream because removing a
  // definition can expose or hide a later prior-output record.
  for (let pass = 0; pass < 8; pass ++) {
    const trie = lexicon.length ? buildDictionaryTrie(lexicon) : dictionaryTrie;
    const templateCandidates = buildTemplateCandidateMap(templates, legacyCosts);
    tokens = tokenize(bytes, true, legacyCosts, trie, templateCandidates);
    const bits = structuredPlanBitLength(tokens, lexicon, templates);
    if (
      !best || bits < best.bits ||
      (bits === best.bits && lexicon.length + templates.length < best.definitionCount)
    ) {
      best = {
        bits,
        definitionCount: lexicon.length + templates.length,
        tokens,
        lexicon,
        templates
      };
    }
    const nextLexicon = pruneLexicon(lexicon, tokens, legacyCosts);
    const nextTemplates = pruneTemplateEntries(templates, tokens, legacyCosts);
    if (sameEntries(nextLexicon, lexicon) && sameEntries(nextTemplates, templates)) {
      converged = true;
      break;
    }
    lexicon = nextLexicon;
    templates = nextTemplates;
  }

  // A bounded cleanup remains valid even on an unusually adversarial grammar:
  // price the final retained definitions once if the eighth pass still moved.
  if (!converged) {
    const trie = lexicon.length ? buildDictionaryTrie(lexicon) : dictionaryTrie;
    tokens = tokenize(
      bytes,
      true,
      legacyCosts,
      trie,
      buildTemplateCandidateMap(templates, legacyCosts)
    );
    const bits = structuredPlanBitLength(tokens, lexicon, templates);
    if (!best || bits < best.bits) {
      best = { tokens, lexicon, templates };
    }
  }

  return { tokens: best.tokens, lexicon: best.lexicon, templates: best.templates, zones };
}

function buildDictionaryTokens (text, bytes, legacyCosts, kind) {
  const zones = scanStructuralZones(text, kind);

  // Structural families are discovered first. The exact token dictionary is
  // then built over the same immutable zones and competes only at emission.
  let templates = collectStructuralTemplates(text, bytes, zones, legacyCosts);
  let lexicon = settleV3Lexicon(
    collectV3LexemeCandidates(text, legacyCosts, zones),
    bytes,
    legacyCosts
  );
  let tokens = [];
  let codebook = buildV3Codebook(lexicon.length);
  let best = null;
  let converged = false;

  for (let pass = 0; pass < 10; pass ++) {
    const trie = lexicon.length ? buildDictionaryTrie(lexicon) : dictionaryTrie;
    const candidates = buildTemplateCandidateMap(templates, legacyCosts);
    const provisional = tokenize(
      bytes,
      true,
      legacyCosts,
      trie,
      candidates,
      codebook.lengths
    );
    const observedCodebook = buildV3Codebook(lexicon.length, provisional);
    tokens = tokenize(
      bytes,
      true,
      legacyCosts,
      trie,
      candidates,
      observedCodebook.lengths
    );
    const refinedCodebook = buildV3Codebook(lexicon.length, tokens);
    const bits = dictionaryPlanBitLength(tokens, lexicon, templates, refinedCodebook);
    if (
      !best || bits < best.bits ||
      (bits === best.bits && lexicon.length + templates.length < best.definitionCount)
    ) {
      best = {
        bits,
        definitionCount: lexicon.length + templates.length,
        tokens,
        lexicon,
        templates,
        codebook: refinedCodebook
      };
    }
    const nextLexicon = pruneV3Lexicon(
      lexicon,
      tokens,
      legacyCosts,
      refinedCodebook.lengths
    );
    const nextTemplates = pruneV3TemplateEntries(
      templates,
      tokens,
      legacyCosts,
      refinedCodebook.lengths
    );
    const stableEntries = sameEntries(nextLexicon, lexicon);
    const stableTemplates = sameEntries(nextTemplates, templates);
    const stableCodes = sameCodeLengths(codebook.lengths, refinedCodebook.lengths);
    if (stableEntries && stableTemplates && stableCodes) {
      converged = true;
      break;
    }
    lexicon = nextLexicon;
    templates = nextTemplates;
    codebook = stableEntries
      ? refinedCodebook
      : buildV3Codebook(lexicon.length);
  }

  if (!converged) {
    const trie = lexicon.length ? buildDictionaryTrie(lexicon) : dictionaryTrie;
    tokens = tokenize(
      bytes,
      true,
      legacyCosts,
      trie,
      buildTemplateCandidateMap(templates, legacyCosts),
      codebook.lengths
    );
    codebook = buildV3Codebook(lexicon.length, tokens);
    const bits = dictionaryPlanBitLength(tokens, lexicon, templates, codebook);
    if (!best || bits < best.bits) best = { bits, tokens, lexicon, templates, codebook };
  }

  return {
    tokens: best.tokens,
    lexicon: best.lexicon,
    templates: best.templates,
    codebook: best.codebook,
    zones
  };
}

function tokenBits (token, version, lexemeCoding = 0) {
  if (token.type === "ascii") {
    return "0" + fixedBits(token.byte, 7);
  }
  if (token.type === "dictionary") {
    return "10" + gammaBits(token.index + 1);
  }
  if (token.type === "lexeme") {
    if (version === DICTIONARY_VERSION) {
      const code = typeof lexemeCoding === "number"
        ? fixedBits(token.index, lexemeCoding)
        : typeof lexemeCoding[token.index] === "string"
          ? lexemeCoding[token.index]
          : "0".repeat(lexemeCoding[token.index]);
      return "1110" + code;
    }
    return "1110" + gammaBits(token.index + 1);
  }
  if (token.type === "copy") {
    return "110" + gammaBits(token.distance) +
      gammaBits(token.length - MIN_COPY + 1);
  }
  if (token.type === "raw") {
    let bits = (version === LEGACY_VERSION ? "111" : "11110") +
      gammaBits(token.bytes.length);
    for (const byte of token.bytes) bits += fixedBits(byte, 8);
    return bits;
  }
  if (token.type === "template") {
    // Patch distances are always at least MIN_PATCH, so distance 1 is a free
    // escape inside the existing patch-reuse branch. Templates therefore add
    // no extra discriminator bit to ordinary or reused patch records.
    let bits = "111111" + gammaBits(1) + gammaBits(token.index + 1);
    for (const hole of token.holes) {
      bits += gammaBits(hole.length + 1);
      for (const byte of hole) bits += fixedBits(byte, 8);
    }
    return bits;
  }
  if (token.type === "patch") {
    let bits = token.templateDistance
      ? "111111" + gammaBits(token.distance) + gammaBits(token.templateDistance)
      : "111110" + gammaBits(token.distance) +
        gammaBits(token.length - MIN_PATCH + 1) + gammaBits(token.runs.length);
    let previousEnd = 0;
    if (!token.templateDistance) {
      for (const run of token.runs) {
        bits += gammaBits(run.start - previousEnd + 1) + gammaBits(run.bytes.length);
        previousEnd = run.start + run.bytes.length;
      }
    }
    for (const run of token.runs) {
      for (const byte of run.bytes) bits += fixedBits(byte, 8);
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

function decodeLegacySection (reader, expectedLength) {
  const output = [];
  const ensureLength = amount => {
    if (amount < 0 || output.length + amount > expectedLength) {
      throw new Error("ln.kr grammar definition exceeds its declared byte length");
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
        throw new Error("Invalid ln.kr grammar definition copy distance");
      }
      ensureLength(length);
      for (let index = 0; index < length; index ++) {
        output.push(output[output.length - distance]);
      }
      continue;
    }

    const rawLength = reader.readGamma();
    ensureLength(rawLength);
    for (let index = 0; index < rawLength; index ++) {
      output.push(Number(reader.readFixed(8)));
    }
  }
  return output;
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
  let lexicon = [];
  let templates = [];
  let codebook = { lengths: new Uint8Array(), codes: [] };
  if (version === STRUCTURED_VERSION || version === DICTIONARY_VERSION) {
    legacyTokens ||= tokenize(bytes);
    const legacyCosts = buildLegacyCostPrefix(bytes.length, legacyTokens);
    const built = version === DICTIONARY_VERSION
      ? buildDictionaryTokens(text, bytes, legacyCosts, kind)
      : buildStructuredTokens(text, bytes, legacyCosts, kind);
    tokens = built.tokens;
    lexicon = built.lexicon;
    templates = built.templates;
    if (built.codebook) codebook = built.codebook;
  } else {
    tokens = tokenize(bytes);
  }
  const hasDocumentGrammar = version === STRUCTURED_VERSION || version === DICTIONARY_VERSION;
  const grammarCounts = hasDocumentGrammar
    ? assignPatchGrammar(tokens)
    : { patchDefinition: 0, patchReuse: 0 };
  const checksum = crc32(bytes);
  const lengthBits = gammaBits(bytes.length + 1);
  const lexiconBits = hasDocumentGrammar
    ? buildLexiconHeaderBits(
        lexicon,
        version === DICTIONARY_VERSION ? codebook.lengths : null
      )
    : "";
  const templateBits = hasDocumentGrammar
    ? buildTemplateHeaderBits(templates)
    : "";
  const lexemeWidth = version === DICTIONARY_VERSION && codebook.lengths.length
    ? Math.max(...codebook.lengths)
    : 0;
  const tokenSequences = tokens.map(token => tokenBits(
    token,
    version,
    version === DICTIONARY_VERSION ? codebook.codes : 0
  ));
  const tokenBitLength = tokenSequences.reduce((total, bits) => total + bits.length, 0);
  const counts = {
    ascii: 0,
    dictionary: 0,
    lexeme: 0,
    copy: 0,
    raw: 0,
    patch: 0,
    template: 0,
    lexicon: lexicon.length,
    lexiconWidth: version === DICTIONARY_VERSION ? lexemeWidth : 0,
    lexiconUse: 0,
    templates: templates.length,
    templateUse: 0,
    sectorTemplateUse: 0,
    lineTemplateUse: 0,
    ...grammarCounts
  };
  for (const token of tokens) {
    counts[token.type] ++;
    if (token.type === "lexeme") {
      counts.lexiconUse ++;
    } else if (token.type === "template") {
      counts.templateUse ++;
      if (token.templateType === "sector") counts.sectorTemplateUse ++;
      if (token.templateType === "line") counts.lineTemplateUse ++;
    }
  }

  return {
    kind,
    version,
    bytes,
    tokens,
    tokenSequences,
    lexicon,
    lexiconBits,
    templates,
    templateBits,
    checksum,
    lengthBits,
    bitLength: 16 + 3 + 2 + lengthBits.length + 32 + lexiconBits.length +
      templateBits.length + tokenBitLength,
    counts
  };
}

function encodePlan (plan, alphabet) {
  let number = 1n;
  for (let index = plan.tokenSequences.length - 1; index >= 0; index --) {
    number = huffmanEncode(number, plan.tokenSequences[index]);
  }
  if (plan.version === STRUCTURED_VERSION || plan.version === DICTIONARY_VERSION) {
    number = huffmanEncode(number, plan.templateBits);
    number = huffmanEncode(number, plan.lexiconBits);
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

function deflateNumber (bytes) {
  // The high sentinel bit preserves every leading/trailing zero byte while the
  // existing bijective alphabet transport carries the complete bitstream.
  const parts = new Array(bytes.length + 1);
  parts[0] = "1";
  for (let index = 0; index < bytes.length; index ++) {
    parts[index + 1] = byteHex[bytes[bytes.length - index - 1]];
  }
  return BigInt(`0x${parts.join("")}`);
}

function encodeDeflate (text, kind, alphabet) {
  const bytes = encoder.encode(text);
  const compressed = deflate(bytes, { level: 9 });
  const lengthBits = gammaBits(bytes.length + 1);
  const compressedLengthBits = gammaBits(compressed.length + 1);
  const checksum = crc32(bytes);

  let number = deflateNumber(compressed);
  number = huffmanEncode(number, compressedLengthBits);
  number = huffmanEncode(number, fixedBits(checksum, 32));
  number = huffmanEncode(number, lengthBits);
  number = huffmanEncode(number, fixedBits(KIND_TO_NUMBER[kind], 2));
  number = huffmanEncode(number, fixedBits(DEFLATE_VERSION, 3));
  number = huffmanEncode(number, fixedBits(MAGIC, 16));

  const payload = numberToString(number, alphabet);
  return {
    payload,
    kind,
    stats: {
      version: DEFLATE_VERSION,
      bytes: bytes.length,
      compressedBytes: compressed.length,
      bits: 16 + 3 + 2 + lengthBits.length + 32 + compressedLengthBits.length + compressed.length * 8,
      symbols: countAlphabetSymbols(payload, alphabet),
      tokens: 0,
      ascii: 0,
      dictionary: 0,
      lexeme: 0,
      copy: 0,
      raw: 0,
      patch: 0,
      template: 0,
      lexicon: 0,
      lexiconWidth: 0,
      lexiconUse: 0,
      templates: 0,
      templateUse: 0,
      sectorTemplateUse: 0,
      lineTemplateUse: 0,
      patchDefinition: 0,
      patchReuse: 0
    }
  };
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

/** Structural v2 encoder, selected explicitly by the caller. */
export function compressTextV2 (text, alphabet, requestedKind = "auto") {
  const kind = resolveKind(text, requestedKind);
  return encodePlan(createEncodingPlan(text, kind, STRUCTURED_VERSION), alphabet);
}

/** Dictionary-first v3 encoder, selected explicitly by the caller. */
export function compressTextV3 (text, alphabet, requestedKind = "auto") {
  const kind = resolveKind(text, requestedKind);
  return encodePlan(createEncodingPlan(text, kind, DICTIONARY_VERSION), alphabet);
}

/** Traditional zlib-wrapped DEFLATE, selected explicitly by the caller. */
export function compressTextV4 (text, alphabet, requestedKind = "auto") {
  const kind = resolveKind(text, requestedKind);
  return encodeDeflate(text, kind, alphabet);
}

/**
 * Default exact UTF-8 encoder. Structural discovery is deliberately opt-in so
 * ordinary links retain v1's stable wire format and never pay for a v2 pass.
 * @returns {{payload: string, kind: string, stats: object}}
 */
export function compressText (text, alphabet, requestedKind = "auto") {
  return compressTextV1(text, alphabet, requestedKind);
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
  if (![LEGACY_VERSION, STRUCTURED_VERSION, DICTIONARY_VERSION, DEFLATE_VERSION].includes(version)) {
    throw new Error(`Unsupported ln.kr version: ${version}`);
  }

  const kindNumber = Number(reader.readFixed(2));
  const expectedLength = reader.readGamma() - 1;
  const expectedChecksum = Number(reader.readFixed(32));

  if (version === DEFLATE_VERSION) {
    const compressedLength = reader.readGamma() - 1;
    if (compressedLength < 0) throw new Error("Invalid ln.kr DEFLATE length");
    const compressed = [];
    for (let index = 0; index < compressedLength; index ++) {
      compressed.push(Number(reader.readFixed(8)));
    }
    if (reader.number !== 1n) throw new Error("ln.kr payload has trailing data");

    let bytes;
    try {
      bytes = inflate(Uint8Array.from(compressed));
    } catch (error) {
      throw new Error("Invalid ln.kr DEFLATE stream", { cause: error });
    }
    if (bytes.length !== expectedLength) throw new Error("ln.kr byte length mismatch");
    if (crc32(bytes) !== expectedChecksum) throw new Error("ln.kr checksum mismatch");
    return {
      text: decoder.decode(bytes),
      kind: NUMBER_TO_KIND[kindNumber],
      version
    };
  }

  const output = [];
  const patchShapes = [];
  const lexicon = [];
  const templates = [];
  let v3CodeTable = new Map();
  let v3MaximumCodeLength = 0;

  if (version === STRUCTURED_VERSION || version === DICTIONARY_VERSION) {
    const count = reader.readGamma() - 1;
    const maximumEntries = version === DICTIONARY_VERSION
      ? MAX_V3_LEXICON_ENTRIES
      : MAX_LEXICON_ENTRIES;
    const maximumLength = version === DICTIONARY_VERSION
      ? MAX_V3_LEXEME_BYTES
      : MAX_LEXEME_BYTES;
    if (count < 0 || count > maximumEntries) {
      throw new Error("Invalid ln.kr structural lexicon size");
    }
    let lexiconBytes = 0;
    const lengths = [];
    for (let entry = 0; entry < count; entry ++) {
      const length = reader.readGamma();
      if (length < MIN_LEXEME_BYTES || length > maximumLength) {
        throw new Error("Invalid ln.kr structural lexeme length");
      }
      lexiconBytes += length;
      if (lexiconBytes > expectedLength) {
        throw new Error("ln.kr structural lexicon exceeds the document length");
      }
      lengths.push(length);
    }
    if (version === DICTIONARY_VERSION) {
      const codeLengths = [];
      for (let entry = 0; entry < count; entry ++) {
        const length = Number(reader.readFixed(4));
        if (length < 1 || length > 13) {
          throw new Error("Invalid ln.kr v3 dictionary code length");
        }
        codeLengths.push(length);
      }
      for (const length of codeLengths) {
        v3MaximumCodeLength = Math.max(v3MaximumCodeLength, length);
      }
      v3CodeTable = buildV3DecodeTable(codeLengths);
    }
    const definitionBytes = decodeLegacySection(reader, lexiconBytes);
    let definitionOffset = 0;
    for (const length of lengths) {
      lexicon.push(Uint8Array.from(
        definitionBytes.slice(definitionOffset, definitionOffset + length)
      ));
      definitionOffset += length;
    }

    const templateCount = reader.readGamma() - 1;
    if (templateCount < 0 || templateCount > MAX_TEMPLATE_ENTRIES) {
      throw new Error("Invalid ln.kr structural template count");
    }
    let templateBytes = 0;
    const templateShapes = [];
    for (let entry = 0; entry < templateCount; entry ++) {
      const holeCount = reader.readGamma();
      if (holeCount < 1 || holeCount > MAX_TEMPLATE_TOKENS) {
        throw new Error("Invalid ln.kr structural template arity");
      }
      const lengths = [];
      for (let segment = 0; segment <= holeCount; segment ++) {
        const length = reader.readGamma() - 1;
        if (length < 0 || length > MAX_TEMPLATE_BYTES) {
          throw new Error("Invalid ln.kr structural template segment");
        }
        templateBytes += length;
        if (templateBytes > expectedLength) {
          throw new Error("ln.kr structural templates exceed the document length");
        }
        lengths.push(length);
      }
      templateShapes.push({ holeCount, lengths });
    }
    const staticBytes = decodeLegacySection(reader, templateBytes);
    let staticOffset = 0;
    for (const shape of templateShapes) {
      const staticSegments = shape.lengths.map(length => {
        const segment = Uint8Array.from(staticBytes.slice(staticOffset, staticOffset + length));
        staticOffset += length;
        return segment;
      });
      templates.push({ holeCount: shape.holeCount, staticSegments });
    }
  }

  const ensureLength = amount => {
    if (amount < 0 || output.length + amount > expectedLength) {
      throw new Error("ln.kr record exceeds its declared byte length");
    }
  };

  const appendAsciiRecord = () => {
    ensureLength(1);
    output.push(Number(reader.readFixed(7)));
  };

  const appendDictionaryRecord = () => {
    const index = reader.readGamma() - 1;
    const bytes = dictionaryBytes[index];
    if (!bytes) throw new Error(`Unknown ln.kr dictionary entry: ${index}`);
    ensureLength(bytes.length);
    output.push(...bytes);
  };

  const appendCopyRecord = () => {
    const distance = reader.readGamma();
    const length = reader.readGamma() + MIN_COPY - 1;
    if (distance < 1 || distance > output.length) {
      throw new Error("Invalid ln.kr copy distance");
    }
    ensureLength(length);
    for (let index = 0; index < length; index ++) {
      output.push(output[output.length - distance]);
    }
  };

  const appendLexemeRecord = index => {
    const bytes = lexicon[index];
    if (!bytes) throw new Error(`Unknown ln.kr structural lexeme: ${index}`);
    ensureLength(bytes.length);
    output.push(...bytes);
  };

  const readV3LexemeIndex = () => {
    let code = "";
    for (let bit = 0; bit < v3MaximumCodeLength; bit ++) {
      code += reader.readBit();
      if (v3CodeTable.has(code)) return v3CodeTable.get(code);
    }
    throw new Error("Invalid ln.kr v3 dictionary reference");
  };

  const appendRawRecord = () => {
    const rawLength = reader.readGamma();
    ensureLength(rawLength);
    for (let index = 0; index < rawLength; index ++) {
      output.push(Number(reader.readFixed(8)));
    }
  };

  const appendTemplateRecord = () => {
    const templateIndex = reader.readGamma() - 1;
    const template = templates[templateIndex];
    if (!template) throw new Error(`Unknown ln.kr structural template: ${templateIndex}`);
    for (let hole = 0; hole < template.holeCount; hole ++) {
      const staticSegment = template.staticSegments[hole];
      ensureLength(staticSegment.length);
      output.push(...staticSegment);
      const holeLength = reader.readGamma() - 1;
      ensureLength(holeLength);
      for (let index = 0; index < holeLength; index ++) {
        output.push(Number(reader.readFixed(8)));
      }
    }
    const trailing = template.staticSegments.at(-1);
    ensureLength(trailing.length);
    output.push(...trailing);
  };

  const appendPatchRecord = (reuseShape, distance) => {
    let length;
    let shape;

    if (reuseShape) {
      const templateDistance = reader.readGamma();
      if (templateDistance < 1 || templateDistance > patchShapes.length) {
        throw new Error("Invalid ln.kr structural grammar reference");
      }
      shape = patchShapes[patchShapes.length - templateDistance];
      length = shape.length;
    } else {
      length = reader.readGamma() + MIN_PATCH - 1;
    }

    if (distance < 1 || distance > output.length || length > distance) {
      throw new Error("Invalid ln.kr structural reference");
    }
    ensureLength(length);
    const sourceStart = output.length - distance;
    const block = output.slice(sourceStart, sourceStart + length);

    if (!reuseShape) {
      const runCount = reader.readGamma();
      if (runCount < 1 || runCount > Math.min(MAX_PATCH_RUNS, length)) {
        throw new Error("Invalid ln.kr structural residual count");
      }
      const runs = [];
      let previousEnd = 0;
      for (let run = 0; run < runCount; run ++) {
        const start = previousEnd + reader.readGamma() - 1;
        const runLength = reader.readGamma();
        if (start < previousEnd || start + runLength > length) {
          throw new Error("Invalid ln.kr structural residual range");
        }
        runs.push({ start, length: runLength });
        previousEnd = start + runLength;
      }
      shape = { length, runs };
      patchShapes.push(shape);
    }

    for (const run of shape.runs) {
      for (let index = 0; index < run.length; index ++) {
        block[run.start + index] = Number(reader.readFixed(8));
      }
    }
    output.push(...block);
  };

  while (output.length < expectedLength) {
    if (reader.readBit() === 0) {
      appendAsciiRecord();
      continue;
    }

    if (reader.readBit() === 0) {
      appendDictionaryRecord();
      continue;
    }

    if (reader.readBit() === 0) {
      appendCopyRecord();
      continue;
    }

    if (version === STRUCTURED_VERSION || version === DICTIONARY_VERSION) {
      if (reader.readBit() === 0) {
        appendLexemeRecord(version === DICTIONARY_VERSION
          ? readV3LexemeIndex()
          : reader.readGamma() - 1);
        continue;
      }

      if (reader.readBit() === 0) {
        appendRawRecord();
        continue;
      }

      const reuseShape = reader.readBit() === 1;
      const distance = reader.readGamma();
      if (reuseShape && distance === 1) {
        appendTemplateRecord();
        continue;
      }
      appendPatchRecord(reuseShape, distance);
      continue;
    }

    appendRawRecord();
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
