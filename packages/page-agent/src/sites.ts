/**
 * @title Site adapters
 * @notice Selectors for known sites, plus a generic fallback that still finds text anywhere.
 * @dev Selectors drift as sites change markup. Each adapter is data and can be updated on its own.
 */

/**
 * @notice How to find blocks and feed controls on one family of sites.
 */
export interface SiteAdapter {
  hosts: string[];
  blocks: [selector: string, kind: string][];
  counts?: string[];
  recommendations?: string[];
  ephemeral?: string[];
  feedItem?: string;
  followingFeed?: () => void;
}

/**
 * @notice Selectors used on every site after the site-specific ones.
 * @dev Ad slots come first so an advertisement is classified as an ad rather than as a paragraph.
 */
export const GENERIC_SELECTORS: [string, string][] = [
  ['[aria-label*="dvertisement" i], [aria-label*="ponsored" i], ins.adsbygoogle, [id^="google_ads"], [data-ad-slot], [data-google-query-id]', 'ad'],
  ['p', 'paragraph'],
  ['li', 'list_item'],
  ['blockquote', 'quote'],
  ['figcaption', 'caption'],
  ['h1, h2, h3', 'title'],
  ['[role=comment]', 'comment'],
  ['div[dir=auto], span[dir=auto]', 'post'],
  ['[role=article]', 'post'],
];

/**
 * @notice Run a navigation at most once per page, even if the adapter is applied again.
 * @param key Window property used as the latch.
 * @param fn Navigation to perform.
 */
const once = (key: string, fn: () => void) => {
  const w = window as any;
  if (w[key]) return;
  w[key] = true;
  fn();
};

/**
 * @notice Adapters for X, YouTube, Reddit, Instagram, Facebook, and TikTok.
 */
export const ADAPTERS: SiteAdapter[] = [
  {
    hosts: ['x.com', 'twitter.com'],
    blocks: [['[data-testid=tweetText]', 'post'], ['[data-testid=UserDescription]', 'bio']],
    counts: ['[data-testid=reply] span', '[data-testid=retweet] span', '[data-testid=like] span', 'a[href$="/analytics"]'],
    recommendations: ['[aria-label="Timeline: Trending now"]', '[aria-label="Who to follow"]', 'aside[aria-label]'],
    feedItem: '[data-testid=cellInnerDiv]',
    followingFeed: () => once('__ddocXFollow', () => setTimeout(() => {
      const tab = [...document.querySelectorAll('[role=tab]')].find((t) => /following/i.test(t.textContent ?? '')) as HTMLElement | undefined;
      tab?.click();
    }, 1500)),
  },
  {
    hosts: ['youtube.com', 'm.youtube.com'],
    blocks: [['#content-text', 'comment'], ['#video-title', 'title'], ['yt-formatted-string#title', 'title'], ['#description-inline-expander', 'caption']],
    counts: ['#vote-count-middle', '#like-button .yt-spec-button-shape-next__button-text-content', '#metadata-line span:first-child'],
    recommendations: ['#related', 'ytd-reel-shelf-renderer', 'ytd-rich-shelf-renderer[is-shorts]', '.ytp-endscreen-content'],
    ephemeral: ['ytd-reel-shelf-renderer', 'a[href^="/shorts"]'],
    feedItem: 'ytd-rich-item-renderer',
    followingFeed: () => {
      if (location.pathname === '/' && !location.search) location.replace('/feed/subscriptions');
    },
  },
  {
    hosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com'],
    blocks: [['shreddit-comment [slot=comment]', 'comment'], ['[slot=title]', 'title'], ['[slot=text-body]', 'post'], ['.md', 'comment']],
    counts: ['faceplate-number', 'shreddit-post [slot=vote-count]', '.score'],
    recommendations: ['[data-testid=popular-communities]', 'recent-posts', 'shreddit-gallery-carousel'],
    feedItem: 'shreddit-post, article',
  },
  {
    hosts: ['instagram.com'],
    blocks: [['article h1', 'caption'], ['ul ul span[dir=auto]', 'comment']],
    counts: ['section a[href$="/liked_by/"]', 'section span[class] > span'],
    ephemeral: ['[role=menu][aria-label*="tories"]', 'div[role=presentation] > div > ul'],
    recommendations: ['a[href="/explore/"]', 'a[href="/reels/"]'],
    feedItem: 'article',
  },
  {
    hosts: ['facebook.com', 'm.facebook.com'],
    blocks: [['[data-ad-preview=message]', 'post'], ['div[role=article] div[dir=auto]', 'comment']],
    ephemeral: ['[aria-label="Stories"]', '[aria-label*="Reels"]'],
    recommendations: ['[aria-label="People you may know"]', '[aria-label="Suggested for you"]'],
    feedItem: 'div[role=feed] > div',
  },
  {
    hosts: ['tiktok.com'],
    blocks: [['[data-e2e=browse-video-desc]', 'caption'], ['[data-e2e=comment-level-1]', 'comment'], ['[data-e2e=video-desc]', 'caption']],
    counts: ['[data-e2e=like-count]', '[data-e2e=comment-count]', '[data-e2e=share-count]', '[data-e2e=video-views]'],
    recommendations: ['[data-e2e=recommend-list-item-container]'],
    feedItem: '[data-e2e=recommend-list-item-container]',
    followingFeed: () => { if (location.pathname === '/' || location.pathname === '/foryou') location.replace('/following'); },
  },
  {
    hosts: ['google.com', 'www.google.com', 'google.com.au', 'www.google.com.au', 'duckduckgo.com', 'bing.com', 'www.bing.com'],
    blocks: [['div.g', 'search_result'], ['[data-testid=result]', 'search_result'], ['li.b_algo', 'search_result']],
  },
];

/**
 * @notice Find the adapter for a hostname.
 * @param host Page hostname.
 * @return The adapter, or undefined so the generic selectors are used alone.
 */
export function adapterFor(host: string): SiteAdapter | undefined {
  return ADAPTERS.find((a) => a.hosts.some((h) => host === h || host.endsWith('.' + h)));
}
