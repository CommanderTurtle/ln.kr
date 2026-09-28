# Vendored browser code

All viewer dependencies are pinned and served locally. Rendering a document
never depends on a CDN.

The 20 KB module lexer loads only for opt-in repository artifacts. It identifies
real JavaScript imports without confusing comments, strings or regular expressions
with executable imports. It adds no WASM fetch or npm/Node runtime to the site.
