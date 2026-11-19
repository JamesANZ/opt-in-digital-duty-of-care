# Architecture

## Goals in one line
One safety engine, one in-page agent, five native shells. The filtering experience is identical everywhere; the browser internals are not.

```
                 +-------------------------------------------+
                 |  packages/core  (TypeScript, no DOM)       |
                 |  taxonomy . policy . profiles . learner    |
                 |  JEV client . local rules . crypto store   |
                 +---------------------+---------------------+
                                       | same JS bundle
                 +---------------------v---------------------+
                 |  packages/page-agent (runs in every page) |
                 |  segment DOM -> classify -> blur/warn/hide |
                 |  highlight-to-tag . feed controls          |
                 +----+-------------+-------------+-----------+
                      |             |             |
            Electron preload   Android WebView   iOS WKUserScript
            (Chromium)         (Chromium/Gecko)  (WebKit)
                      |             |             |
                 +----v----+   +----v-----+   +---v------+
                 | Desktop |   | Android  |   |   iOS    |
                 | Win/Mac |   | Kotlin   |   |  Swift   |
                 | Linux   |   |          |   |          |
                 +---------+   +----------+   +----------+
```

## Classification pipeline (per content block)

1. **Segment**: the page agent splits the page into blocks (posts, comments, search results, captions, alt text, chat messages) using site adapters, with a generic fallback.
2. **Local stage (on-device, always on)**:
   * Learned examples: each user-tagged example is embedded with a local hashed n-gram embedding (`core/src/embed.ts`). Cosine similarity above the user's threshold is a hit. Negative examples ("this is fine") suppress near matches.
   * High-precision rules: crisis phrases, scam patterns, lookalike domains.
   * Benign fast path: blocks with no risk signal skip the network entirely.
3. **JEV stage (opt-out)**: only blocks the local stage cannot settle are sent, as plain text, with no URL, cookies or account identity. One JEV `systemOne` call asks:
   * `harm`: a `choice` over the active categories plus `none`;
   * `context`: a `choice` over `news_reporting`, `education_research`, `satire_parody`, `political_expression`, `ordinary_disagreement`, `support_recovery`, `direct_harm`;
   * `severity`: a `score` from none to severe;
   * one `noul` per user custom category, built from the user's own description and examples.
4. **Policy**: profile + category + severity + context + sensitivity produce an action: `allow`, `label`, `blur`, `hide`, `block_page`, `interstitial` (crisis support). Protected-expression contexts raise the threshold instead of hiding.
5. **Explain + log**: every decision stores which stage decided, the category, confidence and a reason string. One click reveals, overrides or appeals; overrides become negative examples.

Results are cached by content hash (in memory, and in the encrypted store for non-private tabs) so the same comment is never classified twice.

## Why JEV is hosted and what that means
JEV is TypeSafe AI's hosted decision model (`POST https://api.typesafe.ai/v1/systemone`). There are no published open weights, so "on-device AI" is achieved by the local stage, and JEV acts as a remote second opinion. Users can:
* run **Local only** (no network classification at all);
* bring their own JEV key, or route through a self-hosted gateway (`baseURL` is configurable);
* see a live counter of how many snippets were sent.

JEV image input is marked experimental by TypeSafe and needs an opt-in header; DDoC exposes it as an off-by-default setting.

## Browser foundation evaluation

| Option | Desktop | Android | iOS | Verdict |
|---|---|---|---|---|
| Chromium fork (e.g. ungoogled-chromium, Brave-style patches) | Yes | Yes | No (WebKit required) | **Production target for desktop + Android.** Large build (100 GB+ source, hours per build); needs CI farm. |
| Firefox / Gecko fork (Firefox, Fenix with GeckoView) | Yes | Yes | No | Strong privacy story; GeckoView embeds cleanly on Android. Viable alternative. |
| Electron (Chromium content layer) | Yes | No | No | **Used for the MVP**: real Chromium engine, real browser UI, buildable for Win/macOS/Linux in minutes. Security updates follow Electron's Chromium cadence (slower than Chrome). |
| Android System WebView | n/a | Yes | n/a | Used for the Android MVP; swap to GeckoView or a Chromium fork for release. |
| WKWebView | n/a | n/a | **Mandatory** | Apple requires WebKit for browsers outside the EU. Australia is outside the EU's alternative-engine regime, so the iOS app must use WebKit. |

### iOS specifics
* The page agent is injected as a `WKUserScript` at document start in all frames; the core engine runs in the page context and in a background `JSContext`.
* Persistence uses the Keychain-protected store instead of Electron `safeStorage`.
* Content blockers (`WKContentRuleList`) handle domain-level blocks; JEV handles content-level decisions.
* Private browsing uses a non-persistent `WKWebsiteDataStore`.

## Repository layout
```
packages/core        shared engine (Node, Electron, Android, iOS all run the same bundle)
packages/page-agent  injected script + overlay UI
apps/desktop         Electron browser: tabs, bookmarks, history, downloads, private mode, dashboard
apps/android         Kotlin app (WebView) loading the same bundles from assets/
apps/ios             Swift app (WKWebView) loading the same bundles from the app bundle
eval/                labelled eval set incl. protected-expression controls
docs/                mapping, architecture, privacy, risk assessment, roadmap
```
