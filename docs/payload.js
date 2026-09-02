import {
  outputAlphabetASCII,
  outputAlphabetEmoji
} from "./alphabets.js";
import { decompressText } from "./text-compress.js";

/**
 * Decode a payload exactly as present in a URL fragment.  Raw fragments are
 * tried before URI-decoded ones because '%' is a real ASCII-alphabet digit;
 * the text format's magic, length, UTF-8 validation, and CRC select the one
 * valid interpretation rather than a character heuristic.
 */
export function decodeDocumentPayload (fragment, alphabet = null) {
  const candidates = [fragment];
  try {
    const decoded = decodeURIComponent(fragment);
    if (decoded !== fragment) candidates.push(decoded);
  } catch {
    // A raw '%' is legal in the ASCII transport alphabet.
  }

  const alphabets = alphabet
    ? [alphabet]
    : [outputAlphabetASCII, outputAlphabetEmoji];
  let lastError = null;

  for (const payload of candidates) {
    for (const candidateAlphabet of alphabets) {
      try {
        return {
          decoded: decompressText(payload, candidateAlphabet),
          payload,
          alphabet: candidateAlphabet
        };
      } catch (error) {
        lastError = error;
      }
    }
  }

  throw lastError || new Error("Not an ln.kr text payload");
}
