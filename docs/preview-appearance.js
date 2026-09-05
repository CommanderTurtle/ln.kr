// Three Lucide icons, ISC (see vendor/licenses/lucide-LICENSE).
// Self-contained so serialized Markdown uses exactly the same control.
export function installPreviewAppearance (root, options) {
  const doc = root.ownerDocument;
  if (options && typeof options === 'object') root.__lnkrAppearanceOptions = {...root.__lnkrAppearanceOptions,...options};
  const settings = root.__lnkrAppearanceOptions || {};
  const managed = doc.__lnkrManagedAppearance;
  const paletteHost = root.closest('[data-lnkr-palettes]');
  root.dataset.lnkrAppearance ||= paletteHost ? 'system' : 'dark';
  if (managed) root.dataset.lnkrAppearance = managed.mode;
  let tools = root.__lnkrAppearanceTools || root.querySelector(':scope > .lnkr-preview-tools');
  // The host owns its toolbar; serialized documents still work independently.
  if (managed || settings.toolbar === false) {
    tools?.remove(); tools = null;
  } else if (!tools) {
    tools = doc.createElement('div'); tools.className = 'lnkr-preview-tools';
    const button = doc.createElement('button'); button.type = 'button';
    button.dataset.previewAppearance = ''; tools.append(button);
  }
  if (tools) {
    if (settings.toolbar) settings.toolbar.append(tools);
    else if (tools.parentElement !== root) root.prepend(tools);
    tools.onclick = event => {
      if (!event.target.closest?.('[data-preview-appearance]')) return;
      const mode = root.dataset.lnkrAppearance;
      root.__lnkrAppearance(mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark');
    };
  }
  root.__lnkrAppearanceTools = tools;
  if (!root.__lnkrAppearance) {
    const media = doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
    const icons = {
      light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-9.07-15.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
      dark: '<path d="M18 5h4m-2-2v4M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/>',
      system: '<path d="M12 2v2M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715M16 12a4 4 0 0 0-4-4m7-3-1.256 1.256M20 12h2"/>'
    };
    const update = selected => {
      if (['dark','light','system'].includes(selected)) root.dataset.lnkrAppearance = selected;
      const mode = root.dataset.lnkrAppearance || 'dark';
      const light = mode === 'light' || mode === 'system' && !media?.matches;
      root.dataset.lnkrScheme = light ? 'light' : 'dark';
      const host = root.closest('[data-lnkr-palettes]');
      if (host) {
        const choices = JSON.parse(host.dataset.lnkrPalettes);
        for (const choice of choices) {
          const applies = mode === 'system' ? doc.defaultView?.matchMedia?.(choice.media).matches :
            choice.media.includes(light ? ': light' : ': dark');
          if (applies) for (const [key,value] of Object.entries(choice.attrs)) host.setAttribute(key,value);
        }
      }
      const settings = root.__lnkrAppearanceOptions || {};
      if (settings.chrome) settings.chrome.dataset.lnkrScheme = root.dataset.lnkrScheme;
      settings.onChange?.(mode,root.dataset.lnkrScheme);
      const button = root.__lnkrAppearanceTools?.querySelector('[data-preview-appearance]');
      if (!button) return;
      const next = mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
      const label = `Appearance: ${mode}. Switch to ${next}.`;
      button.setAttribute('aria-label',label); button.title = label;
      button.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[mode]}</svg>`;
    };
    // Detached serialization buffers must not be retained by a window listener.
    if (root.isConnected) media?.addEventListener('change', () => { if (root.isConnected && root.dataset.lnkrAppearance === 'system') update(); });
    root.__lnkrAppearance = update;
  }
  root.__lnkrAppearance();
}

export function previewAppearanceBootstrap (settings = null) {
  return `(() => { const install = ${installPreviewAppearance.toString()};
    const settings = ${JSON.stringify(settings)};
    if(settings) document.__lnkrManagedAppearance = settings;
    const ready = () => {
      document.querySelectorAll('[data-lnkr-appearance]').forEach(install);
      if(!document.__lnkrManagedAppearance) return;
      const root=document.querySelector('.frame-preview[data-lnkr-appearance]');
      if(root) {
        const colors=getComputedStyle(root);
        const background=colors.backgroundColor==='rgba(0, 0, 0, 0)' || colors.backgroundColor==='transparent'
          ? colors.getPropertyValue('--canvas').trim() || '#0c0f0d' : colors.backgroundColor;
        for(const node of [document.documentElement,document.body]) {
          node.style.background=background;
          node.style.colorScheme=root.dataset.lnkrScheme;
        }
      }
    };
    if(settings) {
      addEventListener('message',event=>{
        const data=event.data;
        if(event.source!==parent || data?.source!=='ln.kr-theme-set' || data.token!==settings.token || !['dark','light','system'].includes(data.mode)) return;
        settings.mode=data.mode; ready();
      });
      addEventListener('DOMContentLoaded',()=>parent.postMessage({source:'ln.kr-theme-ready',token:settings.token},'*'),{once:true});
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ready,{once:true}); else ready(); })();`;
}
