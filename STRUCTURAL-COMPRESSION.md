# Structural compression notes

## Invariant

ln.kr compresses bytes, not syntax. A JSON object, CSS rule, function,
paragraph, and arbitrary binary-looking UTF-8 region receive the same treatment.
No parser is allowed to normalize whitespace, rename a key, reorder a field, or
guess that two values are semantically equivalent.

The original v1 encoder remains frozen and is the default. Structural v2 is an
explicit switch, so v1 never pays for candidate discovery and the user can
compare the two formats directly. Both decoders validate the exact byte length,
UTF-8, trailing sentinel, and CRC-32.

## Explored approaches

### Semantic or AST templates

Parsing JSON, CSS, JavaScript, Markdown, or HTML could expose repeated shapes,
but would specialize the codec and make exact preservation dependent on several
language grammars. This was rejected.

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
JSON stress corpus it expanded the candidate stream from 19,617 to 58,372
symbols. The whole-document fallback prevented that candidate from shipping,
but the search was doing the wrong work.

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

For each candidate occurrence, the encoder measures the v1 bit cost of the
same byte interval. It then builds both a word-only plan and a phrase-aware
plan, prunes entries that do not repay their definition, orders retained
symbols by actual use, and measures each complete v2 stream. The cheaper v2
grammar wins. This avoids the earlier bookkeeping mistake where fewer records
could still mean more payload bits.

Grammar definitions are not stored as an uncompressed string table. Their
lengths are followed by a concatenated v1 stream, so definitions may use the
frozen dictionary and copy earlier definition ranges. A bounded lookahead also
lets `space + grammar-symbol + space` beat one longer but more expensive exact
copy; a byte-greedy parser would otherwise never reach the symbol.

A document's word count is therefore useful evidence of possible grammar, but
not a lower bound on URL symbols. Unique spellings, punctuation, whitespace,
definition bytes, record tags, distances, length fields, integrity data, and
the transport radix all remain part of a lossless self-contained URL.

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
| Linked generation workflow JSON | 1,196,728 | 117,322 | 103,964 | 11.4% smaller |
| Mixed model README | 62,457 | 41,157 | 39,450 | 4.1% smaller |
| Supplied research-report HTML | 67,965 | 33,130 | 32,433 | 2.1% smaller |
| Supplied image-viewer JavaScript | 2,692 | 1,404 | 1,337 | 4.8% smaller |
| Generated nested-object stress corpus | 249,219 | 19,617 | 15,392 | 21.5% smaller |
| Generated repeated-rule stress corpus | 85,418 | 7,501 | 3,558 | 52.6% smaller |

The large workflow falls from 1,196,728 source bytes to 103,964 link symbols,
or about 91.3% fewer symbols than source. Its v1 result was already unusually
strong; v2 removes another 13,358 symbols without a schema-specific rule.

The README and report results show the lexical layer doing work where aligned
block deltas alone did little. On the supplied HTML, v2 retained 52 local
grammar symbols and used them 376 times, removing 697 more transport symbols
than v1. That is a measured 2.1% incremental improvement—not a claimed
word-count-sized collapse.

The supplied JavaScript is 50.3% shorter than its raw source after both layers.
v2 combines six local symbols used 26 times with four sparse-delta regions and
removes another 67 transport symbols.

## Verification

- frozen ha.mr ASCII, QR, and emoji fixtures remain exact;
- v1 remains decodable and byte-for-byte stable for unambiguous transports;
- v2 round trips through ASCII, QR, and emoji alphabets;
- deterministic tests cover chained generations, recurring lexical phrases,
  sparse edits, compressed definition streams, and reusable residual shapes;
- ignored research harnesses exercise 10,000 emoji transports and 1,200
  randomized structural streams;
- magic, declared length, fatal UTF-8 decode, trailing sentinel, and CRC-32 all
  still fail closed.

The ignored research harnesses live under `.research/` during development so
large or remotely fetched corpora never become deployable site assets.
