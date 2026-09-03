import { expect, test } from "bun:test";

test("composer exposes one explicit four-way codec switch", async () => {
  const html = await Bun.file(new URL("../docs/index.html", import.meta.url)).text();
  const main = await Bun.file(new URL("../docs/main.js", import.meta.url)).text();
  const choices = [...html.matchAll(
    /<input type="radio" name="codec-version" id="codec-v[1-4]" value="(v[1-4])"/g
  )].map(match => match[1]);

  expect(choices).toEqual(["v1", "v2", "v3", "v4"]);
  expect(html.match(/name="codec-version"[^>]*checked/g)).toHaveLength(1);
  expect(html).toContain("Sometimes, opting for traditional DEFLATE works when token entropy is too high.");
  expect(main).toContain('codec: document.querySelector(".codec-switch")');
  expect(main).toContain('elements.codec.addEventListener("change"');
  expect(main).not.toContain("elements.structural");
});
