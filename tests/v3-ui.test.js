import { expect, test } from "bun:test";

test("composer exposes one explicit three-way codec switch", async () => {
  const html = await Bun.file(new URL("../docs/index.html", import.meta.url)).text();
  const choices = [...html.matchAll(
    /<input type="radio" name="codec-version" id="codec-v[123]" value="(v[123])"/g
  )].map(match => match[1]);

  expect(choices).toEqual(["v1", "v2", "v3"]);
  expect(html.match(/name="codec-version"[^>]*checked/g)).toHaveLength(1);
});
