# ln.kr versioned text format

ln.kr keeps ha.mr’s final representation:

1. Encode a self-terminating binary stream as one positive `BigInt`.
2. Convert that integer with ha.mr’s bijective `numberToString` routine.
3. Select the existing ASCII, QR, or emoji alphabet.

The text grammar never rewrites the source. It tokenizes UTF-8 bytes solely to
choose a shorter reversible representation.

## Header

Fields are consumed least-significant bit first:

| Field | Encoding |
|---|---|
| Magic | 16-bit `0x4c4e` |
| Version | 3-bit integer (`1` or `2`) |
| Display kind | 2-bit integer: text, Markdown, JavaScript, HTML |
| Byte length | Elias-gamma of `length + 1` |
| Integrity | CRC-32 of the exact UTF-8 bytes |
| Body | Records until the declared byte length is reached |
| Terminator | ha.mr positive-integer sentinel (`1`) |

Decoding fails closed on a bad magic/version, invalid record, bad distance,
length overflow, invalid UTF-8, trailing bits, or checksum mismatch.

## v1 body records

Record prefixes are prefix-free:

| Prefix | Record |
|---|---|
| `0` | One 7-bit ASCII byte |
| `10` | Elias-gamma dictionary index |
| `110` | Elias-gamma distance and length for a prior-output copy |
| `111` | Elias-gamma length followed by exact 8-bit literal bytes |

Copy records may overlap their source. This expresses long runs and periodic
source compactly. The encoder indexes recent four-byte sequences and checks a
bounded chain of candidates; it never guesses or applies a semantic rewrite.

The ordered dictionary in `docs/text-compress.js` is normative for v1. Any
change to its order or contents requires a new format version.

## Repeated and near-repeated blocks

No separate “paragraph approximation” exists. General prior-output references
handle both cases exactly:

```text
earlier block ───────────────┐
                            ├─ COPY(distance, length)
same block again ────────────┘

same prefix ─ COPY · changed bytes ─ LITERAL/DICT · same suffix ─ COPY
```

This makes repeated codeblocks, paragraphs, indentation, and repeated variants
compact while preserving every differing byte.

## v2 document grammar and structural deltas

v2 retains the first three v1 record prefixes. Its `111` branch is extended:

| Prefix | Record |
|---|---|
| `0` | One 7-bit ASCII byte |
| `10` | Elias-gamma dictionary index |
| `110` | Elias-gamma distance and length for a prior-output copy |
| `1110` | Elias-gamma document-grammar index |
| `11110` | Elias-gamma length followed by exact 8-bit literal bytes |
| `111110` | Prior block plus a newly defined sparse residual shape |
| `111111` | Prior block plus a previously defined residual shape |

After the CRC and before body records, a v2 payload carries its local grammar:

1. Elias-gamma of `entry count + 1`;
2. one Elias-gamma byte length for each entry;
3. all entry bytes concatenated and encoded as a v1 record stream.

The declared lengths split the decoded definition stream back into entries.
Encoding definitions through v1 lets a phrase reuse the frozen dictionary and
earlier definition ranges; it does not require the phrase bytes to be repeated
literally in the header. The combined definition bytes may not exceed the
document's declared byte length, and every entry is bounded to 2–192 bytes.

The encoder discovers repeated exact words/identifiers and repeated sequences
of 2–16 generic word, whitespace, and punctuation units. It does not parse a
programming or markup language. Competing nested phrases are ranked by their
actual savings, and word-only and word-plus-phrase plans are priced as complete
v2 streams. Only the smaller v2 grammar is emitted. A short bounded lookahead
prevents a copy beginning on adjacent whitespace from hiding a cheaper phrase
symbol one byte later.

A full structural definition contains:

1. the Elias-gamma distance to a fully decoded prior block;
2. the block length (`length - 32 + 1`, Elias-gamma);
3. the number of changed runs (Elias-gamma);
4. for each run, its gap from the previous run and its length;
5. the exact replacement bytes for all runs in order.

Each full definition appends `(block length, run starts, run lengths)` to a
second payload-local table of residual shapes. A reuse record contains the
prior-output distance, the backward distance to a residual shape, and only the
exact replacement bytes implied by that shape. This removes repeated
structural bookkeeping without placing any source-specific dictionary in the
application.

Let an earlier byte vector be \(B\), a later equal-length vector be \(T\), and
the ordered sparse residual runs be \(\Delta = \{(s_i, v_i)\}\). Decoding is
the exact overwrite operation

```text
T = overwrite(B, Δ)
T[j] = v_i[j - s_i]  when j belongs to residual run i
T[j] = B[j]          otherwise
```

No interpolation, token normalization, or approximate character replacement
occurs. “Similar” is used only to nominate a reference; every changed byte is
present in the stream and the final CRC is over the reconstructed source.

### Multiscale candidate map

At byte position \(p\), the encoder samples exact four-byte hashes at offsets

```text
O = {0, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048}
W(p) = (H4(p + o)) for o in O
```

Each matching anchor votes for the aligned prior start. This sparse,
wave-shaped fingerprint makes a whole repeated region discoverable even when
some early or interior bytes changed. Only the strongest candidates receive a
byte-for-byte residual scan. The candidate must be at least 32 bytes, may use
at most 128 residual runs, and may never read undecoded future output.

Each grammar entry and structural candidate is compared against the estimated
exact v1 record cost over the same bytes, not merely against raw length. The
user selects v1 or v2 explicitly; the default path never plans both formats.
Within v2, candidate grammars compete against other v2 plans only. Thus v2 data
can form a lossless chain

```text
B0 ──Δ1──> B1 ──Δ2──> B2 ──Δ3──> ... ──Δn──> Bn
```

where every reconstructed generation is eligible as a later reference. This
is the `n=1, n=2, n=3, ...` behavior without assigning meaning to JSON, CSS,
JavaScript, Markdown, or any other language.

## Emoji boundary framing

The emoji alphabet contains both composed sequences and some of their parts.
Two adjacent valid digits can therefore visually concatenate into a different
longer alphabet entry. `numberToString` now inserts `.` only at such an
ambiguous boundary. The separator is not a numeric digit and is removed before
BigInt reconstruction. Existing unframed emoji payloads and every unambiguous
new payload remain unchanged; ASCII and QR alphabets already contain `.`, so
their fixed one-character digits never use this framing rule.

## URL forms

- ASCII or emoji: `https://a.shel.sh/#PAYLOAD`
- Explicit JavaScript auto-run: `https://a.shel.sh/#r:PAYLOAD`
- Explicit Markdown live view: `https://a.shel.sh/#m:PAYLOAD`
- Explicit HTML live view: `https://a.shel.sh/#h:PAYLOAD`
- QR: `HTTPS://A.SHEL.SH/T/PAYLOAD`

The `r:`, `m:`, and `h:` markers are outside the encoded payload, so they do
not change compression or the v1 grammar. Each is accepted only when it
matches the decoded display kind. `r:` selects parent scope and evaluates
JavaScript once on load. `m:` and `h:` open the document in the expanded
unique-origin viewer with network requests enabled. The unprefixed form
remains inert until the recipient chooses Run.

The QR path uses only QR alphanumeric-mode characters. GitHub Pages serves
`404.html`, which moves that payload into `#q:PAYLOAD`; the normal decoder then
uses the QR alphabet. The fragment is not sent in HTTP requests.
