import { describe, expect, test } from "bun:test";
import { compress, decompress } from "../docs/compress.js";
import {
  outputAlphabetASCII,
  outputAlphabetEmoji,
  outputAlphabetQR
} from "../docs/alphabets.js";

// Exact outputs captured from p2r3/ha.mr at ac46e7c before ln.kr changes.
const fixtures = [
  {
    alphabet: outputAlphabetASCII,
    input: "https://example.com/",
    output: "~Uk6",
    decoded: "https://example.com"
  },
  {
    alphabet: outputAlphabetASCII,
    input: "https://www.reddit.com/r/javascript/comments/abc123/example/?utm_source=test#code",
    output: "W4nZBI]'jq-*hK3VhBfLZ7n88p_,-4OOI+]CYLO3ujGMV$lRSqj",
    decoded: "https://www.reddit.com/r/javascript/comments/abc123/example?utm_source=test#code"
  },
  {
    alphabet: outputAlphabetASCII,
    input: "http://localhost:8080/a/a/a/a?x=1&x=2",
    output: "(qhpIL]0)D@#xVp,slZ@9H/O0XaRgl!",
    decoded: "http://localhost:8080/a/a/a/a?x=1&x=2"
  },
  {
    alphabet: outputAlphabetASCII,
    input: "https://example.com/path/to/resource?value=a=b=c",
    output: "OEO/P(yJ.LuQ,i8ay$RWdm)9;k!PP!",
    decoded: "https://example.com/path/to/resource?value=a=b=c"
  },
  {
    alphabet: outputAlphabetEmoji,
    input: "https://example.com/emoji/%F0%9F%90%A2?q=%F0%9F%8C%8A",
    output: "🧑🏻‍❤️‍💋‍🧑🏼🚀🇹🇻🦘🪯🙍🏽‍♂️💱🤠🧑🏻‍❤️‍🧑🏿🧑🏿‍❤️‍🧑🏼🇱🇷🇧🇬🫵🏽💷🇪🇬🤵🏾‍♂️🧑🏿‍🦼🔕🇧🇩",
    decoded: "https://example.com/emoji/%f0%9f%90%a2?q=%f0%9f%8c%8a"
  },
  {
    alphabet: outputAlphabetQR,
    input: "https://github.com/p2r3/ha.mr",
    output: "9KK/TR/NJ82/S4$",
    decoded: "https://github.com/p2r3/ha.mr"
  }
];

describe("upstream ha.mr compatibility", () => {
  for (const fixture of fixtures) {
    test(fixture.input, () => {
      expect(compress(fixture.input, fixture.alphabet)).toBe(fixture.output);
      expect(decompress(fixture.output, fixture.alphabet)).toBe(fixture.decoded);
    });
  }
});
