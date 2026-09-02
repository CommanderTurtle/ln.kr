import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetPath,
  outputAlphabetQR
} from "./alphabets.js";
import { compress, decompress } from "./compress.js";

const routePrefixes = Object.freeze([
  ["hs:", "source-live"],
  ["lr:", "resolved"],
  ["i:", "image"],
  ["s:", "source"],
  ["l:", "guarded"]
]);

const imageSuffixes = new Set([
  "apng", "avif", "bmp", "cur", "gif", "heic", "heif", "ico", "jfif",
  "jpeg", "jpg", "jxl", "pjp", "pjpeg", "png", "svg", "tif", "tiff", "webp"
]);

export function splitLinkFragment (fragment) {
  for (const [prefix, mode] of routePrefixes) {
    if (fragment.startsWith(prefix)) {
      return { mode, payload: fragment.slice(prefix.length) };
    }
  }
  return { mode: "", payload: fragment };
}

export function linkPrefixForMode (mode) {
  if (mode === "source-live") return "hs:";
  if (mode === "resolved") return "lr:";
  if (mode === "image") return "i:";
  if (mode === "source") return "s:";
  if (mode === "guarded") return "l:";
  return "";
}

export function validateLinkTarget (input, { inferProtocol = true } = {}) {
  const value = String(input).trim();
  if (!value) throw new Error("Enter a link first");

  const hasProtocol = /^\w+:\/\//i.test(value);
  const parsed = new URL(hasProtocol || !inferProtocol ? value : `http://${value}`);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Invalid protocol: ${parsed.protocol}. Only http and https are supported.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error("Credentials in URLs are not supported");
  }
  return parsed.href;
}

export function isImageLinkTarget (target) {
  const pathname = new URL(validateLinkTarget(target, { inferProtocol: false })).pathname;
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return Boolean(match && imageSuffixes.has(match[1].toLowerCase()));
}

export function encodeLinkTarget (input, alphabet = outputAlphabetASCII) {
  validateLinkTarget(input);
  const payload = compress(String(input).trim(), alphabet);
  const target = decompress(payload, alphabet);
  validateLinkTarget(target, { inferProtocol: false });
  return { payload, target };
}

export function encodeDirectLinkTarget (input) {
  return encodeLinkTarget(input, outputAlphabetPath);
}

function decodeCandidates (raw) {
  const candidates = [String(raw).replaceAll(" ", "")];
  try {
    const decoded = decodeURIComponent(raw).replaceAll(" ", "");
    if (!candidates.includes(decoded)) candidates.push(decoded);
  } catch {
    // A literal codec payload is still a valid candidate.
  }
  return candidates.filter(Boolean);
}

function inferredAlphabet (payload) {
  return Array.from(payload).some(character => !outputAlphabetASCII.includes(character))
    ? outputAlphabetEmoji
    : outputAlphabetASCII;
}

export function decodeLinkTarget (raw, alphabetHint = null) {
  let lastError = new Error("Empty link payload");
  for (const payload of decodeCandidates(raw)) {
    const alphabets = alphabetHint
      ? [alphabetHint]
      : [inferredAlphabet(payload)];

    for (const alphabet of alphabets) {
      try {
        const target = decompress(payload, alphabet);
        validateLinkTarget(target, { inferProtocol: false });
        return { target, payload, alphabet };
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError;
}

export function decodeQRLinkTarget (raw) {
  return decodeLinkTarget(raw, outputAlphabetQR);
}

export function decodeDirectLinkTarget (raw) {
  return decodeLinkTarget(raw, outputAlphabetPath);
}
