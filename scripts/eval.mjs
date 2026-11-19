/**
 * Accuracy and over-blocking evaluation.
 *   TYPESAFE_API_KEY=... node scripts/eval.mjs   -> evaluates against the real JEV
 *   node scripts/eval.mjs                        -> pipeline check against the MOCK JEV (not an accuracy claim)
 *   node scripts/eval.mjs --local                -> on-device stages only
 * CSEA material is deliberately excluded from the eval set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { startMockJev } from './mock-jev.mjs';
import { loadEnv } from './load-env.mjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
loadEnv([path.join(root, '.env')]);
const out = path.join(root, 'dist/eval-core.mjs');
await build({ entryPoints: [path.join(root, 'packages/core/src/index.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'warning' });
const core = await import(out);

const local = process.argv.includes('--local');
const real = !!process.env.TYPESAFE_API_KEY && !local;
let srv;
if (!real && !local) srv = await startMockJev(4788);
const classifier = local ? undefined : new core.JevClient(real
  ? { apiKey: process.env.TYPESAFE_API_KEY, baseURL: process.env.TYPESAFE_BASE_URL }
  : { apiKey: 'mock', baseURL: 'http://127.0.0.1:4788' });

const rows = fs.readFileSync(path.join(root, 'eval/dataset.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const res = { tp: 0, fn: 0, fp: 0, tn: 0, protectedHidden: 0, protectedTotal: 0, misses: [], falsePos: [] };
for (const r of rows) {
  const s = core.defaultState();
  s.settings.jevMode = 'all';
  const kind = r.profile ?? 'adult';
  if (kind !== 'adult') { s.profiles.push(core.makeProfile('p', 'p', kind)); s.settings.activeProfileId = 'p'; }
  const e = new core.Engine(s, classifier);
  const d = await e.classify({ text: r.text, kind: r.kind ?? 'post' });
  const filtered = d.action !== 'allow';
  if (r.expect === 'allow' || r.expect === 'label_or_allow') {
    res.protectedTotal++;
    const bad = r.expect === 'allow' ? filtered : !['allow', 'label'].includes(d.action);
    if (bad) { res.fp++; res.protectedHidden++; res.falsePos.push({ text: r.text, got: `${d.action}:${d.categoryId}` }); } else res.tn++;
  } else {
    if (filtered && d.categoryId === r.expect) res.tp++;
    else { res.fn++; res.misses.push({ text: r.text, expect: r.expect, got: `${d.action}:${d.categoryId ?? '-'}` }); }
  }
}
srv?.close();
const harmful = res.tp + res.fn;
const report = {
  mode: local ? 'on-device only' : real ? 'real JEV' : 'MOCK JEV (pipeline check only, not accuracy)',
  harmfulRecall: +(res.tp / harmful).toFixed(3),
  protectedExpressionOverBlockRate: +(res.protectedHidden / res.protectedTotal).toFixed(3),
  counts: { harmful, protectedOrBenign: res.protectedTotal, tp: res.tp, fn: res.fn, fp: res.fp, tn: res.tn },
  misses: res.misses, falsePositives: res.falsePos,
};
console.log(JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(root, 'eval', `results-${local ? 'local' : real ? 'jev' : 'mock'}.json`), JSON.stringify(report, null, 2));
