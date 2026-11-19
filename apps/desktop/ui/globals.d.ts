/**
 * @title UI bridges
 * @notice Types for the objects injected by the desktop preloads and the mobile admin shim.
 */
/**
 * @notice Toolbar commands and tab updates.
 */
interface DdocChrome {
  send(cmd: string, arg?: unknown): void;
  onTabs(cb: (state: ChromeState) => void): void;
}

/**
 * @notice One tab as the toolbar sees it.
 */
interface ChromeTab {
  id: number;
  title: string;
  url: string;
  loading: boolean;
  canBack: boolean;
  canFwd: boolean;
}

/**
 * @notice The snapshot pushed to the toolbar whenever tabs or the profile change.
 */
interface ChromeState {
  tabs: ChromeTab[];
  active: number;
  isPrivate: boolean;
  profile: { name: string; kind: string };
  bookmarked: boolean;
  filtered: number;
}

/**
 * @notice Dashboard and new-tab calls into the trusted admin IPC channel.
 */
interface DdocAdmin {
  call(method: string, params?: unknown): Promise<any>;
  chrome(cmd: string, arg?: unknown): void;
}

/**
 * @notice Android's reply channel for dashboard calls.
 */
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
