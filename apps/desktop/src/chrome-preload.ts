import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('ddocChrome', {
  send: (cmd: string, arg?: any) => ipcRenderer.send('ddoc:chrome', cmd, arg),
  onTabs: (cb: (s: any) => void) => ipcRenderer.on('ddoc:tabs', (_e, s) => cb(s)),
});
