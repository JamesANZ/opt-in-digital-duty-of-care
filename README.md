# DDoC Browser: Digital Duty of Care Browser

A privacy-first, open-source browser that puts online safety in the user's hands. It implements the user-side objectives of Australia's **Online Safety Amendment (Digital Duty of Care) Bill 2026** with personal, explainable AI filtering powered by **JEV** (TypeSafe AI) plus on-device learning.

Your filters change only what *you* see. Nothing is shared, no block lists are on by default, and every decision is explained and reversible.

![Forum with DDoC filtering](docs/screenshots/02-forum-adult-labels.png)

## What's here

| Part | Path | Status |
|---|---|---|
| Shared safety engine (taxonomy, JEV client, on-device learning, policy, profiles, encryption, RPC) | `packages/core` | Built and tested |
| Shared in-page agent (block detection, blur/label/hide/support screens, teach-by-selection, feed controls, scam-link guard) | `packages/page-agent` | Built, running in desktop |
| **Desktop browser** for Windows, macOS, Linux (Electron / Chromium): tabs, bookmarks, history, downloads, private windows, Safety Dashboard | `apps/desktop` | **Runs** |
| **Android** app (Kotlin, WebView + androidx.webkit, Keystore-encrypted state) | `apps/android` | Source complete; build with Android SDK |
| **iOS** app (SwiftUI, WKWebView with an isolated content world, Keychain + CryptoKit) | `apps/ios` | Source complete; build with Xcode on macOS |
| Legislative mapping, architecture, privacy, risk assessment, roadmap | `docs/` | Done |
| Evaluation set and harness (recall + over-blocking of protected expression) | `eval/`, `scripts/eval.mjs` | Done |

## Quick start (desktop)

```bash
npm install
npm run build
npm test
npm start                      # launches DDoC Browser
```

JEV: set your TypeSafe key in **Safety Dashboard > Privacy & JEV**, or copy `.env.example` to `.env` and fill in `TYPESAFE_API_KEY`. The desktop app and `scripts/eval.mjs` load that file; a shell export wins if both are set. Without a key DDoC runs on-device only (your examples + safety rules). Android and iOS do not read `.env`; set the key in the dashboard on those apps.

Demo with the bundled test forum and a *mock* JEV server (heuristic stand-in, for offline demos only):

```bash
node scripts/mock-jev.mjs &
DDOC_DEMO=1 TYPESAFE_API_KEY=mock TYPESAFE_BASE_URL=http://127.0.0.1:4778 npm --workspace apps/desktop start
```

Packaging: `npm --workspace apps/desktop run dist:win | dist:mac | dist:linux` (needs `electron-builder`; macOS builds need signing and notarisation).

## Mobile

`npm run build` copies the shared engine, agent and dashboard into both mobile projects.

* **Android**: open `apps/android` in Android Studio (or `gradle assembleDebug` with SDK 35). Uses `addDocumentStartJavaScript` to inject the agent into every frame and `addWebMessageListener` so the page origin comes from WebView, not the page.
* **iOS**: `cd apps/ios && xcodegen && open DDoCBrowser.xcodeproj`. Apple requires WebKit for browsers in Australia, so iOS uses WKWebView; the agent runs in its own `WKContentWorld`, invisible to page scripts. The default-browser entitlement must be requested from Apple.

## How filtering works

1. **On-device**: your taught examples (similarity matching across all sites), plus high-precision safety rules. Always on, works offline.
2. **JEV**: only undecided text is sent, without URL or identity. One call asks which harm (if any), the communicative context (news, education, satire, political expression, support...), severity, and your custom categories.
3. **Policy**: your profile, sensitivity and the context decide: allow, label, blur, hide, support screen, or block page. Protected expression is labelled, not hidden.
4. **Explain and correct**: every item has *Why?*, *Show* and *Not harmful*. Corrections become negative examples.

## Evaluation

```bash
node scripts/eval.mjs --local           # on-device stages only
TYPESAFE_API_KEY=... node scripts/eval.mjs   # real JEV accuracy
```

On the bundled 30-item set, on-device only: 75% recall on harmful items, 0% over-blocking of protected or benign items. Real-JEV numbers need your API key; the mock-server run only checks the plumbing and is not an accuracy result. The set is small and is a starting point, not a benchmark.

## Honest limits

See `docs/LEGISLATIVE_MAPPING.md` section 4. In short: a browser cannot change platform ranking, remove content for others, see inside native apps or E2EE chats, do licensed CSAM hash matching, or file the provider-side reports the Bill requires. The desktop shell uses Electron for now; the roadmap moves it to a patched Chromium build for faster security updates.

## Licence

MPL-2.0 (proposed, matching most browser forks). See `LICENSE`.
