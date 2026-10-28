const { contextBridge, ipcRenderer } = require('electron');

// Each operation is named explicitly; renderer cannot choose IPC channels or paths.
const subscribe = (channel, callback) => {
  const listener = (_, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const modelAction = (name, id) => ipcRenderer.invoke(`companion:${name}`, ...(id === undefined ? [] : [id]));
contextBridge.exposeInMainWorld('companion', Object.freeze({
  state: () => ipcRenderer.invoke('companion:state'),
  download: (id) => modelAction('download', id),
  choose: (id) => modelAction('choose', id),
  load: (id) => modelAction('load', id),
  loadSpeech: (id) => modelAction('loadSpeech', id),
  loadEmbedding: (id) => modelAction('loadEmbedding', id),
  unloadEmbedding: () => ipcRenderer.invoke('companion:unloadEmbedding'),
  testVision: () => ipcRenderer.invoke('companion:testVision'),
  assignImage: (id) => modelAction('assignImage', id),
  testImage: () => ipcRenderer.invoke('companion:testImage'),
  unload: () => ipcRenderer.invoke('companion:unload'),
  generate: (prompt) => ipcRenderer.invoke('companion:generate', prompt),
  install: (id) => modelAction('install', id),
  cancelDownload: () => ipcRenderer.invoke('companion:cancelDownload'),
  remove: () => ipcRenderer.invoke('companion:remove'),
  assign: (id) => ipcRenderer.invoke('companion:assign', id),
  assignCoding: (id) => ipcRenderer.invoke('companion:assignCoding', id),
  catalog: (id) => modelAction('catalog', id),
  pair: () => ipcRenderer.invoke('companion:pair'),
  disableService: () => ipcRenderer.invoke('companion:disableService'),
  approve: (ticket, allowed) => ipcRenderer.invoke('companion:approve', ticket, allowed),
  revoke: (id) => ipcRenderer.invoke('companion:revoke', id),
  cancelJob: (device, id) => ipcRenderer.invoke('companion:cancelJob', device, id),
  onState: (callback) => subscribe('companion:state', callback),
  onToken: (callback) => subscribe('companion:token', callback),
}));
