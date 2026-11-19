/** Bridges injected by the desktop preloads and the mobile admin shim. */
interface DdocChrome {
  send(cmd: string, arg?: unknown): void;
  onTabs(cb: (state: ChromeState) => void): void;
}

interface ChromeTab {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  canBack: boolean;
  canFwd: boolean;
}

interface ChromeState {
  tabs: ChromeTab[];
  active: number;
  isPrivate: boolean;
  profile: { name: string; kind: string };
  bookmarked: boolean;
  filtered: number;
}

interface DdocAdmin {
  call(method: string, params?: unknown): Promise<any>;
  chrome(cmd: string, arg?: unknown): void;
}

interface DdocAndroidBridge {
  postMessage(msg: string): void;
  onmessage: ((ev: { data: string }) => void) | null;
}

interface Window {
  ddocChrome?: DdocChrome;
  ddocAdmin?: DdocAdmin;
  webkit?: { messageHandlers?: { ddocAdmin?: { postMessage(msg: string): Promise<string> } } };
  DDocAdminAndroid?: DdocAndroidBridge;
}
