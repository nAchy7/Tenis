import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, '_site');
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'style.css', 'app.js', 'game.js', 'favicon.svg']) await copyFile(path.join(root, file), path.join(output, file));
await writeFile(path.join(output, '.nojekyll'), '');
const [html, css, engine, app, favicon] = await Promise.all(['index.html', 'style.css', 'game.js', 'app.js', 'favicon.svg'].map((name) => readFile(path.join(root, name), 'utf8')));
// The standalone version also works from disk without a server or Internet connection.
const standalone = html
  .replace('<link rel="stylesheet" href="./style.css">', () => `<style>${css}</style>`)
  .replace('href="./favicon.svg"', () => `href="data:image/svg+xml,${encodeURIComponent(favicon)}"`)
  .replace('<script type="module" src="./app.js"></script>', () => `<script type="module">${engine.replace(/^export /gm, '')}\n${app.replace(/^import .*?;\n/, '')}</script>`);
await writeFile(path.join(output, 'play.html'), standalone);
console.log('Built static site in _site/ and offline game _site/play.html');
