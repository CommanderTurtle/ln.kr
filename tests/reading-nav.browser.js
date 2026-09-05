import {renderContent} from '../docs/render.js';
import {decorateJekyllMarkdown} from '../docs/repo-theme.js';
import {readingNavigationBootstrap} from '../docs/reading-nav.js';
import {previewNavigationBootstrap} from '../docs/preview-navigation.js';

export async function checkReadingNavigation(check,styles) {
  const root=document.createElement('article'); root.className='preview lnkr-theme-jekyll frame-preview';
  await renderContent(root,'## First\n\n<div style="height:500px">First section</div>\n\n## Second\n\n<div style="height:500px">Second section</div>\n\n## Last\n\n<div style="height:500px">Last section</div>','markdown');
  decorateJekyllMarkdown(root);
  for(const nested of [false,true]) {
    // Keep the measured frame visible: Chromium pauses rAF in offscreen frames.
    const frame=document.createElement('iframe');frame.sandbox='allow-scripts';frame.style='position:fixed;top:0;left:0;z-index:10000;display:block;width:1100px;max-width:100%;height:450px';
    const id='reading-'+nested;
    const done=new Promise(resolve=>{
      const timeout=setTimeout(()=>{check(id,false,'no response');resolve();},6000);
      const handler=e=>{
        if(e.source!==frame.contentWindow || e.data?.fixture!==id)return;
        clearTimeout(timeout);removeEventListener('message',handler);check(id,e.data.ok,JSON.stringify(e.data.details));resolve();
      };addEventListener('message',handler);
    });
    const content=`<article class="preview lnkr-theme-jekyll frame-preview">${root.innerHTML}</article>`;
    const body=nested?`<div id="scroller" style="height:420px;overflow:auto">${content}</div>`:content;
    frame.srcdoc=`<!doctype html><html><head><style>${styles}</style><script>${readingNavigationBootstrap()}${previewNavigationBootstrap()}<\/script></head><body>${body}<script>
      addEventListener('DOMContentLoaded',async()=>{
        const tick=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
        const nav=document.querySelector('[data-jekyll-toc]'), heading=document.getElementById('second');
        const scroller=document.getElementById('scroller');
        await tick();
        const first=nav.querySelector('[aria-current]')?.getAttribute('href');
        const geometry=[...document.querySelectorAll('.lnkr-jekyll-body h2')].map(h=>[h.id,h.getBoundingClientRect().top]);
        if(scroller)scroller.scrollTop=heading.getBoundingClientRect().top-scroller.getBoundingClientRect().top-60;
        else scrollTo(0,heading.getBoundingClientRect().top+scrollY-60);
        await tick();
        const second=nav.querySelector('[aria-current]')?.getAttribute('href');
        const hash=location.hash;
        const event=new MouseEvent('click',{bubbles:true,cancelable:true});
        nav.querySelector('a').dispatchEvent(event);await tick();
        const back=nav.querySelector('[aria-current]')?.getAttribute('href');
        parent.postMessage({fixture:${JSON.stringify(id)},ok:first==='#first'&&second==='#second'&&back==='#first'&&hash===location.hash&&event.defaultPrevented,details:{first,second,back,geometry}},'*');
      });<\/script></body></html>`;
    document.body.append(frame);await done;frame.style.position='static';
  }
}
