// Read mk.it's existing MKIT/1 envelope; no request to Make and no new codec.
import { Inflate } from './vendor/pako.esm.min.js';
import { extractSingleLinkDocument, isTextualSourceResponse, mediaLinkKind, sourceResourceURL } from './link-runtime.js';

export function isMakeLink (value) {
  try {
    const url = new URL(value);
    return ['http:','https:'].includes(url.protocol) && url.hostname === 'app.shel.sh' &&
      /^\/make\/?$/.test(url.pathname) && /^#(?:share|p):/.test(url.hash);
  } catch { return false; }
}

export function decodeMakeFile (url, maxBytes = 32 * 1024 * 1024) {
  if (!isMakeLink(url)) throw Error('Not an mk.it share link');
  const payload = decodeURIComponent(new URL(url).hash.replace(/^#(?:share|p):/,''));
  if (!/^[\w-]+={0,2}$/.test(payload) || payload.length > maxBytes * 2) throw Error('Invalid or oversized mk.it payload');
  const binary = atob(payload.replaceAll('-','+').replaceAll('_','/'));
  const compressed = Uint8Array.from(binary,c=>c.charCodeAt(0));
  const chunks = []; let size = 0;
  const stream = new Inflate();
  stream.onData = chunk => {
    size += chunk.length;
    if (size > maxBytes) throw Error('mk.it file exceeds the decoded byte limit');
    chunks.push(chunk);
  };
  stream.push(compressed,true);
  if (stream.err || !stream.ended) throw Error('Damaged mk.it share payload');
  const record = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { record.set(chunk,offset); offset += chunk.length; }
  if (size < 11 || ![0x4d,0x4b,0x49,0x54,1].every((byte,i)=>record[i]===byte)) throw Error('Unsupported mk.it share version');
  const length = new DataView(record.buffer).getUint32(5,false);
  if (length < 2 || length > size-9) throw Error('Invalid mk.it metadata length');
  const decoder = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
  const meta = JSON.parse(decoder.decode(record.subarray(9,9+length)));
  if (typeof meta.name !== 'string' || typeof meta.mime !== 'string' || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+(?:\s*;[^\r\n]*)?$/.test(meta.mime)) throw Error('Invalid mk.it file metadata');
  const bytes = record.slice(9+length);
  const sourceURL = 'https://make-file.invalid/' + encodeURIComponent(meta.name);
  const kind = mediaLinkKind(sourceURL,meta.mime);
  return {name:meta.name,mime:meta.mime,bytes,sourceURL,mediaKind:kind,
    text: !kind && isTextualSourceResponse(sourceURL,meta.mime) ? decoder.decode(bytes) : null};
}

export function makeFileDataURL (file) {
  let binary = '';
  for (let i=0;i<file.bytes.length;i+=8192) binary += String.fromCharCode(...file.bytes.subarray(i,i+8192));
  const mime = file.mime.split(';',1)[0].trim();
  return `data:${mime}${file.text !== null ? ';charset=utf-8' : ''};base64,${btoa(binary)}`;
}

export function createMakeResources ({fetchImpl = globalThis.fetch, resourceURLForTarget = sourceResourceURL, maxBytes = 32*1024*1024} = {}) {
  const files = new Map(), pointers = new Map(); let size = 0;
  function decode (url) {
    if (!files.has(url)) {
      const file = decodeMakeFile(url,maxBytes-size);
      size += file.bytes.length; files.set(url,file);
    }
    return files.get(url);
  }
  function fromText (source, wrapped = false) {
    const text = String(source).trim();
    const url = wrapped || /^https?:\/\/\S+$/i.test(text) ? extractSingleLinkDocument(text) : '';
    return isMakeLink(url) ? decode(url) : null;
  }
  function remember (target, source, wrapped = false) {
    const file = fromText(source,wrapped); pointers.set(target,Promise.resolve(file)); return file;
  }
  async function get (target, {probe = false, wrapped = false} = {}) {
    if (isMakeLink(target)) return decode(target);
    if (wrapped && pointers.has(target)) {
      const known = await pointers.get(target); if (known) return known;
    }
    const url = new URL(resourceURLForTarget(target));
    // Don't pre-fetch ordinary images/media merely to discover an indirection.
    if (probe && (mediaLinkKind(url.href) || !(/\.(?:txt|md|markdown|html?|js|css|json)$/i.test(url.pathname) || /^(?:raw\.githubusercontent\.com|huggingface\.co)$/.test(url.hostname)))) return null;
    const key = target + (wrapped ? ':wrapped' : '');
    if (!pointers.has(key)) {
      if (pointers.size >= 128) throw Error('Too many mk.it pointer files');
      pointers.set(key,(async()=>{
        const response = await fetchImpl(url.href,{signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw Error(`mk.it pointer: ${response.status}`);
        if (!isTextualSourceResponse(url.href,response.headers.get('content-type')||'')) return null;
        const source = await response.text();
        if (source.length > maxBytes) throw Error('mk.it pointer exceeds byte limit');
        return fromText(source,wrapped);
      })());
    }
    return pointers.get(key);
  }
  return {get,fromText,remember,decode};
}
