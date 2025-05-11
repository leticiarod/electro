const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  checkInstallDeps: () => ipcRenderer.invoke('check-install-deps'),
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectAgentFolder: () => ipcRenderer.invoke('select-agent-folder'),
  writeEnv: (folderPath) => ipcRenderer.invoke('write-env', folderPath),
  runAgent: () => ipcRenderer.invoke('run-agent'),
  readPairingCode: () => ipcRenderer.invoke('read-pairing-code'),
  copyToClipboard: () => ipcRenderer.invoke('copy-to-clipboard'),
  getPairingCodePath: () => ipcRenderer.invoke('get-pairing-code-path'),
  fileExists: (filePath) => ipcRenderer.invoke('file-exists', filePath),
  receiveDepStatus: (cb) => ipcRenderer.on('dep-status', cb),
}); 