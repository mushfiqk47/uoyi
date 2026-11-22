"use strict";

const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const crypto = require("node:crypto");
const path = require("node:path");

if (!process.env.CLIPWEAVE_API_TOKEN) {
  process.env.CLIPWEAVE_API_TOKEN = crypto.randomBytes(24).toString("hex");
}

const server = require("../server/index.cjs");
const auth = require("../server/lib/auth.cjs");
const paths = require("../server/lib/paths.cjs");

let mainWindow = null;
let httpServer = null;
let serverUrl = "";

function createWindow(targetUrl) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#18181b",
    title: "ClipWeave",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(targetUrl);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle("clipweave:get-bootstrap", () => ({
    token: auth.SESSION_TOKEN,
    mediaToken: auth.mediaToken(),
  }));

  ipcMain.handle("clipweave:get-version", () => app.getVersion());

  ipcMain.handle("clipweave:choose-directory", async () => {
    const res = await dialog.showOpenDialog(mainWindow || undefined, {
      title: "Select ClipWeave Workspace Folder",
      properties: ["openDirectory", "createDirectory"],
    });
    if (res.canceled || !res.filePaths?.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle("clipweave:reveal-in-folder", (_event, targetPath) => {
    if (typeof targetPath !== "string" || !targetPath.trim()) return false;
    const resolved = path.resolve(targetPath);
    const workspace = path.resolve(paths.getConfiguredWorkspaceDir());
    const dataRoot = path.resolve(paths.DATA_DIR);
    const allowed =
      resolved === workspace ||
      resolved.startsWith(workspace + path.sep) ||
      resolved === dataRoot ||
      resolved.startsWith(dataRoot + path.sep);
    if (!allowed) return false;
    shell.showItemInFolder(resolved);
    return true;
  });

  ipcMain.handle("clipweave:open-external", (_event, url) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });
}

async function boot() {
  process.env.CLIPWEAVE_DATA_DIR = process.env.CLIPWEAVE_DATA_DIR || app.getPath("userData");
  registerIpc();
  httpServer = server.start({ host: "127.0.0.1", port: 0 });
  await new Promise((resolve) => {
    if (httpServer.listening) return resolve();
    httpServer.once("listening", resolve);
  });
  const addr = httpServer.address();
  const port = typeof addr === "object" && addr ? addr.port : 3000;
  serverUrl = `http://127.0.0.1:${port}/`;
  createWindow(serverUrl);
}

app.whenReady().then(() => {
  void boot();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverUrl) {
      createWindow(serverUrl);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  if (httpServer) {
    try {
      httpServer.close();
    } catch {
      /* ignore shutdown race */
    }
    httpServer = null;
  }
});
