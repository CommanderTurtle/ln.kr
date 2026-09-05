import { renderContent } from '../docs/render.js';
import { decorateJekyllMarkdown } from '../docs/repo-theme.js';
import { previewAppearanceBootstrap } from '../docs/preview-appearance.js';
import { previewNavigationBootstrap } from '../docs/preview-navigation.js';
import { createRepositoryRenderer, repositoryFrame } from '../docs/repo-render.js';

export async function checkPreviewThemes (check) {
  const load = (tag,attrs) => new Promise((resolve,reject) => {
    const el = Object.assign(document.createElement(tag),attrs);
    el.onload=resolve; el.onerror=reject; document.head.append(el);
  });
  await Promise.all([
    load('script',{src:'/docs/vendor/marked.umd.js'}),
    load('script',{src:'/docs/vendor/highlight.min.js'}),
    load('link',{rel:'stylesheet',href:'/docs/styles.css'}),
    load('link',{rel:'stylesheet',href:'/docs/vendor/github-dark.min.css'})
  ]);
  const styles = await (await fetch('/docs/styles.css')).text();
  const text = '# Example\n\n## First heading\n\n### Nested heading\n\n[Jump](#first-heading)\n\n!!! note\n    Kept admonition\n\n```js\nconst x = 1;\n```\n\n=== "One"\n    First tab\n\n=== "Two"\n    Second tab\n';
  const root = document.createElement('article');
  root.className='preview lnkr-theme-jekyll'; document.body.append(root);
  await renderContent(root,text,'markdown');
  decorateJekyllMarkdown(root); decorateJekyllMarkdown(root);
  const button = root.querySelector('[data-preview-appearance]');
  check('dark Minima matches the sHEL blog palette', root.dataset.lnkrScheme==='dark' && getComputedStyle(root).backgroundColor==='rgb(10, 10, 15)');
  button.click();
  check('Minima light mode overrides its dark palette', root.dataset.lnkrScheme==='light' && getComputedStyle(root).backgroundColor==='rgb(250, 248, 245)');
  button.click();
  check('system appearance follows the browser', root.dataset.lnkrAppearance==='system' && root.dataset.lnkrScheme===(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'));
  button.click();
  check('appearance completes a three-state cycle', root.dataset.lnkrAppearance==='dark');
  const oldHash=location.hash;
  const menu=root.querySelector('[data-jekyll-toc]'); menu.open=true;
  menu.querySelector('a').click();
  check('collapsible heading menu uses JS jumps without changing the payload', location.hash===oldHash && root.querySelectorAll('[data-jekyll-toc]').length===1 && menu.querySelectorAll('a').length===2);
  check('Minima preserves rich Markdown', !!root.querySelector('.admonition') && !!root.querySelector('[data-copy-code]') && !!root.querySelector('.hljs-keyword') && !!root.querySelector('.zensical-tabs'));

  let serial=0;
  async function verifyFrame(html,initial=false) {
    const id='appearance-'+(++serial);
    const frame=document.createElement('iframe'); frame.sandbox='allow-scripts';
    if(initial) {
      const holder=document.createElement('div'); holder.innerHTML=repositoryFrame(html);
      html=holder.querySelector('iframe').srcdoc;
    }
    const nonce=html.match(/<script nonce="([^"]+)"/)?.[1];
    const probe=`addEventListener('DOMContentLoaded',()=>setTimeout(()=>{
      const root=document.querySelector('.frame-preview');
      const button=root.querySelector('[data-preview-appearance]');
      const before=root.dataset.lnkrAppearance;
      button.click();
      const scheme=root.dataset.lnkrScheme;
      const palette=document.body.getAttribute('data-md-color-scheme');
      const background=getComputedStyle(root).backgroundColor;
      const oldHash=location.hash;
      const jump=new MouseEvent('click',{bubbles:true,cancelable:true});
      root.querySelector('a[href^="#"]')?.dispatchEvent(jump);
      parent.postMessage({fixture:${JSON.stringify(id)},ok:!!button && before!==root.dataset.lnkrAppearance && jump.defaultPrevented && oldHash===location.hash && ${initial?'!window.authoredRan':'true'},before,scheme,palette,background},'*');
    },0));`;
    const done=new Promise(resolve=>{
      const timeout=setTimeout(()=>{check(id,false,'no response');resolve();},6000);
      const receive=event=>{
        if(event.source!==frame.contentWindow || event.data?.fixture!==id) return;
        clearTimeout(timeout); removeEventListener('message',receive);
        check(initial?'inert preview permits controls, not authored scripts':'expanded preview controls and JS jumps',event.data.ok);
        if(event.data.palette) check('built Zensical palette honors the selected mode',event.data.palette==='slate' && event.data.scheme==='dark' && event.data.background==='rgb(17, 34, 51)');
        resolve();
      };
      addEventListener('message',receive);
    });
    const script=`<script${nonce?` nonce="${nonce}"`:''}>${probe}<\/script>`;
    frame.srcdoc=html.replace('</body>',()=>script+'</body>');
    document.body.append(frame); await done;
  }
  await verifyFrame(`<!doctype html><html><head><style>${styles}</style><script>${previewAppearanceBootstrap()}${previewNavigationBootstrap()}<\/script></head><body><article class="preview frame-preview lnkr-theme-jekyll" data-lnkr-appearance="dark">${root.innerHTML}</article></body></html>`);
  const appURL=location.origin+'/docs/';
  const renderer=createRepositoryRenderer({appURL,styles:()=>styles,
    renderMarkdown:async source=>{const node=document.createElement('article'); await renderContent(node,source,'markdown');return node.innerHTML;},
    fetchImpl:async()=>new Response('<html><head><style>[data-md-color-scheme="slate"]{--md-default-bg-color:#123;--md-default-fg-color:#eee}[data-md-color-scheme="default"]{--md-default-bg-color:#fff;--md-default-fg-color:#111}</style></head><body><input data-md-color-media="(prefers-color-scheme)" data-md-color-scheme="default"><input data-md-color-media="(prefers-color-scheme: light)" data-md-color-scheme="default"><input data-md-color-media="(prefers-color-scheme: dark)" data-md-color-scheme="slate"></body></html>')});
  const themed=await renderer.prepare('style=zensical\nartifact=https://example.test/site/\n\n'+text,'markdown');
  // System is the artifact default; the next button click selects dark.
  await verifyFrame(themed.source.replace('</body>','<script>window.authoredRan=true;<\/script></body>'),true);
  await verifyFrame(themed.source);
  await renderContent(root,text,'markdown');
  root.classList.remove('lnkr-theme-jekyll');
  check('ordinary Zensical Markdown also exposes the control',root.querySelectorAll(':scope > .lnkr-preview-tools').length===1);
  root.querySelector('[data-preview-appearance]').click();
  check('light Markdown headings remain readable',getComputedStyle(root.querySelector('h1')).color==='rgb(26, 23, 20)');
  await renderContent(root,'const untouched = true;','javascript');
  check('plain code has no theme controls or modifications',!root.hasAttribute('data-lnkr-appearance') && root.textContent==='const untouched = true;');
}
