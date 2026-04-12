#!/usr/bin/env node
// Generate per-platform store listing markdown from a single source of truth.
//
// Inputs:
//   store-listing/copy.en.json       — EN content (universal)
//   store-listing/copy.ru.json       — RU content (universal)
//   store-listing/platforms.json     — per-platform field selection + limits
//
// Outputs:
//   STORE_LISTING.chrome.md
//   STORE_LISTING.firefox.md
//   STORE_LISTING.safari.md

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LISTING_DIR = join(ROOT, 'store-listing');

const en = JSON.parse(readFileSync(join(LISTING_DIR, 'copy.en.json'), 'utf8'));
const ru = JSON.parse(readFileSync(join(LISTING_DIR, 'copy.ru.json'), 'utf8'));
const platforms = JSON.parse(readFileSync(join(LISTING_DIR, 'platforms.json'), 'utf8'));

// --- Length validation ---

function validate(platform, copy, lang) {
  const limits = platforms[platform].limits || {};
  const issues = [];
  for (const [field, max] of Object.entries(limits)) {
    const value = copy[field];
    if (typeof value !== 'string') continue;
    const len = [...value].length; // count code points, not UTF-16 units
    if (len > max) {
      issues.push(`${lang}.${field}: ${len} > ${max} chars`);
    }
  }
  return issues;
}

// --- Section renderers ---

function section(heading) {
  return `\n## ${heading}\n`;
}

function renderNameBlock(copy, plat, lang) {
  const lines = [section('Basic info')];
  lines.push(`- **Name:** ${copy.name}`);
  lines.push(`- **Category:** ${copy.category}`);
  lines.push(`- **Language:** ${lang === 'en' ? 'English' : 'Русский'}`);
  if (plat.fields.includes('subtitle')) {
    const max = plat.limits?.subtitle;
    const len = [...copy.subtitle].length;
    lines.push(`- **Subtitle** (${len}/${max}): ${copy.subtitle}`);
  }
  if (plat.fields.includes('copyright')) {
    lines.push(`- **Copyright:** ${copy.copyright}`);
  }
  return lines.join('\n');
}

function renderShortDesc(copy, plat) {
  if (!plat.fields.includes('shortDescription')) return '';
  const max = plat.limits?.shortDescription;
  const len = [...copy.shortDescription].length;
  const label = plat.storeName.includes('Firefox') ? 'Summary' : 'Short description';
  return section(`${label} (${len}/${max} chars)`) + `\n> ${copy.shortDescription}\n`;
}

function renderPromoText(copy, plat) {
  if (!plat.fields.includes('promotionalText')) return '';
  const max = plat.limits?.promotionalText;
  const len = [...copy.promotionalText].length;
  return section(`Promotional text (${len}/${max} chars)`) + `\n> ${copy.promotionalText}\n`;
}

function renderKeywords(copy, plat) {
  if (!plat.fields.includes('keywords')) return '';
  const max = plat.limits?.keywords;
  const len = [...copy.keywords].length;
  return section(`Keywords (${len}/${max} chars)`) + `\n\`\`\`\n${copy.keywords}\n\`\`\`\n`;
}

function renderFullDescription(copy, plat) {
  const max = plat.limits?.fullDescription;
  const len = [...copy.fullDescription].length;
  return section(`Full description (${len}/${max} chars)`) + `\n\`\`\`\n${copy.fullDescription}\n\`\`\`\n`;
}

function renderSinglePurpose(copy, plat) {
  if (!plat.fields.includes('singlePurpose')) return '';
  return section('Single purpose') + `\n> ${copy.singlePurpose}\n`;
}

function renderPermissions(copy, plat) {
  if (!plat.fields.includes('permissions')) return '';
  const lines = [section('Permission justifications')];
  lines.push('Copy these into the Privacy practices form in the Developer Console, one per permission.\n');
  for (const [perm, text] of Object.entries(copy.permissions)) {
    lines.push(`**${perm}**`);
    lines.push(`> ${text}\n`);
  }
  return lines.join('\n');
}

function renderDataDisclosure(plat) {
  if (!plat.fields.includes('dataDisclosure') || !plat.dataDisclosure) return '';
  const { collectedCategories, certifications } = plat.dataDisclosure;
  const lines = [section('Data usage disclosure')];
  lines.push('\nMark every category below as **not collected** (the extension stores nothing off-device):\n');
  for (const c of collectedCategories) {
    lines.push(`- ☑ Does not collect ${c.toLowerCase()}`);
  }
  lines.push('\n**Certify:**\n');
  for (const c of certifications) {
    lines.push(`- ☑ ${c}`);
  }
  return lines.join('\n') + '\n';
}

function renderUrls(copy) {
  return section('URLs')
    + `\n- **Privacy policy:** ${copy.urls.privacy}`
    + `\n- **Homepage:** ${copy.urls.homepage}`
    + `\n- **Support:** ${copy.urls.support}`
    + `\n- **Marketing:** ${copy.urls.marketing}\n`;
}

function renderScreenshots(copy, plat) {
  const lines = [section('Screenshots')];
  lines.push(`\nAll at 1280×800, generated via \`node scripts/screenshot-store.mjs\`.\n`);
  for (const [i, shot] of copy.screenshots.entries()) {
    lines.push(`${i + 1}. \`screenshots/store/${shot.file}\` — ${shot.caption}`);
  }
  if (plat.iconSize) {
    lines.push(`\n**Icon:** ${plat.iconSize}`);
  }
  return lines.join('\n');
}

function renderNotes(plat) {
  if (!plat.notes?.length) return '';
  return section('Platform notes') + plat.notes.map(n => `\n- ${n}`).join('') + '\n';
}

function renderZip(plat) {
  if (!plat.zipTarget) return '';
  return section('Package to upload') + `\n\`${plat.zipTarget}\` — produced by \`npm run build\`.\n`;
}

// --- Assemble one platform document ---

function renderPlatformDoc(platformKey, plat) {
  const langs = [['en', en], ['ru', ru]];
  const parts = [`# ${plat.storeName} Listing — ${en.name}`];
  parts.push(`\nAuto-generated from \`store-listing/copy.*.json\`. Edit the source — re-run \`npm run gen:store\`.`);
  parts.push(`\n**Submission target:** ${plat.consoleName}`);

  for (const [lang, copy] of langs) {
    parts.push(`\n\n---\n\n# ${lang === 'en' ? 'English' : 'Русский'}`);
    parts.push(renderNameBlock(copy, plat, lang));
    parts.push(renderShortDesc(copy, plat));
    parts.push(renderPromoText(copy, plat));
    parts.push(renderKeywords(copy, plat));
    parts.push(renderFullDescription(copy, plat));
    parts.push(renderSinglePurpose(copy, plat));
    parts.push(renderPermissions(copy, plat));
    if (lang === 'en') parts.push(renderDataDisclosure(plat));
    parts.push(renderUrls(copy));
  }

  parts.push('\n\n---\n');
  parts.push(renderScreenshots(en, plat));
  parts.push(renderZip(plat));
  parts.push(renderNotes(plat));

  return parts.filter(Boolean).join('\n') + '\n';
}

// --- Main ---

let hadIssues = false;
for (const [key, plat] of Object.entries(platforms)) {
  const enIssues = validate(key, en, 'en');
  const ruIssues = validate(key, ru, 'ru');
  const issues = [...enIssues, ...ruIssues];
  if (issues.length) {
    hadIssues = true;
    console.warn(`\n⚠ ${key}: ${issues.length} length violation(s):`);
    for (const i of issues) console.warn(`   ${i}`);
  }

  const doc = renderPlatformDoc(key, plat);
  const out = join(ROOT, `STORE_LISTING.${key}.md`);
  writeFileSync(out, doc, 'utf8');
  console.log(`✓ ${out}`);
}

if (hadIssues) {
  console.warn('\nLength violations present — review the source JSON and tighten copy.');
  process.exit(1);
}
console.log('\nAll listings generated clean.');
