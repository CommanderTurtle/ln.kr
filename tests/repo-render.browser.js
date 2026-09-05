// Run in a browser through the static fixture host (see README). No DOM shim,
// Node runtime, external model, proxy, package install or network fixture needed.
import { createRepositoryRenderer } from "../docs/repo-render.js";
import { decodeDocumentPayload } from "../docs/payload.js";
import { encodeLinkTarget } from "../docs/link-runtime.js";
import { expandSourceIncludes } from "../docs/source-includes.js";
import { compressTextV4 } from '../docs/text-compress.js';
import { outputAlphabetASCII } from '../docs/alphabets.js';
import { checkPreviewThemes } from './preview-theme.browser.js';

const root = "https://raw.githubusercontent.com/fixture/site/main/dist/";
const files = {
  "index.html": `<!doctype html><html><head><script>addEventListener('error',e=>parent.postMessage({fixture:'error',ok:false,detail:e.message},'*'));addEventListener('unhandledrejection',e=>parent.postMessage({fixture:'error',ok:false,detail:String(e.reason)},'*'));<\/script><link rel="stylesheet" href="/demo/style.css"></head><body>
    <h1>Artifact</h1><a href="./next.html">Next page</a>
    <script>document.body.dataset.classic='yes';<\/script>
    <script type="module" src="./main.js"><\/script><iframe src="./inner/index.html"></iframe>
    </body></html>`,
  "style.css": '@import "./colors.css"; h1::after{content:" imported style"}',
  "colors.css": "h1{color:rgb(1, 2, 3)}",
  "main.js": `import {value} from './dep.js';
    import config from './config.json' with {type:'json'};
    const lazy = await import('./lazy.js');
    document.querySelector('h1').textContent = value;
    if(document.readyState!=='complete') await new Promise(resolve=>addEventListener('load',resolve,{once:true}));
    parent.postMessage({fixture:'modules', ok:value==='ESM works' && config.ok && lazy.default===42 &&
      document.body.dataset.classic==='yes' && import.meta.url===${JSON.stringify(root + "main.js")} &&
      getComputedStyle(document.querySelector('h1')).color==='rgb(1, 2, 3)'},'*');`,
  "dep.js": "import './main.js'; export const value='ESM works';",
  "lazy.js": "export default 42;",
  "config.json": '{"ok":true}',
  "inner/index.html": '<html><head></head><body>Nested page<script>top.postMessage({fixture:"frame",ok:true},"*")<\/script></body></html>',
  "next.html": "<html><body>Next</body></html>",
  "parts/body.html": '<html><head><style>h2{background-image:url("./bg.webp")}</style></head><body><h2>Separate body</h2><img src="./photo.webp"><script type="module">import "./body.js";<\/script></body></html>',
  "parts/body.js": "export const body=true;"
};
files["skin/index.html"] = '<html><head><link rel="stylesheet" href="./theme.css"></head><body data-md-color-scheme="slate"><h1>Never import this homepage</h1><script src="./never-run.js"><\/script></body></html>';
files["skin/theme.css"] = ':root{--md-default-bg-color:#222}';
files["code/start.js"] = 'import "./extra.js"; export const x=1;';
files["code/extra.js"] = 'export const y=2;';
const results = document.querySelector("#results");
let failed = false;
function check (name, pass, detail = "") {
  const node = document.createElement("li");
  node.textContent = `${pass ? "PASS" : "FAIL"} ${name} ${detail}`;
  results.append(node);
  if (!pass) failed = true;
}
const hits = new Map();
const appURL = location.origin + "/docs/";
if(new URL(location.href).searchParams.has('compressed')) {
  for(const path of ['index.html','style.css','colors.css','main.js','dep.js','lazy.js','inner/index.html']) {
    files[path]=appURL+'#'+compressTextV4(files[path],outputAlphabetASCII,'text').payload;
  }
}
const pointer = file => appURL + "#sh:" + encodeLinkTarget(root + file).payload;
const fetchImpl = async url=>{
    hits.set(url,(hits.get(url)||0)+1);
    const source = files[url.slice(root.length)];
    return new Response(source ?? "Not found", {status:source === undefined ? 404 : 200, headers:{"content-type":"text/plain"}});
};
const renderer = createRepositoryRenderer({appURL, fetchImpl,
  renderMarkdown:async text=>`<h2>${text}</h2>`,
  expandModules:async (text, kind)=>(await expandSourceIncludes(text,{appURL,fetchImpl,documentKind:kind,resourceURLForTarget:x=>x,
    transformSource:async(source,url)=>(await renderer.expandStoredSource(source,url)).source})).text});
try {
  const empty = await renderer.prepare(`style=node\nrepo=${root}\nbody=${root}`,"html");
  check("directory headers never import index/body",hits.size === 0 && !empty.source.includes("Artifact"));
  const result = await renderer.prepare(`style=node\nartifact=${root}\nbase=/demo/\n\n${pointer("index.html")}`, "html");
  const doc = new DOMParser().parseFromString(result.source,"text/html");
  const next = new URL(doc.querySelector("a").href);
  check("internal HTML navigation stays fragment-routed", next.origin === location.origin &&
    decodeDocumentPayload(next.hash.slice(3)).decoded.text.includes(pointer("next.html")));
  check("fetch cache", [...hits.values()].every(value=>value===1));
  const messages = new Set();
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox","allow-scripts");
  const done = new Promise(resolve=>{
    const timeout = setTimeout(()=>{check("browser execution completed",false, [...messages].join(","));resolve();},8000);
    addEventListener("message",event=>{
      if (!['modules','frame','error','policy'].includes(event.data?.fixture) || messages.has(event.data.fixture)) return;
      messages.add(event.data.fixture);
      check(`native browser ${event.data.fixture}`, event.data.ok, event.data.detail || "");
      if(messages.has('modules') && messages.has('frame')){clearTimeout(timeout);resolve();}
    });
  });
  const policy = new URL(location.href).searchParams.has('offline') ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline' data: blob:; connect-src data:; frame-src data: blob: about:; style-src-elem 'unsafe-inline' data: blob:">` : "";
  frame.srcdoc = result.source.replace('<head>', `<head>${policy}<script>
    addEventListener('error',e=>parent.postMessage({fixture:'error',ok:false,detail:e.message || e.target.outerHTML},'*'),true);
    addEventListener('unhandledrejection',e=>parent.postMessage({fixture:'error',ok:false,detail:String(e.reason)},'*'));
    addEventListener('securitypolicyviolation',e=>parent.postMessage({fixture:'policy',ok:false,detail:e.violatedDirective+': '+e.blockedURI},'*'));
    <\/script>`);
  document.body.append(frame);
  const separate = await renderer.prepare(`style=node\nartifact=${root}\nbody=${root}parts/\n\n${pointer("parts/body.html")}`,"html");
  const body = new DOMParser().parseFromString(separate.source,"text/html");
  check("body keeps independent relative assets",body.querySelector("img").src === root + "parts/photo.webp");
  check("body stylesheet retains own base",separate.source.includes(root + "parts/bg.webp"));
  check("body module retains own base",separate.source.includes(root + "parts/body.js"));
  const theme = await renderer.prepare(`style=zensical\nartifact=${root}skin/\n\nOwn document`,"markdown");
  check("artifact copies theme, never homepage or script", theme.source.includes('--md-default-bg-color:#222') &&
    theme.source.includes('data-md-color-scheme="slate"') && !theme.source.includes('Never import') &&
    !theme.source.includes('never-run') && !hits.has(root+'skin/never-run.js'));
  const rooted = await renderer.prepare(`style=node\nbody=${root}parts/\ncss=${root}skin/\nscript=${root}code/\n\n<!doctype html><html><head><link rel="stylesheet" href="./theme.css"></head><body><img src="./photo.webp"><script type="module" src="./start.js"><\/script></body></html>`,"html");
  check("body/css/script directory bases stay independent", rooted.source.includes(root+'parts/photo.webp') &&
    rooted.source.includes(root+'code/extra.js') && hits.has(root+'skin/theme.css') && !hits.has(root+'code/index.html'));
  await done;
  await checkPreviewThemes(check);
} catch(error) { check("compilation",false,error.stack); }
document.querySelector("#status").textContent=failed ? "FAILED" : "ALL BROWSER CHECKS PASSED";
