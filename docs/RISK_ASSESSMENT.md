# Voluntary Risk Assessment (v0.1)

Modelled on the Bill's risk-assessment requirements (identify foreseeable risks, likelihood and severity, mitigations and expected effectiveness, review cadence). The Bill imposes this on online service providers; we adopt it voluntarily.

| Risk | Likelihood | Severity | Mitigation | Expected effectiveness | Review |
|---|---|---|---|---|---|
| Over-filtering of journalism, satire, political speech | Medium | High (expression) | Context question on every JEV call; protected contexts are labelled not hidden; one-click reveal; overrides become negative examples; eval set tracks false-positive rate | High | Each release |
| Under-filtering of self-harm content for vulnerable users | Medium | Severe | High-precision local crisis rules run even in Local-only mode; interstitial with help lines | Medium | Each release |
| Privacy leak via JEV calls | Low | High | Text-only, no URL or identity; Local-only mode; counter in dashboard | High | Quarterly |
| Child bypasses profile | Medium | Medium | Parent PIN (PBKDF2, 210k iterations); profile switch requires PIN; private windows disabled for child profiles | Medium | Quarterly |
| Parental surveillance overreach | Medium | Medium | Parents see counts only, never content | High | Annually |
| Engine lags Chrome security patches | High (Electron) | High | Track Electron stable; migrate to Chromium fork (Phase 6) | Medium | Monthly |
| Grooming in E2EE native apps | High | Severe | Out of scope for a browser; documented in mapping | n/a | n/a |

Next review: before first public release, then at least annually, and before any change that could add risk.
