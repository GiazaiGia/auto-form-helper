const { spawn, execFile } = require("child_process");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const fillScript = path.join(__dirname, "fill-qq-form.js");
const nodeExe = process.execPath;
const extraFillArgs = process.argv.slice(2);

let lastText = "";
let busy = false;

function getClipboardText() {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-Command", "Get-Clipboard -Raw"],
      { windowsHide: true, timeout: 5000 },
      (error, stdout) => {
        if (error) {
          resolve("");
          return;
        }
        resolve(String(stdout || "").trim());
      }
    );
  });
}

function extractFormUrl(text) {
  const match = String(text || "").match(/https?:\/\/docs\.qq\.com\/form\/page\/[^\s"'<>，。)）]+/i);
  return match ? match[0] : "";
}

async function tick() {
  if (busy) {
    return;
  }

  const text = await getClipboardText();
  if (!text || text === lastText) {
    return;
  }
  lastText = text;

  const url = extractFormUrl(text);
  if (!url) {
    return;
  }

  busy = true;
  console.log(`发现腾讯表单链接：${url}`);
  console.log("正在启动自动填写窗口...");

  const child = spawn(nodeExe, [fillScript, url, ...extraFillArgs], {
    cwd: rootDir,
    stdio: "inherit",
    env: process.env
  });

  child.on("exit", () => {
    busy = false;
    console.log("可以继续复制下一个表单链接。");
  });
}

console.log("正在监听剪贴板。你从微信复制腾讯表单链接后，我会自动打开并填写。");
console.log("关闭这个窗口即可停止监听。");
setInterval(() => {
  tick().catch(() => {});
}, 2000);
