/**
 * Builds the one HTML page QuestionContent's WebView loads: the web's own
 * richHtml, tokens and rich-content styles, with KaTeX and the Indic fonts
 * inlined as data URIs, so a sitting needs no network but its question images.
 * Generated into webview/dist, which git ignores; every script that needs it runs this first.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

const here = import.meta.dirname;
const out = path.join(here, 'dist');
// The web's own copies of katex and the fonts, so the two clients cannot drift a version apart.
const uiModules = path.resolve(here, '../../../packages/ui/node_modules');
// Optional chaining is the newest syntax shipped, and Android WebView has had it since Chrome 80.
const target = 'es2020';

async function bundle(entry, options) {
  const { outputFiles } = await build({
    entryPoints: [path.join(here, entry)],
    bundle: true,
    minify: true,
    write: false,
    outdir: out,
    nodePaths: [uiModules],
    target,
    ...options,
  });
  return outputFiles[0].text.trim();
}

const asciiEscape = (char) => String.raw`\u${char.codePointAt(0).toString(16).padStart(4, '0')}`;
// esbuild leaves KaTeX's regex literals raw; one wide character doubles the page's size in Hermes.
const script = (
  await bundle('question-page.ts', { format: 'iife', platform: 'browser' })
).replaceAll(/[\u0080-\uffff]/g, asciiEscape);
// KaTeX lists woff and ttf after woff2, which every target reads, so those fallbacks are cut, not shipped.
const style = (
  await bundle('question-page.css', {
    loader: { '.woff2': 'dataurl' },
    external: ['*.woff', '*.ttf'],
  })
).replaceAll(/,url\((?!data:)[^)]*\) format\("[a-z]+"\)/g, '');

if (/url\((?!data:)/.test(style)) {
  throw new Error('The page stylesheet still points at a file the WebView has no way to load.');
}
if (script.includes('</script') || style.includes('</style')) {
  throw new Error('The bundle would close its own tag in the inlined page.');
}

const scriptHash = createHash('sha256').update(script).digest('base64');
const policy = [
  "default-src 'none'",
  `script-src 'sha256-${scriptHash}'`,
  "style-src 'unsafe-inline'",
  'font-src data:',
  'img-src https: http:',
].join('; ');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<style>${style}</style>
</head>
<body>
<script>${script}</script>
</body>
</html>
`;

if (/[\u0080-\uffff]/.test(html)) {
  throw new Error('The page carries a non-ASCII character, which doubles its size in Hermes.');
}

await mkdir(out, { recursive: true });
await writeFile(path.join(out, 'question-page.html'), html);
await writeFile(
  path.join(out, 'question-page.ts'),
  `export const QUESTION_PAGE_HTML = ${JSON.stringify(html)};\n`,
);
