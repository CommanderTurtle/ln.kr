# ln.kr

Lossless text and code carried entirely in a link.

ln.kr is a static, browser-only descendant of
[p2r3/ha.mr](https://github.com/p2r3/ha.mr). ha.mr’s positive-BigInt
bitstream and ASCII, QR, and emoji alphabets remain the foundation. ln.kr adds
a versioned text grammar above that engine; it does not replace it with Brotli,
DEFLATE, Base64URL, a server-side paste ID, or a generic compression package.

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
The visible **Structural v2** switch runs one deterministic four-phase
pipeline:

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

The choice is explicit: v1 runs only v1, and v2 runs only the full v2 pipeline.
There is no whole-document v1 trial, fallback, or auto-selection inside v2.
The fixed v1 record costs are reused as the local price scale for references,
and unreferenced definitions are discarded deterministically. Both formats
decode on the same page. The byte count, UTF-8 validation, trailing-data check,
and CRC-32 must all agree before a document is rendered.

Exact repeated blocks are already v1's strongest case: one prior-output record
can represent every later copy regardless of how many times it was pasted. v2
leaves that record intact rather than replacing it with a structural template.
With no v2-only records, its two empty grammar headers can round to one extra
URL symbol. v2's incremental gain appears on repeated families whose fields
actually differ; definitions that cease to repay themselves after exact-copy
selection are removed.

See [FORMAT.md](FORMAT.md) for the wire format and
[STRUCTURAL-COMPRESSION.md](STRUCTURAL-COMPRESSION.md) for the design attempts,
cost model, and corpus measurements.

## Viewer

The generated page provides:

- an explicit **Structural v2** encoder switch, with stable v1 as the default;
- a GFM preview with authored HTML blocks, Mermaid diagrams,
  syntax highlighting, per-block copy actions, and an exact-source view;
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
changing that engine. It produces five deliberately different transports:

- **Copy link** uses `#l:` and shows the destination before navigation.
- **Copy direct** uses `#lr:` and loads the decoded destination immediately in
  the resolved viewer. It remains a client-side fragment route and never
  invents a path or hostname.
- **Copy source** uses `#s:`. On opening, the browser reads the target through
  the decoded public URL, detects HTML, Markdown, JavaScript, or ordinary text
  from its response type, final suffix, and contents, then replaces the short
  route with the corresponding ordinary editable `#PAYLOAD` document URL.
  Only HTML gets the upstream `<base>` anchor; a raw README or script stays
  raw. The adjacent **Source as** selector defaults to that automatic detection
  and can instead emit the explicit Markdown, JavaScript, or HTML route.
- Explicit `#sm:`, `#sj:`, and `#sh:` source aliases force Markdown,
  JavaScript, or HTML when a server supplies ambiguous metadata.
- A bare `#s:`/`#sm:`/`#sj:`/`#sh:` link on its own source line is a runtime
  include. Its raw textual result is expanded before the existing
  Markdown/HTML preview or JavaScript runner receives the document, so CSS,
  scripts, and Markdown sections can remain modular. Source, Copy raw, and
  Edit a copy still expose the exact authored link rather than the expansion.
  Includes may nest; repeated targets are fetched once. Inline links and
  `#lr:` links are never treated as includes.
- Append `::~START[:SPAN]` to a source link to select raw, zero-based lines
  before rendering or nested-module expansion. This follows CMD substring
  semantics: `::~0:5` takes the first five lines, `::~12` takes line 12 through
  EOF, and `::~12:-3` takes line 12 through the end delimiter three lines back
  from EOF. A negative start counts from EOF as well. Original LF, CRLF, and CR
  endings are preserved byte-for-byte; different slices of one target still
  share its single fetch.
- **Copy live** uses the existing `#hs:` route and the same detection. HTML and
  Markdown continue into their existing `#h:`/`#m:` expanded viewers;
  JavaScript opens in its existing editable viewer with the run controls.
- Binary responses are left on **Copy direct** instead of being decoded as
  UTF-8. This preserves the browser's native PDF/media handling and range
  requests.
- **Copy image** appears only for a recognized image suffix. `#i:` expands the
  target into the project’s complete editable JavaScript image viewer, shows
  that exact source in the normal viewer, and runs it in parent scope.

`#lr:` remains the inspectable framed wrapper for a compressed destination.
It decodes entirely in the browser. Image aliases load the decoded image URL
directly and source routes fetch CORS-readable public text directly; runtime
inclusion remains reserved for textual Markdown, JavaScript, CSS, HTML, and
similar source files.

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

The deployment is entirely static. `#l:`, `#lr:`, `#s:`, `#sm:`, `#sj:`,
`#sh:`, `#hs:`, and `#i:` are URL-fragment routes handled by the browser; no
matching server directories or rewrite rules exist.

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
- payload corruption rejection;
- viewer URL-mode contracts;
- fragment-only guarded, direct, source, live-source, sliced-module, and image routes;
- vendored renderer assets and license copies;
- vendored JSFuck alphabet and execution.

## Lineage and licenses

The repository retains ha.mr’s MIT license and Git history. The URL engine,
alphabets, and lean-qr code originate upstream. `docs/vendor/jsfuck.js` is
JSFuck 0.5.0 by Martin Kleppe and is distributed upstream under the WTFPL.
The invisible export follows the technique documented at
<https://aem1k.com/invisible/encoder/>.

The browser-only rich viewer additionally vendors pinned copies of Marked,
highlight.js, and Mermaid. Their exact versions, upstream links, and license
files are listed in `docs/vendor/README.md`.
