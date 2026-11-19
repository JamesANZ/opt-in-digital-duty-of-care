/**
 * @title On-device rules
 * @notice High-precision checks that run even when JEV is off.
 * @dev These prefer precision over recall. JEV and taught examples supply the recall.
 */
import { normalise } from './embed';

/**
 * @notice One rule that matched a piece of text.
 */
export interface RuleHit {
  categoryId: string;
  confidence: number;
  rule: string;
}

/**
 * @notice A local rule: an id, the category it supports, its confidence, and its test.
 */
interface Rule {
  id: string;
  categoryId: string;
  confidence: number;
  test: (norm: string, raw: string) => boolean;
}

/**
 * @notice Build a rule test that matches when any pattern matches the normalised or raw text.
 * @param res Patterns to try.
 * @return A test function for a `Rule`.
 */
const any = (...res: RegExp[]) => (n: string, raw: string) => res.some((r) => r.test(n) || r.test(raw));

/**
 * @notice The shipped high-precision rules.
 * @dev A match is a filtering candidate only when that category is enabled on the active profile.
 */
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

/**
 * @notice Run every local rule against a piece of text.
 * @param text Text to test.
 * @return Matches, highest confidence first.
 */
export function runRules(text: string): RuleHit[] {
  const norm = normalise(text);
  const lower = text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ');
  const hits: RuleHit[] = [];
  for (const r of RULES) if (r.test(norm, lower)) hits.push({ categoryId: r.categoryId, confidence: r.confidence, rule: r.id });
  return hits.sort((a, b) => b.confidence - a.confidence);
}

/**
 * @notice Stems used by the risk screen.
 * @dev Deliberately broad. A hit only makes the block eligible for a JEV call. It is not a filtering decision.
 */
const RISK_STEMS = [
  'kill', 'die', 'dead', 'death', 'suicid', 'cut', 'hurt', 'harm', 'hate', 'ugly', 'fat', 'stupid', 'idiot', 'loser',
  'retard', 'slut', 'whore', 'bitch', 'cunt', 'fuck', 'rape', 'nude', 'naked', 'sex', 'porn', 'nsfw', 'onlyfans',
  'shoot', 'stab', 'bomb', 'attack', 'jihad', 'martyr', 'manifesto', 'nazi', 'genocide', 'gore', 'torture', 'behead',
  'starv', 'purg', 'calorie', 'thin', 'skinny', 'anorex', 'bulim', 'challenge', 'dare', 'secret', 'snap', 'how old',
  'crypto', 'bitcoin', 'giveaway', 'gift card', 'verify', 'password', 'urgent', 'winner', 'invest', 'returns',
  'deepfake', 'nudify', 'undress', 'women are', 'females', 'alpha male', 'kys', 'worthless', 'nobody likes', 'threat',
];

/**
 * @notice Decide whether balanced mode should consider sending this text to JEV.
 * @param text Text to screen.
 * @return True when a risk stem is present.
 */
export function riskScreen(text: string): boolean {
  const n = normalise(text);
  return RISK_STEMS.some((s) => n.includes(s));
}

/**
 * @notice Phrases that suggest a block might be an advertisement.
 * @dev A hit only justifies asking JEV. It is not itself a block decision.
 */
const AD_HINT = /\b(sponsored|advertisements?|advert|paid partnership|paid post|shop now|buy now|order now|use code|promo codes?|limited[- ]time offer|affiliate link)\b|%\s*off\b/i;

/**
 * @notice Decide whether balanced mode should ask JEV if this block is an ad.
 * @param text Text to screen.
 * @return True when an advertising phrase is present.
 */
export function adScreen(text: string): boolean {
  return AD_HINT.test(text);
}

/**
 * @notice Brand names and the hostnames that are allowed to use them.
 * @dev Used to flag lookalike domains for common Australian scam targets.
 */
const PROTECTED_BRANDS: Record<string, string[]> = {
  mygov: ['my.gov.au'], ato: ['ato.gov.au'], auspost: ['auspost.com.au'], commbank: ['commbank.com.au'],
  westpac: ['westpac.com.au'], nab: ['nab.com.au'], anz: ['anz.com.au'], paypal: ['paypal.com'],
  linkt: ['linkt.com.au'], medicare: ['servicesaustralia.gov.au'], centrelink: ['servicesaustralia.gov.au'],
};

/**
 * @notice Result of checking a link for a lookalike domain.
 */
export interface UrlVerdict {
  suspicious: boolean;
  reason?: string;
  brand?: string;
}

/**
 * @notice Check a link for a punycode host or a brand name on an unofficial domain.
 * @param url Absolute URL to check.
 * @return A verdict. Unparseable URLs are not suspicious.
 */
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
 * @notice Phrases that mark news, education, or support framing.
 * @dev Used to soften a rule hit when JEV's context question is unavailable.
 */
const CONTEXT_CUES: [string, RegExp][] = [
  ['news_reporting', /\b(police (said|say)|reporters?|according to|court (heard|date)|was charged|journalists?)\b/],
  ['education_research', /\b(doctors?|experts?|researchers?) (warn|say|found)|\b(a |new )?study\b|\bwarning signs\b|\bhow to (spot|recognise|recognize)\b|\bparents? (should|need to) know\b/],
  ['support_recovery', /\b(reach out|helpline|you are not alone|in recovery|recovery from|lifeline|kids helpline)\b/],
];

/**
 * @notice Guess a protected context from on-device cues.
 * @param text Text to read.
 * @return A context id, or null when no cue matches.
 */
export function localContext(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [ctx, re] of CONTEXT_CUES) if (re.test(lower)) return ctx;
  return null;
}
