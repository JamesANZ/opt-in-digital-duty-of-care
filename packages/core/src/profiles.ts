import { BUILTIN_CATEGORIES, HarmCategory } from './taxonomy';

export type Action = 'allow' | 'label' | 'blur' | 'hide' | 'interstitial' | 'block_page';
export type ProfileKind = 'adult' | 'teen' | 'child';
export type JevMode = 'off' | 'risky_only' | 'all';

export interface CategorySetting {
  enabled: boolean;
  /** 0 = least sensitive, 1 = most sensitive. */
  sensitivity: number;
  action: Action;
}

/** Design-feature restrictions mirroring the Bill's under-16 provisions. */
export interface DesignRestrictions {
  hideRecommendations: boolean; // "For you", "Suggested", "Up next" rails
  stopInfiniteScroll: boolean; // pause feed after `scrollLimit` items
  scrollLimit: number;
  hideEngagementCounts: boolean; // likes, views, follower counts
  hideEphemeral: boolean; // stories, time-limited content
  disableAutoplay: boolean;
  preferFollowingFeed: boolean; // "My Feed, My Way"
}

export interface Profile {
  id: string;
  name: string;
  kind: ProfileKind;
  /** Parent-chosen band only. No birthdays or ID are collected. */
  ageBand?: 'under_10' | '10_12' | '13_15' | '16_17' | 'adult';
  categories: Record<string, CategorySetting>;
  design: DesignRestrictions;
  blockedHosts: string[];
  allowedHosts: string[];
  allowPrivateWindows: boolean;
  /** Protected profiles need the parent PIN to change settings or switch away. */
  locked: boolean;
}

export interface Settings {
  activeProfileId: string;
  jevMode: JevMode;
  jevApiKey?: string;
  jevBaseURL?: string;
  jevModel?: string;
  shareExamplesWithJev: boolean;
  imageChecks: boolean;
  parentPinHash?: string;
  parentPinSalt?: string;
  searchEngine: string;
}

const NO_DESIGN: DesignRestrictions = {
  hideRecommendations: false, stopInfiniteScroll: false, scrollLimit: 60, hideEngagementCounts: false,
  hideEphemeral: false, disableAutoplay: false, preferFollowingFeed: false,
};
const U16_DESIGN: DesignRestrictions = {
  hideRecommendations: true, stopInfiniteScroll: true, scrollLimit: 30, hideEngagementCounts: true,
  hideEphemeral: true, disableAutoplay: true, preferFollowingFeed: true,
};

function defaultsFor(kind: ProfileKind, cats: HarmCategory[]): Record<string, CategorySetting> {
  const out: Record<string, CategorySetting> = {};
  for (const c of cats) {
    let s: CategorySetting;
    if (kind === 'adult') {
      s = c.group === 'seriously_harmful'
        ? { enabled: true, sensitivity: 0.5, action: c.supportive ? 'interstitial' : 'blur' }
        : c.group === 'other'
          ? { enabled: true, sensitivity: 0.5, action: 'label' }
          : { enabled: c.id === 'cyberbullying', sensitivity: 0.4, action: 'label' };
    } else if (kind === 'teen') {
      s = { enabled: true, sensitivity: 0.6, action: c.supportive ? 'interstitial' : c.id === 'pornography' ? 'hide' : 'blur' };
    } else {
      s = { enabled: true, sensitivity: 0.75, action: c.supportive ? 'interstitial' : 'hide' };
    }
    if (c.id === 'csea') s = { enabled: true, sensitivity: 0.7, action: 'block_page' };
    if (c.id === 'ads') s = { enabled: true, sensitivity: 0.6, action: 'hide' };
    out[c.id] = s;
  }
  return out;
}

/** Fill in built-in categories added after a profile was saved. Existing choices are left as they are. */
export function applyBuiltinDefaults(profiles: Profile[], cats: HarmCategory[] = BUILTIN_CATEGORIES) {
  for (const p of profiles) {
    const defaults = defaultsFor(p.kind, cats);
    for (const [id, setting] of Object.entries(defaults)) {
      if (!p.categories[id]) p.categories[id] = setting;
    }
  }
}

export function makeProfile(id: string, name: string, kind: ProfileKind, cats: HarmCategory[] = BUILTIN_CATEGORIES): Profile {
  return {
    id, name, kind,
    ageBand: kind === 'adult' ? 'adult' : kind === 'teen' ? '13_15' : '10_12',
    categories: defaultsFor(kind, cats),
    design: kind === 'adult' ? { ...NO_DESIGN } : { ...U16_DESIGN },
    blockedHosts: [],
    allowedHosts: [],
    allowPrivateWindows: kind === 'adult',
    locked: kind !== 'adult',
  };
}

export function defaultSettings(): Settings {
  return {
    activeProfileId: 'me',
    jevMode: 'risky_only',
    shareExamplesWithJev: false,
    imageChecks: false,
    searchEngine: 'https://duckduckgo.com/?q=%s',
  };
}

/* PIN hashing with PBKDF2 (WebCrypto works in Node 22, Electron, WKWebView, Android WebView). */
export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const subtle = globalThis.crypto.subtle;
  const salt = saltB64 ? b64d(saltB64) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 }, key, 256);
  return { hash: b64e(new Uint8Array(bits)), salt: b64e(salt) };
}

export async function verifyPin(pin: string, settings: Settings): Promise<boolean> {
  if (!settings.parentPinHash || !settings.parentPinSalt) return true;
  const { hash } = await hashPin(pin, settings.parentPinSalt);
  return hash === settings.parentPinHash;
}

export function b64e(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
export function b64d(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
