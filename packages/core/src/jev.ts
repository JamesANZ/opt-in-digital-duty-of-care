/**
 * @title JEV client
 * @notice Talks to TypeSafe System One. The same code runs in Node, Electron, Android, and iOS.
 * @dev POST {baseURL}/v1/systemone with { model, state, questions }. Ads are a separate yes/no question, not one of the harm choices.
 */
import { CONTEXTS, HarmCategory, SEVERITY_LEVELS } from './taxonomy';

/**
 * @notice The small slice of `fetch` this client uses, so native shells can substitute their own HTTP.
 */
export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

/**
 * @notice How to reach JEV.
 */
export interface JevConfig {
  apiKey?: string;
  baseURL?: string; // default https://api.typesafe.ai
  model?: string; // default jev-latest
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * @notice A user category turned into a JEV question.
 */
export interface CustomCategoryQuestion {
  id: string;
  label: string;
  description: string;
  /** Only sent if the user allowed sharing examples with JEV. */
  examples?: string[];
}

/**
 * @notice Parsed JEV answers for one block.
 */
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

/**
 * @notice The yes/no question asked when the ads filter is on.
 * @dev Kept out of the harm choice so ads do not compete with real harms or fail the severity gate.
 */
const ADS_QUESTION = 'Is `content.text` itself an advertisement, sponsored post, or paid promotion? Yes for commercial pitches, product placements, affiliate plugs, and sponsored labels. No for editorial, personal, news, or discussion text that merely mentions a product, brand, or advertisement.';

/**
 * @notice Anything the engine can ask to classify text. `JevClient` is the production implementation.
 */
export interface Classifier {
  classify(text: string, kind: string, categories: HarmCategory[], custom: CustomCategoryQuestion[]): Promise<JevVerdict>;
}

/**
 * @notice Build the System One request body for one block.
 * @param text Text to judge. Truncated to 4000 characters.
 * @param kind Block kind, such as post, comment, or ad.
 * @param categories Categories to ask about. The ads category is asked separately.
 * @param custom User categories.
 * @param model Model name, usually `jev-latest`.
 * @param opts Set `ads` to include the advertisement question even when `categories` has no ads entry.
 * @return The JSON body posted to `/v1/systemone`.
 */
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

/**
 * @notice Turn a System One response into a verdict.
 * @param body Response JSON.
 * @param custom User categories whose answers should be copied out.
 * @return Probabilities and choices. Missing answers become none, benign, or zero.
 */
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

/**
 * @title JEV client
 * @notice Sends one block to System One and returns a verdict.
 */
export class JevClient implements Classifier {
  private baseURL: string;
  private model: string;
  private fetchFn: FetchLike;
  sent = 0;

  /**
   * @notice Create a client.
   * @param cfg API key, gateway, model, and optional fetch implementation.
   */
  constructor(private cfg: JevConfig) {
    this.baseURL = (cfg.baseURL ?? 'https://api.typesafe.ai').replace(/\/+$/, '');
    this.model = cfg.model ?? 'jev-latest';
    this.fetchFn = cfg.fetch ?? ((globalThis as any).fetch as FetchLike);
  }

  /**
   * @notice Whether an API key is set.
   * @return True when calls can be attempted.
   */
  get configured() {
    return !!this.cfg.apiKey;
  }

  /**
   * @notice Classify one block.
   * @param text Text to judge.
   * @param kind Block kind.
   * @param categories Enabled categories, including ads when that filter is on.
   * @param custom Enabled user categories.
   * @return The parsed verdict. Throws when the key is missing, the request times out, or HTTP fails.
   */
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
