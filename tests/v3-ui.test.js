import { expect, test } from "bun:test";

test("composer exposes a three-way native dial and separate v4 override", async () => {
  const html = await Bun.file(new URL("../docs/index.html", import.meta.url)).text();
  const main = await Bun.file(new URL("../docs/main.js", import.meta.url)).text();
  const styles = await Bun.file(new URL("../docs/styles.css", import.meta.url)).text();
  const choices = [...html.matchAll(
    /<input type="radio" name="codec-version" id="codec-v[1-3]" value="(v[1-3])"/g
  )].map(match => match[1]);

  expect(choices).toEqual(["v1", "v2", "v3"]);
  expect(html.match(/name="codec-version"[^>]*checked/g)).toHaveLength(1);
  expect(html).not.toContain('name="codec-version" id="codec-v4"');
  expect(html).toContain('type="checkbox" id="setting-deflate"');
  expect(html).toContain('class="codec-dial-thumb"');
  expect(html).toContain('id="deflate-tooltip" class="control-tooltip" role="tooltip"');
  expect(html).toContain("Sometimes traditional DEFLATE works better when token entropy is too high.");
  expect(main).toContain('codec: document.querySelector("#codec-control")');
  expect(main).toContain('deflate: document.querySelector("#setting-deflate")');
  expect(main).toContain("if (elements.deflate.checked) return compressTextV4;");
  expect(main).toContain("elements.codec.disabled = elements.deflate.checked;");
  expect(main).toContain('elements.codec.addEventListener("change"');
  expect(main).toContain('elements.deflate.addEventListener("change"');
  expect(main).not.toContain("elements.structural");
  expect(styles).toContain("#codec-v2:checked ~ .codec-dial-thumb");
  expect(styles).toContain("#codec-v3:checked ~ .codec-dial-thumb");
  expect(styles).toContain(".codec-control:disabled");
  expect(styles).toContain(".deflate-control:hover .control-tooltip");
});
