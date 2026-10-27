const { contextBridge, ipcRenderer } = require('electron');

// Each operation is named explicitly; renderer cannot choose IPC channels or paths.
const subscribe = (channel, callback) => {
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('companion', Object.freeze({
  state: () => ipcRenderer.invoke('companion:state'),
  download: () => ipcRenderer.invoke('companion:download'),
  choose: () => ipcRenderer.invoke('companion:choose'),
  load: () => ipcRenderer.invoke('companion:load'),
  unload: () => ipcRenderer.invoke('companion:unload'),
  generate: (prompt) => ipcRenderer.invoke('companion:generate', prompt),
  onState: (callback) => subscribe('companion:state', callback),
  onToken: (callback) => subscribe('companion:token', callback),
}));
