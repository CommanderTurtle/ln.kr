import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("standalone CLI preserves multiline source", async () => {
  const source = "const answer = 42;\r\n  const spaced = '🐢';\n";
  const encodedProcess = Bun.spawn([
    process.execPath,
    "standalone.js",
    "encode",
    source,
    "ascii",
    "javascript"
  ], { cwd: projectRoot });
  const link = (await new Response(encodedProcess.stdout).text()).trim();
  expect(await encodedProcess.exited).toBe(0);

  const decodedProcess = Bun.spawn([
    process.execPath,
    "standalone.js",
    "decode",
    link
  ], { cwd: projectRoot });
  const decoded = await new Response(decodedProcess.stdout).text();
  expect(await decodedProcess.exited).toBe(0);
  expect(decoded).toBe(source);
});

test("standalone CLI decodes Markdown and HTML live-view URLs", async () => {
  for (const [kind, prefix, source] of [
    ["markdown", "m:", "# Heading\n\n<details><summary>More</summary>Body</details>\n"],
    ["html", "h:", "<!doctype html><title>Example</title><p>Body</p>"]
  ]) {
    const encodedProcess = Bun.spawn([
      process.execPath,
      "standalone.js",
      "encode",
      source,
      "ascii",
      kind
    ], { cwd: projectRoot });
    const ordinaryLink = (await new Response(encodedProcess.stdout).text()).trim();
    expect(await encodedProcess.exited).toBe(0);
    const liveLink = ordinaryLink.replace("#", `#${prefix}`);

    const decodedProcess = Bun.spawn([
      process.execPath,
      "standalone.js",
      "decode",
      liveLink
    ], { cwd: projectRoot });
    expect(await new Response(decodedProcess.stdout).text()).toBe(source);
    expect(await decodedProcess.exited).toBe(0);
  }
});

test("standalone CLI exposes the v3 document dictionary", async () => {
  const source = Array.from(
    { length: 24 },
    (_, index) => `dependencies ${index}: reusable-token-${index % 4}`
  ).join("\n");
  const encodedProcess = Bun.spawn([
    process.execPath,
    "standalone.js",
    "encode",
    source,
    "ascii",
    "text",
    "v3"
  ], { cwd: projectRoot });
  const link = (await new Response(encodedProcess.stdout).text()).trim();
  expect(await encodedProcess.exited).toBe(0);

  const decodedProcess = Bun.spawn([
    process.execPath,
    "standalone.js",
    "decode",
    link
  ], { cwd: projectRoot });
  expect(await new Response(decodedProcess.stdout).text()).toBe(source);
  expect(await decodedProcess.exited).toBe(0);
});
