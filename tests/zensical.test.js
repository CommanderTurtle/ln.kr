import { describe, expect, test } from "bun:test";
import {
  inspectZensicalMarkdown,
  parseZensicalAttributes,
  zensicalExtensions,
  zensicalInteractionBootstrap
} from "../docs/zensical.js";

describe("Zensical-compatible Markdown", () => {
  test("recognizes the configured block extensions without touching ordinary source", () => {
    const inspected = inspectZensicalMarkdown(`
*[HTML]: Hyper Text Markup Language
[^proof]: Exact footnote.

!!! warning "Careful"
    Nested **Markdown**.

???+ note "Open"
    Initially visible.

=== "Python"
    \`\`\` py title="app.py" linenums="4" hl_lines="4 6-7"
    print("hello")
    \`\`\`

=== "JavaScript"
    \`\`\` js
    console.log("hello")
    \`\`\`

Term

:   Definition
`);

    expect(inspected.abbreviations.HTML).toBe("Hyper Text Markup Language");
    expect(inspected.footnotes.proof).toBe("Exact footnote.");
    expect(inspected.blocks.map(block => block.type)).toEqual([
      "admonition", "admonition", "tabs", "definition"
    ]);
    expect(inspected.blocks[1]).toMatchObject({ collapsible: true, open: true });
    expect(inspected.blocks[2].tabs).toHaveLength(2);
    expect(inspected.markdown).toContain("zensical-block-slot");
  });

  test("keeps complete highlight metadata for the DOM decoration pass", () => {
    const inspected = inspectZensicalMarkdown(
      '``` python title="demo.py" linenums="10" hl_lines="10 12-13"\npass\n```'
    );
    expect(inspected.code[0]).toMatchObject({
      language: "python",
      title: "demo.py",
      linenums: "10",
      highlights: "10 12-13"
    });
  });

  test("parses buttons, IDs, dimensions, and data attributes", () => {
    expect(parseZensicalAttributes('.md-button .md-button--primary #launch width="320" data-gallery=paper'))
      .toEqual({
        attributes: [["width", "320"], ["data-gallery", "paper"]],
        classes: ["md-button", "md-button--primary"],
        id: "launch"
      });
  });

  test("ships tab and lightbox behavior into expanded document viewers", () => {
    const bootstrap = zensicalInteractionBootstrap();
    expect(bootstrap).toContain("activateZensicalTab");
    expect(bootstrap).toContain("dataset.zensicalLightbox");
    expect(bootstrap).toContain("showModal");
  });
});

test("the viewer contains all 24 extensions enabled by orc/docs/zensical.fs", async () => {
  expect(zensicalExtensions).toEqual([
    "abbr", "admonition", "attr_list", "def_list", "footnotes", "md_in_html",
    "pymdownx.caret", "pymdownx.details", "pymdownx.snippets", "pymdownx.inlinehilite",
    "pymdownx.smartsymbols", "pymdownx.mark", "pymdownx.tilde", "pymdownx.keys",
    "pymdownx.highlight", "pymdownx.superfences", "pymdownx.tabbed", "pymdownx.emoji",
    "pymdownx.arithmatex", "pymdownx.magiclink", "pymdownx.tasklist", "pymdownx.betterem",
    "zensical.extensions.glightbox", "toc"
  ]);
});
