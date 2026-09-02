import { describe, expect, test } from "bun:test";
import { encodeDirectLinkTarget } from "../docs/link-runtime.js";
import { handleResolverRequest } from "../worker/proxy.js";

function requestFor (target, options = {}) {
  const payload = encodeDirectLinkTarget(target).payload;
  return new Request(`https://lr.a.shel.sh/lr/${payload}`, options);
}

describe("stateless direct resolver", () => {
  test("streams the exact upstream bytes, status, and media type", async () => {
    const expected = Uint8Array.from([0, 255, 17, 92, 44, 0, 201]);
    const response = await handleResolverRequest(
      requestFor("https://images.example/source.webp"),
      {
        fetchImpl: async () => new Response(expected, {
          status: 206,
          headers: {
            "accept-ranges": "bytes",
            "content-range": "bytes 0-6/7",
            "content-type": "image/webp",
            etag: '"exact"'
          }
        })
      }
    );

    expect(response.status).toBe(206);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("content-range")).toBe("bytes 0-6/7");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
  });

  test("forwards range validators but no authorization or cookies", async () => {
    let forwarded;
    const response = await handleResolverRequest(
      requestFor("https://media.example/video.webm", {
        headers: {
          authorization: "Bearer private",
          cookie: "session=private",
          range: "bytes=10-20",
          "if-none-match": '"old"'
        }
      }),
      {
        fetchImpl: async (_target, options) => {
          forwarded = options.headers;
          return new Response("range", { headers: { "content-type": "video/webm" } });
        }
      }
    );

    expect(await response.text()).toBe("range");
    expect(forwarded.get("range")).toBe("bytes=10-20");
    expect(forwarded.get("if-none-match")).toBe('"old"');
    expect(forwarded.has("authorization")).toBe(false);
    expect(forwarded.has("cookie")).toBe(false);
  });

  test("does not advertise an origin encoding after fetch decoded the body", async () => {
    const response = await handleResolverRequest(
      requestFor("https://text.example/document.html"),
      {
        fetchImpl: async () => new Response("decoded source", {
          headers: {
            "content-encoding": "gzip",
            "content-length": "30",
            "content-type": "text/html"
          }
        })
      }
    );

    expect(await response.text()).toBe("decoded source");
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(response.headers.has("content-length")).toBe(false);
  });

  test("revalidates every redirect destination", async () => {
    let calls = 0;
    const response = await handleResolverRequest(
      requestFor("https://public.example/start"),
      {
        fetchImpl: async () => {
          calls ++;
          return new Response(null, {
            status: 302,
            headers: { location: "http://127.0.0.1/private" }
          });
        }
      }
    );

    expect(response.status).toBe(502);
    expect(await response.text()).toContain("Private and local network targets");
    expect(calls).toBe(1);
  });

  test("passes cache validation responses through without treating them as redirects", async () => {
    const response = await handleResolverRequest(
      requestFor("https://assets.example/file.png", { headers: { "if-none-match": '"same"' } }),
      { fetchImpl: async () => new Response(null, { status: 304, headers: { etag: '"same"' } }) }
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"same"');
  });

  test("blocks private targets before fetch", async () => {
    let fetched = false;
    const response = await handleResolverRequest(
      requestFor("http://192.168.1.20/image.png"),
      { fetchImpl: async () => { fetched = true; return new Response(); } }
    );
    expect(response.status).toBe(400);
    expect(fetched).toBe(false);

    const trailingDot = await handleResolverRequest(
      requestFor("http://localhost./image.png"),
      { fetchImpl: async () => { fetched = true; return new Response(); } }
    );
    expect(trailingDot.status).toBe(400);
    expect(fetched).toBe(false);

    const recursive = await handleResolverRequest(
      requestFor("https://lr.a.shel.sh/lr/anything"),
      { fetchImpl: async () => { fetched = true; return new Response(); } }
    );
    expect(recursive.status).toBe(400);
    expect(fetched).toBe(false);
  });

  test("supports HEAD and rejects mutating methods", async () => {
    const head = await handleResolverRequest(
      requestFor("https://assets.example/file.png", { method: "HEAD" }),
      { fetchImpl: async () => new Response("ignored", { headers: { "content-type": "image/png" } }) }
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");

    const post = await handleResolverRequest(
      requestFor("https://assets.example/file.png", { method: "POST" })
    );
    expect(post.status).toBe(405);
  });
});
