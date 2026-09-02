import { describe, expect, test } from "bun:test";
import {
  executablePrefixForKind,
  splitExecutableFragment
} from "../docs/viewer-runtime.js";

describe("viewer URL modes", () => {
  test("keeps the established JavaScript marker and adds explicit document viewers", () => {
    expect(executablePrefixForKind("javascript")).toBe("r:");
    expect(executablePrefixForKind("markdown")).toBe("m:");
    expect(executablePrefixForKind("html")).toBe("h:");
    expect(executablePrefixForKind("text")).toBe("");
  });

  test("splits only a recognized leading marker", () => {
    expect(splitExecutableFragment("r:payload")).toEqual({ executableKind: "javascript", payload: "payload" });
    expect(splitExecutableFragment("m:payload")).toEqual({ executableKind: "markdown", payload: "payload" });
    expect(splitExecutableFragment("h:payload")).toEqual({ executableKind: "html", payload: "payload" });
    expect(splitExecutableFragment("q:payload")).toEqual({ executableKind: "", payload: "q:payload" });
    expect(splitExecutableFragment("payload:r:value")).toEqual({ executableKind: "", payload: "payload:r:value" });
  });
});

test("all rich renderer assets and their license copies are vendored", async () => {
  const root = new URL("../docs/vendor/", import.meta.url);
  for (const path of [
    "marked.umd.js",
    "highlight.min.js",
    "github-dark.min.css",
    "mermaid.min.js",
    "licenses/marked-LICENSE",
    "licenses/highlightjs-LICENSE",
    "licenses/mermaid-LICENSE"
  ]) {
    expect(await Bun.file(new URL(path, root)).exists()).toBe(true);
  }
});
