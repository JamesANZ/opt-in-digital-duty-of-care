/**
 * @title Engine tests
 * @notice Checks rules, learning, profiles, encryption, JEV request shape, and the ads filter without a network call.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRequest, checkUrl, Classifier, defaultState, EncryptedStore, Engine, hashPin, JevClient, JevVerdict,
  makeProfile, MemoryBackend, parseResponse, randomKey, runRules, BUILTIN_CATEGORIES, verifyPin,
} from '../src';

/**
 * @title Scripted JEV
 * @notice A fake classifier that returns a scripted verdict, so pipeline tests need no network.
 */
class ScriptedJev implements Classifier {
  calls: string[] = [];
  constructor(private fn: (text: string) => Partial<JevVerdict>) {}
  async classify(text: string): Promise<JevVerdict> {
    this.calls.push(text);
    return { harm: 'none', harmProbabilities: {}, context: 'benign', contextProbabilities: {}, severity: 0, custom: {}, ...this.fn(text) };
  }
}

describe('local rules', () => {
  it('flags scams, grooming and threats', () => {
    expect(runRules('Pay with iTunes gift cards to release your parcel')[0].categoryId).toBe('scam_fraud');
    expect(runRules('this is our little secret ok, dont tell your mum')[0].categoryId).toBe('grooming');
    expect(runRules("I'm gonna stab you after school")[0].categoryId).toBe('threats');
    expect(runRules('Verify your account within 24 hours or it will be closed')[0].categoryId).toBe('scam_fraud');
  });
  it('does not flag ordinary text', () => {
    expect(runRules('The council approved the new bike lane on Tuesday.')).toHaveLength(0);
  });
  it('detects lookalike domains', () => {
    expect(checkUrl('https://mygov-login-secure.com/x').suspicious).toBe(true);
    expect(checkUrl('https://my.gov.au/').suspicious).toBe(false);
    expect(checkUrl('https://xn--pypal-4ve.com').suspicious).toBe(true);
  });
});

describe('personal learning', () => {
  it('generalises a tagged example to similar text on another site', async () => {
    const e = new Engine(defaultState());
    const cat = e.addCustomCategory('Crypto shilling', 'Posts pushing people to buy a coin');
    e.tag('This coin is going to 100x, get in before it moons!!', cat.id, 'harmful', 'Hype spam', 'x.com');
    const d = await e.classify({ text: 'get in before this coin moons, easy 100x', kind: 'comment', host: 'reddit.com' });
    expect(d.action).toBe('blur');
    expect(d.stage).toBe('learned');
    expect(d.reason).toContain('Hype spam');
  });
  it('negative examples suppress matches and overrides teach', async () => {
    const e = new Engine(defaultState());
    const cat = e.addCustomCategory('Spoilers', 'Plot spoilers for shows I watch');
    e.tag('the dragon dies at the end of season two', cat.id, 'harmful');
    const d = await e.classify({ text: 'the dragon dies at the end of season two', kind: 'comment' });
    expect(d.action).not.toBe('allow');
    e.override(d.id, 'not_harmful');
    const d2 = await e.classify({ text: 'the dragon dies at the end of season two', kind: 'comment' });
    expect(d2.action).toBe('allow');
  });
  it('can review and delete learned preferences', () => {
    const e = new Engine(defaultState());
    const ex = e.tag('you are so ugly lol', 'cyberbullying', 'harmful');
    expect(e.state.examples).toHaveLength(1);
    e.deleteExample(ex.id);
    expect(e.state.examples).toHaveLength(0);
  });
});

describe('JEV integration and expression safeguards', () => {
  it('builds the System One request with harm, context, severity and custom questions', () => {
    const req = buildRequest('hello', 'comment', BUILTIN_CATEGORIES.slice(0, 2), [{ id: 'c1', label: 'X', description: 'y' }], 'jev-latest');
    expect(req.questions.harm.type).toBe('choice');
    expect(req.questions.context.criteria.satire_parody).toBeDefined();
    expect(req.questions.severity.type).toBe('score');
    expect(req.questions.custom_c1.type).toBe('noul');
    const v = parseResponse({ answers: { harm: { choice: 'csea', probabilities: { csea: 0.9 } }, context: { choice: 'benign' }, severity: { score: 3 }, custom_c1: { noul: 0.8 } } }, [{ id: 'c1', label: 'X', description: 'y' }]);
    expect(v.custom.c1).toBe(0.8);
  });

  it('calls the real endpoint shape via injected fetch', async () => {
    let seen: any;
    const client = new JevClient({ apiKey: 'k', fetch: async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ answers: { harm: { choice: 'none' }, context: { choice: 'benign' }, severity: { score: 0 } } }), text: async () => '' };
    } });
    await client.classify('hi', 'post', BUILTIN_CATEGORIES, []);
    expect(seen.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(seen.init.headers.Authorization).toBe('Bearer k');
    expect(JSON.parse(seen.init.body).state.content.text).toBe('hi');
  });

  it('labels rather than hides journalism about extremism', async () => {
    const jev = new ScriptedJev(() => ({ harm: 'terrorism_extremism', harmProbabilities: { terrorism_extremism: 0.8 }, context: 'news_reporting', contextProbabilities: { news_reporting: 0.9 }, severity: 3 }));
    const e = new Engine(defaultState(), jev);
    const d = await e.classify({ text: 'Police say the attack was planned by an extremist cell, reporters confirmed.', kind: 'post' });
    expect(d.action).toBe('label');
    expect(d.reason).toContain('news reporting');
  });

  it('blurs direct harm for adults', async () => {
    const jev = new ScriptedJev(() => ({ harm: 'harassment', harmProbabilities: { harassment: 0.9 }, context: 'direct_harm', contextProbabilities: { direct_harm: 0.9 }, severity: 3 }));
    const e = new Engine(defaultState(), jev);
    const d = await e.classify({ text: 'Everyone go spam her inbox, she deserves to suffer, worthless', kind: 'comment' });
    expect(d.action).toBe('blur');
    expect(d.stage).toBe('jev');
  });

  it('hides advertisements by default when JEV says the block is an ad', async () => {
    const jev = new ScriptedJev(() => ({ ads: 0.92, context: 'benign', contextProbabilities: { benign: 0.9 }, severity: 0 }));
    const e = new Engine(defaultState(), jev);
    expect(e.setting('ads')).toMatchObject({ enabled: true, action: 'hide' });
    const d = await e.classify({ text: 'Sponsored: 40% off mattresses this weekend. Shop now with code SLEEP20.', kind: 'post' });
    expect(jev.calls).toHaveLength(1);
    expect(d.action).toBe('hide');
    expect(d.categoryId).toBe('ads');
    expect(d.stage).toBe('jev');
  });

  it('asks JEV only the ads question for ad-like text that is not otherwise risky', async () => {
    let body: any;
    const fetch = async (_url: string, init: { body: string }) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, json: async () => ({ answers: { ads: { noul: 0.91 } } }), text: async () => '' };
    };
    const e = new Engine(defaultState(), new JevClient({ apiKey: 'k', fetch }));
    const d = await e.classify({ text: 'Paid partnership. This pan changed how I cook. Shop now.', kind: 'post' });
    expect(body.questions.ads.type).toBe('noul');
    expect(body.questions.harm).toBeUndefined();
    expect(d.action).toBe('hide');
    expect(d.categoryId).toBe('ads');
  });

  it('turns the ads filter on for a profile saved before it existed', () => {
    const s = defaultState();
    delete s.profiles[0].categories.ads;
    const e = new Engine(s);
    expect(e.profile.categories.ads).toMatchObject({ enabled: true, action: 'hide' });
  });

  it('does not send benign text in risky_only mode (privacy)', async () => {
    const jev = new ScriptedJev(() => ({}));
    const e = new Engine(defaultState(), jev);
    await e.classify({ text: 'Lovely weather for a picnic by the harbour today.', kind: 'post' });
    expect(jev.calls).toHaveLength(0);
  });

  it('child profiles hide and apply under-16 design restrictions', async () => {
    const s = defaultState();
    s.profiles.push(makeProfile('kid', 'Kid', 'child'));
    s.settings.activeProfileId = 'kid';
    const jev = new ScriptedJev(() => ({ harm: 'dangerous_challenges', harmProbabilities: { dangerous_challenges: 0.7 }, context: 'direct_harm', contextProbabilities: { direct_harm: 0.8 }, severity: 2 }));
    const e = new Engine(s, jev);
    const d = await e.classify({ text: 'Try this challenge, hold your breath until you pass out', kind: 'caption' });
    expect(d.action).toBe('hide');
    expect(e.profile.design.stopInfiniteScroll).toBe(true);
    expect(e.profile.design.hideEngagementCounts).toBe(true);
    expect(e.profile.allowPrivateWindows).toBe(false);
  });

  it('self-harm gets a supportive interstitial with help lines', async () => {
    const e = new Engine(defaultState());
    const d = await e.classify({ text: 'honestly just kill yourself, nobody would miss you', kind: 'comment' });
    expect(d.action).toBe('interstitial');
    expect(d.resources?.some((r) => r.phone === '13 11 14')).toBe(true);
  });
});

describe('privacy and security', () => {
  it('encrypts state at rest', async () => {
    const backend = new MemoryBackend();
    const store = new EncryptedStore(backend, randomKey());
    await store.save({ secret: 'my tagged example' });
    expect(backend.data).not.toContain('my tagged example');
    expect(await store.load({ secret: '' })).toEqual({ secret: 'my tagged example' });
  });
  it('hashes and verifies the parent PIN', async () => {
    const s = defaultState().settings;
    const { hash, salt } = await hashPin('2468');
    s.parentPinHash = hash; s.parentPinSalt = salt;
    expect(await verifyPin('2468', s)).toBe(true);
    expect(await verifyPin('1111', s)).toBe(false);
  });
});
