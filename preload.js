const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  loadDB: () => ipcRenderer.invoke('db:load'),
  saveDB: (data) => ipcRenderer.invoke('db:save', data),
  exportFile: (name, data) => ipcRenderer.invoke('export:file', { name, data }),
  exportFileAs: (name, data, filters) => ipcRenderer.invoke('export:saveAs', { name, data, filters }),
  appInfo: () => ipcRenderer.invoke('app:info'),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  backupDB: () => ipcRenderer.invoke('db:backup')
});
