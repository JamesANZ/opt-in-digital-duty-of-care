/**
 * @title Engine RPC
 * @notice The methods every shell forwards from a page or the dashboard.
 * @dev Electron, Android, and iOS all call `handle`. Page callers are limited to `PAGE_METHODS`.
 */
import { Engine } from './engine';
import { makeProfile, hashPin, verifyPin, ProfileKind, Settings } from './profiles';
import { checkUrl } from './rules';

/**
 * @notice One call into the engine.
 */
export interface RpcMessage { method: string; params?: any }

/**
 * @notice Methods an untrusted page may call. Everything else is dashboard-only.
 */
export const PAGE_METHODS = new Set(['classify', 'tag', 'override', 'pageConfig', 'checkUrl']);

/**
 * @notice Dashboard methods that change settings.
 * @dev A locked child or teen profile rejects these until the parent PIN session is unlocked.
 */
const GUARDED = new Set(['updateSetting', 'updateDesign', 'updateProfile', 'setSettings', 'addCustomCategory', 'removeCustomCategory', 'deleteExample', 'clearDecisions', 'addProfile', 'wipe']);

/**
 * @notice Dispatch one RPC call.
 * @param engine Engine for the active profile.
 * @param msg Method name and parameters.
 * @param opts `trusted` is true for the dashboard. `unlocked` is true during a parent PIN session.
 * @return The method result. Throws for an unknown method, a page calling a dashboard method, or a locked profile.
 */
export async function handle(engine: Engine, msg: RpcMessage, opts: { trusted: boolean; unlocked?: boolean }): Promise<any> {
  const p = msg.params ?? {};
  if (!opts.trusted && !PAGE_METHODS.has(msg.method)) throw new Error(`Method ${msg.method} not allowed from pages`);
  if (GUARDED.has(msg.method) && engine.profile.locked && !opts.unlocked) throw new Error('Parent PIN required to change a protected profile');
  switch (msg.method) {
    case 'classify': {
      const blocks = (p.blocks as any[]).slice(0, 50);
      return Promise.all(blocks.map((b) => engine.classify({ text: String(b.text ?? ''), kind: String(b.kind ?? 'other'), host: p.host })));
    }
    case 'tag':
      return engine.tag(String(p.text), String(p.categoryId), p.polarity === 'fine' ? 'fine' : 'harmful', p.note, p.host);
    case 'override':
      return engine.override(String(p.id), p.kind);
    case 'checkUrl':
      return checkUrl(String(p.url));
    case 'pageConfig': {
      const pr = engine.profile;
      return {
        profileKind: pr.kind,
        profileName: pr.name,
        design: pr.design,
        categories: engine.categories.filter((c) => pr.categories[c.id]?.enabled).map((c) => ({ id: c.id, label: c.label, custom: !!c.custom })),
        allCategories: engine.categories.map((c) => ({ id: c.id, label: c.label, custom: !!c.custom })),
        blocked: p.host ? engine.hostPolicy(p.host) : { blocked: false },
      };
    }

    // ---- dashboard (trusted) ----
    case 'state':
      return { ...engine.state, settings: { ...engine.state.settings, jevApiKey: engine.state.settings.jevApiKey ? '••••' + engine.state.settings.jevApiKey.slice(-4) : '' }, categories: engine.categories, report: engine.report(), jevActive: !!engine.classifier };
    case 'updateSetting':
      return engine.updateSetting(p.profileId, p.categoryId, p.patch);
    case 'updateDesign': {
      const pr = engine.state.profiles.find((x) => x.id === p.profileId);
      if (pr) Object.assign(pr.design, p.patch);
      engine.onChange?.(engine.state);
      return true;
    }
    case 'updateProfile': {
      const pr = engine.state.profiles.find((x) => x.id === p.profileId);
      if (pr) for (const k of ['blockedHosts', 'allowedHosts', 'name', 'ageBand', 'allowPrivateWindows'] as const) if (k in p.patch) (pr as any)[k] = p.patch[k];
      engine.onChange?.(engine.state);
      return true;
    }
    case 'setSettings': {
      const allowed: (keyof Settings)[] = ['jevMode', 'jevApiKey', 'jevBaseURL', 'jevModel', 'shareExamplesWithJev', 'imageChecks', 'searchEngine'];
      for (const k of allowed) if (k in p) (engine.state.settings as any)[k] = p[k];
      engine.onChange?.(engine.state);
      return true;
    }
    case 'addCustomCategory':
      return engine.addCustomCategory(String(p.label), String(p.description ?? ''));
    case 'removeCustomCategory':
      return engine.removeCustomCategory(String(p.id));
    case 'deleteExample':
      return engine.deleteExample(String(p.id));
    case 'tagExample':
      return engine.tag(String(p.text), String(p.categoryId), p.polarity, p.note);
    case 'clearDecisions':
      return engine.clearDecisions();
    case 'report':
      return engine.report();
    case 'addProfile': {
      const id = 'p' + Date.now().toString(36);
      engine.state.profiles.push(makeProfile(id, String(p.name), p.kind as ProfileKind, engine.categories));
      engine.onChange?.(engine.state);
      return id;
    }
    case 'setPin': {
      if (!(await verifyPin(String(p.oldPin ?? ''), engine.state.settings))) throw new Error('Incorrect PIN');
      const { hash, salt } = await hashPin(String(p.pin));
      engine.state.settings.parentPinHash = hash;
      engine.state.settings.parentPinSalt = salt;
      engine.onChange?.(engine.state);
      return true;
    }
    case 'switchProfile': {
      const current = engine.profile;
      const target = engine.state.profiles.find((x) => x.id === p.profileId);
      if (!target) throw new Error('No such profile');
      if (current.locked && !(await verifyPin(String(p.pin ?? ''), engine.state.settings))) throw new Error('Parent PIN required');
      engine.state.settings.activeProfileId = target.id;
      engine.onChange?.(engine.state);
      return true;
    }
    case 'verifyPin':
      return verifyPin(String(p.pin ?? ''), engine.state.settings);
    case 'wipe': {
      engine.state.examples = [];
      engine.learner.load([]);
      engine.state.decisions = [];
      engine.state.customCategories = [];
      engine.onChange?.(engine.state);
      return true;
    }
    default:
      throw new Error('Unknown method ' + msg.method);
  }
}
