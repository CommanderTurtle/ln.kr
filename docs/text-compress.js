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
const MIN_LEXEME_BYTES = 2;
const MAX_LEXEME_BYTES = 192;
const MIN_LEXEME_OCCURRENCES = 3;
const MAX_LEXICON_ENTRIES = 512;
const MAX_GRAMMAR_UNITS = 16;
const GRAMMAR_SEEN_SIZE = 1 << 19;

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

function findDictionaryMatch (bytes, position, trie = dictionaryTrie) {
  let node = trie;
  let best = null;

  for (let index = position; index < bytes.length; index ++) {
    node = node.children.get(bytes[index]);
    if (!node) break;
    if (node.index >= 0) {
      const length = index - position + 1;
      const bitLength = (node.type === "lexeme" ? 4 : 2) +
        gammaBitLength(node.index + 1);
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

function findLexemePath (bytes, position, trie) {
  let cursor = position;
  let first = null;
  let savings = 0;

  // A long exact copy can begin one space or punctuation byte before a much
  // cheaper grammar symbol and hide it from a purely greedy parser.  Look
  // through a few already-cheap prefix tokens.  If their combined guaranteed
  // saving beats the competing range record, taking the first step is safe;
  // the lexeme will be reconsidered at the following position.
  for (let step = 0; step < 4 && cursor < bytes.length; step ++) {
    const match = findDictionaryMatch(bytes, cursor, trie);
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
  activeDictionaryTrie = dictionaryTrie
) {
  const tokens = [];
  const chains = new Map();
  let position = 0;
  let lastPatchProbe = -PATCH_PROBE_STEP;

  while (position < bytes.length) {
    const dictionary = findDictionaryMatch(bytes, position, activeDictionaryTrie);
    const copy = findCopyMatch(bytes, position, chains);
    const lexemePath = activeDictionaryTrie === dictionaryTrie
      ? null
      : findLexemePath(bytes, position, activeDictionaryTrie);
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

    if (patch && (!lexemePath || patch.savings >= lexemePath.savings)) {
      tokens.push({ type: "patch", ...patch });
      position += patch.length;
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
  const guaranteedWords = ranked.filter(candidate => !candidate.phrase).slice(0, 128);
  const guaranteed = new Set(guaranteedWords);
  const pool = [
    ...guaranteedWords,
    ...ranked.filter(candidate => !guaranteed.has(candidate)).slice(
      0,
      MAX_LEXICON_ENTRIES - guaranteedWords.length
    )
  ].sort(byGain);
  const selected = [];
  for (const candidate of pool) {
    if (selected.length >= MAX_LEXICON_ENTRIES) break;
    // Overlapping n-grams otherwise fragment one high-frequency phrase into
    // dozens of low-frequency one-token extensions.  Keep the best-scoring
    // member of each nested phrase family; words remain independent symbols.
    if (
      candidate.phrase &&
      selected.some(existing => existing.phrase && phrasesCompete(candidate.value, existing.value))
    ) continue;
    const tokenCost = 4 + gammaBitLength(selected.length + 1);
    const gain = candidate.baseline -
      candidate.positions.length * tokenCost - candidate.definitionCost;
    if (gain > 2) selected.push(candidate);
  }
  return selected.map(candidate => candidate.bytes);
}

function collectLexemeCandidates (text, legacyCosts) {
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
  const wordLexicon = selectLexiconCandidates(candidates, legacyCosts);

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

  return {
    wordLexicon,
    combinedLexicon: selectLexiconCandidates(candidates, legacyCosts)
  };
}

function pruneLexicon (entries, tokens, legacyCosts) {
  if (!entries.length) return entries;
  const gains = new Float64Array(entries.length);
  const uses = new Uint32Array(entries.length);

  for (const token of tokens) {
    if (token.type !== "lexeme") continue;
    uses[token.index] ++;
    gains[token.index] += legacyCosts[token.start + token.length] - legacyCosts[token.start] -
      tokenBits(token, STRUCTURED_VERSION).length;
  }

  return entries.map((entry, index) => {
    const definitionTokens = tokenize(entry);
    const definitionBits = definitionTokens.reduce(
      (total, token) => total + tokenBits(token, LEGACY_VERSION).length,
      gammaBitLength(entry.length)
    );
    return { entry, gain: gains[index], uses: uses[index], definitionBits };
  }).filter(candidate => candidate.gain > candidate.definitionBits)
    .sort((a, b) => b.uses - a.uses || b.gain - a.gain || b.entry.length - a.entry.length)
    .map(candidate => candidate.entry);
}

function buildLexiconHeaderBits (entries) {
  let bits = gammaBits(entries.length + 1);
  let byteLength = 0;
  for (const entry of entries) {
    bits += gammaBits(entry.length);
    byteLength += entry.length;
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

function optimizeLexicon (initialLexicon, bytes, legacyCosts, baseline = null) {
  let lexicon = initialLexicon;
  let best = baseline?.plan || {
    tokens: tokenize(bytes, true, legacyCosts, dictionaryTrie),
    lexicon: []
  };
  let bestBits = baseline?.bits ?? structuredPlanBitLength(best);

  for (let pass = 0; pass < 4; pass ++) {
    const trie = lexicon.length ? buildDictionaryTrie(lexicon) : dictionaryTrie;
    // Settle the lexical grammar without allowing a large sparse-delta record
    // to hide all of the words/phrases it spans during admission.  The plan is
    // still priced with structural records enabled immediately afterwards.
    const lexicalTokens = tokenize(bytes, false, null, trie);
    const tokens = tokenize(bytes, true, legacyCosts, trie);
    const plan = { tokens, lexicon };
    const bits = structuredPlanBitLength(plan);
    if (bits < bestBits) {
      best = plan;
      bestBits = bits;
    }
    const pruned = pruneLexicon(lexicon, lexicalTokens, legacyCosts);
    if (
      pruned.length === lexicon.length &&
      pruned.every((entry, index) => entry === lexicon[index])
    ) break;
    lexicon = pruned;
  }

  return best;
}

function structuredPlanBitLength (plan) {
  assignPatchGrammar(plan.tokens);
  return buildLexiconHeaderBits(plan.lexicon).length + plan.tokens.reduce(
    (total, token) => total + tokenBits(token, STRUCTURED_VERSION).length,
    0
  );
}

function buildStructuredTokens (text, bytes, legacyCosts) {
  const candidates = collectLexemeCandidates(text, legacyCosts);
  const emptyPlan = {
    tokens: tokenize(bytes, true, legacyCosts, dictionaryTrie),
    lexicon: []
  };
  const emptyBits = structuredPlanBitLength(emptyPlan);
  const wordPlan = optimizeLexicon(
    candidates.wordLexicon,
    bytes,
    legacyCosts,
    { plan: emptyPlan, bits: emptyBits }
  );
  const wordBits = structuredPlanBitLength(wordPlan);

  // Phrase discovery must earn its keep after definitions, record prefixes,
  // exact copies, and sparse deltas all compete for the same bytes.  Compare
  // the two actual v2 streams rather than trusting overlapping optimistic
  // gains; the cheaper document-local grammar wins deterministically.
  return optimizeLexicon(
    candidates.combinedLexicon,
    bytes,
    legacyCosts,
    { plan: wordPlan, bits: wordBits }
  );
}

function tokenBits (token, version) {
  if (token.type === "ascii") {
    return "0" + fixedBits(token.byte, 7);
  }
  if (token.type === "dictionary") {
    return "10" + gammaBits(token.index + 1);
  }
  if (token.type === "lexeme") {
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
  if (version === STRUCTURED_VERSION) {
    legacyTokens ||= tokenize(bytes);
    const legacyCosts = buildLegacyCostPrefix(bytes.length, legacyTokens);
    ({ tokens, lexicon } = buildStructuredTokens(text, bytes, legacyCosts));
  } else {
    tokens = tokenize(bytes);
  }
  const grammarCounts = version === STRUCTURED_VERSION
    ? assignPatchGrammar(tokens)
    : { patchDefinition: 0, patchReuse: 0 };
  const checksum = crc32(bytes);
  const lengthBits = gammaBits(bytes.length + 1);
  const lexiconBits = version === STRUCTURED_VERSION
    ? buildLexiconHeaderBits(lexicon)
    : "";
  const tokenSequences = tokens.map(token => tokenBits(token, version));
  const tokenBitLength = tokenSequences.reduce((total, bits) => total + bits.length, 0);
  const counts = {
    ascii: 0,
    dictionary: 0,
    lexeme: 0,
    copy: 0,
    raw: 0,
    patch: 0,
    lexicon: lexicon.length,
    lexiconUse: 0,
    ...grammarCounts
  };
  for (const token of tokens) {
    counts[token.type] ++;
    if (token.type === "lexeme") {
      counts.lexiconUse ++;
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
    checksum,
    lengthBits,
    bitLength: 16 + 3 + 2 + lengthBits.length + 32 + lexiconBits.length + tokenBitLength,
    counts
  };
}

function encodePlan (plan, alphabet) {
  let number = 1n;
  for (let index = plan.tokenSequences.length - 1; index >= 0; index --) {
    number = huffmanEncode(number, plan.tokenSequences[index]);
  }
  if (plan.version === STRUCTURED_VERSION) {
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
  if (![LEGACY_VERSION, STRUCTURED_VERSION].includes(version)) {
    throw new Error(`Unsupported ln.kr version: ${version}`);
  }

  const kindNumber = Number(reader.readFixed(2));
  const expectedLength = reader.readGamma() - 1;
  const expectedChecksum = Number(reader.readFixed(32));
  const output = [];
  const patchShapes = [];
  const lexicon = [];

  if (version === STRUCTURED_VERSION) {
    const count = reader.readGamma() - 1;
    if (count < 0 || count > MAX_LEXICON_ENTRIES) {
      throw new Error("Invalid ln.kr structural lexicon size");
    }
    let lexiconBytes = 0;
    const lengths = [];
    for (let entry = 0; entry < count; entry ++) {
      const length = reader.readGamma();
      if (length < MIN_LEXEME_BYTES || length > MAX_LEXEME_BYTES) {
        throw new Error("Invalid ln.kr structural lexeme length");
      }
      lexiconBytes += length;
      if (lexiconBytes > expectedLength) {
        throw new Error("ln.kr structural lexicon exceeds the document length");
      }
      lengths.push(length);
    }
    const definitionBytes = decodeLegacySection(reader, lexiconBytes);
    let definitionOffset = 0;
    for (const length of lengths) {
      lexicon.push(Uint8Array.from(
        definitionBytes.slice(definitionOffset, definitionOffset + length)
      ));
      definitionOffset += length;
    }
  }

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

    if (version === STRUCTURED_VERSION) {
      if (reader.readBit() === 0) {
        const index = reader.readGamma() - 1;
        const bytes = lexicon[index];
        if (!bytes) throw new Error(`Unknown ln.kr structural lexeme: ${index}`);
        ensureLength(bytes.length);
        output.push(...bytes);
        continue;
      }

      if (reader.readBit() === 0) {
        const rawLength = reader.readGamma();
        ensureLength(rawLength);
        for (let index = 0; index < rawLength; index ++) {
          output.push(Number(reader.readFixed(8)));
        }
        continue;
      }

      const reuseShape = reader.readBit() === 1;
      const distance = reader.readGamma();
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
