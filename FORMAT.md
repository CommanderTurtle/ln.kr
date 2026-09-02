# ln.kr v1 format

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
| Version | 3-bit integer (`1`) |
| Display kind | 2-bit integer: text, Markdown, JavaScript, HTML |
| Byte length | Elias-gamma of `length + 1` |
| Integrity | CRC-32 of the exact UTF-8 bytes |
| Body | Records until the declared byte length is reached |
| Terminator | ha.mr positive-integer sentinel (`1`) |

Decoding fails closed on a bad magic/version, invalid record, bad distance,
length overflow, invalid UTF-8, trailing bits, or checksum mismatch.

## Body records

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
