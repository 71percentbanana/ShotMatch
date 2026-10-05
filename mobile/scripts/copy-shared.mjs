// Copies the shared sample photos and icon bundle from the web demo into www/,
// so the web demo stays the single source of truth for those files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(mobile, '..');
const www = path.join(mobile, 'www');

for (const folder of ['assets', 'vendor']) {
  await fs.rm(path.join(www, folder), { recursive: true, force: true });
  await fs.cp(path.join(repo, folder), path.join(www, folder), { recursive: true });
  console.log(`Copied ${folder}/ -> www/${folder}/`);
}
