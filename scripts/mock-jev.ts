/**
 * MOCK JEV server for offline development, demos and CI. It speaks the real
 * POST /v1/systemone wire format but uses crude keyword heuristics, NOT the real model.
 * Never use for accuracy claims; run scripts/eval.ts with TYPESAFE_API_KEY for that.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const KW: Record<string, string[]> = {
  harassment: ['worthless', 'deserves to suffer', 'spam her', 'pathetic loser'],
  threats: ['i will hurt', 'you are dead', 'watch your back'],
  terrorism_extremism: ['radicalised', 'attack', 'martyr', 'join the cause'],
  self_harm: ['kill yourself', 'end it all', 'cut yourself'],
  eating_disorder: ['starve', 'purge', 'thinspo', 'under 500 calories'],
  dangerous_challenges: ['challenge', 'pass out', 'hold your breath'],
  cyberbullying: ['ugly', 'loser', 'nobody likes you', 'everyone is laughing'],
  scam_fraud: ['crypto', 'guaranteed', 'gift card', 'verify your account'],
  misogyny: ['women are', 'females are'],
  pornography: ['nsfw', 'onlyfans', 'xxx'],
  grooming: ['how old are you', 'our secret', 'snapchat'],
  crime_glorification: ['robbed', 'got away with'],
};
const CTX: Record<string, string[]> = {
  news_reporting: ['police said', 'reporters', 'according to', 'court', 'reported'],
  education_research: ['study', 'research', 'how to recognise', 'warning signs'],
  satire_parody: ['satire', '/s', 'parody'],
  political_expression: ['minister', 'government', 'policy', 'mp ', 'parliament'],
  support_recovery: ['recovery', 'reach out', 'helpline', 'you are not alone'],
};

interface Question { type?: string; criteria?: Record<string, unknown>; instructions?: string }

interface JevBody {
  state?: { content?: { text?: string } };
  questions?: Record<string, Question>;
}

interface ChoiceAnswer { choice: string; confidence: number; probabilities: Record<string, number> }

function classify(body: JevBody) {
  const text = String(body?.state?.content?.text ?? JSON.stringify(body.state)).toLowerCase();
  const answers: Record<string, ChoiceAnswer | { score: number; confidence: number } | { noul: number }> = {};
  const q = body.questions ?? {};
  if (q.harm?.criteria) {
    const criteria = q.harm.criteria;
    const opts = Object.keys(criteria);
    let best = 'none', score = 0;
    for (const o of opts) {
      const hits = (KW[o] ?? []).filter((k) => text.includes(k)).length;
      if (hits > score) { score = hits; best = o; }
    }
    const p = best === 'none' ? 0.9 : Math.min(0.95, 0.6 + 0.15 * score);
    const probs = Object.fromEntries(opts.map((o) => [o, o === best ? p : (1 - p) / (opts.length - 1)]));
    answers.harm = { choice: best, confidence: p, probabilities: probs };
    answers.severity = { score: best === 'none' ? 0.2 : 1.5 + score, confidence: 0.7 };
  }
  const harm = answers.harm;
  if (q.context && harm && 'choice' in harm) {
    let ctx = harm.choice === 'none' ? 'benign' : 'direct_harm';
    for (const [c, ks] of Object.entries(CTX)) if (ks.some((k) => text.includes(k))) { ctx = c; break; }
    answers.context = { choice: ctx, confidence: 0.8, probabilities: { [ctx]: 0.8 } };
  }
  for (const [name, qq] of Object.entries(q)) {
    if (qq.type === 'noul') {
      const words = String(qq.instructions ?? '').toLowerCase().match(/[a-z]{5,}/g) ?? [];
      const hit = words.filter((w) => text.includes(w)).length;
      answers[name] = { noul: Math.min(0.95, hit * 0.2) };
    }
  }
  return { model: 'mock-jev (heuristic, not the real model)', answers };
}

export function startMockJev(port = 4778): Promise<http.Server> {
  const srv = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/v1/systemone')) { res.writeHead(404); return res.end(); }
    let b = '';
    req.on('data', (c: Buffer) => { b += c; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(classify(JSON.parse(b) as JevBody)));
    });
  });
  return new Promise((r) => srv.listen(port, '127.0.0.1', () => r(srv)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startMockJev().then(() => console.log('mock JEV on http://127.0.0.1:4778'));
}
