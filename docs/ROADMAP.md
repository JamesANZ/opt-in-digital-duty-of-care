# Roadmap

Status key: done = in this repository and tested; source = code written, needs a platform toolchain to build; planned = not started.

## Phase 1: Research and planning (done)
* Legislative mapping: `docs/LEGISLATIVE_MAPPING.md`.
* Foundation evaluation and iOS engine constraints: `docs/ARCHITECTURE.md`.
* Privacy model: `docs/PRIVACY.md`. Voluntary risk assessment: `docs/RISK_ASSESSMENT.md`.

## Phase 2: Desktop MVP (done)
* Electron browser for Windows, macOS, Linux: tabs, address/search bar, back/forward/reload, bookmarks, history, downloads, private windows, find-in-page via Chromium.
* Native filtering via preload injection into every page (not an extension).
* JEV client with local-first pipeline, explanations, reveal, override.

## Phase 3: Adaptive learning (done)
* Select text, right-click "Teach DDoC: this is harmful / this is fine".
* Custom categories with descriptions; positive and negative examples; per-category sensitivity.
* Local semantic similarity matching across all sites; JEV custom-category questions.
* Dashboard: review, correct and delete every learned example and decision.

## Phase 4: Mobile (source)
* Android: Kotlin WebView app sharing the engine bundles. Build: `cd apps/android && ./gradlew assembleDebug` (needs Android SDK 34).
* iOS: SwiftUI + WKWebView app sharing the engine bundles. Build in Xcode 16 on macOS.
* Next: tab manager, bookmarks sync via the user's own encrypted export, GeckoView option on Android.

## Phase 5: Comprehensive coverage (partly done)
* done: child/teen/adult profiles, parent PIN, design-feature restrictions for under-16s, report helper, crisis interstitials, feed controls.
* planned: on-device image classifier (ONNX/CoreML) for blur decisions without network; site adapters for more platforms; licensed CSAM hash provider integration.

## Phase 6: Testing and release (partly done)
* done: unit tests; eval harness measuring recall on harmful samples and false positives on protected expression.
* planned: accessibility audit (WCAG 2.2 AA), external security review, reproducible builds, code signing and notarisation (Apple, Microsoft), auto-update channel.
* planned: migrate desktop shell from Electron to a patched Chromium build for faster security updates.

## Known limitations
* Electron's Chromium lags Chrome stable by weeks; a Chromium fork fixes this but needs build infrastructure.
* Text classification only by default; media is judged from captions, alt text and context.
* JEV is a hosted model: Local-only mode works offline but with lower coverage.
