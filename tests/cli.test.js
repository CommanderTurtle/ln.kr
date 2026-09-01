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
