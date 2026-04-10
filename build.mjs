import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const watchMode = args.includes('--watch');
const browserArg = args.find(a => a.startsWith('--browser='));
const browsers = browserArg
  ? [browserArg.split('=')[1]]
  : ['chrome', 'firefox', 'safari'];

const entryPoints = {
  background: resolve(__dirname, 'src/background/index.ts'),
  content: resolve(__dirname, 'src/content/index.ts'),
  'popup/popup': resolve(__dirname, 'src/popup/popup.ts'),
  'options/options': resolve(__dirname, 'src/options/options.ts'),
};

async function build(browser) {
  const outdir = resolve(__dirname, `dist/${browser}`);

  // Clean
  if (existsSync(outdir)) rmSync(outdir, { recursive: true });
  mkdirSync(outdir, { recursive: true });
  mkdirSync(resolve(outdir, 'popup'), { recursive: true });
  mkdirSync(resolve(outdir, 'options'), { recursive: true });
  mkdirSync(resolve(outdir, 'icons'), { recursive: true });

  // Copy manifest
  cpSync(
    resolve(__dirname, `src/manifests/manifest.${browser}.json`),
    resolve(outdir, 'manifest.json')
  );

  // Copy static assets
  const staticFiles = [
    ['src/popup/popup.html', 'popup/popup.html'],
    ['src/popup/popup.css', 'popup/popup.css'],
    ['src/options/options.html', 'options/options.html'],
    ['src/options/options.css', 'options/options.css'],
  ];
  for (const [src, dest] of staticFiles) {
    const srcPath = resolve(__dirname, src);
    if (existsSync(srcPath)) {
      cpSync(srcPath, resolve(outdir, dest));
    }
  }

  // Copy icons
  const iconsDir = resolve(__dirname, 'src/icons');
  if (existsSync(iconsDir)) {
    cpSync(iconsDir, resolve(outdir, 'icons'), { recursive: true });
  }

  // Copy locales
  const localesDir = resolve(__dirname, 'src/_locales');
  if (existsSync(localesDir)) {
    cpSync(localesDir, resolve(outdir, '_locales'), { recursive: true });
  }

  // Copy webextension-polyfill
  const polyfillSrc = resolve(__dirname, 'node_modules/webextension-polyfill/dist/browser-polyfill.min.js');
  if (existsSync(polyfillSrc)) {
    cpSync(polyfillSrc, resolve(outdir, 'browser-polyfill.js'));
  }

  // Bundle
  const buildOptions = {
    entryPoints,
    bundle: true,
    outdir,
    format: 'iife',
    target: 'es2022',
    minify: !watchMode,
    sourcemap: watchMode ? 'inline' : false,
    define: {
      'process.env.BROWSER': JSON.stringify(browser),
    },
  };

  if (watchMode) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log(`[${browser}] Watching for changes...`);
    return ctx;
  } else {
    await esbuild.build(buildOptions);
    console.log(`[${browser}] Build complete -> dist/${browser}/`);
  }
}

async function main() {
  const contexts = [];
  for (const browser of browsers) {
    const ctx = await build(browser);
    if (ctx) contexts.push(ctx);
  }

  if (watchMode && contexts.length > 0) {
    process.on('SIGINT', async () => {
      for (const ctx of contexts) await ctx.dispose();
      process.exit(0);
    });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
