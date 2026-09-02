const executableModes = Object.freeze({
  "r:": "javascript",
  "m:": "markdown",
  "h:": "html"
});

const executablePrefixes = Object.freeze({
  javascript: "r:",
  markdown: "m:",
  html: "h:"
});

export function executablePrefixForKind (kind) {
  return executablePrefixes[kind] || "";
}

export function splitExecutableFragment (fragment) {
  for (const [prefix, kind] of Object.entries(executableModes)) {
    if (fragment.startsWith(prefix)) {
      return {
        executableKind: kind,
        payload: fragment.slice(prefix.length)
      };
    }
  }

  return { executableKind: "", payload: fragment };
}
