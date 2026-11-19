# Legislative Mapping: Online Safety Amendment (Digital Duty of Care) Bill 2026

Status of the law (checked 17 Nov 2026):

* Exposure draft published 8 Sep 2026; consultation closed 22 Sep 2026 [S1][S2].
* Bill introduced to the House of Representatives on 15 Oct 2026 and under deliberation [S5].
* A 12-month transition applies before the duty commences and the existing framework is repealed [S6].
* The Bill is addressed to *providers of online services* (social media, messaging, designated internet services, hosting, search, app stores, equipment providers, and AI tools that generate or share content) [S3]. A browser is a user-side tool, so most duties cannot be "complied with" by a browser. This product instead **implements the protective objectives on the user's side**, and the table below says honestly which ones only a platform can deliver.

> Caveat: this mapping is built from the government exposure draft listing and leading law-firm analyses of it. The introduced Bill may differ. Before release, re-run this mapping against the as-introduced text and Explanatory Memorandum on the Parliament of Australia Bills page.

Legend: **Full** = implemented in DDoC Browser. **Partial** = browser delivers a user-side equivalent but the legal duty stays with the platform. **Platform-only** = cannot be fulfilled by a browser.

## 1. Harm categories

### 1a. Seriously harmful material and conduct (all users)

The draft lists child sexual exploitation and abuse, grooming, sexual violence, extreme violence, harassment and self-harm, and the Minister can extend the list [S3]. Allens' summary also names promotion of terrorism, encouraging serious harm or suicide, and explicit threats of physical harm [S4].

| Bill category | Engine category id | Status | How |
|---|---|---|---|
| Child sexual exploitation and abuse material | `csea` | Partial | Text signals via JEV and local rules; page is blocked outright (no reveal) and the user is pointed to the eSafety reporting page. **No image hash matching**: CSAM hash lists (e.g. PhotoDNA) are only licensed to vetted organisations. A hook (`ImageHashProvider`) exists for a licensed provider. |
| Grooming | `grooming` | Partial | JEV questions on contact-seeking, secrecy, age probing and gift offers in chat/comments; strongest in child/teen profiles. Cannot see end-to-end encrypted app traffic outside the browser. |
| Sexual violence | `sexual_violence` | Full (text) | JEV + local learning. |
| Extreme violence / cruelty | `extreme_violence` | Full (text), Partial (media) | Text classified; media blurred when surrounding text/alt text or opt-in image check flags it. |
| Promotion of terrorism / violent extremism | `terrorism_extremism` | Full (text) | JEV with explicit exceptions for journalism, research, education and condemnation. |
| Encouraging serious harm or suicide; self-harm | `self_harm` | Full (text) | Content hidden behind a supportive interstitial with help resources (Lifeline 13 11 14, Kids Helpline 1800 55 1800). Recovery and help-seeking content is explicitly *not* filtered. |
| Explicit threats of physical harm | `threats` | Full (text) | JEV. |
| Harassment | `harassment` | Full (text) | JEV + user-taught examples. |
| Minister-extended categories | custom categories | Full | Category registry is data-driven; new categories ship as config without code changes. |

### 1b. Material harmful to children (under-18s)

Covers pornography, material promoting disordered eating, hostile attitudes toward women or gender equality, glorification of crime, dangerous stunts, and abuse, harassment or bullying [S4][S3].

| Bill category | Engine id | Status | How |
|---|---|---|---|
| Pornography | `pornography` | Partial | Text/URL/metadata signals; opt-in JEV image check (experimental in the JEV API). Child profiles: blocked. Adult profile: off by default. |
| Disordered eating | `eating_disorder` | Full (text) | As self-harm, with Butterfly Foundation resource (1800 33 4673). |
| Misogynistic / hostile to gender equality | `misogyny` | Full (text) | JEV with satire/critique carve-outs. |
| Glorification of crime | `crime_glorification` | Full (text) | JEV. |
| Dangerous stunts / challenges | `dangerous_challenges` | Full (text), Partial (video) | JEV on titles, captions, comments. |
| Abuse, harassment, bullying | `cyberbullying` | Full (text) | JEV + user-taught examples. |

### 1c. Other harms in the brief

| Harm | Engine id | Status | Note |
|---|---|---|---|
| Non-consensual intimate imagery / sexual deepfakes | `nci_deepfake` | Partial | Text signals plus a user/parent-subscribable list of "nudify" app domains (off by default; see Freedom of Expression below). The Bill adds powers over sexually explicit deepfake apps and sites [S3]; those powers act on providers. |
| Scams, fraud, malicious content | `scam_fraud` | Full | Not among the Bill's harm categories in the sources reviewed; included because the product brief requires it. Uses JEV plus lookalike-domain heuristics. Malware blocking relies on the engine's Safe Browsing equivalent. |

## 2. Duties on services

| Bill provision | Status | Browser implementation / reason |
|---|---|---|
| Digital duty of care: safe online environment "so far as reasonably practicable" [S3][S4] | Platform-only | Legal duty sits on the service. The browser is a user-side complement. |
| Written risk assessments, reviewed annually, kept 6 years, given to eSafety within 30 days [S3][S4] | Platform-only | The project keeps its own voluntary risk assessment in `docs/RISK_ASSESSMENT.md` as good practice. |
| Effective measures against identified risks [S3] | Platform-only | n/a |
| User empowerment tools, e.g. controls over recommended content [S3] | Partial | **Feed Controls**: hide recommendation rails/"For you" modules, stop infinite scroll after N items, hide engagement counts, redirect to "Following" views on supported sites. Works only on sites with recognisable DOM; cannot change server-side ranking. |
| "My Feed, My Way": choose algorithmic or following-only feed [S3] | Partial | Site adapters for major platforms switch to following/chronological views where the site offers one. |
| Under-16s kept from specified design features (recommenders, endless feeds, feedback features, time-limited content) [S3][S4] | Partial | **Child and Teen profiles** apply these by default: no infinite scroll, likes/view counts hidden, Stories/ephemeral content hidden, recommendation rails hidden, autoplay off. |
| Those features must not operate in a logged-out state [S4] | Partial | Child profile applies the same restrictions whether or not the user is signed in to the site. |
| Private-communications exclusion does not cover minors [S4] | Partial | Child/teen profiles run grooming and bullying checks on web messaging UIs **locally first**; parents see category counts, never message content. |
| Children's Online Privacy Code, best interests, strictly-necessary defaults [S4] | Full (for the browser itself) | Child profile collects no name, birthday or ID; only an age band chosen by a parent. All telemetry off. |
| Complaint and dispute processes [S3] | Partial | **Report Helper**: one click opens the site's own report flow (where known) and the eSafety complaint page, prefilled with the URL. In-browser **appeals** against our own decisions are Full. |
| Transparency reports on notice from eSafety [S3] | Partial | The browser produces a *local* transparency report (what was filtered, why, overrides) for the user. Nothing is uploaded. |
| Publication of safety information (moderation decisions, complaints) [S3] | Partial | Every decision shows category, confidence, which stage decided (local rule, learned example, JEV) and a plain-English reason. |
| Research data access for approved researchers [S3] | Partial | Optional, off-by-default export of aggregate, anonymised counts the user can review before sharing. |
| Australian-resident point of contact [S3] | Platform-only | n/a |
| Removal / link deletion notices, 24-hour compliance [S3] | Platform-only | n/a |
| Civil penalties, infringement notices, remedial directions [S3][S4] | Platform-only | n/a |
| No private right of action [S3] | n/a | n/a |
| Age-based access restrictions [S7][S4] | Partial | Parent-assigned profile age bands; no document or face-based age assurance (deliberately, to avoid collecting children's data). |

## 3. Brief requirements that go beyond the Bill

| Requirement | Status |
|---|---|
| Learn from highlighted/tagged examples, custom categories, explanations, positive/negative examples, sensitivity, corrections, review/delete | Full (desktop), Full in source (mobile) |
| Distinguish political expression, satire, journalism, education, ordinary disagreement | Full: every JEV call includes a `context` choice question; protected-expression contexts raise the threshold rather than auto-hiding |
| Personal filtering must not affect other users | Full: no shared lists, no upload of tags |
| No centralised censorship lists beyond legal requirements | Full: no lists enabled by default; list subscriptions are user-chosen |

## 4. What a browser fundamentally cannot do

1. Change what a platform stores, ranks or recommends server-side.
2. Remove content for anyone else, or make a platform remove it.
3. Inspect native apps (Instagram, TikTok, WhatsApp apps) or end-to-end-encrypted traffic outside the browser.
4. Perform CSAM hash matching without a licensed provider.
5. Verify age without collecting data (we choose not to).
6. Produce the provider-side records the Bill requires (risk assessments, transparency reports to eSafety, a local contact).

## Sources

* [S1] Australian Government, exposure draft page: https://www.infrastructure.gov.au/media-communications/internet/online-safety/online-safety-amendment-digital-duty-care-bill-2026-exposure-draft
* [S2] Clayton Utz, "Safe by design" (21 Sep 2026): https://www.claytonutz.com/insights/2026/september/safe-by-design-unpacking-australia-s-proposed-digital-duty-of-care-for-online-services
* [S3] Clayton Utz (same article), detailed duties, design features, complaints, transparency, penalties.
* [S4] Allens, "Australia's 'digital duty of care'" (Sep 2026): https://www.allens.com.au/insights-news/insights/2026/09/australias-digital-duty-of-care-what-the-draft-bill-means-for-online-services/
* [S5] Digital Policy Alert, Bill introduced 15 Oct 2026: https://digitalpolicyalert.org/event/44673-online-safety-amendment-digital-duty-of-care-bill-2026-including-user-rights-was-introduced-to-house-of-representatives
* [S6] Pinsent Masons Out-Law: https://www.pinsentmasons.com/out-law/news/digitial-duty-of-care-legislation
* Exposure draft PDF: https://www.infrastructure.gov.au/sites/default/files/documents/exposure-draft-online-safety-amendment-digital-duty-of-care-bill-2026-september2026.pdf
* [S7] Digital Policy Alert, age-based access restrictions provisions (15 Oct 2026): https://digitalpolicyalert.org/event/44672-online-safety-amendment-digital-duty-of-care-bill-2026-including-age-based-access-restrictions-was-introduced-to-national-assembly
* Help lines verified against Butterfly Foundation's own pages (Butterfly 1800 33 4673; Lifeline 13 11 14; Kids Helpline 1800 55 1800): https://butterfly.org.au/get-support/how-we-help/
