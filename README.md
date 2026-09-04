# ln.kr

Lossless text and code carried entirely in a link.

ln.kr is a static, browser-only descendant of
[p2r3/ha.mr](https://github.com/p2r3/ha.mr). ha.mr’s positive-BigInt
bitstream and ASCII, QR, and emoji alphabets remain the foundation. ln.kr adds
versioned text codecs above that engine. v1-v3 are its native text grammars;
v4 is an explicit traditional-DEFLATE alternative. None uses a server-side
paste ID or replaces ha.mr's final alphabet transport with Base64URL.

Open the site, paste source, and share the resulting fragment URL. The source
is decoded by the recipient’s browser. There is no paste database or resolver
service; Link mode also remains entirely fragment-routed in the browser.

## What it preserves

- Exact UTF-8 source, including indentation, repeated spaces, tabs, blank
  lines, LF/CRLF bytes already present in the input, combining marks, and emoji.
- Markdown, JavaScript, HTML, or plain-text display intent.
- ha.mr’s ASCII, QR-alphanumeric, and emoji output modes.
- Original ha.mr URL-codec behavior. Frozen upstream vectors guard its outputs
  byte-for-byte in the test suite.

The frozen v1 grammar combines a ranked code/Markdown dictionary with
prior-output references. It is the default and does no structural discovery.
The visible three-position encoder dial keeps that frozen v1 path and exposes
**Structural v2** and **Dictionary v3**. A separate **DEFLATE v4** high-entropy
override disables the dial while selected. v2 runs one deterministic
four-phase pipeline:

1. map HTML body/style/script regions, Markdown and its fenced languages or
   authored HTML, and sustained CSS/JavaScript/JSON-looking sectors;
2. map repeated words, identifiers, punctuation/whitespace phrases, and the
   frozen technical dictionary to short document-local symbols;
3. map whole brace/element/paragraph sectors to exact templates or prior-byte
   regions plus sparse residuals; and
4. map remaining repeated line families to one static template plus their
   exact variable slots.

Local word, phrase, line, and sector definitions are carried inside the URL
and are themselves compressed with v1's fixed records. Reconstructed blocks
can become references for later blocks, and recurring residual layouts reuse
one shape definition. Format recognition only supplies byte boundaries; it
never rewrites, normalizes, or semantically evaluates the source.

The choice is explicit: each selection runs only its own complete pipeline.
There is no whole-document trial, fallback, or automatic winner selection.
The fixed v1 record costs are reused as the local price scale for references,
and unreferenced definitions are discarded deterministically. All four formats
decode on the same page. The byte count, UTF-8 validation, trailing-data check,
and CRC-32 must all agree before a document is rendered.

Exact repeated blocks are already v1's strongest case: one prior-output record
can represent every later copy regardless of how many times it was pasted. v2
leaves that record intact rather than replacing it with a structural template.
With no v2-only records, its two empty grammar headers can round to one extra
URL symbol. v2's incremental gain appears on repeated families whose fields
actually differ; definitions that cease to repay themselves after exact-copy
selection are removed.

Dictionary v3 preserves those structural templates, sparse residuals, static
dictionary records, and prior-output copies. It discovers structure first,
then builds a broader document vocabulary from exact words, identifiers,
punctuation atoms, and compatible-zone phrases. A costed vocabulary may hold
up to 7,225 entries. Its canonical frequency-shaped codes are carried in the
payload, are at most 13 bits each, and favor the entries actually referenced
most often. Entries still have to repay their definition and codebook bytes;
one-use words are not added merely to make the entry count larger.

v3 is a separate wire version and never changes a v1 or v2 link. Like v2, it
does not run another whole-document encoder and silently choose the smaller
result. All four versions decode on the same static page.

### When v4 wins: token entropy versus byte recurrence

v3's document dictionary is self-describing. Every retained word, identifier,
phrase, and template must be written into the URL before a reference can save
anything. With `U` similarly frequent entries, an identifier needs roughly

```text
ceil(log2(U)) bits
```

before framing. At 4,000 unique entries that floor is 12 bits; near v3's 7,225
entry cap it is 13 bits. A v3 lexeme also carries its four-bit `1110` record
prefix, so those references occupy 16–17 body bits before transport packing.
Canonical Huffman codes shorten hot entries, but a large, flat long tail still
approaches the lexical entropy

```text
H(T) = -sum(p_i * log2(p_i))
```

and the payload must additionally carry exact dictionary bytes, lengths, code
lengths, and structural definitions. A word such as `dependencies` repeated
30 times can repay its own entry while the document as a whole still loses the
dictionary-vs-literal contest once thousands of other tokens are nearly unique.

v4 takes the other side of that trade. It applies pako's level-9, zlib-wrapped
DEFLATE directly to the exact UTF-8 bytes. DEFLATE's LZ77 window references
nearby repeated byte strings and its dynamic Huffman stage codes the remaining
literal/length/distance alphabet. It therefore does not need to publish one
independent entry for every word, and can exploit recurring markup, spacing,
punctuation, and substrings even when the vocabulary is large. The compressed
bytes then enter the same ln.kr magic/version/kind/length/CRC framing and the
same ha.mr ASCII, QR, or emoji transport.

Neither model dominates every input. v1 is exceptionally cheap for exact
copies, v2/v3 can win on reusable structural families, and v4 often wins on
long documents with high token entropy but strong local byte recurrence. The
choice stays explicit: selecting v4 runs DEFLATE once; ln.kr never runs all
encoders and hides a winner-selection pass.

See [FORMAT.md](FORMAT.md) for the wire format and
[STRUCTURAL-COMPRESSION.md](STRUCTURAL-COMPRESSION.md) for the design attempts,
cost model, and corpus measurements.

## Viewer

The generated page provides:

- an explicit **v1 / v2 / v3** encoder dial, with stable v1 as the default, plus
  a separate **DEFLATE v4** high-entropy override;
- a GFM preview with the render-facing Zensical extensions used by sHEL docs,
  authored HTML blocks, Mermaid diagrams, syntax highlighting, per-block copy
  actions, and an exact-source view;
- **Copy raw** and **Copy rich**;
- local **Copy JSFuck** and AEM1K-style **Copy invisible** exports for
  JavaScript;
- an explicit **Run in sandbox** action for JavaScript, Markdown, and HTML;
- a default-blocked **Allow network requests** control for sandboxed remote
  images, frameworks, media, fonts, and fetch/WebSocket calls;
- automatic page navigation to the isolated preview and a screen-sized **Expand
  viewer** mode with its own scrolling document;
- a JSFuck-compatible **Run in parent scope** opt-in for JavaScript;
- explicit `#r:` JavaScript auto-run and `#m:`/`#h:` live-view links.

Opening an ordinary `#PAYLOAD` link does not enter the executable viewer.
Markdown is parsed as GFM without sanitizing or rewriting authored HTML. This
preserves README/Obsidian constructs such as images, audio/video players,
`details`/`summary`, custom schemes, attributes, and embedded markup. The exact
source remains available through **Source** and **Copy raw**.

### Zensical-compatible Markdown

The viewer natively implements the complete 24-extension Markdown set enabled
by `orc/docs/zensical.fs`: abbreviations, admonitions, attribute lists,
definition lists, footnotes, Markdown inside marked HTML, Caret, collapsible
Details, Snippets, InlineHilite, SmartSymbols, Mark, Tilde, Keys, Highlight,
SuperFences, linked content Tabs, Emoji/icons, Arithmatex, MagicLink, custom
Tasklists, BetterEm, GLightbox, and TOC permalinks. This is a compact browser
renderer, not a generated Zensical site shell, so navigation/search/repository
theme features do not become part of a shared document.

Configured forms such as `!!! warning`, `???+ note`, `=== "Tab"`,
`==mark==`, `^^insert^^`, `H~2~O`, `++ctrl+alt+del++`, footnotes, definition
lists, `{ .md-button }`, `[TOC]`, and fence metadata (`title`, `linenums`, and
`hl_lines`) render directly. Matching tab labels stay linked. Headings receive
permalinks; images receive the compact full-screen lightbox unless marked
`.off-glb`; code blocks receive copy/select actions and numbered annotations.
Mermaid stays locally vendored. MathJax 3.2.2 loads only when Arithmatex is
present, and readable TeX remains if that optional network load is unavailable.

Heading icons, TOC/footnote links, and Markdown bookmarks such as
`[my link text](#the-cordis-research-paper)` jump within the preview using
JavaScript, including the expanded viewer. Their appearance and authored source
stay unchanged; clicking never replaces the compressed URL fragment.

Absolute Zensical snippet syntax is routed through the same source-module
engine: `--8<-- "https://a.shel.sh/#s:…"`. A pasted fragment has no build-time
filesystem, so relative snippet filenames cannot be read; an ln.kr source link
is the browser-native equivalent and retains nested expansion, line slicing,
cycle checks, fetch reuse, and exact authored source.

For ordinary rendered document links, ln.kr only fills in missing link-opening
attributes: `target="_blank"` and the `noopener noreferrer` `rel` tokens.
Existing targets and `rel` tokens are retained, `href` is never filtered or
removed, and `javascript:` links are not altered. The document runner repeats
that narrowly scoped behavior for links created later by rendered Markdown or
by HTML running with network access disabled.

Checking the parent-scope control makes the JavaScript Run action immediate,
just as on JSFuck. A deliberately shared `#r:PAYLOAD` link selects that mode
and runs JavaScript on load. `#m:PAYLOAD` and `#h:PAYLOAD` open Markdown and
HTML in the expanded isolated viewer, with network access enabled so remote
document assets can render. Network-enabled HTML is assigned to the iframe
directly from the exact decoded source, without an injected policy or document
rewriter. The iframe still has a unique sandbox origin. With network disabled,
the runner adds its network-blocking Content Security Policy and the narrow
document-link helper described above. Stopping the runner destroys its
document.

## Link mode

The **Link** control restores ha.mr’s original URL-specialized codec without
changing that engine. It produces these fragment-only route families:

- **Copy link** uses `#l:` and shows the destination before navigation.
- **Copy direct** uses `#lr:` and replaces the current page with the decoded
  destination immediately. It is exactly the guarded route without the
  **Proceed** step, remains client-side, and invents no path or hostname.
- **Copy source** uses `#s:`. On opening, the browser reads the target through
  the decoded public URL, detects HTML, Markdown, JavaScript, or ordinary text
  from its response type, final suffix, and contents, then replaces the short
  route with the corresponding ordinary editable `#PAYLOAD` document URL.
  Only HTML gets the upstream `<base>` anchor; a raw README or script stays
  raw. GitHub repository, `/blob/`, and `/raw/` presentation URLs are resolved
  to `raw.githubusercontent.com`; Hugging Face model-card, `/blob/`, and `/raw/`
  URLs are resolved to their official `/resolve/` files. Those URL selections
  occur entirely in the browser before the existing source fetch. The adjacent
  **Source as** selector defaults to automatic detection and can instead emit
  the explicit Markdown, JavaScript, or HTML route. A source fetch that the
  origin does not permit remains an explicit error and never degrades into the
  direct route.
- Explicit `#sm:`, `#sj:`, and `#sh:` source aliases force Markdown,
  JavaScript, or HTML when a server supplies ambiguous metadata.
- A bare `#s:`/`#sm:`/`#sj:`/`#sh:` link on its own source line is a runtime
  include. Its raw textual result is expanded before the existing
  Markdown/HTML preview or JavaScript runner receives the document, so CSS,
  scripts, and Markdown sections can remain modular. Source, Copy raw, and
  Edit a copy still expose the exact authored link rather than the expansion.
  Includes may nest; repeated targets are fetched once. The rendered module
  retains a compact source capsule; hover or focus it to inspect the expanded,
  scrollable code. Inline links are not modules. A `#lr:` link remains literal
  in authored source and is resolved only in the private runtime copy.
- Append `::~START[:SPAN]` to a source link to select raw, zero-based lines
  before rendering or nested-module expansion. This follows CMD substring
  semantics: `::~0:5` takes the first five lines, `::~12` takes line 12 through
  EOF, and `::~12:-3` takes line 12 through the end delimiter three lines back
  from EOF. A negative start counts from EOF as well. Original LF, CRLF, and CR
  endings are preserved byte-for-byte; different slices of one target still
  share its single fetch.
- **Copy live** uses the existing `#hs:` route and the same detection. HTML and
  Markdown continue into their existing `#h:`/`#m:` expanded viewers with
  network access enabled. JavaScript continues into its existing `#r:`
  editable parent-scope run state.
- **Copy in-frame** uses `#lf:` and loads the decoded destination in the
  inspectable frame without changing the top-level page. It exposes manual
  **Copy source**, **Download**, and **Expand frame** controls. Copy serializes
  a same-origin frame or uses a readable text response; Download preserves the
  fetched bytes and MIME type. Sites may still decline framing or cross-origin
  reads through their own response headers; that never changes source routes.
- **Copy superlink** appears only after the browser verifies that the selected
  readable raw file is exactly one physical line containing one bare URL,
  Markdown link, or HTML anchor. Its `#ss:` route keeps that small outer file
  pointer in authored source. Opening it resolves the inner link; using it as
  a bare source module double-resolves an inner route-three/route-four link and
  appends that source through the existing runtime module engine. This lets a
  tiny raw file carry an otherwise enormous a.shel.sh source link without
  copying the expanded link into the parent document.
- **Copy image** appears only for a recognized image suffix. `#i:` expands the
  target into the project’s complete editable JavaScript image viewer, shows
  that exact source in the normal viewer, and runs it in parent scope. Its
  source keeps the compressed `#lr:` URL; a.shel.sh replaces that reference
  only in the private runtime copy before the image element loads it.
- **Copy media** appears only for recognized audio and video suffixes.
  `#media:` expands to an editable, immediately live JavaScript player whose
  `src` is likewise the route-two `#lr:` form in visible source.
- **Copy PDF** appears only for a `.pdf` suffix. `#pdf:` expands to an editable
  JavaScript PDF viewer with the same embedded `#lr:` resolution. It fetches
  exact bytes, gives the resulting local Blob the correct `application/pdf`
  type, and supplies previous/next/page controls plus Single and Book layouts
  over the browser-native PDF viewer.

A bare route-three or route-four link is also a valid module when it points to
recognized image, audio, video, or PDF bytes. Markdown and HTML receive the
corresponding native element at that exact line. Bare `#i:`, `#media:`, and
`#pdf:` route-six links do the same. Generated media `src` attributes use the
short route-two URL; only the private runtime representation substitutes the
decoded public resource. Animated images remain ordinary `<img>` elements,
and PDF modules fetch into an `application/pdf` Blob before opening their
native frame.

`#lr:` remains the no-confirmation redirect for a compressed destination.
When opened in the URL bar, `#lr:` immediately replaces the page with its
destination. Inside an a.shel.sh document, the authored code stays short while
the renderer/executor resolves `#lr:` references in a separate runtime copy.
A bare external `<img>` request cannot execute a fragment application; this
special behavior belongs to source rendered by a.shel.sh. Source routes fetch
CORS-readable public text directly. Runtime inclusion remains reserved for
textual Markdown, JavaScript, CSS, HTML, and similar source files.

## Optional repository rendering

An exact first line `style=zensical`, `style=jekyll`, or `style=node` enables
a render recipe. `theme=` is an alias for `style=`. Without that first line,
rendering and all existing links behave exactly as before. Headers are hidden
only in the preview; the original recipe remains in Exact source, copy, edit,
and the compressed link. Nothing changes in any compression engine.

```ini
theme=jekyll

# My document

Ordinary Markdown, including the existing rich Markdown features.
```

Zensical uses the current renderer and appearance. Jekyll supplies a small,
Minima-inspired light skin—not a Ruby/Liquid engine. Neither theme-only form
fetches a repository. `node` means browser-ready HTML/JavaScript, not a Node
process, package installer, or build command.

### Bases are not page includes

```ini
style=node
repo=https://github.com/owner/project/tree/main
body=https://github.com/owner/project/tree/main/dist
css=https://github.com/owner/project/tree/main/dist
script=https://github.com/owner/project/tree/main/dist
base=/project/

<!doctype html>
<html><head><link rel="stylesheet" href="./assets/site.css"></head>
<body><h1>My page</h1><img src="./assets/photo.webp">
<script type="module" src="./assets/site.js"></script></body></html>
```

- `repo=`: repository root used to resolve header pointers and locate optional
  theme configuration. It never imports the repository's page content.
- `body=`: base for relative body resources (`src`, `href`, `poster`, etc.).
  It does **not** fetch or insert that body. A tree/trailing-slash URL names a
  directory; a file pointer selects that file's containing directory.
- `css=` / `script=` with a tree or trailing-slash URL: separate bases for
  stylesheet and JavaScript references. No index body or scripts are imported
  just because a directory was named. Only one directory base of each type is
  allowed. Additional explicit **file** pointers load that stylesheet/module;
  these may use existing shel source links and line slices.
- `artifact=`: optional built-output directory, used as the default resource
  root. For Jekyll/Zensical its index can be inspected **for stylesheets and
  color-scheme attributes only**; page contents and scripts are not copied.
- `base=`: original deployment mount, for example `/project/`, so an authored
  `/project/assets/site.js` resolves within the artifact rather than a raw
  host's domain root.

GitHub tree URLs map to raw.githubusercontent.com. Hugging Face model, dataset,
and Space trees map to their `resolve` files, which also handles LFS. Shel links
to those directories work too. Other directory URLs should end in `/`.
Relative header pointers use `repo`, otherwise `artifact`, otherwise the raw
recipe's directory. Resources inside a fetched CSS/JS file keep that file's
own relative base; explicit directory overrides also control root-relative URLs.

The document itself must be written below the header or included with an
existing standalone shel/superlink line pointing at the **actual file**. For
example, shorten the raw `dist/index.html` as a source link and put that link
on its own line below the header. This is the existing modular include, not
an implicit repository-index import. `#s:`, `#sm:`, `#sh:`, `#hs:` and their
existing `::~start:span` slices keep their original meanings.

### Repository theme styling

```ini
style=zensical
repo=https://github.com/owner/docs/tree/main
artifact=https://github.com/owner/docs/tree/main/site

# My own content

This uses the built theme's CSS, not the artifact's homepage.
```

For Jekyll, use `style=jekyll` and the built `_site` directory instead.
Without an explicit artifact, the loader looks for the simple `destination`
setting in `_config.yml`/`.yaml`, or `site_dir` in `zensical.toml` /
`mkdocs.yml` / `.yaml`; defaults are `_site` and `site`. Built files must
actually exist at the pointer. Configuration is read as data, never executed.
Unbuilt Sass, Liquid, Python plugins, TSX and package scripts are not compiled.
Layouts, navigation and page bodies are deliberately not copied from a theme.

A raw file containing a recipe also works through `#ss:`. When a fetched
recipe becomes an editable full link, an explicit `repo=` base is retained so
its relative references survive reloading/sharing that link.

### Browser execution and boundaries

Only the opt-in recipe path prepares fetched JS/CSS bytes with their correct
MIME types. Raw GitHub's `text/plain` / `nosniff` responses otherwise prevent
them being used directly as scripts/styles. The lazy module lexer recognizes
real ESM imports, literal dynamic imports, cycles, JSON imports and
`import.meta.url`; it does not rewrite fake imports in comments/strings.
Browser import maps and browser ESM entries in existing `node_modules` are
supported. CSS imports and asset URLs are rebased. Referenced static HTML
iframes are prepared too; internal HTML navigation uses ordinary shel fragment
links rather than inventing server paths.

The initial repository preview is inert. Run in sandbox enables its scripts;
Allow network requests still controls the running preview. Repository files
must first be fetched to prepare it, just like existing source modules.
The preparation cache is limited to 256 text files / 32 MiB / 16 nested frames,
with a 20-second per-request timeout. Failures are explicit.

This does not bypass CORS, provide a server filesystem, impersonate the target
origin, enable origin storage inside an opaque sandbox, or run server-only
dependencies. Computed module imports need a prebuilt literal chunk map.
Applications depending on their own origin, service workers, runtime-created
raw-host iframes, or restrictive artifact CSP may need a portable build; naming
their repository is not a promise that every application can be rehosted.
No proxy, backend, worker service or package installation is added to ln.kr.

The new module parser is pinned and lazy (20 KB uncompressed); no framework,
WASM compiler, Jekyll runtime or Zensical build runtime ships with this feature.

Browser checks, using only a static fixture host and in-browser mocked raw files:

```bash
bun tests/serve-repo-fixture.js
# Open http://127.0.0.1:4174/
```

## Run locally

No install or build is required for the site. Bun is only used for the local
development server and tests.

```bash
bun run serve
# http://127.0.0.1:4173/

bun test
```

The development server reproduces GitHub Pages’ `404.html` behavior for QR
routes. All link and source behavior remains fragment-routed client-side in
both environments.

## CLI

`standalone.js` exposes the same text format without a browser:

```bash
node standalone.js encode "const answer = 42;" ascii javascript
node standalone.js encode "const answer = 42;" ascii javascript v2
node standalone.js encode "const answer = 42;" ascii javascript v3
node standalone.js encode "const answer = 42;" ascii javascript v4
node standalone.js decode "https://a.shel.sh/#..."

# Preserve a file exactly through stdin
node standalone.js encode - emoji markdown < README.md
```

The Nix package installs this as `lnkr`.

## Deploy

The deployable site is `docs/`. It is ready for GitHub Pages and includes the
custom domain in `docs/CNAME`:

```text
a.shel.sh
```

The deployment is entirely static. `#l:`, `#lr:`, `#lf:`, `#s:`, `#sm:`,
`#sj:`, `#sh:`, `#hs:`, `#ss:`, `#i:`, `#media:`, and `#pdf:` are URL-fragment routes
handled by the browser; no matching server directories or rewrite rules
exist.

The Docker image serves the same directory with Nginx and sends unknown QR
paths through `404.html`.

## Tests

The suite covers:

- exact untouched ha.mr ASCII, QR, and emoji URL fixtures;
- all three alphabets for ln.kr text;
- empty, whitespace-sensitive, CRLF/LF, NUL, combining, multilingual, and
  emoji cases;
- exact and sparsely modified repetition;
- multigeneration structural deltas and reusable grammar shapes;
- deterministic mixed-Unicode fuzz cases;
- ambiguity-safe emoji boundaries;
- randomized and multigeneration structural-v2 round trips;
- bounded, frequency-shaped v3 dictionaries through every transport alphabet;
- explicit v4 DEFLATE round trips through every content kind and transport alphabet;
- payload corruption rejection;
- viewer URL-mode contracts;
- fragment-only guarded, direct, source, live-source, framed, sliced-module,
  nested-superlink, image, audio/video, and PDF routes;
- the exact Zensical extension inventory, block recognition, fence metadata,
  linked-viewer bootstrap, and absolute Snippets spelling;
- vendored renderer assets and license copies;
- vendored JSFuck alphabet and execution.

## Lineage and licenses

The repository retains ha.mr’s MIT license and Git history. The URL engine,
alphabets, and lean-qr code originate upstream. `docs/vendor/jsfuck.js` is
JSFuck 0.5.0 by Martin Kleppe and is distributed upstream under the WTFPL.
The invisible export follows the technique documented at
<https://aem1k.com/invisible/encoder/>.

The browser-only rich viewer additionally vendors pinned copies of Marked,
highlight.js, Mermaid, and pako. Their exact versions, upstream links, and
license files are listed in `docs/vendor/README.md`.
