/**
 * Cross-platform zip packager for the built extensions.
 * Produces forward-slash ZIP entries that Chrome Web Store / AMO accept.
 *
 * Run: node scripts/pack.mjs chrome        # dist/aging-tabs-chrome.zip
 *      node scripts/pack.mjs firefox       # dist/aging-tabs-firefox.zip
 *      node scripts/pack.mjs source        # dist/aging-tabs-source.zip
 *      node scripts/pack.mjs               # all of the above
 */

import AdmZip from 'adm-zip';
import { readdirSync, statSync, existsSync, rmSync } from 'fs';
import { resolve, dirname, relative, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, base, out);
    else out.push({ full, rel: relative(base, full).replaceAll('\\', '/') });
  }
  return out;
}

function packDir(srcDir, zipPath, label) {
  if (!existsSync(srcDir)) {
    console.error(`Skipped ${label}: ${srcDir} does not exist`);
    return false;
  }
  if (existsSync(zipPath)) rmSync(zipPath);

  const zip = new AdmZip();
  const files = walk(srcDir);
  for (const { full, rel } of files) {
    // addLocalFile with zipPath forces forward-slash entries.
    const parent = dirname(rel);
    zip.addLocalFile(full, parent === '.' ? '' : parent);
  }
  zip.writeZip(zipPath);
  console.log(`${label}: ${zipPath} (${files.length} files)`);
  return true;
}

function packSource(zipPath) {
  if (existsSync(zipPath)) rmSync(zipPath);
  const zip = new AdmZip();

  const include = [
    ['src', 'src'],
    ['package.json', 'package.json'],
    ['package-lock.json', 'package-lock.json'],
    ['tsconfig.json', 'tsconfig.json'],
    ['build.mjs', 'build.mjs'],
    ['README.md', 'README.md'],
    ['LICENSE', 'LICENSE'],
  ];
  const excludeGlob = /[\\/]__tests__[\\/]/;

  let count = 0;
  for (const [srcRel, destRel] of include) {
    const abs = resolve(ROOT, srcRel);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (st.isDirectory()) {
      for (const { full, rel } of walk(abs)) {
        if (excludeGlob.test(full)) continue;
        const zipRel = `${destRel}/${rel}`;
        const parent = dirname(zipRel);
        zip.addLocalFile(full, parent === '.' ? '' : parent);
        count++;
      }
    } else {
      zip.addLocalFile(abs, '');
      count++;
    }
  }
  zip.writeZip(zipPath);
  console.log(`source: ${zipPath} (${count} files)`);
}

const targets = process.argv.slice(2);
const jobs = targets.length > 0 ? targets : ['chrome', 'firefox', 'safari', 'source'];

for (const t of jobs) {
  if (t === 'chrome') packDir(resolve(ROOT, 'dist/chrome'), resolve(ROOT, 'dist/aging-tabs-chrome.zip'), 'chrome');
  else if (t === 'firefox') packDir(resolve(ROOT, 'dist/firefox'), resolve(ROOT, 'dist/aging-tabs-firefox.zip'), 'firefox');
  else if (t === 'safari') packDir(resolve(ROOT, 'dist/safari'), resolve(ROOT, 'dist/aging-tabs-safari.zip'), 'safari');
  else if (t === 'source') packSource(resolve(ROOT, 'dist/aging-tabs-source.zip'));
  else {
    console.error(`Unknown target: ${t}`);
    process.exit(1);
  }
}
