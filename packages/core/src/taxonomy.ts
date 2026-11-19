/**
 * Harm taxonomy mapped to the Online Safety Amendment (Digital Duty of Care) Bill 2026.
 * See docs/LEGISLATIVE_MAPPING.md for sources. Categories are data, so a Minister-extended
 * category can ship as configuration without code changes.
 */

export type HarmGroup = 'seriously_harmful' | 'harmful_to_children' | 'other';

export interface HelpResource {
  name: string;
  phone?: string;
  url: string;
}

export interface HarmCategory {
  id: string;
  label: string;
  group: HarmGroup;
  /** Plain-language definition sent to JEV as the choice description. */
  description: string;
  /** Where the category comes from, shown in explanations. */
  billRef: string;
  /** Never offer "reveal" (e.g. CSEA). */
  noReveal?: boolean;
  /** Show a supportive interstitial instead of a plain blur. */
  supportive?: boolean;
  resources?: HelpResource[];
  /** User-created category. */
  custom?: boolean;
}

const LIFELINE: HelpResource = { name: 'Lifeline', phone: '13 11 14', url: 'https://www.lifeline.org.au' };
const KIDS: HelpResource = { name: 'Kids Helpline', phone: '1800 55 1800', url: 'https://kidshelpline.com.au' };
const BUTTERFLY: HelpResource = { name: 'Butterfly Foundation', phone: '1800 33 4673', url: 'https://butterfly.org.au' };
const ESAFETY: HelpResource = { name: 'eSafety Commissioner: report', url: 'https://www.esafety.gov.au/report' };
const SCAMWATCH: HelpResource = { name: 'Scamwatch', url: 'https://www.scamwatch.gov.au/report-a-scam' };

export const BUILTIN_CATEGORIES: HarmCategory[] = [
  // Seriously harmful material and conduct (all users)
  { id: 'csea', label: 'Child sexual exploitation', group: 'seriously_harmful', noReveal: true,
    description: 'Sexualised material involving minors, or content facilitating child sexual abuse.',
    billRef: 'Seriously harmful material: child sexual exploitation and abuse', resources: [ESAFETY] },
  { id: 'grooming', label: 'Grooming risk', group: 'seriously_harmful',
    description: 'An adult seeking private contact with a child, asking a child to keep secrets, probing a child\'s age or location, offering gifts, or moving a child to private channels.',
    billRef: 'Seriously harmful conduct: grooming', resources: [ESAFETY, KIDS] },
  { id: 'sexual_violence', label: 'Sexual violence', group: 'seriously_harmful',
    description: 'Content depicting, endorsing or threatening sexual violence.',
    billRef: 'Seriously harmful material: sexual violence', resources: [{ name: '1800RESPECT', phone: '1800 737 732', url: 'https://www.1800respect.org.au' }] },
  { id: 'extreme_violence', label: 'Extreme violence or cruelty', group: 'seriously_harmful',
    description: 'Gratuitous depiction or celebration of extreme violence, gore, torture or cruelty.',
    billRef: 'Seriously harmful material: extreme violence or cruelty' },
  { id: 'terrorism_extremism', label: 'Terrorism and violent extremism', group: 'seriously_harmful',
    description: 'Promotion, recruitment, glorification or instruction for terrorism or violent extremism. Reporting on or condemning it is not this.',
    billRef: 'Seriously harmful material: promotion of terrorism', resources: [ESAFETY] },
  { id: 'self_harm', label: 'Self-harm or suicide promotion', group: 'seriously_harmful', supportive: true,
    description: 'Content encouraging, instructing or glorifying suicide or self-harm. Help-seeking, recovery and support content is not this.',
    billRef: 'Seriously harmful material: encouraging serious harm or suicide', resources: [LIFELINE, KIDS] },
  { id: 'threats', label: 'Threats of violence', group: 'seriously_harmful',
    description: 'Explicit threats of physical harm against a person or group.',
    billRef: 'Seriously harmful conduct: explicit threats of physical harm', resources: [ESAFETY] },
  { id: 'harassment', label: 'Harassment and abuse', group: 'seriously_harmful',
    description: 'Targeted, repeated or severe abuse, intimidation or humiliation of a specific person.',
    billRef: 'Seriously harmful conduct: harassment', resources: [ESAFETY] },

  // Harmful to children (applied to under-18 profiles; adults may opt in)
  { id: 'pornography', label: 'Pornography', group: 'harmful_to_children',
    description: 'Sexually explicit material.', billRef: 'Material harmful to children: pornography' },
  { id: 'eating_disorder', label: 'Disordered eating promotion', group: 'harmful_to_children', supportive: true,
    description: 'Content promoting extreme restriction, purging, "thinspiration" or disordered eating. Recovery support is not this.',
    billRef: 'Material harmful to children: disordered eating', resources: [BUTTERFLY] },
  { id: 'misogyny', label: 'Hostility toward women', group: 'harmful_to_children',
    description: 'Content promoting hatred of women or hostility toward gender equality. Critique or discussion of such content is not this.',
    billRef: 'Material harmful to children: hostile attitudes toward women or gender equality' },
  { id: 'crime_glorification', label: 'Glorification of crime', group: 'harmful_to_children',
    description: 'Content glorifying or encouraging criminal acts.', billRef: 'Material harmful to children: glorification of crime' },
  { id: 'dangerous_challenges', label: 'Dangerous challenges and stunts', group: 'harmful_to_children',
    description: 'Content encouraging dangerous stunts or viral challenges likely to cause injury.',
    billRef: 'Material harmful to children: dangerous stunts' },
  { id: 'cyberbullying', label: 'Cyberbullying', group: 'harmful_to_children',
    description: 'Insults, mockery, exclusion or abuse directed at a person, especially a young person.',
    billRef: 'Material harmful to children: abuse, harassment or bullying', resources: [ESAFETY, KIDS] },

  // Other harms in the product brief
  { id: 'nci_deepfake', label: 'Intimate image abuse / sexual deepfakes', group: 'other',
    description: 'Sharing, requesting or generating intimate images of a person without consent, including "nudify" or sexual deepfake tools.',
    billRef: 'Bill powers over sexually explicit deepfake apps and sites; image-based abuse scheme', resources: [ESAFETY] },
  { id: 'scam_fraud', label: 'Scams and fraud', group: 'other',
    description: 'Scams, phishing, fake investment or giveaway schemes, impersonation, or requests for credentials or payment under false pretences.',
    billRef: 'Product brief (scams are outside the Bill\'s listed categories)', resources: [SCAMWATCH] },
  { id: 'ads', label: 'Ads', group: 'other',
    description: 'The text is itself an advertisement, sponsored post, or paid promotion. Editorial or personal text that only mentions a product is not an ad.',
    billRef: 'Default filter, decided by JEV' },
];

/** Contexts that represent protected expression. These raise the threshold instead of hiding. */
export const CONTEXTS: Record<string, string> = {
  direct_harm: 'The text itself carries out, promotes or encourages the harm.',
  news_reporting: 'Journalism or factual reporting about events, including harmful ones.',
  education_research: 'Educational, academic, medical or safety information.',
  satire_parody: 'Satire, parody, comedy or obvious fiction.',
  political_expression: 'Political opinion, advocacy or criticism of public figures or policy.',
  ordinary_disagreement: 'Ordinary disagreement or robust debate without targeted abuse.',
  support_recovery: 'Help-seeking, peer support, recovery or prevention.',
  benign: 'Everyday content unrelated to any harm.',
};

export const PROTECTED_CONTEXTS = new Set([
  'news_reporting', 'education_research', 'satire_parody', 'political_expression',
  'ordinary_disagreement', 'support_recovery',
]);

export const SEVERITY_LEVELS = [
  'None: harmless.',
  'Mild: rude, crude or edgy but not harmful.',
  'Moderate: likely to upset or harm some readers.',
  'Serious: clearly harmful, targeted or dangerous.',
  'Severe: illegal or life-threatening content.',
];

export function categoryById(cats: HarmCategory[], id: string): HarmCategory | undefined {
  return cats.find((c) => c.id === id);
}
