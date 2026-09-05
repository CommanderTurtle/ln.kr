import { expect, test } from "bun:test";
import { parseRepositoryHeader, anchorRepositoryHeader, repositoryDirectory, repositoryAssetURL, repositoryDocumentKind, createRepositoryRenderer } from "../docs/repo-render.js";
import { encodeLinkTarget } from "../docs/link-runtime.js";
import { compressTextV1, compressTextV2, compressTextV3, compressTextV4 } from "../docs/text-compress.js";
import { outputAlphabetASCII } from "../docs/alphabets.js";
import { expandSourceIncludes } from "../docs/source-includes.js";

test("only an explicit first line enables a repository recipe", () => {
  for (const text of ["# Hello\nstyle=node", "```ini\nstyle=node\n```", "style=unknown\ntext", "const style=node;", "\nstyle=node"]) {
    expect(parseRepositoryHeader(text)).toBeNull();
    expect(repositoryDocumentKind(text, "javascript")).toBe("javascript");
  }
  expect(parseRepositoryHeader("\uFEFFtheme=jekyll\r\ncss=one\r\ncss=two\r\n\r\n# Hello\r\n")).toEqual({theme:"jekyll", css:["one","two"], script:[], source:"# Hello\r\n"});
  expect(parseRepositoryHeader("style=zensical\n# Body").source).toBe("# Body");
  expect(() => parseRepositoryHeader("style=node\nrepo=a\nrepo=b")).toThrow("Duplicate");
  expect(repositoryDocumentKind("style=jekyll\n# Heading")).toBe("markdown");
  expect(repositoryDocumentKind("style=node\nartifact=https://example.test/dist")).toBe("html");
});

test("repository directory conversion is separate from existing file routes", () => {
  expect(repositoryDirectory("https://github.com/alice/demo/tree/main/dist")).toBe("https://raw.githubusercontent.com/alice/demo/main/dist/");
  expect(repositoryDirectory("https://github.com/alice/demo/tree/refs/heads/main/a%20b/")).toBe("https://raw.githubusercontent.com/alice/demo/refs/heads/main/a%20b/");
  expect(repositoryDirectory("https://github.com/alice/demo")).toBe("https://raw.githubusercontent.com/alice/demo/HEAD/");
  expect(repositoryDirectory("https://huggingface.co/datasets/a/b/tree/main/site")).toBe("https://huggingface.co/datasets/a/b/resolve/main/site/");
  expect(repositoryDirectory("https://huggingface.co/a/b/tree/main/site")).toBe("https://huggingface.co/a/b/resolve/main/site/");
  expect(() => repositoryDirectory("https://github.com/a/b/blob/main/index.html")).toThrow("directory");
});

test("a fetched recipe retains its directory after expansion into an editable link", () => {
  const base = "https://raw.githubusercontent.com/a/b/main/docs/recipe.txt";
  expect(anchorRepositoryHeader("style=zensical\r\n\r\n# Content\r\n", base)).toBe("style=zensical\r\nrepo=https://raw.githubusercontent.com/a/b/main/docs/\r\n\r\n# Content\r\n");
  expect(anchorRepositoryHeader("style=jekyll\r\nrepo=../\r\n# Content", base)).toBe("style=jekyll\r\nrepo=https://raw.githubusercontent.com/a/b/main/\r\n# Content");
  expect(anchorRepositoryHeader("ordinary text", base)).toBe("ordinary text");
});

test("relative and root-relative assets use the declared artifact root/mount", () => {
  const root = "https://raw.githubusercontent.com/a/b/main/dist/";
  expect(repositoryAssetURL("../font.woff2", root + "assets/app.css", root)).toBe(root + "font.woff2");
  expect(repositoryAssetURL("/assets/app.js", root + "index.html", root)).toBe(root + "assets/app.js");
  expect(repositoryAssetURL("/radio/assets/app.js", root + "index.html", root, "/radio/")).toBe(root + "assets/app.js");
  expect(repositoryAssetURL("#heading", root, root)).toBe("#heading");
  expect(repositoryAssetURL("data:image/png;base64,abcd", root, root)).toBe("data:image/png;base64,abcd");
});

test("default and theme-only documents perform zero fetches", async () => {
  const renderer = createRepositoryRenderer({appURL:"https://a.shel.sh/", fetchImpl:()=>{throw new Error("Unexpected fetch");}});
  expect(await renderer.prepare("# Unchanged", "markdown")).toBeNull();
  expect(await renderer.prepare("style=zensical\n\n# Same", "markdown")).toEqual({source:"# Same", kind:"markdown", theme:"zensical"});
  expect(await renderer.prepare("style=jekyll\n# Light", "markdown")).toEqual({source:"# Light", kind:"markdown", theme:"jekyll"});
  expect(renderer.files).toBe(0);
});

test("header pointers reuse compressed documents, source suffixes, raw fetch cache and superlinks", async () => {
  const target = "https://raw.example.test/file.css";
  const pointer = mode => `https://a.shel.sh/#${mode}:${encodeLinkTarget(target).payload}`;
  let calls = 0;
  const renderer = createRepositoryRenderer({appURL:"https://a.shel.sh/", fetchImpl:async () => { calls++; return new Response("a\r\nb\r\nc\r\n"); }});
  expect((await renderer.read(pointer("s") + "::~1:-1")).source).toBe("b\r\n");
  expect((await renderer.read(pointer("lr"))).source).toBe("a\r\nb\r\nc\r\n");
  const encoded = compressTextV1("h1{color:red}", outputAlphabetASCII, "text");
  expect((await renderer.read(`https://a.shel.sh/#${encoded.payload}`)).source).toBe("h1{color:red}");
  expect(calls).toBe(1);
});

test("repository reads fail explicitly for missing files, cycles and budgets", async () => {
  const appURL = "https://a.shel.sh/";
  const missing = createRepositoryRenderer({appURL,fetchImpl:async()=>new Response("missing",{status:404})});
  await expect(missing.read("https://example.test/no.css")).rejects.toThrow("not found");
  const limited = createRepositoryRenderer({appURL,limits:{bytes:3},fetchImpl:async()=>new Response("1234")});
  await expect(limited.read("https://example.test/file.css")).rejects.toThrow("3 text bytes");
  const loop = appURL + "#ss:" + encodeLinkTarget("https://example.test/loop").payload;
  const cyclic = createRepositoryRenderer({appURL,limits:{depth:2},fetchImpl:async()=>new Response(loop)});
  await expect(cyclic.read(loop)).rejects.toThrow("nesting limit");
});

test("source and super-source expansion can consume a header without altering defaults", async () => {
  const target = "https://raw.example.test/recipe.txt";
  const recipe = "style=zensical\n# Modular";
  const options = {appURL:"https://a.shel.sh/", resourceURLForTarget:x=>x,
    fetchImpl:async () => new Response(recipe),
    transformSource:async text => parseRepositoryHeader(text)?.source ?? null};
  for (const mode of ["s", "hs", "ss"]) {
    expect((await expandSourceIncludes(`https://a.shel.sh/#${mode}:${encodeLinkTarget(target).payload}`, options)).text).toBe("# Modular");
  }
});

test('compressed artifact files retain their repository-relative base in all codec versions', async () => {
  const appURL = 'https://a.shel.sh/';
  const base = 'https://raw.githubusercontent.com/a/b/main/dist/assets/site.js';
  const text = "import './dependency.js';\r\n// 🐢\r\n";
  for (const encode of [compressTextV1,compressTextV2,compressTextV3,compressTextV4]) {
    const file = appURL + '#' + encode(text,outputAlphabetASCII,'javascript').payload;
    const renderer = createRepositoryRenderer({appURL,fetchImpl:async()=>new Response(file)});
    expect(await renderer.read(base)).toMatchObject({source:text,url:base,kind:'javascript'});
    const short = appURL + '#s:' + encodeLinkTarget(base).payload;
    expect((await renderer.read(short+'::~1:1')).source).toBe('// 🐢\r\n');
    expect(renderer.files).toBe(1);
  }
});

test('only standalone bare links denote compressed file contents', async () => {
  const renderer = createRepositoryRenderer({appURL:'https://a.shel.sh/',fetchImpl:()=>{throw Error('Unexpected fetch');}});
  for(const source of ['<a href="https://a.shel.sh/#abc">Visit</a>','See https://a.shel.sh/#abc','https://example.test/file.js']) {
    expect(await renderer.expandStoredSource(source,'https://raw.example.test/index.html')).toEqual({source});
  }
});
