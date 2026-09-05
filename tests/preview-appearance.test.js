import { expect, test } from 'bun:test';
import { previewAppearanceBootstrap } from '../docs/preview-appearance.js';
import { activateRepositoryFrames, repositoryFrame } from '../docs/repo-render.js';

test('serialized preview controls and frame activation are executable JavaScript', () => {
  expect(() => new Function(previewAppearanceBootstrap())).not.toThrow();
  expect(() => new Function(activateRepositoryFrames)).not.toThrow();
});

test('initial HTML remains inert; generated Markdown permits only nonce-bound controls', () => {
  const html = '<html><body><script>userCode()</script></body></html>';
  expect(repositoryFrame(html)).toContain('sandbox=""');
  const markdown = html.replace('<body>','<body class="frame-preview" data-lnkr-appearance="dark">');
  const frame = repositoryFrame(markdown);
  expect(frame).toContain('sandbox="allow-scripts"');
  expect(frame).toContain("script-src-attr 'none'");
  expect(frame).toContain('<!--lnkr-controls-->'.replaceAll('<','&lt;'));
  let sandbox;
  const fakeFrame = {srcdoc:'<!--lnkr-controls-->inert controls<!--/lnkr-controls-->'+markdown,
    setAttribute:(_,value)=>{sandbox=value;}};
  new Function('document',activateRepositoryFrames)({querySelectorAll:()=>[fakeFrame]});
  expect(fakeFrame.srcdoc).toBe(markdown);
  expect(sandbox).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
});
