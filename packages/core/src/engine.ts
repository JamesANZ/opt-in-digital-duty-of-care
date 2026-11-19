import { Example, Learner, Polarity, similarityThreshold } from './learner';
import { Classifier, CustomCategoryQuestion, JevVerdict } from './jev';
import { Action, applyBuiltinDefaults, CategorySetting, defaultSettings, makeProfile, Profile, Settings } from './profiles';
import { adScreen, localContext, riskScreen, runRules } from './rules';
import { BUILTIN_CATEGORIES, HarmCategory, HelpResource, PROTECTED_CONTEXTS } from './taxonomy';

export type Stage = 'learned' | 'rule' | 'jev' | 'host' | 'none' | 'cache';

export interface Block {
  text: string;
  /** post | comment | search_result | caption | alt | message | title | other */
  kind: string;
  host?: string;
}

export interface Decision {
  id: string;
  ts: number;
  action: Action;
  categoryId?: string;
  categoryLabel?: string;
  confidence: number;
  stage: Stage;
  context?: string;
  severity?: number;
  reason: string;
  resources?: HelpResource[];
  noReveal?: boolean;
  host?: string;
  preview?: string;
  overridden?: 'revealed' | 'not_harmful' | 'appealed';
}

export interface EngineState {
  version: 1;
  settings: Settings;
  profiles: Profile[];
  customCategories: HarmCategory[];
  examples: Example[];
  decisions: Decision[];
  counters: { jevSent: number; localDecided: number; filtered: number };
}

export function defaultState(): EngineState {
  return {
    version: 1,
    settings: defaultSettings(),
    profiles: [makeProfile('me', 'Me', 'adult')],
    customCategories: [],
    examples: [],
    decisions: [],
    counters: { jevSent: 0, localDecided: 0, filtered: 0 },
  };
}

const MAX_LOG = 2000;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + ':' + s.length;
}

const MIN_SEVERITY = { adult: 2.0, teen: 1.5, child: 1.0 } as const;
const ACTION_RANK: Record<Action, number> = { allow: 0, label: 1, blur: 2, interstitial: 3, hide: 4, block_page: 5 };

/** JEV probability threshold from user sensitivity. */
export function probabilityThreshold(sensitivity: number) {
  return 0.85 - 0.5 * Math.min(1, Math.max(0, sensitivity));
}

export class Engine {
  state: EngineState;
  learner = new Learner();
  private cache = new Map<string, Decision>();
  onChange?: (s: EngineState) => void;

  constructor(state: EngineState = defaultState(), public classifier?: Classifier) {
    this.state = state;
    applyBuiltinDefaults(this.state.profiles);
    this.learner.load(state.examples);
  }

  /* ---------------- accessors ---------------- */

  get profile(): Profile {
    return this.state.profiles.find((p) => p.id === this.state.settings.activeProfileId) ?? this.state.profiles[0];
  }

  get categories(): HarmCategory[] {
    return [...BUILTIN_CATEGORIES, ...this.state.customCategories];
  }

  category(id: string) {
    return this.categories.find((c) => c.id === id);
  }

  setting(id: string): CategorySetting {
    return this.profile.categories[id] ?? { enabled: false, sensitivity: 0.5, action: 'blur' };
  }

  private changed() {
    this.state.examples = this.learner.examples;
    this.onChange?.(this.state);
  }

  /* ---------------- host policy ---------------- */

  hostPolicy(host: string): { blocked: boolean; reason?: string } {
    const p = this.profile;
    const m = (list: string[]) => list.some((h) => host === h || host.endsWith('.' + h));
    if (m(p.allowedHosts)) return { blocked: false };
    if (m(p.blockedHosts)) return { blocked: true, reason: `${host} is on this profile's blocked list` };
    return { blocked: false };
  }

  /* ---------------- classification ---------------- */

  async classify(block: Block): Promise<Decision> {
    const text = block.text.replace(/\s+/g, ' ').trim();
    if (text.length < 4) return this.allow(block, 'Too short to assess');
    const key = this.profile.id + '|' + hash(text);
    const cached = this.cache.get(key);
    if (cached) return { ...cached, stage: cached.stage, id: cached.id };

    const d = await this.decide(text, block);
    d.preview = text.slice(0, 160);
    d.host = block.host;
    this.cache.set(key, d);
    if (this.cache.size > 5000) this.cache.delete(this.cache.keys().next().value!);
    if (d.action !== 'allow') {
      this.state.counters.filtered++;
      this.state.decisions.unshift(d);
      if (this.state.decisions.length > MAX_LOG) this.state.decisions.length = MAX_LOG;
      this.changed();
    }
    return d;
  }

  private allow(block: Block, reason: string, stage: Stage = 'none'): Decision {
    return { id: uid(), ts: Date.now(), action: 'allow', confidence: 0, stage, reason, host: block.host };
  }

  private make(categoryId: string, confidence: number, stage: Stage, reason: string, extra: Partial<Decision> = {}): Decision {
    const cat = this.category(categoryId);
    const set = this.setting(categoryId);
    return {
      id: uid(), ts: Date.now(), action: set.action, categoryId, categoryLabel: cat?.label ?? categoryId,
      confidence, stage, reason, resources: cat?.resources, noReveal: cat?.noReveal, ...extra,
    };
  }

  private async decide(text: string, block: Block): Promise<Decision> {
    const enabled = (id: string) => this.setting(id).enabled;

    // 1. Personal learned examples (on-device).
    const hit = this.learner.match(text, (id) => similarityThreshold(this.setting(id).sensitivity));
    if (hit && !hit.suppressed && enabled(hit.categoryId)) {
      this.state.counters.localDecided++;
      const ex = this.learner.examples.find((e) => e.id === hit.exampleId);
      return this.make(hit.categoryId, hit.similarity, 'learned',
        `Similar (${Math.round(hit.similarity * 100)}%) to something you marked as ${this.category(hit.categoryId)?.label ?? hit.categoryId}${ex?.note ? `: "${ex.note}"` : ''}.`);
    }
    if (hit?.suppressed) {
      this.state.counters.localDecided++;
      return this.allow(block, 'Matches content you marked as fine', 'learned');
    }

    // 2. High-precision local rules.
    const rule = runRules(text).find((r) => enabled(r.categoryId));
    if (rule) {
      this.state.counters.localDecided++;
      const d = this.make(rule.categoryId, rule.confidence, 'rule', `Matched an on-device safety rule (${rule.rule}).`);
      // Rules are context-blind, so check framing before hiding: JEV's context question if available, else local cues.
      let ctx = localContext(text);
      if (!ctx && this.classifier && this.state.settings.jevMode !== 'off') {
        try {
          this.state.counters.jevSent++;
          const v = await this.classifier.classify(text, block.kind, [this.category(rule.categoryId)!], []);
          if (PROTECTED_CONTEXTS.has(v.context) && (v.contextProbabilities[v.context] ?? 0.6) >= 0.5) ctx = v.context;
          d.context = v.context;
        } catch { /* keep rule decision */ }
      }
      if (ctx && PROTECTED_CONTEXTS.has(ctx) && !(rule.categoryId === 'grooming' || rule.categoryId === 'threats') && this.profile.kind !== 'child') {
        d.action = ACTION_RANK[d.action] > ACTION_RANK.label ? 'label' : d.action;
        d.context = ctx;
        d.reason += ` Shown with a label because it reads as ${ctx.replace(/_/g, ' ')}.`;
      }
      return d;
    }

    // 3. JEV.
    const mode = this.state.settings.jevMode;
    const adsOn = enabled('ads');
    const adCandidate = adsOn && (block.kind === 'ad' || adScreen(text));
    if (!this.classifier || mode === 'off') return this.allow(block, 'No local signal; cloud check disabled');
    if (mode === 'risky_only' && !riskScreen(text) && this.state.customCategories.length === 0 && !adCandidate) {
      return this.allow(block, 'No risk signal');
    }
    // Ads are a separate yes/no question. They are not a harm, and ordinary text is not sent just to look for them.
    const onlyAds = mode === 'risky_only' && !riskScreen(text) && this.state.customCategories.length === 0;
    const active = (onlyAds ? [] : BUILTIN_CATEGORIES.filter((c) => c.id !== 'ads' && enabled(c.id)));
    if (adsOn) {
      const ads = this.category('ads');
      if (ads) active.push(ads);
    }
    const custom: CustomCategoryQuestion[] = this.state.customCategories.filter((c) => enabled(c.id)).map((c) => ({
      id: c.id, label: c.label, description: c.description,
      examples: this.state.settings.shareExamplesWithJev
        ? this.learner.examples.filter((e) => e.categoryId === c.id && e.polarity === 'harmful').map((e) => e.text)
        : undefined,
    }));
    if (active.length === 0 && custom.length === 0) return this.allow(block, 'No categories enabled');
    let v: JevVerdict;
    try {
      this.state.counters.jevSent++;
      v = await this.classifier.classify(text, block.kind, active, custom);
    } catch (e) {
      return this.allow(block, `Cloud check unavailable: ${(e as Error).message}`);
    }
    return this.fromVerdict(v, block);
  }

  fromVerdict(v: JevVerdict, block: Block): Decision {
    const kind = this.profile.kind;
    const ctxP = v.contextProbabilities[v.context] ?? 0.6;
    const protectedCtx = PROTECTED_CONTEXTS.has(v.context) && ctxP >= 0.5;
    const candidates: Decision[] = [];

    if (v.harm !== 'none') {
      const set = this.setting(v.harm);
      const p = v.harmProbabilities[v.harm] ?? 0.7;
      if (set.enabled && p >= probabilityThreshold(set.sensitivity) && v.severity >= MIN_SEVERITY[kind]) {
        candidates.push(this.make(v.harm, p, 'jev',
          `JEV judged this ${this.category(v.harm)?.label ?? v.harm} (${Math.round(p * 100)}% likely, severity ${v.severity.toFixed(1)}/4).`,
          { context: v.context, severity: v.severity }));
      }
    }
    const adsP = v.ads ?? 0;
    if (adsP > 0) {
      const set = this.setting('ads');
      if (set.enabled && adsP >= probabilityThreshold(set.sensitivity)) {
        candidates.push(this.make('ads', adsP, 'jev', `JEV judged this an advertisement (${Math.round(adsP * 100)}% likely).`, { context: v.context, severity: v.severity }));
      }
    }
    for (const [id, p] of Object.entries(v.custom)) {
      const set = this.setting(id);
      if (set.enabled && p >= probabilityThreshold(set.sensitivity)) {
        candidates.push(this.make(id, p, 'jev', `JEV matched your category "${this.category(id)?.label ?? id}" (${Math.round(p * 100)}%).`, { context: v.context, severity: v.severity }));
      }
    }
    if (candidates.length === 0) {
      return { ...this.allow(block, 'JEV found no enabled harm above your thresholds', 'jev'), context: v.context, severity: v.severity };
    }
    candidates.sort((a, b) => ACTION_RANK[b.action] - ACTION_RANK[a.action] || b.confidence - a.confidence);
    const d = candidates[0];

    // Freedom of expression: protected contexts are labelled, not hidden, unless severe and person-directed.
    const hardCats = new Set(['csea', 'grooming', 'threats']);
    if (d.categoryId !== 'ads' && protectedCtx && !(hardCats.has(d.categoryId!) && v.severity >= 3.5) && kind !== 'child') {
      d.action = ACTION_RANK[d.action] > ACTION_RANK.label ? 'label' : d.action;
      d.reason += ` Shown with a label because it reads as ${v.context.replace(/_/g, ' ')}.`;
    }
    return d;
  }

  /* ---------------- learning & feedback ---------------- */

  tag(text: string, categoryId: string, polarity: Polarity, note?: string, host?: string, source: Example['source'] = 'tag'): Example {
    const ex = this.learner.add({ text: text.slice(0, 2000), categoryId, polarity, note, host, source });
    this.cache.clear();
    this.changed();
    return ex;
  }

  /** One-click override. "not_harmful" teaches a negative example; "appeal" also records for review. */
  override(decisionId: string, kind: 'revealed' | 'not_harmful' | 'appealed') {
    const d = this.state.decisions.find((x) => x.id === decisionId);
    if (!d) return;
    d.overridden = kind;
    if ((kind === 'not_harmful' || kind === 'appealed') && d.preview && d.categoryId) {
      this.tag(d.preview, d.categoryId, 'fine', kind === 'appealed' ? 'Appealed by user' : 'Marked not harmful', d.host, 'override');
    }
    this.changed();
  }

  deleteExample(id: string) {
    this.learner.remove(id);
    this.cache.clear();
    this.changed();
  }

  addCustomCategory(label: string, description: string): HarmCategory {
    const id = 'custom_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) + '_' + uid().slice(0, 4);
    const cat: HarmCategory = { id, label, description, group: 'other', billRef: 'Your own category', custom: true };
    this.state.customCategories.push(cat);
    for (const p of this.state.profiles) p.categories[id] = { enabled: true, sensitivity: 0.5, action: 'blur' };
    this.cache.clear();
    this.changed();
    return cat;
  }

  removeCustomCategory(id: string) {
    this.state.customCategories = this.state.customCategories.filter((c) => c.id !== id);
    for (const p of this.state.profiles) delete p.categories[id];
    this.learner.removeCategory(id);
    this.cache.clear();
    this.changed();
  }

  updateSetting(profileId: string, categoryId: string, patch: Partial<CategorySetting>) {
    const p = this.state.profiles.find((x) => x.id === profileId);
    if (!p) return;
    p.categories[categoryId] = { ...(p.categories[categoryId] ?? { enabled: true, sensitivity: 0.5, action: 'blur' }), ...patch };
    this.cache.clear();
    this.changed();
  }

  clearDecisions() {
    this.state.decisions = [];
    this.changed();
  }

  /** Local transparency report (never uploaded). */
  report() {
    const byCat: Record<string, number> = {};
    const byStage: Record<string, number> = {};
    let overrides = 0;
    for (const d of this.state.decisions) {
      byCat[d.categoryLabel ?? 'other'] = (byCat[d.categoryLabel ?? 'other'] ?? 0) + 1;
      byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
      if (d.overridden) overrides++;
    }
    return { total: this.state.decisions.length, byCategory: byCat, byStage, overrides, counters: this.state.counters, learning: this.learner.stats() };
  }
}
