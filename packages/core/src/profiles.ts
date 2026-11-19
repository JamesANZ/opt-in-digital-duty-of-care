/**
 * @title Profiles and settings
 * @notice Profile defaults, parent PIN hashing, and the encoding helpers the encrypted store uses.
 */

import { BUILTIN_CATEGORIES, HarmCategory } from './taxonomy';

/**
 * @notice What the browser does with a matching block.
 * @dev `allow` shows it. `label` marks it. `blur`, `hide`, `interstitial`, and `block_page` hide progressively more.
 */
export type Action = 'allow' | 'label' | 'blur' | 'hide' | 'interstitial' | 'block_page';

/**
 * @notice Who a profile is for. Child and teen profiles lock settings behind the parent PIN.
 */
export type ProfileKind = 'adult' | 'teen' | 'child';

/**
 * @notice How much text is eligible to be sent to JEV.
 * @dev `off` stays on device. `risky_only` sends risk signals, custom categories, and ad candidates. `all` sends undecided blocks.
 */
export type JevMode = 'off' | 'risky_only' | 'all';

/**
 * @notice How one category is configured on one profile.
 */
export interface CategorySetting {
  enabled: boolean;
  /** 0 = least sensitive, 1 = most sensitive. */
  sensitivity: number;
  action: Action;
}

/**
 * @notice Feed controls that mirror the Bill's under-16 design protections.
 * @dev These change what this browser shows. They do not change a site's ranking.
 */
export interface DesignRestrictions {
  hideRecommendations: boolean; // "For you", "Suggested", "Up next" rails
  stopInfiniteScroll: boolean; // pause feed after `scrollLimit` items
  scrollLimit: number;
  hideEngagementCounts: boolean; // likes, views, follower counts
  hideEphemeral: boolean; // stories, time-limited content
  disableAutoplay: boolean;
  preferFollowingFeed: boolean; // "My Feed, My Way"
}

/**
 * @notice A person using this browser. No name, birthday, or identity document is required.
 */
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

/**
 * @notice Device-wide settings shared by every profile.
 */
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

/**
 * @notice Default category settings for a new profile of `kind`.
 * @param kind Adult, teen, or child.
 * @param cats Categories to configure. Built-in categories are the usual list.
 * @return Settings keyed by category id. CSEA blocks the page. Ads start hidden.
 */
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

/**
 * @notice Add settings for built-in categories that a saved profile does not have yet.
 * @dev Existing choices are left as they are. Used when a new built-in category ships, such as ads.
 * @param profiles Profiles to update in place.
 * @param cats Categories that should have a setting. Defaults to the built-in list.
 */
export function applyBuiltinDefaults(profiles: Profile[], cats: HarmCategory[] = BUILTIN_CATEGORIES) {
  for (const p of profiles) {
    const defaults = defaultsFor(p.kind, cats);
    for (const [id, setting] of Object.entries(defaults)) {
      if (!p.categories[id]) p.categories[id] = setting;
    }
  }
}

/**
 * @notice Create a profile with the defaults for its kind.
 * @param id Profile id.
 * @param name Name shown in the toolbar and dashboard.
 * @param kind Adult, teen, or child.
 * @param cats Categories to configure. Defaults to the built-in list.
 * @return A profile. Child and teen profiles are locked and get the under-16 feed controls.
 */
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

/**
 * @notice Settings for a fresh install.
 * @return Balanced JEV mode, DuckDuckGo search, and no sharing of examples.
 */
export function defaultSettings(): Settings {
  return {
    activeProfileId: 'me',
    jevMode: 'risky_only',
    shareExamplesWithJev: false,
    imageChecks: false,
    searchEngine: 'https://duckduckgo.com/?q=%s',
  };
}

/**
 * @notice Hash a parent PIN with PBKDF2-SHA256.
 * @dev 210,000 iterations. WebCrypto is used so the same code runs in Node, Electron, WKWebView, and Android WebView.
 * @param pin PIN to hash.
 * @param saltB64 Existing salt, base64. A new 16-byte salt is created when omitted.
 * @return Base64 hash and salt.
 */
export async function hashPin(pin: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const subtle = globalThis.crypto.subtle;
  const salt = saltB64 ? bytes(b64d(saltB64)) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 }, key, 256);
  return { hash: b64e(new Uint8Array(bits)), salt: b64e(salt) };
}

/**
 * @notice Check a parent PIN against the stored hash.
 * @param pin PIN the user entered.
 * @param settings Settings that hold the hash and salt.
 * @return True when the PIN matches, or when no PIN has been set.
 */
export async function verifyPin(pin: string, settings: Settings): Promise<boolean> {
  if (!settings.parentPinHash || !settings.parentPinSalt) return true;
  const { hash } = await hashPin(pin, settings.parentPinSalt);
  return hash === settings.parentPinHash;
}

/**
 * @notice Copy bytes into a fresh ArrayBuffer.
 * @dev WebCrypto rejects a view whose buffer is only ArrayBufferLike, which TypeScript 7's DOM types allow.
 * @param data Bytes to copy.
 * @return A Uint8Array backed by a real ArrayBuffer.
 */
export function bytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

/**
 * @notice Encode bytes as base64.
 * @param u Bytes to encode.
 * @return Base64 text.
 */
export function b64e(u: Uint8Array): string {
  let s = '';
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
/**
 * @notice Decode base64 into bytes.
 * @param s Base64 text.
 * @return Decoded bytes. The backing buffer may be ArrayBufferLike, so WebCrypto callers should wrap it with `bytes`.
 */
export function b64d(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
