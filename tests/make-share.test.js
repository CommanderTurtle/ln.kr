import { expect, test } from 'bun:test';
import { inflate } from '../docs/vendor/pako.esm.min.js';
import { makeShareURL } from '../docs/make-share.js';

function unpack (url) {
  const hash = new URL(url).hash;
  expect(hash.startsWith('#share:')).toBe(true);
  const bytes = inflate(new Uint8Array(Buffer.from(hash.slice(7), 'base64url')));
  expect([...bytes.slice(0,5)]).toEqual([0x4d,0x4b,0x49,0x54,1]);
  const length = new DataView(bytes.buffer,bytes.byteOffset).getUint32(5,false);
  return {metadata: JSON.parse(new TextDecoder().decode(bytes.slice(9,9+length))), content: bytes.slice(9+length)};
}

test('Hoist uses the exact existing mk.it share envelope', () => {
  // Generated independently by mk.it/src/tools/share.ts::encodeSharedFile.
  const golden = 'eNrz9fYMYWRgYNCtVspLzE1VslJKyU8uzU3NK9HLTVHSUcrNBAuWpFaU6OcmFmWn5JfnKdUqK4SkFpfwcvFyfZg_YZHCkx1rn01rV1DgAgCsDhqS';
  expect(makeShareURL('# Test\r\n\r\n🐢 中文  \n','markdown')).toBe('https://app.shel.sh/make/#share:' + golden);
});

test('Hoist preserves exact UTF-8 source and the text document type', () => {
  for (const [kind,name,mime] of [['markdown','document.md','text/markdown'],['html','document.html','text/html'],['javascript','script.js','text/javascript'],['text','document.txt','text/plain']]) {
    for (const text of ['', '\uFEFF\t🐢 e\u0301 中文\r\n  <img>\rnext\n', 'Line with whitespace \r\n'.repeat(10000)]) {
      const result = unpack(makeShareURL(text,kind));
      expect(result.metadata).toEqual({name,mime});
      expect(result.content).toEqual(new TextEncoder().encode(text));
    }
  }
});

test('Make navigation is distinct from exact-source hoisting', async () => {
  const html = await Bun.file(new URL('../docs/index.html',import.meta.url)).text();
  expect(html).toMatch(/>Link<\/button>\s*<a[^>]+href="https:\/\/app.shel.sh\/make" target="_blank" rel="noopener noreferrer">\/make\/<\/a>/);
  expect(html).toMatch(/id="copy-rich"[^>]*>Copy rich<\/button>\s*<button id="hoist-make"/);
  const main = await Bun.file(new URL('../docs/main.js',import.meta.url)).text();
  const click = main.split('elements.hoistMake.addEventListener("click", () => {')[1].split('elements.copyJSFuck')[0];
  expect(click).toContain("window.open(makeShareURL(text, kind), '_blank', 'noopener,noreferrer')");
  expect(click).not.toMatch(/\bawait\s/);
});
