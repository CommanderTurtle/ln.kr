// mk.it's existing MKIT/1 file-share envelope (src/tools/share.ts), not a
// second ln.kr codec. Loaded only when the user chooses Hoist to Make.
import { deflate } from './vendor/pako.esm.min.js';

export function makeShareURL (text, kind, base = 'https://app.shel.sh/make/') {
  const [name, mime] = ({
    markdown: ['document.md', 'text/markdown'],
    html: ['document.html', 'text/html'],
    javascript: ['script.js', 'text/javascript'],
    text: ['document.txt', 'text/plain']
  })[kind] || ['document.txt', 'text/plain'];
  const encoder = new TextEncoder();
  const metadata = encoder.encode(JSON.stringify({name, mime}));
  const content = encoder.encode(text);
  const record = new Uint8Array(9 + metadata.length + content.length);
  record.set([0x4d, 0x4b, 0x49, 0x54, 0x01]);
  new DataView(record.buffer).setUint32(5, metadata.length, false);
  record.set(metadata, 9);
  record.set(content, 9 + metadata.length);
  const bytes = deflate(record, {level: 9});
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  const url = new URL(base);
  url.hash = 'share:' + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  return url.href;
}
