# Vendored browser code

All viewer dependencies are pinned and served locally. Rendering a document
never depends on a CDN.

| Files | Version | Project | License copy |
|---|---:|---|---|
| `jsfuck.js` | 0.5.0 | [JSFuck](https://github.com/aemkei/jsfuck) | `JSFUCK-LICENSE.txt` |
| `marked.umd.js` | 18.0.11 | [Marked](https://github.com/markedjs/marked) | `licenses/marked-LICENSE` |
| `highlight.min.js`, `github-dark.min.css` | 11.12.0 | [highlight.js](https://github.com/highlightjs/highlight.js) | `licenses/highlightjs-LICENSE` |
| `mermaid.min.js` | 11.17.2 | [Mermaid](https://github.com/mermaid-js/mermaid) | `licenses/mermaid-LICENSE` |
| `pako.esm.min.js` | 2.1.0 | [pako](https://github.com/nodeca/pako) | `licenses/pako-LICENSE` |
| `es-module-lexer.js` | 1.7.0 (asm.js) | [ES Module Lexer](https://github.com/guybedford/es-module-lexer) | `licenses/es-module-lexer-LICENSE` |

Mermaid is loaded lazily only when a Markdown document contains a
`mermaid`-language fenced block.

The 20 KB module lexer loads only for opt-in repository artifacts. It identifies
real JavaScript imports without confusing comments, strings or regular expressions
with executable imports. It adds no WASM fetch or npm/Node runtime to the site.
