/**
 * @title Page preload
 * @notice Gives internal ddoc:// pages the dashboard bridge, and web pages the filtering agent.
 * @dev The main process checks the sender URL again on every dashboard call.
 */
import { contextBridge, ipcRenderer } from 'electron';

if (location.protocol === 'ddoc:') {
  // Internal pages (dashboard, new tab). Main process re-checks the sender URL on every call.
  contextBridge.exposeInMainWorld('ddocAdmin', {
    call: (method: string, params?: any) => ipcRenderer.invoke('ddoc:admin', method, params),
    chrome: (cmd: string, arg?: any) => ipcRenderer.send('ddoc:chrome', cmd, arg),
  });
} else {
  require('./bridge-electron');
  require('../../../packages/page-agent/src/agent');
  ipcRenderer.on('ddoc:teach', (_e, text: string) => {
    const t = text || document.getSelection()?.toString() || '';
    if (t) (window as any).__ddocOpenTeach?.(t);
  });
}
