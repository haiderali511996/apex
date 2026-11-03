// The sign-in window's only bridge to the app: these calls, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("unc", {
  defaults: () => ipcRenderer.invoke("defaults"),
  signIn: (details) => ipcRenderer.invoke("sign-in", details),
  open: (url) => ipcRenderer.invoke("open-external", url),
  tools: () => ipcRenderer.invoke("tools"),
});
