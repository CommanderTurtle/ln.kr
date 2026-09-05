import {expect,test} from 'bun:test';
import {deflate} from '../docs/vendor/pako.esm.min.js';
import {makeShareURL} from '../docs/make-share.js';
import {decodeMakeFile,isMakeLink,makeFileDataURL,createMakeResources} from '../docs/make-resource.js';
import {encodeLinkTarget} from '../docs/link-runtime.js';
import {expandSourceIncludes,prepareResolvedResourceLinks} from '../docs/source-includes.js';

const appURL='https://a.shel.sh/';
const link=(target,mode='s')=>appURL+'#'+mode+':'+encodeLinkTarget(target).payload;
export function binaryShare(name,mime,bytes) {
  const meta=new TextEncoder().encode(JSON.stringify({name,mime}));
  const record=new Uint8Array(9+meta.length+bytes.length);
  record.set([77,75,73,84,1]); new DataView(record.buffer).setUint32(5,meta.length,false);
  record.set(meta,9);record.set(bytes,9+meta.length);
  return 'https://app.shel.sh/make/#p:'+Buffer.from(deflate(record)).toString('base64url');
}

test('Make decoding uses existing envelopes with exact text, bytes and MIME',()=>{
  const source='\uFEFF# Turtle 🐢\r\n  whitespace\r\n';
  const file=decodeMakeFile(makeShareURL(source,'markdown'));
  expect(file.text).toBe(source); expect(file.mime).toBe('text/markdown');
  expect(makeFileDataURL(file)).toStartWith('data:text/markdown;charset=utf-8;base64,');
  for(const [name,mime,kind] of [['x.gif','image/gif','image'],['x.avif','image/avif','image'],['x.pdf','application/pdf','pdf'],['x.webm','video/webm','video'],['x.mp3','audio/mpeg','audio']]) {
    const bytes=Uint8Array.of(0,255,1,2,128);
    const decoded=decodeMakeFile(binaryShare(name,mime,bytes));
    expect(decoded.bytes).toEqual(bytes);expect(decoded.mediaKind).toBe(kind);
    expect(Buffer.from(makeFileDataURL(decoded).split(',')[1],'base64')).toEqual(Buffer.from(bytes));
  }
  expect(isMakeLink('https://elsewhere.test/make/#p:test')).toBe(false);
  expect(isMakeLink('https://app.shel.sh/make-other/#p:test')).toBe(false);
});

test('explicit wrapped Make superlinks reuse decoded media without fetching twice',async()=>{
  const share=binaryShare('x.png','image/png',Uint8Array.of(1,2,3));
  const raw='https://raw.githubusercontent.com/a/b/main/file.html';
  let fetches=0;
  const fetchImpl=async()=>{fetches++;return new Response(`<a href="${share}">File</a>`);};
  const makeResources=createMakeResources({fetchImpl});
  const options={appURL,fetchImpl,makeResources,documentKind:'html',resourceURLForTarget:x=>x,resourceLinkForTarget:x=>link(x,'lr')};
  const expanded=await expandSourceIncludes(link(raw,'ss'),options);
  const runtime=await prepareResolvedResourceLinks(expanded.text,{appURL,makeResources});
  expect(runtime).toContain('src="data:image/png;base64,AQID"');expect(fetches).toBe(1);
});

test('Make text recipes do not invent a repository base from the filename hint',async()=>{
  const share=makeShareURL('style=jekyll\n\n# Hello','markdown');
  const calls=[];
  const options={appURL,documentKind:'markdown',resourceURLForTarget:x=>x,resourceLinkForTarget:x=>link(x,'lr'),transformSource:(text,base)=>{calls.push(base);return text;}};
  await expandSourceIncludes(link(share),options);
  await expandSourceIncludes(link(share,'ss'),options);
  expect(calls).toEqual([undefined,undefined]);
});

test('ordinary and malformed Make-like raw contents retain their existing behavior',async()=>{
  const share=makeShareURL('code','text');
  const makeResources=createMakeResources();
  expect(makeResources.fromText('A note: '+share)).toBeNull();
  expect(makeResources.fromText(`<a href="${share}">File</a>`)).toBeNull();
  expect(makeResources.fromText(share+'\n'+share)).toBeNull();
  expect(makeResources.fromText('https://example.test/make/#p:bad')).toBeNull();
  expect(()=>makeResources.fromText('https://app.shel.sh/make/#p:bad')).toThrow();
});

test('damaged and oversized Make envelopes fail explicitly',()=>{
  expect(()=>decodeMakeFile('https://app.shel.sh/make/#p:abcd')).toThrow();
  expect(()=>decodeMakeFile(makeShareURL('x'.repeat(5000),'text'),200)).toThrow('byte limit');
  expect(()=>decodeMakeFile(binaryShare('x','not-a-mime',new Uint8Array()))).toThrow('metadata');
});

test('Make text modules and raw-pointer superlinks use normal line slicing',async()=>{
  const share=makeShareURL('zero\r\none\r\ntwo\r\n','markdown');
  const raw='https://raw.githubusercontent.com/a/b/main/file.txt'; let fetches=0;
  const fetchImpl=async()=>{fetches++;return new Response(share);};
  const makeResources=createMakeResources({fetchImpl});
  const options={appURL,fetchImpl,makeResources,documentKind:'markdown',resourceURLForTarget:x=>x,resourceLinkForTarget:x=>link(x,'lr'),showModuleSource:true};
  expect((await expandSourceIncludes(link(raw)+'::~1:-1',options)).text).toContain('one\r\n');
  expect((await expandSourceIncludes(link(raw,'ss'),options)).text).toContain('zero\r\none\r\ntwo\r\n');
  expect((await expandSourceIncludes(share,options)).text).toContain('zero\r\none\r\ntwo\r\n');
  expect(fetches).toBe(2); // per expansion fetch cache, shared decoded Make file
});

test('Make media becomes existing modules and short route-two sources decode only at runtime',async()=>{
  const share=binaryShare('motion.avif','image/avif',Uint8Array.of(1,2,3,4));
  const raw='https://raw.githubusercontent.com/a/b/main/image.txt'; let fetches=0;
  const calls=[];
  const fetchImpl=async url=>{fetches++;calls.push(String(url));return new Response(share);};
  const makeResources=createMakeResources({fetchImpl});
  const options={appURL,fetchImpl,makeResources,documentKind:'html',resourceURLForTarget:x=>x,resourceLinkForTarget:x=>link(x,'lr')};
  const authored=link(raw,'ss');
  const expanded=await expandSourceIncludes(authored,options);
  expect(expanded.text).toContain('lnkr-module-image');expect(expanded.text).toContain('#lr:');
  const runtime=await prepareResolvedResourceLinks(expanded.text,{appURL,makeResources});
  expect(runtime).toContain('src="data:image/avif;base64,AQIDBA=="');
  expect(runtime).toContain(authored.replaceAll('&','&amp;'));expect(calls).toEqual([raw]);
  for(const target of [link(share,'lr'),link(raw,'lr'),link(raw,'ss'),share]) {
    const markup=`<img src="${target}"><style>.x{background:url('${target}')}</style>`;
    const result=await prepareResolvedResourceLinks(markup,{appURL,makeResources});
    expect(result).toContain('src="data:image/avif;base64,AQIDBA=="');
    expect(result).toContain("url('data:image/avif;base64,AQIDBA==')");
    expect(markup).toContain(target);
  }
  expect(await prepareResolvedResourceLinks(`<a href="${share}">Visit</a>`,{appURL,makeResources})).toBe(`<a href="${share}">Visit</a>`);
});

test('ordinary media resources still use their URL without probe requests',async()=>{
  const target='https://example.test/working.webp';
  const makeResources=createMakeResources({fetchImpl:()=>{throw Error('Unexpected request');}});
  expect(await prepareResolvedResourceLinks(`<img src="${link(target,'lr')}">`,{appURL,makeResources})).toBe(`<img src="${target}">`);
});

test('PDF and audio modules reuse the established elements and fetch/Blob loader',async()=>{
  for(const [name,mime,expected] of [['paper.pdf','application/pdf','data-lnkr-pdf-source'],['audio.ogg','audio/ogg','<audio'],['movie.mp4','video/mp4','<video']]) {
    const share=binaryShare(name,mime,Uint8Array.of(37,80,68,70));
    const expanded=await expandSourceIncludes(link(share),{appURL,documentKind:'markdown',resourceURLForTarget:x=>x,resourceLinkForTarget:x=>link(x,'lr')});
    expect(expanded.text).toContain(expected);
    expect(expanded.text).toContain('#lr:');
    const runtime=await prepareResolvedResourceLinks(expanded.text,{appURL});
    expect(runtime).toContain(`data:${mime};base64,JVBERg==`);
  }
});
