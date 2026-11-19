/**
 * High-precision local rules. These run on-device even in Local-only mode.
 * They aim for precision over recall: JEV and learned examples provide recall.
 */
import { normalise } from './embed';

export interface RuleHit {
  categoryId: string;
  confidence: number;
  rule: string;
}

interface Rule {
  id: string;
  categoryId: string;
  confidence: number;
  test: (norm: string, raw: string) => boolean;
}

const any = (...res: RegExp[]) => (n: string, raw: string) => res.some((r) => r.test(n) || r.test(raw));

const RULES: Rule[] = [
  // Self-harm / suicide promotion and method-seeking. Supportive interstitial, never a silent hide.
  { id: 'selfharm.encourage', categoryId: 'self_harm', confidence: 0.9,
    test: any(/\b(you should|just|go) (kill|hurt) (yourself|urself)\b/, /\bkys\b/, /\b(nobody|no one) would miss you\b/) },
  // Disordered eating promotion
  { id: 'ed.promo', categoryId: 'eating_disorder', confidence: 0.85,
    test: any(/\bthinspo\b/, /\bproana\b|\bpro ana\b/, /\bmeanspo\b/, /\bpro mia\b/) },
  // Grooming signals
  { id: 'grooming.secret', categoryId: 'grooming', confidence: 0.8,
    test: any(/\b(dont|don't|do not) tell (your|ur) (mum|mom|dad|parents|teacher)\b/, /\bour little secret\b/,
      /\b(delete|clear) (this|these|our) (chat|messages)\b.*\b(parents|mum|mom|dad)\b/) },
  { id: 'grooming.move', categoryId: 'grooming', confidence: 0.7,
    test: (n) => /\bhow old are (you|u)\b/.test(n) && /\b(snap|snapchat|whatsapp|telegram|kik|discord|dm me|private)\b/.test(n) },
  // Threats
  { id: 'threat.direct', categoryId: 'threats', confidence: 0.85,
    test: any(/\bi(?:'?ll| will) (kill|stab|shoot|hurt) (you|u|ur|your)\b/, /\bi(?:'?m| am) (?:going to|gonna) (kill|stab|shoot|hurt) (you|u|ur|your)\b/, /\bi know where (you|u) live\b/) },
  // Scams
  { id: 'scam.giftcard', categoryId: 'scam_fraud', confidence: 0.85,
    test: any(/\b(pay|send|buy) (with |me |us )?(itunes|google play|steam|apple) gift ?cards?\b/, /\bgift ?cards? (to|as) (pay|payment)\b/) },
  { id: 'scam.crypto', categoryId: 'scam_fraud', confidence: 0.8,
    test: any(/\b(double|triple) your (crypto|bitcoin|btc|eth|money)\b/, /\bguaranteed (daily |weekly )?(returns?|profits?)\b/) },
  { id: 'scam.urgent', categoryId: 'scam_fraud', confidence: 0.7,
    test: any(/\b(verify|confirm) your (account|identity|details) within \d+ ?(hours|hrs|minutes)\b/, /\byour (parcel|package) (is|has been) (held|on hold)\b.*\b(fee|pay)\b/) },
  // Image-based abuse
  { id: 'nci.nudify', categoryId: 'nci_deepfake', confidence: 0.85,
    test: any(/\b(nudify|undress) (any|anyone|her|him|your crush|a photo)\b/, /\bdeep ?fake (nudes?|porn)\b/) },
  // Dangerous challenges
  { id: 'challenge.blackout', categoryId: 'dangerous_challenges', confidence: 0.85,
    test: any(/\b(blackout|choking|pass ?out|skull ?breaker) challenge\b/) },
];

export function runRules(text: string): RuleHit[] {
  const norm = normalise(text);
  const lower = text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ');
  const hits: RuleHit[] = [];
  for (const r of RULES) if (r.test(norm, lower)) hits.push({ categoryId: r.categoryId, confidence: r.confidence, rule: r.id });
  return hits.sort((a, b) => b.confidence - a.confidence);
}

/**
 * Cheap risk screen used to decide whether a block is worth sending to JEV in "risky-only" mode.
 * Deliberately broad: false positives here only cost a JEV call, not a filtering decision.
 */
const RISK_STEMS = [
  'kill', 'die', 'dead', 'death', 'suicid', 'cut', 'hurt', 'harm', 'hate', 'ugly', 'fat', 'stupid', 'idiot', 'loser',
  'retard', 'slut', 'whore', 'bitch', 'cunt', 'fuck', 'rape', 'nude', 'naked', 'sex', 'porn', 'nsfw', 'onlyfans',
  'shoot', 'stab', 'bomb', 'attack', 'jihad', 'martyr', 'manifesto', 'nazi', 'genocide', 'gore', 'torture', 'behead',
  'starv', 'purg', 'calorie', 'thin', 'skinny', 'anorex', 'bulim', 'challenge', 'dare', 'secret', 'snap', 'how old',
  'crypto', 'bitcoin', 'giveaway', 'gift card', 'verify', 'password', 'urgent', 'winner', 'invest', 'returns',
  'deepfake', 'nudify', 'undress', 'women are', 'females', 'alpha male', 'kys', 'worthless', 'nobody likes', 'threat',
];

export function riskScreen(text: string): boolean {
  const n = normalise(text);
  return RISK_STEMS.some((s) => n.includes(s));
}

/**
 * Cheap hint that a block might be an ad. A hit only justifies asking JEV;
 * it is not itself a block decision.
 */
const AD_HINT = /\b(sponsored|advertisements?|advert|paid partnership|paid post|shop now|buy now|order now|use code|promo codes?|limited[- ]time offer|affiliate link)\b|%\s*off\b/i;

export function adScreen(text: string): boolean {
  return AD_HINT.test(text);
}

/* ------------------------------------------------------------------ */
/* URL checks: lookalike domains for common Australian scam targets.   */
/* ------------------------------------------------------------------ */

const PROTECTED_BRANDS: Record<string, string[]> = {
  mygov: ['my.gov.au'], ato: ['ato.gov.au'], auspost: ['auspost.com.au'], commbank: ['commbank.com.au'],
  westpac: ['westpac.com.au'], nab: ['nab.com.au'], anz: ['anz.com.au'], paypal: ['paypal.com'],
  linkt: ['linkt.com.au'], medicare: ['servicesaustralia.gov.au'], centrelink: ['servicesaustralia.gov.au'],
};

export interface UrlVerdict {
  suspicious: boolean;
  reason?: string;
  brand?: string;
}

export function checkUrl(url: string): UrlVerdict {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase(); } catch { return { suspicious: false }; }
  if (host.startsWith('xn--') || host.includes('.xn--')) {
    return { suspicious: true, reason: 'Internationalised domain that can imitate familiar names' };
  }
  const flat = host.replace(/[^a-z0-9]/g, '');
  for (const [brand, officials] of Object.entries(PROTECTED_BRANDS)) {
    if (!flat.includes(brand)) continue;
    const official = officials.some((d) => host === d || host.endsWith('.' + d));
    if (!official) return { suspicious: true, brand, reason: `Uses the name "${brand}" but is not an official ${brand} domain` };
  }
  return { suspicious: false };
}

/**
 * On-device detector for protected-expression framing (news, education, research, support).
 * Used to soften rule hits in Local-only mode, where JEV's context question is unavailable.
 */
const CONTEXT_CUES: [string, RegExp][] = [
  ['news_reporting', /\b(police (said|say)|reporters?|according to|court (heard|date)|was charged|journalists?)\b/],
  ['education_research', /\b(doctors?|experts?|researchers?) (warn|say|found)|\b(a |new )?study\b|\bwarning signs\b|\bhow to (spot|recognise|recognize)\b|\bparents? (should|need to) know\b/],
  ['support_recovery', /\b(reach out|helpline|you are not alone|in recovery|recovery from|lifeline|kids helpline)\b/],
];

export function localContext(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [ctx, re] of CONTEXT_CUES) if (re.test(lower)) return ctx;
  return null;
}
