# ln.kr

Lossless text and code carried entirely in a link.

ln.kr is a static, browser-only descendant of
[p2r3/ha.mr](https://github.com/p2r3/ha.mr). ha.mr’s positive-BigInt
bitstream and ASCII, QR, and emoji alphabets remain the foundation. ln.kr adds
a versioned text grammar above that engine; it does not replace it with Brotli,
DEFLATE, Base64URL, a server-side paste ID, or a generic compression package.

Open the site, paste source, and share the resulting fragment URL. The source
is decoded by the recipient’s browser. Nothing is uploaded.

## What it preserves

- Exact UTF-8 source, including indentation, repeated spaces, tabs, blank
  lines, LF/CRLF bytes already present in the input, combining marks, and emoji.
- Markdown, JavaScript, HTML, or plain-text display intent.
- ha.mr’s ASCII, QR-alphanumeric, and emoji output modes.
- Original ha.mr URL-codec behavior. Frozen upstream vectors guard its outputs
  byte-for-byte in the test suite.

The v1 grammar combines a ranked code/Markdown dictionary with prior-output
references. An exact paragraph repeated *N* times becomes a copy record. A
mostly repeated block with changed lines becomes copy → exact literal → copy,
so the unchanged regions are reused without normalizing the changed region.
The byte count, UTF-8 validation, trailing-data check, and CRC-32 must all agree
before a document is rendered.

See [FORMAT.md](FORMAT.md) for the wire format.

## Viewer

The generated page provides:

- a safe Markdown preview and an exact-source view;
- **Copy raw** and **Copy rich**;
- local **Copy JSFuck** and AEM1K-style **Copy invisible** exports for
  JavaScript;
- an explicit **Run in sandbox** action for JavaScript and HTML;
- a JSFuck-compatible **Run in parent scope** opt-in for JavaScript;
- an explicit `#r:` auto-run link for intentionally executable shares.

Opening an ordinary `#PAYLOAD` link never runs its contents. Markdown HTML is
treated as text and links are protocol-filtered. Checking the parent-scope
control makes the Run action immediate, just as on JSFuck. A deliberately
shared `#r:PAYLOAD` link selects that mode and runs JavaScript on load. The
default runner remains an `allow-scripts` iframe with a unique origin and a
network-blocking Content Security Policy. Stopping that runner destroys its
document.

## Run locally

No install or build is required for the site. Bun is only used for the local
development server and tests.

```bash
bun run serve
# http://127.0.0.1:4173/

bun test
```

The development server reproduces GitHub Pages’ `404.html` behavior so QR
routes can be tested locally.

## CLI

`standalone.js` exposes the same text format without a browser:

```bash
node standalone.js encode "const answer = 42;" ascii javascript
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

The Docker image serves the same directory with Nginx and sends unknown QR
paths through `404.html`.

## Tests

The suite covers:

- exact untouched ha.mr ASCII, QR, and emoji URL fixtures;
- all three alphabets for ln.kr text;
- empty, whitespace-sensitive, CRLF/LF, NUL, combining, multilingual, and
  emoji cases;
- exact and sparsely modified repetition;
- deterministic mixed-Unicode fuzz cases;
- payload corruption rejection;
- vendored JSFuck alphabet and execution.

## Lineage and licenses

The repository retains ha.mr’s MIT license and Git history. The URL engine,
alphabets, and lean-qr code originate upstream. `docs/vendor/jsfuck.js` is
JSFuck 0.5.0 by Martin Kleppe and is distributed upstream under the WTFPL.
The invisible export follows the technique documented at
<https://aem1k.com/invisible/encoder/>.
