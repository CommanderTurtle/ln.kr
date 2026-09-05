// sHEL's Minima adaptation: CommanderTurtle/orc @ df42526f, blog/_includes/
// sharphtml-header.fs and assets/js/sharpjs-main.fs. AGPL-3.0; see README.
// The existing Markdown renderer owns IDs, code tools, tabs and navigation.
export function decorateJekyllMarkdown (root) {
  if (root.querySelector(':scope > [data-jekyll-toc]')) return;
  const headings = [...root.querySelectorAll('h2[id],h3[id]')].filter(heading =>
    !heading.closest('.code-block,.lnkr-module-peek,[data-jekyll-toc]'));
  if (!headings.length) return;
  const doc = root.ownerDocument;
  const menu = doc.createElement('details');
  menu.className = 'lnkr-jekyll-toc';
  menu.dataset.jekyllToc = '';
  const summary = doc.createElement('summary');
  summary.textContent = '☰  On this page';
  const nav = doc.createElement('nav');
  nav.setAttribute('aria-label', 'On this page');
  const list = doc.createElement('ul');
  for (const heading of headings) {
    const item = doc.createElement('li');
    const link = doc.createElement('a');
    const label = heading.cloneNode(true);
    for (const permalink of label.querySelectorAll('.headerlink')) permalink.remove();
    link.textContent = label.textContent.trim();
    link.setAttribute('href', '#' + encodeURIComponent(heading.id));
    item.className = 'toc-' + heading.localName;
    item.append(link); list.append(item);
  }
  nav.append(list); menu.append(summary, nav); root.prepend(menu);
}

// Copy the built theme's palette choices, without its site navigation/scripts.
// More specific media choices take priority over the generic system entry.
export function themePalette (theme, document) {
  const choices = [...theme.querySelectorAll('[data-md-color-media]')].map(node => ({
    media: node.getAttribute('data-md-color-media'),
    attrs: Object.fromEntries(['scheme', 'primary', 'accent'].map(key =>
      ['data-md-color-' + key, node.getAttribute('data-md-color-' + key)]).filter(([,value]) => value))
  }));
  if (choices.length) document.body.dataset.lnkrPalettes = JSON.stringify(choices);
  if (choices.length && globalThis.matchMedia) {
    for (const choice of choices) if (matchMedia(choice.media).matches) {
      for (const [key,value] of Object.entries(choice.attrs)) document.body.setAttribute(key,value);
    }
  }
  return choices;
}
