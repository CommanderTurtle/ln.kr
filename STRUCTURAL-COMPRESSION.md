# Structural compression notes

## Invariant

ln.kr compresses bytes, not syntax. A JSON object, CSS rule, function,
paragraph, and arbitrary binary-looking UTF-8 region receive the same treatment.
No parser is allowed to normalize whitespace, rename a key, reorder a field, or
guess that two values are semantically equivalent.

The original v1 encoder remains frozen and is the default. Structural v2 is an
explicit switch and a separate deterministic pipeline. Selecting v2 never runs
v1 as a competing whole-document encoder and never falls back to it. v2 does
reuse v1's fixed dictionary and record prices while constructing its own
grammar. Every decoder validates the exact byte length, UTF-8, trailing sentinel,
and CRC-32.

Dictionary v3 is another explicit wire version. It retains v2's structural
records, discovers those ranges first, then broadens the exact document-local
vocabulary to repeated words, identifiers, punctuation atoms, and longer
compatible-zone phrases. Up to 7,225 entries use a canonical, frequency-shaped
codebook capped at 13 bits. v1 and v2 encoding remain byte-for-byte frozen.

## Explored approaches

### Semantic or AST templates

Making reconstruction depend on a JSON, CSS, JavaScript, Markdown, or HTML AST
would specialize the codec and risk normalization. This was rejected. v2 does
perform a read-only zone scan for braces, elements, Markdown fences, authored
HTML, and sustained code-looking regions. Those zones nominate exact byte
boundaries only; the decoder knows nothing about the source language.

### Approximate global curves

A fitted curve or quadratic model can predict repeated values, but prediction
alone is lossy. Carrying every prediction error restores exactness, at which
point the residual representation—not the curve—is what determines whether
compression wins. Elliptic-curve machinery supplies useful algebra for
cryptography, not a redundancy model for arbitrary document bytes.

### A block delta priced against raw bytes

The first structural prototype referenced an earlier block and carried changed
runs, but compared its cost with `8 × blockLength`. This looked locally cheap
while replacing already excellent v1 copy sequences. On a 249,219-byte nested
JSON stress corpus it expanded the experimental stream from 19,617 to 58,372
symbols. That prototype was discarded; the current v2 prices a candidate
against the fixed-record cost of the same byte interval.

### Multiscale anchors plus sparse residuals

The implemented design uses exact four-byte anchors at exponentially increasing
offsets. Matching anchors vote for an aligned prior start. This is the useful
part of the “wave/cloud” analogy: sparse samples across several spatial scales
nominate a region without requiring every point to match.

For source block `B` and target block `T`, v2 stores only contiguous nonzero
residual support:

```text
Δ = {(start0, exactBytes0), (start1, exactBytes1), ...}
T = overwrite(B, Δ)
```

The residual is compared with the distributed cost of the exact v1 records over
the same interval. Reconstructed v2 blocks enter prior output, so later records
may reference `B1`, then `B2`, then `B3`, forming an arbitrary-depth lossless
chain.

### Document-local lexical and phrase grammar

v2 first divides the exact text into generic units: Unicode word/number runs,
whitespace runs, and punctuation runs. This is boundary discovery rather than
parsing—no unit is altered, discarded, or assigned language-specific meaning.
Repeated words and repeated sequences of 2–16 units become candidate local
symbols. Candidate phrases are at most 192 UTF-8 bytes.

For each candidate occurrence, the encoder measures the fixed-record bit cost
of the same byte interval. Words are admitted first so their low indices stay
stable; non-overlapping phrase families follow. Definitions that receive no
body references are garbage-collected during a bounded fixed-point pass. This
is one v2 construction, not a v1/v2 trial or a set of whole-stream alternatives.

Grammar definitions are not stored as an uncompressed string table. Their
lengths are followed by a concatenated v1 stream, so definitions may use the
frozen dictionary and copy earlier definition ranges. A bounded lookahead also
lets `space + grammar-symbol + space` beat one longer but more expensive exact
copy; a byte-greedy parser would otherwise never reach the symbol.

An exact pasted block is intentionally not converted into a template. v1's
distance/length record already represents the complete recurrence more cheaply
than defining its internal grammar again. After ordinary record selection, v2
recounts actual lexeme and template references and removes any definition whose
remaining references no longer repay its header and definition bytes.

Every recurring word can therefore become a low-index local symbol. Words that
occur only once remain exact variable material—storing a definition and one
reference would merely move those bytes into the header. Punctuation,
whitespace, record tags, integrity data, and transport radix remain exact too.
The later sector and line phases prevent those one-off fields from forcing the
surrounding repeated structure to be emitted again.

### Zone, sector, and residual-line grammar

The first v2 phase creates a disposable boundary map:

- HTML is split into markup plus style, script, and JSON-script bodies;
- Markdown exposes fenced languages and authored HTML/media blocks;
- standalone or sustained CSS, JavaScript, and JSON-looking regions are
  promoted only after multiple lines and a minimum span; and
- every remaining exact line stays eligible for the final line-family pass.

Within compatible zones, balanced brace sectors, balanced HTML elements,
Markdown paragraphs, and individual lines are tokenized into an exact shape.
Stable tokens become static template segments. Differing identifiers, numbers,
quoted values, or other fields become ordered holes. Common byte prefixes and
suffixes inside a differing token are retained in the static segment as well.

For template `G = (S0, S1, ..., Sn)` and exact variable fields
`V = (V0, V1, ..., Vn-1)`, reconstruction is

```text
expand(G, V) = S0 || V0 || S1 || ... || Vn-1 || Sn
```

One template definition is carried in the URL; each whole sector or remaining
line is then a short template index plus its exact holes. Definitions are
compressed as a concatenated v1 stream. No AST, normalized token, or inferred
value is needed by the decoder.

### Reusable structural grammar

A full delta defines its sector shape: block length plus every changed-run
position and length. When the same shape recurs, v2 references that definition
and emits only the prior-sector distance and the new exact changed bytes. This
turns repeated layouts into payload-local grammar shapes without teaching the
codec JSON, CSS, HTML, Markdown, or any other syntax. These shape definitions
are separate from the lexical/phrase table above.

## Measurements

Measurements were taken on the development machine with the ASCII transport.
Remote files can change, so byte counts identify the tested revisions more
reliably than percentages alone.

| Corpus | UTF-8 bytes | v1 symbols | v2 symbols | v2 change from v1 |
|---|---:|---:|---:|---:|
| Linked generation workflow JSON | 1,196,728 | 117,322 | 103,834 | 11.5% smaller |
| Mixed model README | 62,457 | 41,157 | 39,432 | 4.2% smaller |
| Supplied research-report HTML | 67,965 | 33,130 | 32,408 | 2.2% smaller |
| Supplied image-viewer JavaScript | 2,692 | 1,404 | 1,343 | 4.3% smaller |
| Generated nested-object stress corpus | 249,219 | 19,617 | 15,392 | 21.5% smaller |
| Generated repeated-rule stress corpus | 85,418 | 7,501 | 3,558 | 52.6% smaller |
| Mixed HTML/CSS structural corpus | 16,196 | 3,643 | 1,876 | 48.5% smaller |
| Markdown residual-line corpus | 5,779 | 1,508 | 811 | 46.2% smaller |

The local 145,897-byte `cordis-paper.md` validation corpus produced 89,219 v1
ASCII symbols, 84,884 v2 symbols, and 81,235 v3 symbols. v3 retained 534
dictionary entries, emitted 3,954 dictionary references, and preserved the
active v2 template and eight sparse-delta records. The corpus is deliberately
not checked into the repository.

The large workflow falls from 1,196,728 source bytes to 103,834 link symbols,
or about 91.3% fewer symbols than source. Its v1 result was already unusually
strong; v2 removes another 13,488 symbols without a schema-specific decoder.

The README and report results show the lexical layer doing work where aligned
block deltas alone did little. On the supplied HTML, v2 retained 58 local
grammar symbols used 413 times and 23 sparse deltas. It removes 722 more
transport symbols than v1. Candidate templates that lost their uses to cheaper
exact-copy records were repriced and removed rather than carried as dead
definitions. The mixed synthetic corpora separately prove that sector and
residual-line records activate when the document actually contains those
families.

The supplied JavaScript is 50.1% shorter than its raw source after all phases.
v2 combines seven local symbols used 26 times with four sparse-delta regions
and removes another 61 transport symbols beyond v1.

## Verification

- frozen ha.mr ASCII, QR, and emoji fixtures remain exact;
- v1 remains decodable and byte-for-byte stable for unambiguous transports;
- v2 round trips through ASCII, QR, and emoji alphabets;
- deterministic tests cover chained generations, recurring lexical phrases,
  HTML/CSS/JavaScript sectors, Markdown fences and authored HTML, exact line
  families, compressed definition streams, and reusable residual shapes;
- ignored research harnesses exercise 10,000 emoji transports and 1,200
  randomized structural streams;
- magic, declared length, fatal UTF-8 decode, trailing sentinel, and CRC-32 all
  still fail closed.

The ignored research harnesses live under `.research/` during development so
large or remotely fetched corpora never become deployable site assets.
