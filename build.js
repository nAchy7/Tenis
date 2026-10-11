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
  // Local surface maps and HDR lighting travel with the JavaScript, including play.html.
  loader: { '.jpg': 'dataurl', '.jpeg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl', '.hdr': 'dataurl', '.glb': 'dataurl' },
});
const license = await readFile(path.join(root, 'node_modules/three/LICENSE'), 'utf8');
const assetLicenses = [];
for (const file of ['assets/LICENSES.md', 'assets/ASSET_LICENSES.md', 'ASSET_LICENSES.md']) {
  let content;
  try { content = await readFile(path.join(root, file), 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content);
  assetLicenses.push(content);
}
const notices = [license, ...assetLicenses].join('\n\n');
const bundle = `/*! Three.js — ${license} */\n${result.outputFiles[0].text}`;
await writeFile(path.join(output, 'bundle.js'), bundle);
await writeFile(path.join(output, 'THIRD_PARTY_NOTICES.txt'), notices);
const [html, css, favicon] = await Promise.all(['index.html', 'style.css', 'favicon.svg'].map((name) => readFile(path.join(root, name), 'utf8')));
// The standalone version also works from disk without a server or Internet connection.
// Replacement callbacks preserve literal dollar signs in JavaScript and embedded data URLs.
const inlineBundle = bundle.replace(/<\/script/gi, '<\\/script');
const standalone = html
  .replace(/<link rel="stylesheet" href="\.\/style\.css(?:\?[^\"]*)?">/, () => `<style>${css}</style>`)
  .replace('href="./favicon.svg"', () => `href="data:image/svg+xml,${encodeURIComponent(favicon)}"`)
  .replace(/<script defer src="\.\/bundle\.js(?:\?[^\"]*)?"><\/script>/, () => `<script>${inlineBundle}</script>`);
await writeFile(path.join(output, 'play.html'), standalone);
if (process.argv.includes('--portable')) {
  await writeFile(path.join(root, 'play.html'), standalone);
  await writeFile(path.join(root, 'bundle.js'), bundle);
  await writeFile(path.join(root, 'THIRD_PARTY_NOTICES.txt'), notices);
}
console.log(`Built 3D site and offline game (${Math.round(Buffer.byteLength(bundle) / 1024)} KiB bundled JavaScript)`);
