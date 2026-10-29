import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const isWatch = process.argv.includes('--watch');

const distDir = path.resolve('dist');

// Ensure dist and target subdirectories exist
function ensureDirs() {
  fs.mkdirSync(path.join(distDir, 'popup'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'content'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'background'), { recursive: true });
  fs.mkdirSync(path.join(distDir, 'assets'), { recursive: true });
}

function copyStaticFiles() {
  ensureDirs();

  // Copy manifest
  fs.copyFileSync('manifest.json', path.join(distDir, 'manifest.json'));

  // Copy popup assets
  fs.copyFileSync('src/popup/popup.html', path.join(distDir, 'popup', 'popup.html'));
  fs.copyFileSync('src/popup/popup.css', path.join(distDir, 'popup', 'popup.css'));
  fs.copyFileSync('src/popup/auth-callback.html', path.join(distDir, 'popup', 'auth-callback.html'));

  // Copy assets if directory exists
  if (fs.existsSync('assets')) {
    const files = fs.readdirSync('assets');
    for (const file of files) {
      fs.copyFileSync(path.join('assets', file), path.join(distDir, 'assets', file));
    }
  }
}

async function run() {
  ensureDirs();
  copyStaticFiles();

  const buildOptions = {
    entryPoints: [
      { in: 'src/popup/popup.ts', out: 'popup/popup' },
      { in: 'src/popup/auth-callback.ts', out: 'popup/auth-callback' },
      { in: 'src/content/extractor.ts', out: 'content/extractor' },
      { in: 'src/background/service-worker.ts', out: 'background/service-worker' },
    ],
    bundle: true,
    outdir: distDir,
    platform: 'browser',
    target: ['chrome120'],
    format: 'esm',
    sourcemap: true,
    logLevel: 'info',
  };

  if (isWatch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[Extension Build] Watching for changes...');
  } else {
    await esbuild.build(buildOptions);
    console.log('[Extension Build] Build completed successfully.');
  }
}

run().catch((err) => {
  console.error('[Extension Build Error]:', err);
  process.exit(1);
});
