"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("clipweaveDesktop", {
  isDesktop: true,
  platform: process.platform,
  getVersion: () => ipcRenderer.invoke("clipweave:get-version"),
  getBootstrapToken: () => ipcRenderer.invoke("clipweave:get-bootstrap"),
  chooseWorkspaceDirectory: () => ipcRenderer.invoke("clipweave:choose-directory"),
  revealFileInFolder: (filePath) => ipcRenderer.invoke("clipweave:reveal-in-folder", filePath),
  openExternalUrl: (url) => ipcRenderer.invoke("clipweave:open-external", url),
});
