// The blog's scroll-following TOC, scoped to a preview instead of window.hash.
export function installReadingNavigation (root) {
  const menu = root.querySelector(':scope > .lnkr-jekyll-layout > [data-jekyll-toc]');
  if (!menu || menu.__lnkrReading) return;
  menu.__lnkrReading = true;
  const doc = root.ownerDocument, win = doc.defaultView;
  const links = [...menu.querySelectorAll('a[href^="#"]')];
  const headings = [...root.querySelectorAll('.lnkr-jekyll-body h2[id],.lnkr-jekyll-body h3[id]')];
  const pairs = links.map(link => ({link, heading: headings.find(h => h.id === decodeURIComponent(link.getAttribute('href').slice(1)))})).filter(p => p.heading);
  if (!pairs.length || !win) return;
  const nav = menu.querySelector('nav');
  let pending = false, active;
  function update () {
    pending = false;
    let edge = 80;
    for (let node = root; node && node !== doc.body; node = node.parentElement) {
      if (/(auto|scroll)/.test(win.getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1) {
        edge = Math.max(0,node.getBoundingClientRect().top) + 80; break;
      }
    }
    let current = pairs[0];
    for (const pair of pairs) {
      if (pair.heading.getClientRects().length && pair.heading.getBoundingClientRect().top <= edge) current = pair;
    }
    if (current === active) return;
    active = current;
    for (const pair of pairs) {
      pair.link.classList.toggle('active', pair === current);
      if (pair === current) pair.link.setAttribute('aria-current','location');
      else pair.link.removeAttribute('aria-current');
    }
    if (menu.open) {
      const item = current.link.getBoundingClientRect(), box = nav.getBoundingClientRect();
      if (item.top < box.top) nav.scrollTop -= box.top - item.top;
      else if (item.bottom > box.bottom) nav.scrollTop += item.bottom - box.bottom;
    }
  }
  const schedule = () => {
    if (!menu.isConnected) { cleanup(); return; }
    if (!pending) { pending = true; win.requestAnimationFrame(update); }
  };
  const resize = new win.ResizeObserver(schedule);
  const cleanup = () => {
    doc.removeEventListener('scroll',schedule,true); win.removeEventListener('resize',schedule); resize.disconnect();
  };
  doc.addEventListener('scroll',schedule,{capture:true,passive:true});
  win.addEventListener('resize',schedule,{passive:true});
  resize.observe(root); menu.addEventListener('toggle',schedule);
  // A srcdoc can finish parsing before its first layout. Measure after a frame,
  // then keep tracking late font/image/layout changes through the observer.
  schedule();
}

export function readingNavigationBootstrap () {
  return `(()=>{const install=${installReadingNavigation.toString()};const ready=()=>document.querySelectorAll('.lnkr-theme-jekyll').forEach(install);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready,{once:true});else ready();})();`;
}
