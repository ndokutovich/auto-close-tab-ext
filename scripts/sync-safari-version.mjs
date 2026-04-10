/**
 * Syncs MARKETING_VERSION and CURRENT_PROJECT_VERSION in the Xcode project
 * to match the version in package.json.
 *
 * Run: node scripts/sync-safari-version.mjs
 *      node scripts/sync-safari-version.mjs 1.2.0   # explicit override
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const pbxPath = resolve(ROOT, 'safari-ext/Aging tabs/Aging tabs.xcodeproj/project.pbxproj');
const pkgPath = resolve(ROOT, 'package.json');

const version = process.argv[2] || JSON.parse(readFileSync(pkgPath, 'utf8')).version;
const buildNumber = version.split('.').reduce((a, n) => a * 1000 + Number(n), 0).toString();

let pbx = readFileSync(pbxPath, 'utf8');

const mvBefore = (pbx.match(/MARKETING_VERSION = .+?;/g) || []).length;
pbx = pbx.replace(/MARKETING_VERSION = .+?;/g, `MARKETING_VERSION = ${version};`);

const cpvBefore = (pbx.match(/CURRENT_PROJECT_VERSION = .+?;/g) || []).length;
pbx = pbx.replace(/CURRENT_PROJECT_VERSION = .+?;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`);

writeFileSync(pbxPath, pbx, 'utf8');
console.log(`Safari project synced: v${version} (build ${buildNumber})`);
console.log(`  Updated ${mvBefore} MARKETING_VERSION entries`);
console.log(`  Updated ${cpvBefore} CURRENT_PROJECT_VERSION entries`);
