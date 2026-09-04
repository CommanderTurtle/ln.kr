// Static files only. The fixture runs the real renderer in the browser;
// its mock fetch supplies repository fixtures, never this host.
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../",import.meta.url));
const index = await Bun.file(new URL("../docs/index.html",import.meta.url)).text();
const csp = index.match(/<meta http-equiv="Content-Security-Policy"[^>]+>/)[0];
const server = Bun.serve({hostname:"127.0.0.1",port:Number(process.env.PORT || 4174), async fetch(request){
  const url = new URL(request.url);
  if(url.pathname==="/") return new Response(`<!doctype html><html><head>${csp}<title>Repository browser checks</title></head><body><h1 id="status">Running browser checks</h1><ul id="results"></ul><script type="module" src="/tests/repo-render.browser.js"></script></body></html>`,{headers:{"content-type":"text/html"}});
  const path = resolve(root, "."+decodeURIComponent(url.pathname));
  if(!path.startsWith(root.endsWith(sep)?root:root+sep))return new Response("Forbidden",{status:403});
  const file=Bun.file(path);
  return await file.exists()?new Response(file):new Response("Not found",{status:404});
}});
console.log(`Repository browser checks: http://${server.hostname}:${server.port}/`);
