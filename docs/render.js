function appendInline (container, source) {
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\)|https?:\/\/[^\s<]+)/g;
  let cursor = 0;

  for (const match of source.matchAll(pattern)) {
    container.append(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];

    if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      container.append(code);
    } else if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      container.append(strong);
    } else if (token.startsWith("~~")) {
      const strike = document.createElement("s");
      strike.textContent = token.slice(2, -2);
      container.append(strike);
    } else {
      const markdownLink = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      const href = markdownLink ? markdownLink[2] : token.replace(/[.,;:!?]+$/, "");
      const suffix = token.slice(href.length + (markdownLink ? 0 : 0));
      let parsed;
      try {
        parsed = new URL(href, window.location.href);
      } catch {
        parsed = null;
      }
      if (parsed && ["http:", "https:", "mailto:"].includes(parsed.protocol)) {
        const link = document.createElement("a");
        link.href = parsed.href;
        link.textContent = markdownLink ? markdownLink[1] : href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        container.append(link);
        if (!markdownLink && suffix) container.append(document.createTextNode(suffix));
      } else {
        container.append(document.createTextNode(token));
      }
    }

    cursor = match.index + token.length;
  }

  container.append(document.createTextNode(source.slice(cursor)));
}

function splitTableRow (line) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
}

function isTableDivider (line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart (lines, index) {
  const line = lines[index] || "";
  return !line.trim() || /^(#{1,6})\s+/.test(line) || /^```/.test(line) ||
    /^\s*(?:[-*+] |\d+\. )/.test(line) || /^>\s?/.test(line) ||
    /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line) ||
    (line.includes("|") && isTableDivider(lines[index + 1] || ""));
}

export function renderMarkdown (container, source) {
  container.replaceChildren();
  const lines = source.split(/\r\n|\r|\n/);
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index ++;
      continue;
    }

    const fence = line.match(/^```\s*([^\s`]*)/);
    if (fence) {
      const body = [];
      index ++;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        body.push(lines[index ++]);
      }
      if (index < lines.length) index ++;
      const pre = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = body.join("\n");
      if (fence[1]) code.dataset.language = fence[1];
      pre.append(code);
      container.append(pre);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInline(element, heading[2]);
      container.append(element);
      index ++;
      continue;
    }

    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      container.append(document.createElement("hr"));
      index ++;
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1] || "")) {
      const table = document.createElement("table");
      const head = document.createElement("thead");
      const headRow = document.createElement("tr");
      for (const value of splitTableRow(line)) {
        const cell = document.createElement("th");
        appendInline(cell, value);
        headRow.append(cell);
      }
      head.append(headRow);
      table.append(head);
      index += 2;
      const body = document.createElement("tbody");
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = document.createElement("tr");
        for (const value of splitTableRow(lines[index ++])) {
          const cell = document.createElement("td");
          appendInline(cell, value);
          row.append(cell);
        }
        body.append(row);
      }
      table.append(body);
      container.append(table);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote = document.createElement("blockquote");
      const values = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        values.push(lines[index ++].replace(/^>\s?/, ""));
      }
      appendInline(quote, values.join("\n"));
      container.append(quote);
      continue;
    }

    const listMatch = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const list = document.createElement(ordered ? "ol" : "ul");
      const listPattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      while (index < lines.length) {
        const itemMatch = lines[index].match(listPattern);
        if (!itemMatch) break;
        const item = document.createElement("li");
        appendInline(item, itemMatch[1]);
        list.append(item);
        index ++;
      }
      container.append(list);
      continue;
    }

    const paragraph = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraph.push(lines[index ++].trim());
    }
    if (!paragraph.length) paragraph.push(lines[index ++]);
    const element = document.createElement("p");
    appendInline(element, paragraph.join(" "));
    container.append(element);
  }
}

const javascriptPattern = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:const|let|var|function|return|class|new|if|else|for|while|switch|case|break|continue|try|catch|finally|throw|async|await|import|export|from|true|false|null|undefined|this|typeof|instanceof)\b|\b(?:0x[\da-f]+|\d+(?:\.\d+)?)\b)/gi;

export function renderCode (container, source, language = "text") {
  container.replaceChildren();
  const pre = document.createElement("pre");
  pre.className = "source-code";
  const code = document.createElement("code");
  code.dataset.language = language;

  if (language !== "javascript") {
    code.textContent = source;
  } else {
    let cursor = 0;
    for (const match of source.matchAll(javascriptPattern)) {
      code.append(document.createTextNode(source.slice(cursor, match.index)));
      const span = document.createElement("span");
      const token = match[0];
      span.className = token.startsWith("/") ? "tok-comment" :
        /^[`"']/.test(token) ? "tok-string" :
          /^\d|^0x/i.test(token) ? "tok-number" : "tok-keyword";
      span.textContent = token;
      code.append(span);
      cursor = match.index + token.length;
    }
    code.append(document.createTextNode(source.slice(cursor)));
  }

  pre.append(code);
  container.append(pre);
}

export function renderContent (container, source, kind) {
  if (kind === "markdown") {
    renderMarkdown(container, source);
  } else {
    renderCode(container, source, kind);
  }
}
