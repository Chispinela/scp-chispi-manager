const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('chispi', {
  call: (method, payload) => ipcRenderer.invoke('manager', method, payload),
  report: entry => ipcRenderer.send('diagnostic', entry),
  onCreateStage: callback => ipcRenderer.on('manager-create-stage', (_, stage) => callback(stage)),
  onChanged: callback => ipcRenderer.on('manager-changed', () => callback()),
  onLog: callback => ipcRenderer.on('manager-log', (_, entry) => callback(entry)),
  onBusy: callback => ipcRenderer.on('manager-busy', () => callback()),
  onStopFailed: callback => ipcRenderer.on('manager-stop-failed', () => callback())
});
