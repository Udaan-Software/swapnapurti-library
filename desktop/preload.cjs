const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("desktopAPI", {
  getAutoLaunch: () => ipcRenderer.invoke("auto-launch:get"),
  setAutoLaunch: (value) => ipcRenderer.invoke("auto-launch:set", Boolean(value)),
  platform: process.platform
});
