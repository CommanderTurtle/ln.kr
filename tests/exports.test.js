import { expect, test } from "bun:test";

test("vendored JSFuck emits only its six-character alphabet and executes", async () => {
  const source = await Bun.file(new URL("../docs/vendor/jsfuck.js", import.meta.url)).text();
  const browserWindow = {};
  new Function("window", "exports", source)(browserWindow, undefined);
  const encoded = browserWindow.JSFuck.encode("return 42", true);
  expect(new Set(encoded)).toEqual(new Set(["[", "]", "(", ")", "!", "+"]));
  expect((0, eval)(encoded)).toBe(42);
});
