/**
 * @title Page bridge
 * @notice The object the page agent calls. It lives in the preload's isolated world, so site scripts cannot reach it.
 */
import { ipcRenderer } from 'electron';
// Lives in the preload's isolated world: page scripts cannot reach this object.
(window as any).ddocBridge = { call: (method: string, params: any) => ipcRenderer.invoke('ddoc:page', method, params) };
