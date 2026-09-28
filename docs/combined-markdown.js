// The same small, dependency-free format reader is shipped with llm, Make and a.shel.sh.
const MAX_FILES = 20_000;
const MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const NO_FINAL_NEWLINE = "<!-- combined:no-final-newline -->";

export function markdownFence(text, language = "text") {
  let longest = 2;
  for (const run of String(text).matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const marker = "`".repeat(longest + 1);
  return `${marker}${String(language).replace(/[\r\n`]/g, "")}\n${text}${String(text).endsWith("\n") || !text ? "" : "\n"}${marker}`;
}

export function combinedFileSection(path, text, language = "text") {
  return `## File: ./${path}\n\n${text && !text.endsWith("\n") ? `${NO_FINAL_NEWLINE}\n` : ""}${markdownFence(text, language)}\n\n***`;
}

function safePath(input) {
  const path = input.replaceAll("\\", "/");
  if (!path || path.startsWith("/") || /[\u0000-\u001f\u007f:]/.test(path)) return null;
  const parts = path.split("/");
  if (parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) return null;
  return path;
}

function hasFileDirectoryConflict(paths) {
  for (const path of paths) {
    const parts = path.split("/");
    for (let count = 1; count < parts.length; count++) if (paths.has(parts.slice(0, count).join("/"))) return true;
  }
  return false;
}

/** @typedef {{path:string, language:string, text?:string, omittedReason?:string}} CombinedFile */

// Require the entire document to match the format. Never export a partially parsed archive.
export function parseCombinedMarkdown(source) {
  if (typeof source !== "string" || source.length > MAX_BYTES || !/^\s*## File: \.\//.test(source)) return null;
  const lines = source.replace(/^\uFEFF/, "").match(/[^\n]*\n|[^\n]+$/g) || [];
  const line = index => (lines[index] || "").replace(/\r?\n$/, "");
  /** @type {CombinedFile[]} */
  const entries = [];
  const paths = new Set();
  let legacyNewlines = false;
  let index = 0;
  while (index < lines.length) {
    while (index < lines.length && !line(index).trim()) index++;
    if (index === lines.length) break;
    const heading = line(index++).match(/^## File: \.\/(.+)$/);
    const path = heading && safePath(heading[1]);
    if (!path || paths.has(path.toLowerCase()) || entries.length >= MAX_FILES) return null;
    paths.add(path.toLowerCase());
    while (index < lines.length && !line(index).trim()) index++;
    let noFinalNewline = false;
    if (line(index) === NO_FINAL_NEWLINE) { noFinalNewline = true; index++; }
    const omitted = line(index).match(/^\(omitted — (.+)\)$/);
    if (omitted) {
      if (noFinalNewline) return null;
      entries.push({ path, language: "text", omittedReason: omitted[1] });
      index++;
    } else {
      const opening = line(index++).match(/^(`{3,}|~{3,})[ \t]*([\w#+.-]*)[ \t]*$/);
      if (!opening) return null;
      const closing = new RegExp(`^${opening[1][0]}{${opening[1].length},}[ \\t]*$`);
      const start = index;
      while (index < lines.length && !closing.test(line(index))) index++;
      if (index === lines.length) return null;
      let text = lines.slice(start, index).join("");
      if (noFinalNewline) {
        if (!text.endsWith("\n")) return null;
        // The combiner inserts exactly one LF as a delimiter, not part of the file.
        text = text.slice(0, -1);
      } else if (text) legacyNewlines = true;
      entries.push({ path, language: opening[2] || "text", text });
      index++;
    }
    while (index < lines.length && !line(index).trim()) index++;
    if (line(index) !== "***") return null;
    index++;
  }
  if (!entries.length || hasFileDirectoryConflict(paths) || encoder.encode(source).length > MAX_BYTES) return null;
  return { entries, legacyNewlines, included: entries.filter(entry => entry.text !== undefined).length,
    omitted: entries.filter(entry => entry.omittedReason !== undefined).length };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

// ZIP STORE is sufficient for reconstructed text and needs no download, worker or library.
export function combinedZipBytes(entries) {
  if (entries.length > MAX_FILES) throw Error("Too many files for a combined archive.");
  const paths = new Set();
  const files = entries.filter(entry => entry.text !== undefined).map(entry => {
    const path = safePath(entry.path);
    if (!path || paths.has(path.toLowerCase())) throw Error("Unsafe or duplicate archive path.");
    paths.add(path.toLowerCase());
    const name = encoder.encode(path);
    const data = encoder.encode(entry.text);
    if (name.length > 65535) throw Error("Archive filename is too long.");
    return { name, data, crc: crc32(data), offset: 0 };
  });
  if (!files.length) throw Error("This document contains no recoverable text files.");
  if (hasFileDirectoryConflict(paths)) throw Error("A file conflicts with an archive directory.");
  const dataSize = files.reduce((sum, file) => sum + file.data.length, 0);
  if (dataSize > MAX_BYTES) throw Error("Combined archive exceeds 64 MiB of text.");
  const localSize = files.reduce((sum, file) => sum + 30 + file.name.length + file.data.length, 0);
  const centralSize = files.reduce((sum, file) => sum + 46 + file.name.length, 0);
  if (localSize + centralSize > MAX_BYTES * 2) throw Error("Combined archive metadata is too large.");
  const output = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(output.buffer);
  const u16 = (offset, value) => view.setUint16(offset, value, true);
  const u32 = (offset, value) => view.setUint32(offset, value, true);
  let at = 0;
  for (const file of files) {
    file.offset = at;
    u32(at, 0x04034b50); u16(at + 4, 20); u16(at + 6, 0x0800);
    u16(at + 12, 33); // 1980-01-01: deterministic ZIP metadata.
    u32(at + 14, file.crc); u32(at + 18, file.data.length); u32(at + 22, file.data.length);
    u16(at + 26, file.name.length);
    output.set(file.name, at + 30); output.set(file.data, at + 30 + file.name.length);
    at += 30 + file.name.length + file.data.length;
  }
  for (const file of files) {
    u32(at, 0x02014b50); u16(at + 4, 20); u16(at + 6, 20); u16(at + 8, 0x0800);
    u16(at + 14, 33); u32(at + 16, file.crc); u32(at + 20, file.data.length); u32(at + 24, file.data.length);
    u16(at + 28, file.name.length); u32(at + 42, file.offset);
    output.set(file.name, at + 46); at += 46 + file.name.length;
  }
  u32(at, 0x06054b50); u16(at + 8, files.length); u16(at + 10, files.length);
  u32(at + 12, centralSize); u32(at + 16, localSize);
  return output;
}

export function downloadCombinedFile(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const link = document.createElement("a");
  link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
