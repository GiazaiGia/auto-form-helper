const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, shell, dialog } = require("electron");

let mainWindow;
let monitorWindow;
let serverHandle;
let updateCheckStarted = false;

function selectedTool() {
  const arg = process.argv.find((item) => item.startsWith("--tool="));
  return arg ? arg.split("=").slice(1).join("=") : "form";
}

function wantsMonitorPlatform(argv = process.argv) {
  return argv.includes("--monitor-platform");
}

function readJsonFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    console.error(`Failed to read ${filePath}:`, error.message);
    return null;
  }
}

function updateConfigPaths() {
  const resourceRoot = process.resourcesPath || path.join(__dirname, "..");
  return [
    path.join(resourceRoot, "config", "update.json"),
    path.join(__dirname, "..", "config", "update.json")
  ];
}

function updateFeedFromConfig() {
  const config = updateConfigPaths()
    .map((filePath) => readJsonFile(filePath))
    .find(Boolean) || {};

  if (config.enabled === false) {
    return null;
  }

  const provider = String(config.provider || "github").trim().toLowerCase();
  if (provider === "generic") {
    const url = String(config.url || "").trim();
    return url ? { provider: "generic", url } : null;
  }

  const owner = String(config.owner || config.githubOwner || "").trim();
  const repo = String(config.repo || config.githubRepo || "").trim();
  if (!owner || !repo) {
    return null;
  }

  return {
    provider: "github",
    owner,
    repo,
    private: Boolean(config.private)
  };
}

function activeWindow() {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    return monitorWindow;
  }
  return null;
}

function showAppDialog(options) {
  const parent = activeWindow();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function setupAutoUpdates() {
  if (updateCheckStarted || !app.isPackaged) {
    return;
  }

  const feed = updateFeedFromConfig();
  if (!feed) {
    return;
  }

  let autoUpdater;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (error) {
    console.error("Auto updater is unavailable:", error.message);
    return;
  }

  updateCheckStarted = true;
  let downloading = false;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.setFeedURL(feed);

  autoUpdater.on("update-available", async (info) => {
    if (downloading) {
      return;
    }
    const version = info && info.version ? ` ${info.version}` : "";
    const result = await showAppDialog({
      type: "info",
      buttons: ["现在下载", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "发现新版本",
      message: `发现新版本${version}`,
      detail: "下载完成后会提示重启软件并安装。"
    });
    if (result.response !== 0) {
      return;
    }
    downloading = true;
    autoUpdater.downloadUpdate().catch((error) => {
      downloading = false;
      console.error("Update download failed:", error.message);
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    const version = info && info.version ? ` ${info.version}` : "";
    const result = await showAppDialog({
      type: "info",
      buttons: ["重启安装", "稍后"],
      defaultId: 0,
      cancelId: 1,
      title: "新版已下载",
      message: `新版${version}已下载完成`,
      detail: "重启后会自动完成安装。"
    });
    if (result.response === 0) {
      autoUpdater.quitAndInstall(false, true);
    }
  });

  autoUpdater.on("error", (error) => {
    console.error("Update check failed:", error && error.message ? error.message : error);
  });

  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((error) => {
      console.error("Update check failed:", error.message);
    });
  }, 4000);
}

const bootTool = selectedTool();
const appDataRoot = process.env.APPDATA || path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Roaming");
const userDataName = bootTool === "form" ? "wechat-order-form-helper" : "jianying-batch-draft-tool";
app.setPath("userData", path.join(appDataRoot, userDataName));

const singleInstanceLock = app.requestSingleInstanceLock({ tool: bootTool });
if (!singleInstanceLock) {
  app.quit();
}

function focusMainWindow() {
  if (!mainWindow && monitorWindow && !monitorWindow.isDestroyed()) {
    if (monitorWindow.isMinimized()) {
      monitorWindow.restore();
    }
    monitorWindow.show();
    monitorWindow.focus();
    return;
  }
  if (!mainWindow) {
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

app.on("second-instance", (_event, commandLine) => {
  if (wantsMonitorPlatform(commandLine) && serverHandle) {
    createMonitorWindow(`http://127.0.0.1:${serverHandle.port}/monitor-platform.html`);
    return;
  }
  focusMainWindow();
});

function createWindow(url) {
  const tool = selectedTool();
  const isFormTool = tool === "form";
  const title = isFormTool ? "自动填表助手" : "剪映批量草稿工具";

  mainWindow = new BrowserWindow({
    width: isFormTool ? 1180 : 1240,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title,
    icon: path.join(__dirname, "..", "assets", "app-icon.ico"),
    backgroundColor: "#eef1f5",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadURL(isFormTool ? url : `${url}/jianying.html`);
  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      const target = new URL(targetUrl);
      const base = new URL(url);
      if (isFormTool && target.origin === base.origin && target.pathname === "/monitor-platform.html") {
        createMonitorWindow(targetUrl);
        return { action: "deny" };
      }
    } catch (error) {
      // Fall back to the system browser for non-app URLs.
    }
    shell.openExternal(targetUrl);
    return { action: "deny" };
  });
}

function createMonitorWindow(url) {
  if (monitorWindow && !monitorWindow.isDestroyed()) {
    if (monitorWindow.isMinimized()) {
      monitorWindow.restore();
    }
    monitorWindow.show();
    monitorWindow.focus();
    return;
  }
  monitorWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1100,
    minHeight: 720,
    title: "微信监控台",
    icon: path.join(__dirname, "..", "assets", "app-icon.ico"),
    backgroundColor: "#eef1f5",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  monitorWindow.loadURL(url);
  monitorWindow.on("closed", () => {
    monitorWindow = null;
  });
}

app.whenReady().then(async () => {
  if (!singleInstanceLock) {
    return;
  }
  const tool = selectedTool();
  process.env.FORM_HELPER_DATA_DIR = tool === "form"
    ? path.join(app.getPath("userData"), "data")
    : path.join(app.getPath("userData"), "data");
  const { startServer } = require("./app-server");
  serverHandle = await startServer(0);
  const baseUrl = `http://127.0.0.1:${serverHandle.port}`;
  if (tool === "form" && wantsMonitorPlatform()) {
    createMonitorWindow(`${baseUrl}/monitor-platform.html`);
  } else {
    createWindow(baseUrl);
  }
  setupAutoUpdates();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      if (tool === "form" && wantsMonitorPlatform()) {
        createMonitorWindow(`${baseUrl}/monitor-platform.html`);
      } else {
        createWindow(baseUrl);
      }
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (serverHandle && serverHandle.server) {
    serverHandle.server.close();
  }
});
