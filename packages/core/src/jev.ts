/**
 * JEV (TypeSafe AI System One) client.
 *
 * Dependency-free so the same code runs in Node/Electron main, Android and iOS JS contexts.
 * Wire format matches @typesafe-ai/sdk 0.7: POST {baseURL}/v1/systemone with
 * { model, state, questions: { name: { type, instructions, criteria } } }.
 */
import { CONTEXTS, HarmCategory, SEVERITY_LEVELS } from './taxonomy';

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

export interface JevConfig {
  apiKey?: string;
  baseURL?: string; // default https://api.typesafe.ai
  model?: string; // default jev-latest
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface CustomCategoryQuestion {
  id: string;
  label: string;
  description: string;
  /** Only sent if the user allowed sharing examples with JEV. */
  examples?: string[];
}

export interface JevVerdict {
  harm: string; // category id or 'none'
  harmProbabilities: Record<string, number>;
  context: string;
  contextProbabilities: Record<string, number>;
  severity: number; // 0..4
  /** Probability that the block is itself an advertisement. Absent on older responses. */
  ads?: number;
  custom: Record<string, number>; // custom category id -> probability
  model?: string;
}

const ADS_QUESTION = 'Is `content.text` itself an advertisement, sponsored post, or paid promotion? Yes for commercial pitches, product placements, affiliate plugs, and sponsored labels. No for editorial, personal, news, or discussion text that merely mentions a product, brand, or advertisement.';

export interface Classifier {
  classify(text: string, kind: string, categories: HarmCategory[], custom: CustomCategoryQuestion[]): Promise<JevVerdict>;
}

export function buildRequest(text: string, kind: string, categories: HarmCategory[], custom: CustomCategoryQuestion[], model: string, opts?: { ads?: boolean }) {
  const harmCats = categories.filter((c) => c.id !== 'ads');
  const askAds = !!opts?.ads || categories.some((c) => c.id === 'ads');
  const questions: Record<string, any> = {};
  if (harmCats.length > 0 || !askAds) {
    const harmCriteria: Record<string, string> = { none: 'None of the listed harms. Ordinary content.' };
    for (const c of harmCats) harmCriteria[c.id] = `${c.label}: ${c.description}`;
    questions.harm = { type: 'choice', instructions: 'Which harm, if any, does `content.text` most clearly contain? Judge the text itself, not the topic it discusses.', criteria: harmCriteria };
    questions.context = { type: 'choice', instructions: 'What is the communicative purpose of `content.text`?', criteria: CONTEXTS };
    questions.severity = { type: 'score', instructions: 'How harmful would `content.text` be to an ordinary reader?', criteria: SEVERITY_LEVELS };
  }
  if (askAds) questions.ads = { type: 'noul', instructions: ADS_QUESTION, criteria: null };
  for (const c of custom) {
    const ex = c.examples?.length ? ` Examples the user marked as unwanted: ${c.examples.slice(0, 5).map((e) => JSON.stringify(e.slice(0, 200))).join('; ')}.` : '';
    questions['custom_' + c.id] = {
      type: 'noul',
      instructions: `Does \`content.text\` match the user's personal category "${c.label}": ${c.description}?${ex}`,
      criteria: null,
    };
  }
  return { model, state: { content: { kind, text: text.slice(0, 4000) } }, questions };
}

export function parseResponse(body: any, custom: CustomCategoryQuestion[]): JevVerdict {
  const a = body?.answers ?? {};
  const customOut: Record<string, number> = {};
  for (const c of custom) customOut[c.id] = Number(a['custom_' + c.id]?.noul ?? 0);
  return {
    harm: a.harm?.choice ?? 'none',
    harmProbabilities: a.harm?.probabilities ?? {},
    context: a.context?.choice ?? 'benign',
    contextProbabilities: a.context?.probabilities ?? {},
    severity: Number(a.severity?.score ?? 0),
    ads: Number(a.ads?.noul ?? 0),
    custom: customOut,
    model: body?.model,
  };
}

export class JevClient implements Classifier {
  private baseURL: string;
  private model: string;
  private fetchFn: FetchLike;
  sent = 0;

  constructor(private cfg: JevConfig) {
    this.baseURL = (cfg.baseURL ?? 'https://api.typesafe.ai').replace(/\/+$/, '');
    this.model = cfg.model ?? 'jev-latest';
    this.fetchFn = cfg.fetch ?? ((globalThis as any).fetch as FetchLike);
  }

  get configured() {
    return !!this.cfg.apiKey;
  }

  async classify(text: string, kind: string, categories: HarmCategory[], custom: CustomCategoryQuestion[]): Promise<JevVerdict> {
    if (!this.cfg.apiKey) throw new Error('JEV API key not configured');
    const body = buildRequest(text, kind, categories, custom, this.model, { ads: categories.some((c) => c.id === 'ads') });
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 8000) : undefined;
    try {
      this.sent++;
      const res = await this.fetchFn(`${this.baseURL}/v1/systemone`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl?.signal,
      });
      if (!res.ok) throw new Error(`JEV HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return parseResponse(await res.json(), custom);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
