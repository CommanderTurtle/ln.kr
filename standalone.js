import { readFileSync } from "node:fs";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "./docs/alphabets.js";
import { compressText, decompressText } from "./docs/text-compress.js";
import { splitExecutableFragment } from "./docs/viewer-runtime.js";

const [, , command, inputArgument, alphabetArgument = "ascii", kind = "auto"] = process.argv;

function usage (exitCode = 0) {
  console.error(`Usage:
  lnkr encode <text|-> [ascii|emoji|qr] [auto|text|markdown|javascript|html]
  lnkr decode <payload-or-url> [ascii|emoji|qr]

Use - as the input to read exact UTF-8 text from stdin.`);
  process.exit(exitCode);
}

if (!command || command === "--help" || command === "-h") usage();
if (!inputArgument) usage(1);

const alphabets = {
  ascii: outputAlphabetASCII,
  emoji: outputAlphabetEmoji,
  qr: outputAlphabetQR
};

if (command === "encode") {
  const alphabet = alphabets[alphabetArgument];
  if (!alphabet) usage(2);
  const input = inputArgument === "-" ? readFileSync(0, "utf8") : inputArgument;
  const payload = compressText(input, alphabet, kind).payload;
  console.log(alphabetArgument === "qr"
    ? `HTTPS://A.SHEL.SH/T/${payload}`
    : `https://a.shel.sh/#${payload}`);
  process.exit(0);
}

if (command === "decode") {
  let payload = inputArgument;
  let alphabetName = alphabetArgument;
  const qrMarker = payload.toUpperCase().indexOf("/T/");
  if (qrMarker >= 0) {
    payload = payload.slice(qrMarker + 3);
    alphabetName = "qr";
  } else if (payload.includes("#q:")) {
    payload = decodeURIComponent(payload.slice(payload.indexOf("#q:") + 3));
    alphabetName = "qr";
  } else if (payload.includes("#")) {
    payload = decodeURIComponent(payload.slice(payload.indexOf("#") + 1));
    payload = splitExecutableFragment(payload).payload;
    if (Array.from(payload).some(character => !outputAlphabetASCII.includes(character))) {
      alphabetName = "emoji";
    }
  }
  const alphabet = alphabets[alphabetName];
  if (!alphabet) usage(2);
  process.stdout.write(decompressText(payload, alphabet).text);
  process.exit(0);
}

usage(2);
