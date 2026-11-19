# Privacy and Freedom of Expression

## Data that never leaves the device
* Browsing history, bookmarks, downloads.
* URLs of pages being classified.
* Learned examples, custom categories, decisions log.
* Child profile settings and activity.

## Data that can leave the device (and how to stop it)
* Text of a content block the local stage could not settle, sent to the JEV API (or your configured gateway) for classification. No URL, title, cookies or account identity is attached. Toggle **Local only** in Settings to stop this entirely. The dashboard shows a running count of snippets sent.
* Optional image classification (off by default).

## Storage
* Desktop: all engine state is encrypted with AES-256-GCM. The key is protected by the OS keychain via Electron `safeStorage` (Keychain on macOS, DPAPI on Windows, libsecret on Linux).
* Android: EncryptedSharedPreferences / Android Keystore.
* iOS: Keychain + Data Protection.
* Private windows keep everything in memory and discard it on close.

## Freedom of expression
* No block lists are enabled by default. Users may subscribe to lists they choose.
* A user's tags and filters only change what *that user* sees. Nothing is shared.
* Protected-expression contexts (journalism, education, satire, political expression, ordinary disagreement, recovery and support) are detected explicitly and raise the bar for filtering. When filtered at all they are labelled, not hidden.
* Every decision is explained and reversible in one click.

## Children
* No names, birthdays, photos or ID documents collected. A parent picks an age band.
* Parents see category counts and settings, not content or browsing history.

## Known exposure
* Filtered blocks carry DDoC classes and labels in the page DOM, so a site's own scripts could detect that DDoC is in use and which of its blocks were filtered. They cannot read your examples, settings or the engine itself (desktop: isolated preload world; iOS: separate `WKContentWorld`; Android: native origin checks).
* Android WebView has no isolated script worlds, so a hostile page could imitate the agent and send "teach" messages. Mitigation: the native layer attaches the real page origin to every message, and taught examples are listed with their site in the dashboard for review. A Chromium/GeckoView fork removes this gap (Phase 6).
