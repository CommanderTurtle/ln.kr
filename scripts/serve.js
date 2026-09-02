import { join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { handleResolverRequest } from "../worker/proxy.js";

const root = normalize(fileURLToPath(new URL("../docs/", import.meta.url)));
const rootPrefix = root.endsWith(sep) ? root : root + sep;
const fallback = Bun.file(join(root, "404.html"));
const port = Number(process.env.PORT || 4173);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch (request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/lr/")) {
      return handleResolverRequest(request);
    }
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad path", { status: 400 });
    }

    const relative = pathname.endsWith("/")
      ? `${pathname}index.html`
      : pathname;
    const candidate = normalize(join(root, relative));
    if (candidate.startsWith(rootPrefix)) {
      const file = Bun.file(candidate);
      if (await file.exists()) return new Response(file);
    }
    return new Response(fallback, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" }
    });
  }
});

console.log(`ln.kr dev server: http://${server.hostname}:${server.port}/`);
