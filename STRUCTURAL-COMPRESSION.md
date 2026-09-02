# Structural compression notes

## Invariant

ln.kr compresses bytes, not syntax. A JSON object, CSS rule, function,
paragraph, and arbitrary binary-looking UTF-8 region receive the same treatment.
No parser is allowed to normalize whitespace, rename a key, reorder a field, or
guess that two values are semantically equivalent.

The original v1 encoder remains frozen. The default encoder plans v1 and v2,
selects v2 only when its exact stream is shorter, and verifies a full decode
against the original string. A failed check or non-win returns v1.

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
the same interval. The final v1 and v2 plans are then compared by exact total
bit length. Reconstructed v2 blocks enter prior output, so later records may
reference `B1`, then `B2`, then `B3`, forming an arbitrary-depth lossless chain.

## Measurements

Measurements were taken on the development machine with the ASCII transport.
Remote files can change, so byte counts identify the tested revisions more
reliably than percentages alone.

| Corpus | UTF-8 bytes | v1 symbols | selected symbols | Additional gain over v1 |
|---|---:|---:|---:|---:|
| Linked generation workflow JSON | 1,196,728 | 117,322 | 105,461 (v2) | 10.1% |
| Mixed model README | 62,457 | 41,157 | 41,157 (v1) | 0%; correct fallback |
| Supplied research-report HTML | 67,965 | 33,130 | 33,038 (v2) | 0.28% |
| Supplied image-viewer JavaScript | 2,692 | 1,404 | 1,383 (v2) | 1.5% |
| Generated nested-object stress corpus | 249,219 | 19,617 | 17,662 (v2) | 10.0% |
| Generated repeated-rule stress corpus | 85,418 | 7,501 | 5,081 (v2) | 32.3% |

The large workflow falls from 1,196,728 source bytes to 105,461 link symbols,
or about 91.2% fewer symbols than source. Its v1 result was already unusually
strong; v2 removes another 11,861 symbols without a schema-specific rule.

The README result is also important. It contains varied prose and code, not
enough aligned near-duplicate blocks to justify structural deltas. v2 does not
pretend otherwise. Improving that class substantially would require a separate
generic entropy/context-coding version, not looser structural matching.

The supplied JavaScript is 48.6% shorter than its raw source after both layers.
Most of that win already comes from v1's exact copy grammar; v2 finds four
larger sparse-delta regions and removes another 21 symbols.

## Verification

- frozen ha.mr ASCII, QR, and emoji fixtures remain exact;
- v1 remains decodable and byte-for-byte stable for unambiguous transports;
- v2 round trips through ASCII, QR, and emoji alphabets;
- deterministic tests cover chained block generations and sparse edits;
- ignored research harnesses exercise 10,000 emoji transports and 1,200
  randomized structural streams;
- magic, declared length, fatal UTF-8 decode, trailing sentinel, and CRC-32 all
  still fail closed.

The ignored research harnesses live under `.research/` during development so
large or remotely fetched corpora never become deployable site assets.
