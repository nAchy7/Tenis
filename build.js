import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, '_site');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'favicon.svg']) await copyFile(path.join(root, file), path.join(output, file));
await writeFile(path.join(output, '.nojekyll'), '');
const result = await build({
  entryPoints: [path.join(root, 'app.js')], bundle: true, write: false,
  minify: true, format: 'iife', target: ['es2020'], legalComments: 'inline',
});
const license = await readFile(path.join(root, 'node_modules/three/LICENSE'), 'utf8');
const bundle = `/*! Three.js — ${license} */\n${result.outputFiles[0].text}`;
await writeFile(path.join(output, 'bundle.js'), bundle);
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), license);
const [html, css, favicon] = await Promise.all(['index.html', 'style.css', 'favicon.svg'].map((name) => readFile(path.join(root, name), 'utf8')));
// The standalone version also works from disk without a server or Internet connection.
const standalone = html
  .replace(/<link rel="stylesheet" href="\.\/style\.css(?:\?[^\"]*)?">/, () => `<style>${css}</style>`)
  .replace('href="./favicon.svg"', () => `href="data:image/svg+xml,${encodeURIComponent(favicon)}"`)
  .replace(/<script defer src="\.\/bundle\.js(?:\?[^\"]*)?"><\/script>/, () => `<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`);
await writeFile(path.join(output, 'play.html'), standalone);
if (process.argv.includes('--portable')) {
  await writeFile(path.join(root, 'play.html'), standalone);
  await writeFile(path.join(root, 'bundle.js'), bundle);
  await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), license);
}
console.log(`Built 3D site and offline game (${Math.round(Buffer.byteLength(bundle) / 1024)} KiB bundled JavaScript)`);
