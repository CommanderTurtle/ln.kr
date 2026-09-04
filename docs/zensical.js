const blockHeader = /^(\s*)(!!!|\?\?\?\+?)\s+(?:([\w-]+)(?:\s+(inline(?:\s+end)?))?)?(?:\s*"([^"]*)")?\s*$/;
const tabHeader = /^(\s*)===\s+"([^"]+)"\s*$/;
const fenceHeader = /^(\s*)(`{3,}|~{3,})\s*(.*)$/;

export const zensicalExtensions = Object.freeze([
  "abbr", "admonition", "attr_list", "def_list", "footnotes", "md_in_html",
  "pymdownx.caret", "pymdownx.details", "pymdownx.snippets", "pymdownx.inlinehilite",
  "pymdownx.smartsymbols", "pymdownx.mark", "pymdownx.tilde", "pymdownx.keys",
  "pymdownx.highlight", "pymdownx.superfences", "pymdownx.tabbed", "pymdownx.emoji",
  "pymdownx.arithmatex", "pymdownx.magiclink", "pymdownx.tasklist", "pymdownx.betterem",
  "zensical.extensions.glightbox", "toc"
]);

const emoji = Object.freeze({
  smile: "😄", heart: "❤️", warning: "⚠️", fire: "🔥", rocket: "🚀",
  tada: "🎉", sparkles: "✨", white_check_mark: "✅", x: "❌", bulb: "💡",
  eyes: "👀", memo: "📝", link: "🔗", lock: "🔒", unlock: "🔓",
  gear: "⚙️", wrench: "🔧", package: "📦", computer: "💻", globe_with_meridians: "🌐",
  arrow_right: "➡️", arrow_left: "⬅️", heavy_plus_sign: "➕", heavy_minus_sign: "➖"
});

const iconGlyphs = Object.freeze({
  github: "◉", "mark-github-16": "◉", "font-awesome": "◈", flask: "⚗",
  "circle-info": "i", info: "i", skull: "☠", warning: "!", check: "✓",
  heart: "♥", link: "↗", code: "</>", copy: "⎘", search: "⌕"
});

const admonitionTitles = Object.freeze({
  note: "Note", abstract: "Abstract", info: "Info", tip: "Tip", success: "Success",
  question: "Question", warning: "Warning", failure: "Failure", danger: "Danger",
  bug: "Bug", example: "Example", quote: "Quote"
});

function indentWidth (line) {
  let width = 0;
  for (const character of line) {
    if (character === " ") width++;
    else if (character === "\t") width += 4;
    else break;
  }
  return width;
}

function stripIndent (line, width) {
  let index = 0;
  let removed = 0;
  while (index < line.length && removed < width) {
    if (line[index] === " ") removed++;
    else if (line[index] === "\t") removed += 4;
    else break;
    index++;
  }
  return line.slice(index);
}

function indentedBody (lines, start, parentIndent) {
  const body = [];
  let index = start;
  for (; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) {
      body.push("");
      continue;
    }
    if (indentWidth(line) < parentIndent + 4) break;
    body.push(stripIndent(line, parentIndent + 4));
  }
  while (body.at(-1) === "") body.pop();
  return { body: body.join("\n"), next: index };
}

function newState () {
  return {
    abbreviations: new Map(),
    blocks: new Map(),
    code: new Map(),
    footnotes: new Map(),
    footnoteOrder: [],
    nextBlock: 0,
    nextCode: 0,
    nextTabs: 0
  };
}

function blockSlot (state, record) {
  const id = String(++state.nextBlock);
  state.blocks.set(id, record);
  return `\n<div class="zensical-block-slot" data-zensical-block="${id}"></div>\n`;
}

function attributeTokens (source) {
  const tokens = [];
  const pattern = /(?:^|\s+)(\.[-\w]+|#[-\w]+|[-\w:]+(?:=(?:"[^"]*"|'[^']*'|[^\s]+))?)/g;
  for (const match of String(source).matchAll(pattern)) tokens.push(match[1]);
  return tokens;
}

export function parseZensicalAttributes (source) {
  const attributes = [];
  const classes = [];
  let id = "";
  for (const token of attributeTokens(source)) {
    if (token.startsWith(".")) classes.push(token.slice(1));
    else if (token.startsWith("#")) id = token.slice(1);
    else {
      const equal = token.indexOf("=");
      if (equal < 0) attributes.push([token, ""]);
      else {
        const name = token.slice(0, equal);
        const raw = token.slice(equal + 1);
        const value = /^(["']).*\1$/.test(raw) ? raw.slice(1, -1) : raw;
        attributes.push([name, value]);
      }
    }
  }
  return { attributes, classes, id };
}

function fenceMetadata (info) {
  let value = String(info).trim();
  if (value.startsWith("{") && value.endsWith("}")) value = value.slice(1, -1).trim();
  const language = value.match(/^(?:\.[-\w]+|[-\w]+)/)?.[0]?.replace(/^\./, "") || "";
  const options = Object.fromEntries(Array.from(value.matchAll(
    /([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g
  ), match => [match[1], match[2] ?? match[3] ?? match[4] ?? ""]));
  const attrs = parseZensicalAttributes(value);
  return {
    language,
    title: options.title || "",
    linenums: options.linenums || "",
    highlights: options.hl_lines || "",
    classes: attrs.classes,
    id: attrs.id
  };
}

function prepareFragment (input, state) {
  const lines = String(input).replace(/\r\n?|\u2028|\u2029/g, "\n").split("\n");
  const output = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const abbreviation = line.match(/^\*\[([^\]]+)\]:\s*(.+)$/);
    if (abbreviation) {
      state.abbreviations.set(abbreviation[1], abbreviation[2]);
      index++;
      continue;
    }

    const footnote = line.match(/^\[\^([^\]]+)\]:\s*(.*)$/);
    if (footnote) {
      const continuation = indentedBody(lines, index + 1, 0);
      state.footnotes.set(footnote[1], [footnote[2], continuation.body].filter(Boolean).join("\n"));
      index = continuation.next;
      continue;
    }

    const fence = line.match(fenceHeader);
    if (fence) {
      const meta = fenceMetadata(fence[3]);
      const marker = String(++state.nextCode);
      state.code.set(marker, meta);
      output.push(`<!--zensical-code:${marker}-->`);
      output.push(`${fence[1]}${fence[2]}${meta.language}`);
      index++;
      const close = new RegExp(`^${fence[1]}${fence[2][0]}{${fence[2].length},}\\s*$`);
      while (index < lines.length) {
        output.push(lines[index]);
        const closed = close.test(lines[index]);
        index++;
        if (closed) break;
      }
      continue;
    }

    const tabs = line.match(tabHeader);
    if (tabs) {
      const records = [];
      const baseIndent = indentWidth(tabs[1]);
      let cursor = index;
      while (cursor < lines.length) {
        const header = lines[cursor].match(tabHeader);
        if (!header || indentWidth(header[1]) !== baseIndent) break;
        const nested = indentedBody(lines, cursor + 1, baseIndent);
        records.push({ body: nested.body, label: header[2] });
        cursor = nested.next;
        while (cursor < lines.length && !lines[cursor].trim()) cursor++;
      }
      output.push(blockSlot(state, { type: "tabs", tabs: records }));
      index = cursor;
      continue;
    }

    const admonition = line.match(blockHeader);
    if (admonition) {
      const nested = indentedBody(lines, index + 1, indentWidth(admonition[1]));
      const kind = (admonition[3] || "note").toLowerCase();
      output.push(blockSlot(state, {
        body: nested.body,
        collapsible: admonition[2].startsWith("???"),
        open: admonition[2] === "???+",
        kind,
        modifier: admonition[4] || "",
        title: admonition[5] === undefined
          ? (admonitionTitles[kind] || kind)
          : admonition[5],
        type: "admonition"
      }));
      index = nested.next;
      continue;
    }

    if (line.trim() && !/^\s*(?:[#>*+\-]|\d+[.)])\s/.test(line)) {
      let definitionIndex = index + 1;
      if (!lines[definitionIndex]?.trim()) definitionIndex++;
      if (/^\s*:\s+/.test(lines[definitionIndex] || "")) {
        const definitions = [];
        while (definitionIndex < lines.length) {
          const first = lines[definitionIndex].match(/^\s*:\s+(.*)$/);
          if (!first) break;
          const nested = indentedBody(lines, definitionIndex + 1, 0);
          definitions.push([first[1], nested.body].filter(Boolean).join("\n"));
          definitionIndex = nested.next;
          while (definitionIndex < lines.length && !lines[definitionIndex].trim()) definitionIndex++;
        }
        output.push(blockSlot(state, { type: "definition", term: line.trim(), definitions }));
        index = definitionIndex;
        continue;
      }
    }

    output.push(line);
    index++;
  }

  return output.join("\n");
}

function slug (value) {
  return String(value).toLowerCase().trim()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-|-$/g, "") || "section";
}

function parseInline (parser, source) {
  return parser.parseInline(String(source), { gfm: true, breaks: false });
}

function attachCodeMetadata (container, state) {
  const document = container.ownerDocument;
  const showComment = document.defaultView?.NodeFilter?.SHOW_COMMENT ?? 128;
  const walker = document.createTreeWalker(container, showComment);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const comment of comments) {
    const match = comment.data.match(/^zensical-code:(\d+)$/);
    if (!match) continue;
    let next = comment.nextSibling;
    while (next?.nodeType === 3 && !next.textContent.trim()) next = next.nextSibling;
    const pre = next?.matches?.("pre") ? next : next?.querySelector?.("pre");
    const metadata = state.code.get(match[1]);
    if (pre && metadata) pre.dataset.zensicalCode = JSON.stringify(metadata);
    comment.remove();
  }
}

async function renderFragment (container, source, parser, state) {
  const prepared = prepareFragment(source, state);
  container.innerHTML = parser.parse(prepared, {
    gfm: true, breaks: false, pedantic: false, silent: false
  });
  attachCodeMetadata(container, state);

  const slots = Array.from(container.querySelectorAll(".zensical-block-slot[data-zensical-block]"));
  for (const slot of slots) {
    const block = state.blocks.get(slot.dataset.zensicalBlock);
    if (!block) continue;
    const document = container.ownerDocument;

    if (block.type === "admonition") {
      const shell = document.createElement(block.collapsible ? "details" : "aside");
      shell.className = `admonition ${block.kind}${block.modifier ? ` ${block.modifier.replace(/\s+/g, " ")}` : ""}`;
      if (block.open) shell.open = true;
      const title = document.createElement(block.collapsible ? "summary" : "p");
      title.className = "admonition-title";
      title.innerHTML = parseInline(parser, block.title);
      if (!block.title) title.hidden = true;
      const body = document.createElement("div");
      body.className = "admonition-body";
      shell.append(title, body);
      slot.replaceWith(shell);
      await renderFragment(body, block.body, parser, state);
      continue;
    }

    if (block.type === "tabs") {
      const group = String(++state.nextTabs);
      const shell = document.createElement("section");
      shell.className = "zensical-tabs";
      const tablist = document.createElement("div");
      tablist.className = "zensical-tab-list";
      tablist.setAttribute("role", "tablist");
      const panels = document.createElement("div");
      panels.className = "zensical-tab-panels";
      shell.append(tablist, panels);
      slot.replaceWith(shell);

      for (const [position, tab] of block.tabs.entries()) {
        const label = slug(tab.label);
        const tabId = `zensical-tab-${group}-${position + 1}`;
        const panelId = `${tabId}-panel`;
        const button = document.createElement("button");
        button.type = "button";
        button.id = tabId;
        button.className = "zensical-tab";
        button.dataset.zensicalTab = label;
        button.setAttribute("role", "tab");
        button.setAttribute("aria-controls", panelId);
        button.setAttribute("aria-selected", String(position === 0));
        button.tabIndex = position === 0 ? 0 : -1;
        button.innerHTML = parseInline(parser, tab.label);
        const panel = document.createElement("div");
        panel.id = panelId;
        panel.className = "zensical-tab-panel";
        panel.dataset.zensicalPanel = label;
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tabId);
        panel.hidden = position !== 0;
        tablist.append(button);
        panels.append(panel);
        await renderFragment(panel, tab.body, parser, state);
      }
      continue;
    }

    if (block.type === "definition") {
      const list = document.createElement("dl");
      list.className = "zensical-def-list";
      const term = document.createElement("dt");
      term.innerHTML = parseInline(parser, block.term);
      list.append(term);
      slot.replaceWith(list);
      for (const definition of block.definitions) {
        const detail = document.createElement("dd");
        list.append(detail);
        await renderFragment(detail, definition, parser, state);
      }
    }
  }

  const markdownNodes = Array.from(container.querySelectorAll("[markdown]"))
    .filter(node => node.closest("[markdown]") === node);
  for (const node of markdownNodes) {
    const mode = node.getAttribute("markdown");
    const nestedSource = node.innerHTML;
    node.removeAttribute("markdown");
    if (mode === "span") node.innerHTML = parseInline(parser, nestedSource);
    else await renderFragment(node, nestedSource, parser, state);
  }
}

function applyAttributes (element, source) {
  const parsed = parseZensicalAttributes(source);
  if (parsed.id) element.id = parsed.id;
  if (parsed.classes.length) element.classList.add(...parsed.classes);
  for (const [name, value] of parsed.attributes) element.setAttribute(name, value);
}

function applyAttributeLists (container) {
  for (const paragraph of Array.from(container.querySelectorAll("p"))) {
    if (paragraph.children.length) continue;
    const match = paragraph.textContent.match(/^\s*\{([^{}]+)\}\s*$/);
    if (!match || !paragraph.previousElementSibling) continue;
    applyAttributes(paragraph.previousElementSibling, match[1]);
    paragraph.remove();
  }

  const document = container.ownerDocument;
  const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = document.createTreeWalker(container, showText);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const match = node.data.match(/^\s*\{([^{}]+)\}/);
    let previous = node.previousSibling;
    while (previous?.nodeType === 3 && !previous.textContent.trim()) previous = previous.previousSibling;
    if (!match || !previous?.classList) continue;
    applyAttributes(previous, match[1]);
    node.data = node.data.slice(match[0].length);
  }
}

function textNodes (root, extraExcluded = "") {
  const excluded = `pre,code,script,style,textarea,kbd,samp,math,svg,.lnkr-module-token,.arithmatex${extraExcluded}`;
  const document = root.ownerDocument;
  const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
  const walker = document.createTreeWalker(root, showText);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement?.closest(excluded)) nodes.push(node);
  }
  return nodes;
}

function replaceTextPattern (root, pattern, replacer, excluded = "") {
  for (const node of textNodes(root, excluded)) {
    pattern.lastIndex = 0;
    if (!pattern.test(node.data)) continue;
    pattern.lastIndex = 0;
    const fragment = root.ownerDocument.createDocumentFragment();
    let cursor = 0;
    for (const match of node.data.matchAll(pattern)) {
      fragment.append(node.data.slice(cursor, match.index));
      const replacement = replacer(match, root.ownerDocument);
      if (replacement) fragment.append(replacement);
      else fragment.append(match[0]);
      cursor = match.index + match[0].length;
    }
    fragment.append(node.data.slice(cursor));
    node.replaceWith(fragment);
  }
}

function simpleElement (document, tag, text, className = "") {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function inlineExtensions (container, state) {
  replaceTextPattern(container, /\[\^([^\]]+)\]/g, (match, document) => {
    const id = match[1];
    if (!state.footnotes.has(id)) return null;
    let number = state.footnoteOrder.indexOf(id) + 1;
    if (!number) {
      state.footnoteOrder.push(id);
      number = state.footnoteOrder.length;
    }
    const sup = document.createElement("sup");
    sup.className = "footnote-ref";
    const link = document.createElement("a");
    link.href = `#fn-${slug(id)}`;
    link.id = `fnref-${slug(id)}`;
    link.title = state.footnotes.get(id).replace(/\s+/g, " ").trim();
    link.textContent = String(number);
    sup.append(link);
    return sup;
  });

  replaceTextPattern(container, /==([^=\n]+)==/g, (match, document) => simpleElement(document, "mark", match[1]));
  replaceTextPattern(container, /\^\^([^\n]+?)\^\^/g, (match, document) => simpleElement(document, "ins", match[1]));
  replaceTextPattern(container, /\+\+([^+\n]+(?:\+[^+\n]+)*)\+\+/g, (match, document) => {
    const span = document.createElement("span");
    span.className = "keys";
    for (const [index, key] of match[1].split("+").entries()) {
      if (index) span.append(simpleElement(document, "span", "+", "key-separator"));
      span.append(simpleElement(document, "kbd", key.replace(/-/g, " ")));
    }
    return span;
  });
  replaceTextPattern(container, /(?<!\^)\^([^\^\n]+)\^(?!\^)/g, (match, document) => simpleElement(document, "sup", match[1]));
  replaceTextPattern(container, /(?<!~)~([^~\n]+)~(?!~)/g, (match, document) => simpleElement(document, "sub", match[1]));

  replaceTextPattern(container, /:([a-z][a-z0-9_+-]*):/g, (match, document) => {
    if (!emoji[match[1]]) return null;
    const visual = simpleElement(document, "span", emoji[match[1]], "zensical-emoji");
    visual.setAttribute("role", "img");
    visual.setAttribute("aria-label", match[1].replaceAll("_", " "));
    return visual;
  });
  replaceTextPattern(container, /:((?:fontawesome|material|octicons|simple|lucide)-[a-z0-9_-]+):/g, (match, document) => {
    const tail = match[1].split("-").slice(2).join("-");
    const glyph = Object.entries(iconGlyphs).find(([name]) => tail.endsWith(name))?.[1] || "◇";
    const visual = simpleElement(document, "span", glyph, "zensical-icon");
    visual.title = match[1].replaceAll("-", " ");
    visual.setAttribute("role", "img");
    visual.setAttribute("aria-label", visual.title);
    return visual;
  });

  const github = "https://github.com/CommanderTurtle/docs-pages";
  replaceTextPattern(container, /(?<![\w/])([#!?])(\d+)\b/g, (match, document) => {
    const link = document.createElement("a");
    link.className = "magiclink";
    link.href = `${github}/${match[1] === "!" ? "pull" : match[1] === "?" ? "discussions" : "issues"}/${match[2]}`;
    link.textContent = `#${match[2]}`;
    return link;
  }, ",a");
  replaceTextPattern(container, /(?<![\w/])@([a-z\d](?:[a-z\d-]{0,37}[a-z\d])?)\b/gi, (match, document) => {
    const link = document.createElement("a");
    link.className = "magiclink";
    link.href = `https://github.com/${match[1]}`;
    link.textContent = match[0];
    return link;
  }, ",a");

  if (state.abbreviations.size) {
    const names = Array.from(state.abbreviations.keys()).sort((a, b) => b.length - a.length);
    const escaped = names.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`(?<![\\p{Letter}\\p{Number}_])(${escaped.join("|")})(?![\\p{Letter}\\p{Number}_])`, "gu");
    replaceTextPattern(container, pattern, (match, document) => {
      const abbreviation = simpleElement(document, "abbr", match[1]);
      abbreviation.title = state.abbreviations.get(match[1]);
      return abbreviation;
    }, ",abbr");
  }

  for (const node of textNodes(container)) {
    node.data = node.data
      .replace(/\(tm\)/gi, "™").replace(/\(c\)/gi, "©").replace(/\(r\)/gi, "®")
      .replace(/\bc\/o\b/gi, "℅").replace(/\+\/-/g, "±").replace(/<-->/g, "↔")
      .replace(/-->/g, "→").replace(/<--/g, "←").replace(/=\/=|!=/g, "≠")
      .replace(/\b1\/2\b/g, "½").replace(/\b1\/4\b/g, "¼").replace(/\b3\/4\b/g, "¾")
      .replace(/\.\.\./g, "…");
  }

  replaceTextPattern(container,
    /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([^\n]+?)\\\)|(?<!\$)\$([^$\n]+?)\$(?!\$)/g,
    (match, document) => {
      const display = match[1] !== undefined || match[2] !== undefined;
      const formula = match[1] ?? match[2] ?? match[3] ?? match[4];
      const math = simpleElement(document, "span", display ? `\\[${formula}\\]` : `\\(${formula}\\)`, "arithmatex");
      math.dataset.display = String(display);
      return math;
    }
  );
}

async function appendFootnotes (container, parser, state) {
  if (!state.footnoteOrder.length) return;
  const document = container.ownerDocument;
  const section = document.createElement("section");
  section.className = "footnotes";
  section.setAttribute("role", "doc-endnotes");
  section.append(document.createElement("hr"));
  const list = document.createElement("ol");
  section.append(list);
  container.append(section);

  for (const id of state.footnoteOrder) {
    const item = document.createElement("li");
    item.id = `fn-${slug(id)}`;
    item.setAttribute("role", "doc-endnote");
    list.append(item);
    await renderFragment(item, state.footnotes.get(id), parser, state);
    const backlink = document.createElement("a");
    backlink.className = "footnote-backref";
    backlink.href = `#fnref-${slug(id)}`;
    backlink.setAttribute("aria-label", "Back to reference");
    backlink.textContent = "↩";
    item.append(backlink);
  }
  applyAttributeLists(section);
  inlineExtensions(section, state);
}

function headingPermalinks (container) {
  const used = new Set();
  const headings = Array.from(container.querySelectorAll("h1,h2,h3,h4,h5,h6"));
  for (const heading of headings) {
    let id = heading.id || slug(heading.textContent);
    const base = id;
    let suffix = 1;
    while (used.has(id)) id = `${base}-${++suffix}`;
    used.add(id);
    heading.id = id;
    const permalink = heading.ownerDocument.createElement("a");
    permalink.className = "headerlink";
    permalink.href = `#${id}`;
    permalink.setAttribute("aria-label", `Permalink to ${heading.textContent.trim()}`);
    permalink.textContent = "¶";
    heading.append(permalink);
  }

  for (const paragraph of Array.from(container.querySelectorAll("p"))) {
    if (paragraph.textContent.trim().toUpperCase() !== "[TOC]") continue;
    const navigation = paragraph.ownerDocument.createElement("nav");
    navigation.className = "zensical-toc";
    navigation.setAttribute("aria-label", "Table of contents");
    const list = paragraph.ownerDocument.createElement("ul");
    for (const heading of headings) {
      const item = paragraph.ownerDocument.createElement("li");
      item.className = `toc-level-${heading.tagName.slice(1)}`;
      const link = paragraph.ownerDocument.createElement("a");
      link.href = `#${heading.id}`;
      link.textContent = heading.childNodes[0]?.textContent || heading.textContent.replace(/¶$/, "");
      item.append(link);
      list.append(item);
    }
    navigation.append(list);
    paragraph.replaceWith(navigation);
  }
}

function inlineHighlightMarkers (container) {
  for (const code of container.querySelectorAll("code:not(pre code)")) {
    const match = code.textContent.match(/^#!([\w+-]+)\s+([\s\S]*)$/);
    if (!match) continue;
    code.dataset.inlineLanguage = match[1];
    code.textContent = match[2];
  }
}

function lightboxImages (container) {
  for (const image of container.querySelectorAll("img:not(.off-glb)")) {
    if (image.closest("a,button,.lnkr-module-source")) continue;
    image.dataset.zensicalLightbox = image.currentSrc || image.src;
    image.tabIndex = image.tabIndex < 0 ? 0 : image.tabIndex;
    image.setAttribute("role", "button");
    image.setAttribute("aria-label", image.alt ? `Open ${image.alt}` : "Open image");
  }
}

function activateTab (button, root = button.ownerDocument) {
  const shell = button.closest(".zensical-tabs");
  if (!shell) return;
  const label = button.dataset.zensicalTab;
  for (const tab of shell.querySelectorAll(":scope > .zensical-tab-list > .zensical-tab")) {
    const selected = tab === button;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of shell.querySelectorAll(":scope > .zensical-tab-panels > .zensical-tab-panel")) {
    panel.hidden = panel.dataset.zensicalPanel !== label;
  }
  for (const linked of root.querySelectorAll(`.zensical-tab[data-zensical-tab="${CSS.escape(label)}"]`)) {
    if (linked === button || linked.closest(".zensical-tabs") === shell) continue;
    const linkedShell = linked.closest(".zensical-tabs");
    linked.setAttribute("aria-selected", "true");
    linked.tabIndex = 0;
    for (const peer of linkedShell.querySelectorAll(":scope > .zensical-tab-list > .zensical-tab")) {
      if (peer !== linked) { peer.setAttribute("aria-selected", "false"); peer.tabIndex = -1; }
    }
    for (const panel of linkedShell.querySelectorAll(":scope > .zensical-tab-panels > .zensical-tab-panel")) {
      panel.hidden = panel.dataset.zensicalPanel !== label;
    }
  }
}

function showLightbox (image) {
  const document = image.ownerDocument;
  const overlay = document.createElement("dialog");
  overlay.className = "zensical-lightbox";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "zensical-lightbox-close";
  close.setAttribute("aria-label", "Close image");
  close.textContent = "×";
  const full = document.createElement("img");
  full.src = image.dataset.zensicalLightbox || image.src;
  full.alt = image.alt;
  overlay.append(close, full);
  document.body.append(overlay);
  close.addEventListener("click", () => overlay.close());
  overlay.addEventListener("click", event => { if (event.target === overlay) overlay.close(); });
  overlay.addEventListener("close", () => overlay.remove(), { once: true });
  overlay.showModal();
}

export function installZensicalInteractions (container) {
  if (container.dataset.zensicalInteractions) return;
  container.dataset.zensicalInteractions = "true";
  container.addEventListener("click", event => {
    const tab = event.target.closest?.(".zensical-tab[data-zensical-tab]");
    if (tab) { activateTab(tab, container); return; }
    const image = event.target.closest?.("img[data-zensical-lightbox]");
    if (image) showLightbox(image);
  });
  container.addEventListener("keydown", event => {
    const image = event.target.closest?.("img[data-zensical-lightbox]");
    if (image && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      showLightbox(image);
    }
  });
}

/** Pure syntax inventory used by tests and lightweight embedding diagnostics. */
export function inspectZensicalMarkdown (source) {
  const state = newState();
  const markdown = prepareFragment(source, state);
  return {
    markdown,
    abbreviations: Object.fromEntries(state.abbreviations),
    blocks: Array.from(state.blocks.values()),
    code: Array.from(state.code.values()),
    footnotes: Object.fromEntries(state.footnotes)
  };
}

/** Parse the render-related extensions enabled by orc/docs/zensical.fs. */
export async function renderZensicalMarkdown (container, source, parser) {
  const state = newState();
  await renderFragment(container, source, parser, state);
  applyAttributeLists(container);
  inlineExtensions(container, state);
  await appendFootnotes(container, parser, state);
  headingPermalinks(container);
  inlineHighlightMarkers(container);
  lightboxImages(container);
  installZensicalInteractions(container);
  return { hasMath: Boolean(container.querySelector(".arithmatex")) };
}

export function zensicalInteractionBootstrap () {
  return `
  const activateZensicalTab = button => {
    const shell = button.closest('.zensical-tabs'); if (!shell) return;
    const label = button.dataset.zensicalTab;
    for (const tab of shell.querySelectorAll(':scope > .zensical-tab-list > .zensical-tab')) {
      const selected = tab === button; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1;
    }
    for (const panel of shell.querySelectorAll(':scope > .zensical-tab-panels > .zensical-tab-panel')) panel.hidden = panel.dataset.zensicalPanel !== label;
    for (const linked of document.querySelectorAll('.zensical-tab[data-zensical-tab="' + CSS.escape(label) + '"]')) {
      const linkedShell = linked.closest('.zensical-tabs');
      if (!linkedShell || linkedShell === shell) continue;
      for (const peer of linkedShell.querySelectorAll(':scope > .zensical-tab-list > .zensical-tab')) { const selected = peer === linked; peer.setAttribute('aria-selected', String(selected)); peer.tabIndex = selected ? 0 : -1; }
      for (const panel of linkedShell.querySelectorAll(':scope > .zensical-tab-panels > .zensical-tab-panel')) panel.hidden = panel.dataset.zensicalPanel !== label;
    }
  };
  const openZensicalImage = image => {
    const dialog = document.createElement('dialog'); dialog.className = 'zensical-lightbox';
    const close = document.createElement('button'); close.type = 'button'; close.className = 'zensical-lightbox-close'; close.textContent = '×';
    const full = document.createElement('img'); full.src = image.dataset.zensicalLightbox || image.src; full.alt = image.alt;
    dialog.append(close, full); document.body.append(dialog); close.onclick = () => dialog.close(); dialog.onclick = event => { if (event.target === dialog) dialog.close(); }; dialog.onclose = () => dialog.remove(); dialog.showModal();
  };
  document.addEventListener('click', event => {
    const tab = event.target.closest?.('.zensical-tab[data-zensical-tab]'); if (tab) { activateZensicalTab(tab); return; }
    const image = event.target.closest?.('img[data-zensical-lightbox]'); if (image) openZensicalImage(image);
  });`;
}
