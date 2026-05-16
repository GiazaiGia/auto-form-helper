let activeJobId = "";
let pollTimer = null;

const templateDir = document.querySelector("#templateDir");
const taskFile = document.querySelector("#taskFile");
const outputDir = document.querySelector("#outputDir");
const materialRoot = document.querySelector("#materialRoot");
const materialColumn = document.querySelector("#materialColumn");
const namePattern = document.querySelector("#namePattern");
const replaceMaterials = document.querySelector("#replaceMaterials");
const jyStatus = document.querySelector("#jyStatus");
const jySaveStatus = document.querySelector("#jySaveStatus");
const previewCount = document.querySelector("#previewCount");
const rowCount = document.querySelector("#rowCount");
const jsonCount = document.querySelector("#jsonCount");
const placeholderCount = document.querySelector("#placeholderCount");
const mediaSlotCount = document.querySelector("#mediaSlotCount");
const columnsList = document.querySelector("#columnsList");
const placeholderList = document.querySelector("#placeholderList");
const firstRowBox = document.querySelector("#firstRowBox");
const logBox = document.querySelector("#logBox");
const jobState = document.querySelector("#jobState");

const fields = [
  templateDir,
  taskFile,
  outputDir,
  materialRoot,
  materialColumn,
  namePattern,
  replaceMaterials
];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "操作失败");
  }
  return data;
}

function setStatus(text, kind = "idle") {
  jyStatus.textContent = text;
  const colors = {
    idle: ["#e8f5ef", "#18794e", "#b9e4ce"],
    busy: ["#fff7ed", "#b45309", "#fed7aa"],
    error: ["#fff1f0", "#b42318", "#fecaca"]
  }[kind] || ["#eef2f7", "#17202a", "#cbd5e1"];
  jyStatus.style.background = colors[0];
  jyStatus.style.color = colors[1];
  jyStatus.style.borderColor = colors[2];
}

function setLog(text) {
  logBox.textContent = text || "就绪";
  logBox.scrollTop = logBox.scrollHeight;
}

function settings() {
  return {
    templateDir: templateDir.value.trim(),
    taskFile: taskFile.value.trim(),
    outputDir: outputDir.value.trim(),
    materialRoot: materialRoot.value.trim(),
    materialColumn: materialColumn.value.trim(),
    namePattern: namePattern.value.trim() || "{{序号}}_{{标题}}",
    replaceMaterials: replaceMaterials.checked,
    allowedTypes: ["video", "image"]
  };
}

function saveSettings() {
  localStorage.setItem("jianyingBatchSettings", JSON.stringify(settings()));
  jySaveStatus.textContent = "已保存";
  window.clearTimeout(saveSettings.timer);
  saveSettings.timer = window.setTimeout(() => {
    jySaveStatus.textContent = "本机配置";
  }, 1200);
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("jianyingBatchSettings") || "{}");
    templateDir.value = saved.templateDir || "";
    taskFile.value = saved.taskFile || "";
    outputDir.value = saved.outputDir || "";
    materialRoot.value = saved.materialRoot || "";
    materialColumn.value = saved.materialColumn || "";
    namePattern.value = saved.namePattern || "{{序号}}_{{标题}}";
    replaceMaterials.checked = saved.replaceMaterials !== false;
  } catch (error) {
    setLog(error.message);
  }
}

function requireBasicPaths() {
  const current = settings();
  if (!current.templateDir) {
    throw new Error("先选择剪映模板草稿文件夹");
  }
  if (!current.taskFile) {
    throw new Error("先选择任务单");
  }
  return current;
}

function renderTags(container, items, emptyText) {
  container.innerHTML = "";
  if (!items || !items.length) {
    const empty = document.createElement("span");
    empty.className = "empty-inline";
    empty.textContent = emptyText;
    container.appendChild(empty);
    return;
  }

  items.forEach((item) => {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = item;
    container.appendChild(tag);
  });
}

function renderFirstRow(row) {
  firstRowBox.innerHTML = "";
  const entries = Object.entries(row || {}).slice(0, 12);
  if (!entries.length) {
    firstRowBox.innerHTML = '<div class="empty">暂无</div>';
    return;
  }

  entries.forEach(([key, value]) => {
    const line = document.createElement("div");
    const name = document.createElement("span");
    const text = document.createElement("strong");
    name.textContent = key;
    text.textContent = value || "";
    line.appendChild(name);
    line.appendChild(text);
    firstRowBox.appendChild(line);
  });
}

async function pickPath(target, type, title, filter) {
  const result = await api("/api/pick-path", {
    method: "POST",
    body: JSON.stringify({ type, title, filter })
  });
  if (result.path) {
    target.value = result.path;
    saveSettings();
  }
}

async function preview() {
  const current = requireBasicPaths();
  setStatus("读取中", "busy");
  setLog("正在读取任务单和模板...");
  const result = await api("/api/jianying/preview", {
    method: "POST",
    body: JSON.stringify(current)
  });

  rowCount.textContent = String(result.rowCount || 0);
  jsonCount.textContent = String(result.template && result.template.jsonFileCount || 0);
  placeholderCount.textContent = String(result.template && result.template.placeholders.length || 0);
  mediaSlotCount.textContent = String(result.template && result.template.mediaSlotCount || 0);
  previewCount.textContent = `${result.rowCount || 0} 条任务`;
  renderTags(columnsList, result.columns || [], "任务单没有字段");
  renderTags(placeholderList, result.template && result.template.placeholders || [], "模板里暂未发现占位文字");
  renderFirstRow(result.firstRow);
  setStatus("预览完成", "idle");
  setLog("预览完成，可以开始生成草稿。");
}

async function generate() {
  const current = requireBasicPaths();
  if (!current.outputDir) {
    throw new Error("先选择输出文件夹");
  }

  saveSettings();
  setStatus("生成中", "busy");
  setLog("正在启动批量生成...");
  const result = await api("/api/jianying/generate", {
    method: "POST",
    body: JSON.stringify(current)
  });
  watchJob(result.jobId);
}

function watchJob(jobId) {
  activeJobId = jobId;
  if (pollTimer) {
    window.clearInterval(pollTimer);
  }

  async function poll() {
    const job = await api(`/api/jobs/${encodeURIComponent(activeJobId)}`);
    jobState.textContent = job.status === "running" ? "运行中" : job.status === "done" ? "已完成" : "失败";
    setLog(job.logs);
    if (job.status === "done") {
      setStatus("生成完成", "idle");
    }
    if (job.status === "failed") {
      setStatus("生成失败", "error");
    }
    if (job.status !== "running") {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  poll().catch((error) => {
    setStatus("读取失败", "error");
    setLog(error.message);
  });
  pollTimer = window.setInterval(() => poll().catch((error) => setLog(error.message)), 1200);
}

async function openOutput() {
  const current = settings();
  if (!current.outputDir) {
    throw new Error("先选择输出文件夹");
  }
  await api("/api/open-path", {
    method: "POST",
    body: JSON.stringify({ path: current.outputDir })
  });
}

async function useJianyingDir() {
  const result = await api("/api/jianying/paths");
  if (!result.preferred || !result.preferred.draftDir) {
    throw new Error("没有自动找到剪映草稿库，请手动选择输出文件夹");
  }
  outputDir.value = result.preferred.draftDir;
  saveSettings();
  setStatus("已接入剪映草稿库", "idle");
  setLog(`输出文件夹已设置为：${result.preferred.draftDir}\n生成后回到剪映首页刷新，就能看到新草稿。`);
}

document.querySelector("#pickTemplateBtn").addEventListener("click", () => {
  pickPath(templateDir, "folder", "选择剪映模板草稿文件夹").catch((error) => alert(error.message));
});
document.querySelector("#pickTaskBtn").addEventListener("click", () => {
  pickPath(taskFile, "file", "选择任务单", "任务单|*.xlsx;*.xls;*.csv;*.tsv;*.json|所有文件|*.*").catch((error) => alert(error.message));
});
document.querySelector("#pickOutputBtn").addEventListener("click", () => {
  pickPath(outputDir, "folder", "选择输出文件夹").catch((error) => alert(error.message));
});
document.querySelector("#useJianyingDirBtn").addEventListener("click", () => {
  useJianyingDir().catch((error) => alert(error.message));
});
document.querySelector("#pickMaterialBtn").addEventListener("click", () => {
  pickPath(materialRoot, "folder", "选择素材总文件夹").catch((error) => alert(error.message));
});
document.querySelector("#previewBtn").addEventListener("click", () => preview().catch((error) => {
  setStatus("预览失败", "error");
  setLog(error.message);
  alert(error.message);
}));
document.querySelector("#generateBtn").addEventListener("click", () => generate().catch((error) => {
  setStatus("启动失败", "error");
  setLog(error.message);
  alert(error.message);
}));
document.querySelector("#openOutputBtn").addEventListener("click", () => openOutput().catch((error) => alert(error.message)));
document.querySelector("#refreshJobBtn").addEventListener("click", () => {
  if (activeJobId) {
    watchJob(activeJobId);
  }
});
fields.forEach((field) => field.addEventListener("change", saveSettings));
fields.forEach((field) => field.addEventListener("input", saveSettings));

loadSettings();
setStatus("待开始", "idle");
