import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const r = (p: string) => path.join(root, p);
const common = { bundle: true, sourcemap: false, logLevel: 'warning' as const, legalComments: 'none' as const };

// Desktop (Electron)
await build({ ...common, entryPoints: [r('apps/desktop/src/main.ts')], outfile: r('apps/desktop/dist/main.js'), platform: 'node', format: 'cjs', target: 'node20', external: ['electron'] });
for (const name of ['page-preload', 'chrome-preload']) {
  await build({ ...common, entryPoints: [r(`apps/desktop/src/${name}.ts`)], outfile: r(`apps/desktop/dist/${name}.js`), platform: 'browser', format: 'cjs', target: 'chrome120', external: ['electron'] });
}

// Browser UI. HTML keeps <script src="*.js">; these files are the compiled output.
for (const name of ['chrome', 'newtab', 'dashboard', 'blocked']) {
  await build({ ...common, entryPoints: [r(`apps/desktop/ui/${name}.ts`)], outfile: r(`apps/desktop/ui/${name}.js`), platform: 'browser', format: 'iife', target: 'chrome120' });
}
await build({ ...common, entryPoints: [r('packages/mobile-shared/admin-shim.ts')], outfile: r('packages/mobile-shared/admin-shim.js'), platform: 'browser', format: 'iife', target: ['chrome100', 'safari15'] });

// Shared bundles for mobile shells
const shared = r('dist/shared');
fs.mkdirSync(shared, { recursive: true });
await build({ ...common, entryPoints: [r('packages/page-agent/src/agent.ts')], outfile: path.join(shared, 'ddoc-agent.js'), platform: 'browser', format: 'iife', target: ['chrome100', 'safari15'], minify: true });
await build({ ...common, entryPoints: [r('packages/core/src/mobile-host.ts')], outfile: path.join(shared, 'ddoc-engine.js'), platform: 'browser', format: 'iife', target: ['chrome100', 'safari15'], minify: true });
fs.copyFileSync(r('apps/desktop/ui/dashboard.js'), path.join(shared, 'dashboard.js'));
fs.copyFileSync(r('apps/desktop/ui/icon.png'), path.join(shared, 'icon.png'));
fs.copyFileSync(r('apps/desktop/ui/dash.css'), path.join(shared, 'dash.css'));
fs.writeFileSync(path.join(shared, 'dashboard.html'), fs.readFileSync(r('apps/desktop/ui/dashboard.html'), 'utf8').replace('<script src="dashboard.js">', '<script src="admin-shim.js"></script><script src="dashboard.js">'));
for (const f of ['blocked.html', 'blocked.js']) fs.copyFileSync(r('apps/desktop/ui/' + f), path.join(shared, f));
for (const f of ['engine.html', 'admin-shim.js']) fs.copyFileSync(r('packages/mobile-shared/' + f), path.join(shared, f));

const targets = [r('apps/android/app/src/main/assets/ddoc'), r('apps/ios/DDoCBrowser/Resources/ddoc')];
for (const t of targets) {
  fs.mkdirSync(t, { recursive: true });
  for (const f of fs.readdirSync(shared)) fs.copyFileSync(path.join(shared, f), path.join(t, f));
}
console.log('built desktop + shared bundles');
