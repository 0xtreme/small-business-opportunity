import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const copyPairs = [
  ['public/index.html', 'docs/index.html'],
  ['public/app.js', 'docs/app.js'],
  ['public/styles.css', 'docs/styles.css'],
  ['public/data/opportunity-dataset.json', 'docs/data/opportunity-dataset.json'],
  ['docs/sources.md', 'public/sources.md'],
  ['docs/how-it-works.md', 'public/how-it-works.md'],
];

async function main() {
  for (const [srcRelative, dstRelative] of copyPairs) {
    const src = path.join(projectRoot, srcRelative);
    const dst = path.join(projectRoot, dstRelative);

    await fs.mkdir(path.dirname(dst), { recursive: true });
    await fs.copyFile(src, dst);
    console.log(`Copied ${srcRelative} -> ${dstRelative}`);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
