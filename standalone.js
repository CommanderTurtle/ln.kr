import { readFileSync } from "node:fs";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "./docs/alphabets.js";
import { decodeDocumentPayload } from "./docs/payload.js";
import { compressText } from "./docs/text-compress.js";
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
  let alphabetHint = process.argv[4] ? alphabets[alphabetArgument] : null;
  const qrMarker = payload.toUpperCase().indexOf("/T/");
  if (qrMarker >= 0) {
    payload = payload.slice(qrMarker + 3);
    alphabetName = "qr";
    alphabetHint = outputAlphabetQR;
  } else if (payload.includes("#q:")) {
    payload = payload.slice(payload.indexOf("#q:") + 3);
    alphabetName = "qr";
    alphabetHint = outputAlphabetQR;
  } else if (payload.includes("#")) {
    payload = payload.slice(payload.indexOf("#") + 1);
    payload = splitExecutableFragment(payload).payload;
  }
  if (alphabetHint === undefined || !alphabets[alphabetName]) usage(2);
  process.stdout.write(decodeDocumentPayload(payload, alphabetHint).decoded.text);
  process.exit(0);
}

usage(2);
