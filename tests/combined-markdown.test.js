import { expect, test } from "bun:test";
import { combinedFileSection, parseCombinedMarkdown } from "../docs/combined-markdown.js";
import { inspectZensicalMarkdown } from "../docs/zensical.js";
import { makeShareURL } from "../docs/make-share.js";
import { decodeMakeFile } from "../docs/make-resource.js";

const vendor = { exports: {} };
new Function("exports", "module", await Bun.file(new URL("../docs/vendor/marked.umd.js", import.meta.url)).text())(vendor.exports, vendor);

test("bundled renderer keeps shorter nested fences inside the longer outer fence", () => {
  const source = "`````markdown\n# Inner\n````md\n```js\nx()\n```\n````\n`````\n\n# Outside";
  const prepared = inspectZensicalMarkdown(source);
  expect(prepared.code).toHaveLength(1);
  const html = vendor.exports.parse(prepared.markdown);
  expect(html).toContain("# Inner\n````md\n```js\nx()\n```\n````");
  expect(html).toContain("<h1>Outside</h1>");
  expect(html.match(/<pre>/g)).toHaveLength(1);
});

test("combined files preserve exact text and validate all boundaries", () => {
  const body = "# Inner\n\n```md\n## File: ./fake.txt\n```\n\n\n\nend";
  const source = combinedFileSection("docs/readme.md", body, "markdown");
  expect(parseCombinedMarkdown(source).entries).toEqual([{ path: "docs/readme.md", language: "markdown", text: body }]);
  expect(parseCombinedMarkdown(source + "\nunmatched text")).toBeNull();
  expect(parseCombinedMarkdown(combinedFileSection("../escape.txt", "x"))).toBeNull();
});

test("Hoist to Make names the preserved bundle combined.md", async () => {
  const source = combinedFileSection("a.txt", "hello");
  const file = await decodeMakeFile(new URL(makeShareURL(source, "markdown")));
  expect(file.name).toBe("combined.md");
  expect(file.text).toBe(source);
});
