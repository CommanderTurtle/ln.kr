import {deflate} from '../docs/vendor/pako.esm.min.js';
import {encodeLinkTarget} from '../docs/link-runtime.js';
import {createMakeResources} from '../docs/make-resource.js';
import {expandSourceIncludes,prepareResolvedResourceLinks} from '../docs/source-includes.js';

export async function checkMakeMedia(check) {
  const bytes=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR1sAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const metadata=new TextEncoder().encode(JSON.stringify({name:'pixel.png',mime:'image/png'}));
  const record=new Uint8Array(9+metadata.length+bytes.length);
  record.set([77,75,73,84,1]);new DataView(record.buffer).setUint32(5,metadata.length,false);
  record.set(metadata,9);record.set(bytes,9+metadata.length);
  const share='https://app.shel.sh/make/#p:'+btoa(String.fromCharCode(...deflate(record))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const raw='https://raw.githubusercontent.com/fixture/media/main/link.txt';
  const appURL=location.origin+'/docs/';
  const link=(target,mode)=>appURL+'#'+mode+':'+encodeLinkTarget(target).payload;
  let fetches=0;
  const fetchImpl=async()=>{fetches++;return new Response(share);};
  const makeResources=createMakeResources({fetchImpl});
  const authored=link(raw,'ss');
  const expanded=await expandSourceIncludes(authored,{appURL,documentKind:'html',makeResources,fetchImpl,resourceURLForTarget:x=>x,resourceLinkForTarget:x=>link(x,'lr')});
  const runtime=await prepareResolvedResourceLinks(expanded.text,{appURL,makeResources});
  const host=document.createElement('div');host.innerHTML=runtime;document.body.append(host);
  const img=host.querySelector('img');
  await img.decode();
  check('Make superlink decodes a real image without contacting Make',img.naturalWidth===1&&img.naturalHeight===1&&fetches===1);
  check('Make module keeps the short source capsule',host.querySelector('.lnkr-module-token').getAttribute('href')===authored);
  for(const href of [link(share,'lr'),share,link(raw,'ss')]) {
    const markup=await prepareResolvedResourceLinks(`<img src="${href}">`,{appURL,makeResources});
    const block=document.createElement('div');block.innerHTML=markup;
    const image=block.querySelector('img');await image.decode();
    check('Make resource URL renders native image bytes',image.naturalWidth===1);
  }
}
