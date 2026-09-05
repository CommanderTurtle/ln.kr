import {previewAppearanceBootstrap} from '../docs/preview-appearance.js';
import {compressTextV1} from '../docs/text-compress.js';
import {outputAlphabetASCII} from '../docs/alphabets.js';

export async function checkFrameChrome(check,styles) {
  const frame=document.createElement('iframe');
  frame.sandbox='allow-scripts';
  frame.style='position:fixed;inset:0;width:100%;height:500px;z-index:10000';
  const token='chrome-fixture';
  const done=new Promise(resolve=>{
    const timeout=setTimeout(()=>{check('managed frame responds',false);cleanup();},6000);
    const cleanup=()=>{clearTimeout(timeout);removeEventListener('message',receive);resolve();};
    const receive=event=>{
      if(event.source!==frame.contentWindow || event.data?.fixture!==token)return;
      const data=event.data;
      if(data.ready) {
        // A wrong-token command must not alter the document.
        frame.contentWindow.postMessage({source:'ln.kr-theme-set',token:'wrong',mode:'light'},'*');
        frame.contentWindow.postMessage({probe:'wrong'},'*');
        return;
      }
      if(data.probe==='wrong') {
        check('frame appearance commands require the current token',data.mode==='dark');
        frame.contentWindow.postMessage({source:'ln.kr-theme-set',token,mode:'light'},'*');
        frame.contentWindow.postMessage({probe:'light'},'*');return;
      }
      check('frame header mode removes document controls without moving its content',data.controls===0&&data.scroll===180&&data.top===data.initialTop,JSON.stringify(data));
      check('light mode fills the iframe canvas, not just the article',data.mode==='light'&&data.body===data.background&&data.html===data.background,JSON.stringify(data));
      cleanup();
    };addEventListener('message',receive);
  });
  frame.srcdoc=`<!doctype html><html><head><style>${styles}</style><script>${previewAppearanceBootstrap({mode:'dark',token})}<\/script></head><body><article class="preview frame-preview" data-lnkr-appearance="dark"><h1>Frame document</h1><div style="height:1500px">Content stays in place</div></article><script>
  addEventListener('DOMContentLoaded',async()=>{
    const root=document.querySelector('article'),deadline=Date.now()+2000;
    while(!root.getBoundingClientRect().width && Date.now()<deadline) await new Promise(r=>setTimeout(r,20));
    const initialTop=root.querySelector('h1').offsetTop;
    scrollTo(0,180);
    addEventListener('message',event=>{
      if(event.source!==parent||!event.data?.probe)return;
      parent.postMessage({fixture:${JSON.stringify(token)},probe:event.data.probe,mode:root.dataset.lnkrAppearance,controls:root.querySelectorAll('.lnkr-preview-tools').length,scroll:scrollY,top:root.querySelector('h1').offsetTop,initialTop,background:getComputedStyle(root).backgroundColor,body:getComputedStyle(document.body).backgroundColor,html:getComputedStyle(document.documentElement).backgroundColor},'*');
    });
    parent.postMessage({fixture:${JSON.stringify(token)},ready:true},'*');
  });<\/script></body></html>`;
  document.body.append(frame);await done;frame.remove();

  // The real app, with its opaque sandbox and external header control.
  const app=document.createElement('iframe');
  app.style='position:fixed;inset:0;width:100%;height:700px;z-index:10000';
  const source='style=jekyll\n\n# Window test\n\n## First\n\nText\n\n## Second\n\nMore text';
  app.src='/docs/index.html#m:'+compressTextV1(source,outputAlphabetASCII,'markdown').payload;
  document.body.append(app);
  try {
    const doc=await new Promise((resolve,reject)=>{
      const start=Date.now();const timer=setInterval(()=>{
        const doc=app.contentDocument;
        if(doc?.querySelector('#runner-appearance button') && !doc.querySelector('#runner').hidden) {clearInterval(timer);resolve(doc);}
        else if(Date.now()-start>7000){clearInterval(timer);reject(Error('App not ready'));}
      },30);
    });
    const runner=doc.querySelector('#runner'),preview=doc.querySelector('#preview');
    check('appearance buttons live in the two window headers',!!doc.querySelector('.document-head [data-preview-appearance]')&&!!runner.querySelector('.runner-head [data-preview-appearance]')&&!preview.querySelector(':scope > .lnkr-preview-tools'));
    const button=runner.querySelector('[data-preview-appearance]');
    button.click();
    check('runner chrome and main preview switch together',runner.dataset.lnkrScheme==='light'&&preview.dataset.lnkrScheme==='light'&&app.contentWindow.getComputedStyle(runner).backgroundColor==='rgb(250, 250, 251)');
    button.click();check('the frame header retains system mode',runner.dataset.lnkrAppearance==='system');
    button.click();check('the frame header can return to dark',runner.dataset.lnkrScheme==='dark');
    // Intercept only the browser opener; the actual button still constructs its link.
    let opened;
    app.contentWindow.open=(...args)=>{opened=args;};
    doc.querySelector('#hoist-make').click();
    check('Hoist constructs its Make share on click and opens a protected new tab',opened?.[0].startsWith('https://app.shel.sh/make/#share:')&&opened[1]==='_blank'&&opened[2]==='noopener,noreferrer');
  } catch(error) {check('real frame chrome',false,error.message);}
  finally {app.remove();}
}
