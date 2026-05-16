let appState = null;
let monitorState = null;
let availableWindows = [];
let selectedAccount = "";
let lockBusy = false;
let proofRefreshBusy = false;
let proofRefreshIndex = 0;
let settingsDirty = false;
const expandedDetailHwnds = new Set();
const liveReadPollMs = 1000;
let eventPageSize = Number(localStorage.getItem("monitor-platform:event-page-size") || 10);
if (![10, 20].includes(eventPageSize)) {
  eventPageSize = 10;
}
let eventPage = 1;
let eventFollowLatest = true;
const selectedQueueLinks = new Set();
const selectedQueueUrlByKey = new Map();

const proofImages = {};
const proofImageTimes = {};

const summaryText = document.querySelector("#summaryText");
const accountTabs = document.querySelector("#accountTabs");
const selectedAccountName = document.querySelector("#selectedAccountName");
const lockZone = document.querySelector("#lockZone");
const lockHint = document.querySelector("#lockHint");
const lockAccountName = document.querySelector("#lockAccountName");
const lockOverlay = document.querySelector("#lockOverlay");
const lockCount = document.querySelector("#lockCount");
const lockTitle = document.querySelector("#lockTitle");
const lockMessage = document.querySelector("#lockMessage");
const scanWindowsBtn = document.querySelector("#scanWindowsBtn");
const recoverWindowsBtn = document.querySelector("#recoverWindowsBtn");
const pauseBtn = document.querySelector("#pauseBtn");
const autoFillToggle = document.querySelector("#autoFillToggle");
const settingsPanel = document.querySelector("#settingsPanel");
const scanPresetSelect = document.querySelector("#scanPresetSelect");
const readModeSelect = document.querySelector("#readModeSelect");
const saveSettingsBtn = document.querySelector("#saveSettingsBtn");
const settingsHint = document.querySelector("#settingsHint");
const lockBadge = document.querySelector("#lockBadge");
const gridList = document.querySelector("#gridList");
const availableBlock = document.querySelector("#availableBlock");
const availableList = document.querySelector("#availableList");
const eventList = document.querySelector("#eventList");
const syncQueueBtn = document.querySelector("#syncQueueBtn");
const syncQueueStatus = document.querySelector("#syncQueueStatus");
const clearEventsBtn = document.querySelector("#clearEventsBtn");
const clearSelectedEventsBtn = document.querySelector("#clearSelectedEventsBtn");
const eventPager = document.querySelector("#eventPager");
const eventPrevBtn = document.querySelector("#eventPrevBtn");
const eventNextBtn = document.querySelector("#eventNextBtn");
const eventPageInfo = document.querySelector("#eventPageInfo");
const eventPageSizeSelect = document.querySelector("#eventPageSizeSelect");

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

function accounts() {
  return appState && appState.accounts && appState.accounts.accounts || [];
}

function currentConfig() {
  return monitorState && monitorState.config || {
    enabled: false,
    detectWechatWindow: true,
    detectClipboard: true,
    readMode: "ocr",
    syncQueue: false,
    syncQueueStartedAt: "",
    intervalMs: 15000,
    scanBatchSize: 1,
    targetCycleSeconds: 15,
    fillAccounts: [],
    autoFillStartedAt: "",
    sources: [],
    windowBindings: []
  };
}

function activeBindings() {
  return (currentConfig().windowBindings || []).filter((binding) => binding.enabled !== false);
}

function sourceMap() {
  return new Map((currentConfig().sources || []).map((source) => [source.id, source]));
}

function accountForBinding(binding, sourcesById = sourceMap()) {
  const source = sourcesById.get(binding.sourceId) || null;
  return source && source.account || binding.account || "";
}

function bindingsForSelectedAccount() {
  return activeBindings();
}

function bindingCountsByAccount() {
  const counts = new Map();
  const sourcesById = sourceMap();
  for (const binding of activeBindings()) {
    const account = accountForBinding(binding, sourcesById);
    counts.set(account, Number(counts.get(account) || 0) + 1);
  }
  return counts;
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

const scanPresets = {
  stable: {
    label: "稳定",
    intervalMs: 30000,
    targetCycleSeconds: 30,
    scanBatchSize: 1,
    note: "稳定：实际每 30 秒触发一次，优先降低占用。"
  },
  balanced: {
    label: "均衡",
    intervalMs: 15000,
    targetCycleSeconds: 15,
    scanBatchSize: 1,
    note: "均衡：实际每 15 秒触发一次，适合日常监控。"
  },
  fast: {
    label: "快速",
    intervalMs: 5000,
    targetCycleSeconds: 5,
    scanBatchSize: 2,
    note: "快速：实际每 5 秒触发一次，并行检查更多窗口。"
  }
};

const readModes = {
  ocr: {
    label: "Paddle OCR",
    note: "识别微信窗口画面，优先使用 PaddleOCR。"
  },
  local: {
    label: "微信本地",
    note: "读取本地消息库；如果数据库加密或密钥未获取，会显示原因。"
  }
};

function readModeFromConfig(config = currentConfig()) {
  return readModes[config.readMode] ? config.readMode : "ocr";
}

function readModeLabel(value = readModeFromConfig()) {
  return (readModes[value] || readModes.ocr).label;
}

function readSourceLabel(stat) {
  const source = String(stat && stat.lastReadSource || "").trim();
  if (source && source !== "等待") {
    return source;
  }
  return readModeLabel(stat && stat.lastReadMode || readModeFromConfig());
}

function settingsHintText(scanPresetValue, scanPlan = {}, readModeValue = readModeFromConfig()) {
  const mode = readModes[readModeValue] || readModes.ocr;
  const durationMs = Number(monitorState && monitorState.lastScanDurationMs || 0);
  const durationText = durationMs >= 1000
    ? ` 上轮实际读取耗时约 ${Math.max(1, Math.round(durationMs / 1000))} 秒。`
    : "";
  return `${scanPresetText(scanPresetValue, scanPlan)}${durationText} 读取方式：${mode.note}`;
}

function scanPresetFromConfig(config = currentConfig()) {
  const intervalMs = Number(config.intervalMs || 15000);
  const targetCycleSeconds = Number(config.targetCycleSeconds || 15);
  if (intervalMs <= 10000 || targetCycleSeconds <= 10) {
    return "fast";
  }
  if (intervalMs >= 25000 || targetCycleSeconds >= 25) {
    return "stable";
  }
  return "balanced";
}

function estimatePresetScanPlan(value, windowCount = activeBindings().length) {
  const preset = scanPresets[value] || scanPresets.balanced;
  const total = Math.max(0, Number(windowCount) || 0);
  const configuredBatchSize = Math.max(1, Number(preset.scanBatchSize) || 1);
  const batchSize = total ? Math.min(total, configuredBatchSize) : configuredBatchSize;
  const tickCount = total ? Math.ceil(total / batchSize) : 1;
  return {
    total,
    batchSize,
    intervalMs: preset.intervalMs,
    targetCycleSeconds: preset.targetCycleSeconds,
    estimatedCycleSeconds: Number(((tickCount * preset.intervalMs) / 1000).toFixed(1))
  };
}

function presetScanDelayMs() {
  const presetValue = scanPresetFromConfig();
  const plan = estimatePresetScanPlan(presetValue);
  return Math.max(5000, Number(plan.estimatedCycleSeconds || 0) * 1000);
}

function scanPresetText(value, scanPlan = {}) {
  const preset = scanPresets[value] || scanPresets.balanced;
  const plan = estimatePresetScanPlan(value);
  const estimated = Math.max(1, Math.round(Number(plan.estimatedCycleSeconds || 0)));
  const batchText = plan.batchSize > 1 ? `，每轮检查 ${plan.batchSize} 个窗口` : "";
  const estimateText = plan.total
    ? `当前 ${plan.total} 个窗口：预计每个窗口约 ${estimated} 秒检查一轮${batchText}`
    : `添加窗口后生效；单窗口约 ${estimated} 秒检查一轮`;
  return `${preset.note} ${estimateText}。`;
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function shortLink(url) {
  const text = String(url || "");
  const id = (text.match(/\/form\/page\/([^/?#]+)/i) || [])[1] || text;
  return id.length > 18 ? `${id.slice(0, 8)}...${id.slice(-6)}` : id;
}

function shortSizeLink(url) {
  const text = String(url || "");
  const id = (text.match(/\/form\/page\/([^/?#]+)/i) || [])[1] || text;
  return id.length > 16 ? `${id.slice(0, 7)}...${id.slice(-5)}` : id;
}

function canonicalUrl(value) {
  const text = String(value || "")
    .trim()
    .replace(/[：﹕]/g, ":")
    .replace(/[／\\|]/g, "/")
    .replace(/[．。]/g, ".")
    .replace(/[‘’“”]/g, "")
    .replace(/\s+/g, "")
    .replace(/aocs\.qq\.com/gi, "docs.qq.com")
    .replace(/d0cs\.qq\.com/gi, "docs.qq.com")
    .replace(/d〇cs\.qq\.com/gi, "docs.qq.com")
    .replace(/docs\.qg\.com/gi, "docs.qq.com")
    .replace(/(?:torm|fom|from|forrn)\/page/gi, "form/page")
    .replace(/[，。,.、;；:：!！?？)\]）】}」》]+$/g, "");
  const match = text.match(/(?:https?:\/\/)?docs\.qq\.com\/form\/page\/([A-Za-z0-9_-]+)/i);
  return match ? `https://docs.qq.com/form/page/${match[1]}` : text;
}

function linkKey(url) {
  return canonicalUrl(url).toLowerCase();
}

function timeValue(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function eventLinkList(event) {
  const urls = Array.isArray(event && event.urls) ? event.urls : [];
  return urls;
}

function eventTrackForUrl(event, url) {
  const normalized = canonicalUrl(url);
  const trackByUrl = event && event.trackByUrl && typeof event.trackByUrl === "object" && !Array.isArray(event.trackByUrl)
    ? event.trackByUrl
    : {};
  const direct = trackByUrl[normalized] || trackByUrl[linkKey(url)] || null;
  if (direct) {
    return {
      expectedTrack: direct.expectedTrack || "",
      trackScore: Number(direct.trackScore || 0),
      trackStatus: direct.expectedTrack ? "confirmed" : direct.trackStatus || "",
      trackMessage: direct.trackMessage || ""
    };
  }
  const eventUrls = eventLinkList(event).map(canonicalUrl).filter(Boolean);
  if (eventUrls.length <= 1) {
    return {
      expectedTrack: event && event.expectedTrack || "",
      trackScore: Number(event && event.trackScore || 0),
      trackStatus: event && event.expectedTrack ? "confirmed" : event && event.trackStatus || "",
      trackMessage: event && event.trackMessage || ""
    };
  }
  return {
    expectedTrack: "",
    trackScore: 0,
    trackStatus: "",
    trackMessage: ""
  };
}

function trackStatusRank(status) {
  if (status === "confirmed") {
    return 3;
  }
  if (status === "checking") {
    return 2;
  }
  if (status === "unknown") {
    return 1;
  }
  return 0;
}

function monitorRecordTrackMap() {
  const map = new Map();
  const put = (item = {}) => {
    const key = linkKey(item.url);
    if (!key) {
      return;
    }
    const existing = map.get(key) || {};
    const nextStatus = item.expectedTrack ? "confirmed" : item.trackStatus || "";
    const keepExistingStatus = trackStatusRank(existing.trackStatus) >= trackStatusRank(nextStatus);
    map.set(key, {
      expectedTrack: existing.expectedTrack || item.expectedTrack || "",
      trackScore: Math.max(Number(existing.trackScore || 0), Number(item.trackScore || 0)),
      trackStatus: keepExistingStatus ? existing.trackStatus || "" : nextStatus,
      trackMessage: existing.trackMessage || item.trackMessage || ""
    });
  };

  for (const item of Array.isArray(monitorState && monitorState.monitorRecords) ? monitorState.monitorRecords : []) {
    put(item);
  }
  for (const event of Array.isArray(monitorState && monitorState.recentEvents) ? monitorState.recentEvents : []) {
    for (const url of eventLinkList(event)) {
      const track = eventTrackForUrl(event, url);
      put({
        url,
        expectedTrack: track.expectedTrack || "",
        trackScore: track.trackScore || 0,
        trackStatus: track.trackStatus || "",
        trackMessage: track.trackMessage || ""
      });
    }
  }
  return map;
}

function scopesForVisibleBindings() {
  const sourcesById = sourceMap();
  return bindingsForSelectedAccount().map((binding) => {
    const source = sourcesById.get(binding.sourceId) || null;
    return {
      account: "",
      names: new Set([source && source.name, binding.title].filter(Boolean)),
      startAt: timeValue(binding.startAfterSetAt || binding.boundAt),
      ignoredUrls: new Set((binding.ignoredUrls || []).map(linkKey).filter(Boolean))
    };
  });
}

function eventMatchesVisibleScope(event, url) {
  const scopes = scopesForVisibleBindings();
  if (!scopes.length) {
    return true;
  }
  const key = linkKey(url);
  const eventAt = timeValue(event.createdAt || event.lastSeenAt);
  return scopes.some((scope) => {
    const accountMatches = true;
    const sourceName = event.sourceName || event.title || "";
    const sourceMatches = !scope.names.size || scope.names.has(sourceName);
    const afterStart = !scope.startAt || eventAt >= scope.startAt;
    const notIgnored = !scope.ignoredUrls.has(key);
    return accountMatches && sourceMatches && afterStart && notIgnored;
  });
}

function titleForWindow(item, index = 0) {
  const title = String(item && item.title || "").trim();
  if (isReadableLabel(title) && title !== "微信") {
    return title;
  }
  return `微信窗口 ${index + 1}`;
}

function isReadableLabel(value) {
  const text = String(value || "").trim();
  return Boolean(text) && !/^[?\uFFFD\s]+$/.test(text);
}

function displayLabel(value, fallback) {
  const text = String(value || "").trim();
  return isReadableLabel(text) ? text : fallback;
}

function statFor(binding) {
  return monitorState && monitorState.bindingStats && monitorState.bindingStats[String(binding.hwnd || "")] || null;
}

function statusText(stat, running) {
  if (stat && stat.lastError) {
    return "需要重新确认";
  }
  if (running && stat && stat.lastScanAt) {
    return "正在监控";
  }
  if (running) {
    return "等待第一次心跳";
  }
  return "已锁定";
}

function statusClass(stat, running) {
  if (stat && stat.lastError) {
    return "bad";
  }
  if (running && stat && stat.lastScanAt) {
    return "ok";
  }
  return "warn";
}

function processText(stat) {
  const readTarget = readModeFromConfig() === "local" ? "微信本地" : "当前画面";
  if (stat && stat.lastReadMode === "local" && stat.lastScanAt && Number(stat.lastTextLength || 0) <= 0) {
    return `微信本地未读到消息：${stat.lastLocalMessage || "本地消息库暂不可读。"}`;
  }
  if (stat && stat.lastNewLinkCount > 0) {
    return currentConfig().autoFill === true
      ? `新增 ${stat.lastNewLinkCount} 条链接，已联动填表。`
      : `新增 ${stat.lastNewLinkCount} 条链接，已记录。`;
  }
  if (stat && stat.lastUrlCount > 0) {
    return `${readTarget} ${stat.lastUrlCount} 条有效链接，重复链接已自动去掉。`;
  }
  if (stat && stat.lastScanAt) {
    return `实时读取中，${readTarget}没有新链接。`;
  }
  return "等待识别。";
}

function compactPreviewText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function createReadPreview(stat) {
  if (!stat || !stat.lastScanAt) {
    return null;
  }
  const box = document.createElement("div");
  const previewText = compactPreviewText(stat.lastPreview);
  box.className = `read-preview${previewText ? "" : " empty"}`;
  const head = document.createElement("div");
  head.className = "read-preview-head";
  const title = document.createElement("strong");
  title.textContent = stat.lastReadMode === "local" ? "微信本地读取结果" : "本轮实际读到";
  const meta = document.createElement("span");
  const lengthParts = [`${Number(stat.lastTextLength || 0)} 字`];
  if (stat.lastReadMode === "local") {
    if (stat.lastLocalStatus) {
      lengthParts.push(stat.lastLocalStatus);
    }
  } else if (stat.lastReadMode === "ocr") {
    lengthParts.push(`OCR ${Number(stat.lastOcrTextLength || 0)} 字`);
  }
  meta.textContent = [readSourceLabel(stat), ...lengthParts].filter(Boolean).join(" · ");
  head.append(title, meta);
  const body = document.createElement("div");
  body.className = "read-preview-body";
  body.textContent = previewText || (stat.lastReadMode === "local" ? (stat.lastLocalMessage || "微信本地暂未返回消息正文。") : "空");
  box.append(head, body);
  return box;
}

function createChip(text, ok) {
  const item = document.createElement("span");
  item.className = ok ? "ok" : "wait";
  item.textContent = text;
  return item;
}

function createMetric(text) {
  const item = document.createElement("span");
  item.textContent = text;
  return item;
}

function createStatusItem(label, value, tone = "") {
  const item = document.createElement("div");
  item.className = `status-item${tone ? ` ${tone}` : ""}`;
  const labelNode = document.createElement("span");
  labelNode.textContent = label;
  const valueNode = document.createElement("strong");
  valueNode.textContent = value;
  item.append(labelNode, valueNode);
  return item;
}

function rememberSelectedAccount(name) {
  if (name) {
    localStorage.setItem("monitor-platform:selected-account", name);
  }
}

function accountExists(name) {
  return accounts().some((account) => account.name === name);
}

function ensureSelectedAccount() {
  selectedAccount = "";
}

function setSelectedAccount(name) {
  renderAccountTabs();
  updateAccountLabels();
  renderSummary();
  renderSlots();
  renderAvailable();
  renderEvents();
}

function renderAccountTabs() {
  accountTabs.innerHTML = "";
  const item = document.createElement("span");
  item.className = "account-tab active static-tab";
  item.textContent = `已接入 ${activeBindings().length} 个窗口`;
  accountTabs.appendChild(item);
}

function updateAccountLabels() {
  selectedAccountName.textContent = "全部监控窗口";
  if (lockAccountName) {
    lockAccountName.textContent = "监控台";
  }
}

function renderPauseButton() {
  const hasBindings = activeBindings().length > 0;
  pauseBtn.disabled = !hasBindings;
  pauseBtn.textContent = monitorState && monitorState.running ? "暂停监控" : "恢复监控";
  const autoFill = currentConfig().autoFill === true;
  if (autoFillToggle) {
    autoFillToggle.textContent = autoFill ? "联动填表" : "只记录";
    autoFillToggle.classList.toggle("primary", autoFill);
  }
  lockBadge.textContent = autoFill ? "新链接自动填表" : "新链接先记录";
}

function renderSettings() {
  const config = currentConfig();
  const scanPlan = monitorState && monitorState.scanPlan || {};
  const activeElement = document.activeElement;
  const editingSettings = settingsPanel && !settingsPanel.hidden && settingsPanel.contains(activeElement);

  if (settingsDirty && editingSettings) {
    updateSettingsPreview();
    return;
  }

  if (!settingsDirty || !editingSettings) {
    scanPresetSelect.value = scanPresetFromConfig(config);
    if (readModeSelect) {
      readModeSelect.value = readModeFromConfig(config);
    }
  }

  settingsHint.textContent = settingsHintText(
    scanPresetSelect.value,
    scanPlan,
    readModeSelect ? readModeSelect.value : readModeFromConfig(config)
  );
}

function renderSummary() {
  const allBindings = activeBindings();
  const bindings = bindingsForSelectedAccount();
  const runningText = monitorState && monitorState.running ? "正在监控" : "已暂停";
  const modeText = readModeLabel(readModeFromConfig());
  const speedText = (scanPresets[scanPresetFromConfig()] || scanPresets.balanced).label;
  const lastTick = formatTime(monitorState && monitorState.lastTickAt);
  const parts = [
    `${bindings.length}窗口`,
    modeText,
    speedText,
    monitorState && monitorState.running ? "实时识别中" : runningText,
    lastTick ? `最新心跳 ${lastTick}` : ""
  ].filter(Boolean);
  summaryText.textContent = parts.join(" · ");
  renderPauseButton();
  renderSettings();
}

function renderSlots() {
  const config = currentConfig();
  const sources = config.sources || [];
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const bindings = bindingsForSelectedAccount();
  gridList.innerHTML = "";

  if (!bindings.length) {
    gridList.innerHTML = '<div class="empty">暂无监控窗口，点击上方添加微信独立聊天窗口。</div>';
    return;
  }

  const groups = new Map();
  for (const binding of bindings) {
    const source = sourcesById.get(binding.sourceId) || null;
    const account = "监控窗口";
    if (!groups.has(account)) {
      groups.set(account, []);
    }
    groups.get(account).push({ binding, source });
  }

  for (const [accountName, entries] of groups.entries()) {
    const lane = document.createElement("section");
    lane.className = "lane";

    const head = document.createElement("div");
    head.className = "lane-head";
    const title = document.createElement("strong");
    title.textContent = accountName;
    const count = document.createElement("span");
    count.textContent = `${entries.length} 个窗口`;
    head.append(title, count);

    const grid = document.createElement("div");
    grid.className = "slot-grid";

    entries.forEach(({ binding, source }, index) => {
      const stat = statFor(binding);
      const running = Boolean(monitorState && monitorState.running);
      const hwnd = String(binding.hwnd || "");
      const lastLinks = Array.isArray(stat && stat.lastLinks) ? stat.lastLinks : [];
      const newLinks = Array.isArray(stat && stat.lastNewLinks) ? stat.lastNewLinks : [];
      const slot = document.createElement("article");
      slot.className = "slot";

      const range = document.createElement("div");
      range.className = `slot-range ${statusClass(stat, running)}`;
      const rangeName = document.createElement("strong");
      rangeName.textContent = statusText(stat, running);
      const slotNo = document.createElement("span");
      slotNo.textContent = `窗口 ${index + 1}`;
      range.append(rangeName, slotNo);

      const titleText = document.createElement("div");
      titleText.className = "slot-title";
      titleText.textContent = displayLabel(binding.title, displayLabel(source && source.name, `微信窗口 ${index + 1}`));

      const meta = document.createElement("div");
      meta.className = "slot-meta";
      meta.textContent = [
        stat && stat.lastScanAt ? `最近扫描 ${formatTime(stat.lastScanAt)}` : "等待扫描",
        stat && stat.lastNewAt ? `最近新增 ${formatTime(stat.lastNewAt)}` : "",
        binding.startAfterUrl ? `起点 ${shortLink(binding.startAfterUrl)}` : ""
      ].filter(Boolean).join(" · ");

      const statusGrid = document.createElement("div");
      statusGrid.className = "status-grid";
      const heartbeatOk = Boolean(stat && stat.lastScanAt && !stat.lastError);
      statusGrid.append(
        createStatusItem("窗口", heartbeatOk ? "正常" : "等待", stat && stat.lastError ? "bad" : heartbeatOk ? "ok" : ""),
        createStatusItem("有效链接", `${Number(stat && stat.lastUrlCount || 0)} 条`, stat && stat.lastUrlCount > 0 ? "ok" : ""),
        createStatusItem("方式", readSourceLabel(stat), ""),
        createStatusItem("屏幕", binding.virtualScreen ? "虚拟屏" : "当前屏", binding.virtualScreen ? "ok" : "")
      );

      const process = document.createElement("div");
      process.className = `process-line${stat && stat.lastError ? " bad" : ""}`;
      process.textContent = stat && stat.lastError ? stat.lastError : processText(stat);
      const actions = document.createElement("div");
      actions.className = "slot-actions main-actions";
      actions.innerHTML = `
        <button data-read="${hwnd}">识别链接</button>
        <button class="primary" data-dock="${hwnd}">${binding.virtualScreen ? "重放到虚拟屏" : "放到虚拟屏"}</button>
        ${binding.virtualScreen ? `<button data-restore="${hwnd}">移回主屏</button>` : ""}
        <button data-focus="${hwnd}">定位窗口</button>
        <button class="danger" data-remove="${hwnd}">移出</button>
      `;
      const readPreview = createReadPreview(stat);

      const image = proofImages[hwnd];
      const imageWrap = document.createElement("div");
      imageWrap.className = image ? "proof-image live-proof" : "proof-placeholder live-proof";
      if (image) {
        const proofHead = document.createElement("div");
        proofHead.className = "proof-head";
        const proofTitle = document.createElement("strong");
        proofTitle.textContent = "识别画面";
        const proofTime = document.createElement("span");
        proofTime.textContent = proofImageTimes[hwnd] ? formatTime(proofImageTimes[hwnd]) : "";
        proofHead.append(proofTitle, proofTime);
        const img = document.createElement("img");
        img.src = image;
        img.alt = "本次识别的微信窗口画面";
        imageWrap.append(proofHead, img);
      } else {
        imageWrap.textContent = "等待识别画面";
      }

      const newLinkBox = document.createElement("div");
      newLinkBox.className = "link-list new-links";
      if (newLinks.length) {
        const linkTitle = document.createElement("div");
        linkTitle.className = "link-list-title";
        linkTitle.textContent = `本轮新增 ${newLinks.length} 条`;
        newLinkBox.appendChild(linkTitle);
        for (const [linkIndex, link] of newLinks.entries()) {
          const row = document.createElement("div");
          row.className = "link-item";
          const label = document.createElement("span");
          label.textContent = `${linkIndex + 1}. ${shortLink(link)}`;
          const anchor = document.createElement("a");
          anchor.href = link;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.textContent = "打开";
          const actions = document.createElement("div");
          actions.className = "link-actions";
          actions.append(anchor);
          row.append(label, actions);
          newLinkBox.appendChild(row);
        }
      }

      let detailLinks = null;
      if (lastLinks.length) {
        detailLinks = document.createElement("div");
        detailLinks.className = "link-list";
        const linkTitle = document.createElement("div");
        linkTitle.className = "link-list-title";
        linkTitle.textContent = `当前画面 ${lastLinks.length} 条有效链接`;
        detailLinks.appendChild(linkTitle);
        for (const [linkIndex, link] of lastLinks.entries()) {
          const row = document.createElement("div");
          row.className = "link-item";
          const label = document.createElement("span");
          label.textContent = `${linkIndex + 1}. ${shortLink(link)}`;
          const anchor = document.createElement("a");
          anchor.href = link;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          anchor.textContent = "打开";
          const rowActions = document.createElement("div");
          rowActions.className = "link-actions";
          rowActions.append(anchor);
          row.append(label, rowActions);
          detailLinks.appendChild(row);
        }
      }

      slot.append(range, titleText, meta, statusGrid, process, actions);
      if (readPreview) {
        slot.appendChild(readPreview);
      }
      slot.appendChild(imageWrap);
      if (newLinks.length) {
        slot.appendChild(newLinkBox);
      }
      if (detailLinks) {
        slot.appendChild(detailLinks);
      }
      grid.appendChild(slot);
    });

    lane.append(head, grid);
    gridList.appendChild(lane);
  }
}

function renderAvailable() {
  const bindings = activeBindings();
  const sourcesById = sourceMap();
  availableList.innerHTML = "";
  if (availableBlock) {
    availableBlock.classList.toggle("quiet-block", !availableWindows.length);
  }

  if (!availableWindows.length) {
    availableList.innerHTML = '<div class="empty compact-empty">暂无新的可添加窗口</div>';
    return;
  }

  availableWindows.forEach((item, index) => {
    const boundBinding = bindings.find((binding) => String(binding.hwnd) === String(item.hwnd));
    const card = document.createElement("div");
    card.className = "available-card";
    const title = document.createElement("strong");
    title.textContent = titleForWindow(item, index);
    const meta = document.createElement("span");
    const screenText = item.screenPrimary === false ? "虚拟屏" : "主屏";
    meta.textContent = `${item.process || "微信"} · ${screenText} · ${boundBinding ? "已接入监控" : "可接入监控"}`;
    const button = document.createElement("button");
    button.className = "primary";
    button.textContent = boundBinding
      ? "重新读取"
      : item.screenPrimary === false ? "移回主屏并加入" : "加入监控";
    button.dataset.addHwnd = item.hwnd;
    card.append(title, meta, button);
    availableList.appendChild(card);
  });
}

function renderSyncQueueControls() {
  const enabled = currentConfig().syncQueue === true;
  if (syncQueueStatus) {
    syncQueueStatus.textContent = enabled ? "同步开启" : "同步未开启";
    syncQueueStatus.className = enabled ? "sync-status on" : "sync-status";
  }
  if (syncQueueBtn) {
    syncQueueBtn.textContent = enabled ? "暂停同步" : "开始同步";
    syncQueueBtn.classList.toggle("primary", enabled);
  }
}

function renderEvents() {
  renderSyncQueueControls();
  const rowsByKey = new Map();
  const trackByLink = monitorRecordTrackMap();
  let insertOrder = 0;
  const putRow = (row) => {
    const url = canonicalUrl(row.url);
    const key = linkKey(url);
    if (!key) {
      return;
    }
    const trackInfo = trackByLink.get(key) || {};
    const expectedTrack = row.expectedTrack || trackInfo.expectedTrack || "";
    const trackStatus = expectedTrack
      ? "confirmed"
      : row.trackStatus || trackInfo.trackStatus || "";
    const trackMessage = row.trackMessage || trackInfo.trackMessage || "";
    const mergedRow = {
      ...row,
      expectedTrack,
      trackStatus,
      trackMessage
    };
    const rowKey = key;
    const existing = rowsByKey.get(rowKey);
    if (existing) {
      existing.seenCount += Number(row.seenCount || 1);
      existing.latestAt = Math.max(Number(existing.latestAt || 0), Number(row.latestAt || 0));
      existing.valid = existing.valid || row.valid;
      if (!existing.expectedTrack && mergedRow.expectedTrack) {
        existing.expectedTrack = mergedRow.expectedTrack;
      }
      if (trackStatusRank(mergedRow.trackStatus) > trackStatusRank(existing.trackStatus)) {
        existing.trackStatus = mergedRow.trackStatus;
      }
      if (!existing.trackMessage && mergedRow.trackMessage) {
        existing.trackMessage = mergedRow.trackMessage;
      }
      if (!existing.eventId && row.eventId) {
        existing.eventId = row.eventId;
      }
      return;
    }
    rowsByKey.set(rowKey, {
      ...mergedRow,
      url,
      firstSeenAt: Number(row.firstSeenAt || row.latestAt || Date.now()),
      order: Number(row.order === undefined ? insertOrder : row.order),
      seenCount: Number(row.seenCount || 1)
    });
    insertOrder += 1;
  };
  const events = Array.isArray(monitorState && monitorState.recentEvents)
    ? monitorState.recentEvents
    : [];
  for (const event of events) {
    const validLinks = Array.isArray(event.urls) && event.urls.length;
    for (const [linkIndex, rawLink] of eventLinkList(event).entries()) {
      const url = canonicalUrl(rawLink);
      const key = linkKey(url);
      if (!key || !eventMatchesVisibleScope(event, url)) {
        continue;
      }
      const track = eventTrackForUrl(event, url);
      const sourceName = displayLabel(event.sourceName, displayLabel(event.title, "微信窗口"));
      const latestAt = timeValue(event.createdAt) || timeValue(event.lastSeenAt);
      putRow({
        eventId: event.id || "",
        account: event.account || "",
        sourceName,
        url,
        expectedTrack: track.expectedTrack || "",
        trackStatus: track.trackStatus || "",
        trackMessage: track.trackMessage || "",
        latestAt,
        firstSeenAt: timeValue(event.createdAt) || latestAt,
        order: linkIndex,
        valid: Boolean(validLinks),
        readSource: event.readSource || "",
        seenCount: Number(event.seenCount || 1)
      });
    }
  }
  const rows = Array.from(rowsByKey.values())
    .sort((a, b) => (
      a.firstSeenAt - b.firstSeenAt
      || a.order - b.order
      || a.latestAt - b.latestAt
    ));
  const rowKeys = new Set(rows.map((row) => linkKey(row.url)).filter(Boolean));
  for (const key of Array.from(selectedQueueLinks)) {
    if (!rowKeys.has(key)) {
      selectedQueueLinks.delete(key);
      selectedQueueUrlByKey.delete(key);
    }
  }
  if (clearSelectedEventsBtn) {
    clearSelectedEventsBtn.disabled = selectedQueueLinks.size === 0;
    clearSelectedEventsBtn.textContent = selectedQueueLinks.size
      ? `清除选中 ${selectedQueueLinks.size}`
      : "清除选中";
  }

  eventList.innerHTML = "";
  if (!rows.length) {
    eventList.innerHTML = currentConfig().syncQueue === true
      ? '<div class="empty">暂无新链接</div>'
      : '<div class="empty">同步未开启。左侧会继续识别，点击“开始同步”后，当前链接和后续新链接会进入这里。</div>';
    if (eventPager) {
      eventPager.hidden = true;
    }
    eventPage = 1;
    return;
  }

  const pageSize = [10, 20].includes(eventPageSize) ? eventPageSize : 10;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  if (eventFollowLatest) {
    eventPage = totalPages;
  }
  eventPage = Math.max(1, Math.min(totalPages, eventPage));
  const startIndex = (eventPage - 1) * pageSize;
  const visibleRows = rows.slice(startIndex, startIndex + pageSize);

  if (eventPager) {
    eventPager.hidden = rows.length <= pageSize && totalPages <= 1;
  }
  if (eventPageSizeSelect) {
    eventPageSizeSelect.value = String(pageSize);
  }
  if (eventPageInfo) {
    eventPageInfo.textContent = `第 ${eventPage}/${totalPages} 页 · 共 ${rows.length} 条`;
  }
  if (eventPrevBtn) {
    eventPrevBtn.disabled = eventPage <= 1;
  }
  if (eventNextBtn) {
    eventNextBtn.disabled = eventPage >= totalPages;
  }

  for (const [index, item] of visibleRows.entries()) {
    const card = document.createElement("div");
    card.className = `event-card queue-card${item.valid ? "" : " candidate"}`;
    const head = document.createElement("div");
    head.className = "queue-head";
    const checkboxLabel = document.createElement("label");
    checkboxLabel.className = "queue-select";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.queueUrl = item.url;
    checkbox.checked = selectedQueueLinks.has(linkKey(item.url));
    const checkboxText = document.createElement("span");
    checkboxText.textContent = "选中";
    checkboxLabel.append(checkbox, checkboxText);
    const title = document.createElement("strong");
    title.textContent = item.sourceName;
    const state = document.createElement("span");
    state.className = item.valid ? "queue-state ok" : "queue-state warn";
    state.textContent = item.valid ? "有效链接" : "疑似链接";
    head.append(checkboxLabel, title, state);

    const linkLine = document.createElement("div");
    linkLine.className = "queue-link";
    linkLine.textContent = `${startIndex + index + 1}. ${shortLink(item.url)}`;

    const meta = document.createElement("span");
    meta.textContent = [
      item.latestAt ? formatTime(item.latestAt) : "",
      item.expectedTrack
        ? `赛道 ${item.expectedTrack}`
        : item.trackStatus === "checking"
          ? "赛道确认中"
          : item.trackStatus === "unknown"
            ? "赛道未确认"
            : ""
    ].filter(Boolean).join(" · ");

    const trackNote = document.createElement("span");
    trackNote.textContent = item.trackMessage || "";
    trackNote.hidden = !item.trackMessage;

    const actions = document.createElement("div");
    actions.className = "queue-actions";
    const anchor = document.createElement("a");
    anchor.href = item.url;
    anchor.target = "_blank";
    anchor.rel = "noreferrer";
    anchor.textContent = "打开表单";
    const startButton = document.createElement("button");
    startButton.type = "button";
    startButton.className = "start-point-btn";
    startButton.textContent = "设为起点";
    startButton.title = "只设置本次起点，回到填表单页开始后才会处理";
    startButton.dataset.startEvent = item.eventId;
    startButton.dataset.startUrl = item.url;
    actions.append(anchor, startButton);

    card.append(head, linkLine, meta, trackNote, actions);
    eventList.appendChild(card);
  }
}

function renderSizeTestResults(stat) {
  const results = Array.isArray(stat && stat.sizeTestResults) ? stat.sizeTestResults : [];
  if (!results.length) {
    return null;
  }
  const bestLabel = stat.sizeTestBest || "";
  const wrap = document.createElement("div");
  wrap.className = "size-test-results";
  const head = document.createElement("div");
  head.className = "size-test-head";
  const title = document.createElement("strong");
  title.textContent = "尺寸测试结果";
  const summary = document.createElement("span");
  summary.textContent = stat.sizeTestMessage || (bestLabel ? `推荐 ${bestLabel}` : "");
  head.append(title, summary);
  wrap.appendChild(head);

  for (const item of results) {
    const label = `${item.width}×${item.height}`;
    const row = document.createElement("div");
    row.className = `size-test-row${label === bestLabel ? " best" : ""}`;
    const main = document.createElement("div");
    main.className = "size-test-main";
    const name = document.createElement("strong");
    name.textContent = label === bestLabel ? `${label} · 推荐` : label;
    const metrics = document.createElement("span");
    metrics.textContent = item.error
      ? item.error
      : [
        `有效 ${Number(item.validCount || 0)}`,
        `稳定 ${Number(item.stableCount || 0)}`,
        `疑似 ${Number(item.candidateCount || 0)}`,
        `文字 ${Number(item.textLength || 0)}`,
        `${Math.max(0, Math.round(Number(item.elapsedMs || 0) / 1000))}秒`
      ].join(" · ");
    main.append(name, metrics);
    const links = document.createElement("div");
    links.className = "size-test-links";
    const visibleLinks = Array.isArray(item.urls) && item.urls.length ? item.urls : item.candidateUrls || [];
    links.textContent = visibleLinks.length
      ? visibleLinks.slice(0, 3).map(shortSizeLink).join("、")
      : "无链接";
    row.append(main, links);
    wrap.appendChild(row);
  }
  return wrap;
}

function render() {
  ensureSelectedAccount();
  renderAccountTabs();
  updateAccountLabels();
  renderSummary();
  renderSlots();
  renderAvailable();
  renderEvents();
}

async function saveMonitorConfig(patch = {}) {
  const config = currentConfig();
  monitorState = await api("/api/monitor", {
    method: "POST",
    body: JSON.stringify({
      ...config,
      enabled: patch.enabled !== undefined ? patch.enabled : config.enabled,
      detectWechatWindow: true,
      detectClipboard: config.detectClipboard !== false,
      readMode: readModeFromConfig(config),
      syncQueue: config.syncQueue === true,
      syncQueueStartedAt: config.syncQueueStartedAt || "",
      intervalMs: config.intervalMs || 15000,
      scanBatchSize: config.scanBatchSize === undefined ? 1 : config.scanBatchSize,
      targetCycleSeconds: config.targetCycleSeconds || 15,
      fillAccounts: config.fillAccounts || [],
      autoFillStartedAt: config.autoFillStartedAt || "",
      sources: config.sources || [],
      windowBindings: config.windowBindings || [],
      ...patch
    })
  });
}

async function addWindowToAccount(windowItem) {
  const config = currentConfig();
  if (windowItem && windowItem.screenPrimary === false) {
    lockHint.textContent = "窗口在虚拟屏，正在先移回主屏";
    await api("/api/monitor/restore-window", {
      method: "POST",
      body: JSON.stringify({ hwnd: windowItem.hwnd, persist: false })
    });
  }
  const title = titleForWindow(windowItem, 0);
  const existingSource = (config.sources || []).find((source) => (
    source.enabled !== false
    && source.name === title
  ));
  const source = existingSource || {
    id: `window-source-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: title,
    account: "",
    douyinIndex: "__auto__",
    enabled: true
  };
  const sources = existingSource
    ? (config.sources || []).map((item) => item.id === existingSource.id
      ? { ...item, douyinIndex: item.douyinIndex || "__auto__" }
      : item)
    : [...(config.sources || []), source];
  const stats = monitorState && monitorState.bindingStats || {};
  const windowBindings = (config.windowBindings || [])
    .filter((binding) => {
      if (String(binding.hwnd) === String(windowItem.hwnd || "")) {
        return false;
      }
      if (existingSource && binding.sourceId === existingSource.id && binding.virtualScreen === true) {
        const stat = stats[String(binding.hwnd || "")] || {};
        return !(stat.lastError || !stat.lastScanAt);
      }
      return true;
    });

  windowBindings.push({
    id: `binding-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    hwnd: String(windowItem.hwnd || ""),
    pid: String(windowItem.pid || ""),
    title,
    sourceId: source.id,
    account: "",
    enabled: true,
    boundAt: new Date().toISOString()
  });

  await saveMonitorConfig({ enabled: true, sources, windowBindings });
  monitorState = await api("/api/monitor/start", { method: "POST" });
  render();
  try {
    await optimizeWindowSize(windowItem.hwnd, true);
  } catch (error) {
    lockHint.textContent = error.message;
  }
  await verifyWindow(windowItem.hwnd, true);
}

async function optimizeWindowSize(hwnd, silent = false) {
  if (!silent) {
    lockHint.textContent = "正在调整到推荐尺寸";
  }
  const result = await api("/api/monitor/resize-window", {
    method: "POST",
    body: JSON.stringify({ hwnd })
  });
  monitorState = await api("/api/monitor");
  render();
  if (!silent) {
    const sourceText = result.source === "tested-best" ? "已应用测试推荐" : "已调整到默认推荐";
    lockHint.textContent = `${sourceText}：${result.width || 960}×${result.height || 780}`;
  }
  return result;
}

async function dockWindowToVirtualScreen(hwnd) {
  lockHint.textContent = "正在把微信窗口放到虚拟屏";
  const result = await api("/api/monitor/dock-window", {
    method: "POST",
    body: JSON.stringify({ hwnd })
  });
  monitorState = await api("/api/monitor");
  render();
  const target = result.target || {};
  lockHint.textContent = target.deviceName
    ? `已放到虚拟屏：${target.deviceName}`
    : "已放到虚拟屏";
  await verifyWindow(hwnd, true);
  return result;
}

async function restoreWindowToMainScreen(hwnd) {
  lockHint.textContent = "正在把微信窗口移回主屏";
  const result = await api("/api/monitor/restore-window", {
    method: "POST",
    body: JSON.stringify({ hwnd })
  });
  monitorState = await api("/api/monitor");
  render();
  lockHint.textContent = "已移回主屏";
  return result;
}

async function runSizeTest(hwnd) {
  lockHint.textContent = "正在测试窗口尺寸";
  const result = await api("/api/monitor/test-window-sizes", {
    method: "POST",
    body: JSON.stringify({ hwnd })
  });
  monitorState = await api("/api/monitor");
  render();
  lockHint.textContent = result.message || "尺寸测试完成";
  return result;
}

async function clearEventQueue(urls = []) {
  if (clearEventsBtn) {
    clearEventsBtn.disabled = true;
    clearEventsBtn.textContent = "清空中";
  }
  if (clearSelectedEventsBtn) {
    clearSelectedEventsBtn.disabled = true;
  }
  try {
    const targetUrls = (urls || []).map(canonicalUrl).filter((url) => linkKey(url));
    const result = await api("/api/monitor/events/clear", {
      method: "POST",
      body: JSON.stringify({ urls: targetUrls })
    });
    for (const url of targetUrls) {
      const key = linkKey(url);
      selectedQueueLinks.delete(key);
      selectedQueueUrlByKey.delete(key);
    }
    if (!targetUrls.length) {
      selectedQueueLinks.clear();
      selectedQueueUrlByKey.clear();
    }
    monitorState = await api("/api/monitor");
    eventPage = 1;
    eventFollowLatest = true;
    render();
    lockHint.textContent = targetUrls.length
      ? `已清除选中：${targetUrls.length} 条`
      : `已清空队列：采集 ${result.removedEvents || 0} 条，待分配 ${result.removedHistory || 0} 条`;
  } finally {
    if (clearEventsBtn) {
      clearEventsBtn.disabled = false;
      clearEventsBtn.textContent = "清空队列";
    }
    if (clearSelectedEventsBtn) {
      clearSelectedEventsBtn.disabled = selectedQueueLinks.size === 0;
      clearSelectedEventsBtn.textContent = selectedQueueLinks.size
        ? `清除选中 ${selectedQueueLinks.size}`
        : "清除选中";
    }
  }
}

async function verifyWindow(hwnd, silent = false) {
  if (!silent) {
    lockHint.textContent = "正在读取窗口画面";
  }
  const result = await api("/api/monitor/read-window", {
    method: "POST",
    body: JSON.stringify({ hwnd })
  });
  if (result.image) {
    proofImages[String(hwnd)] = result.image;
    proofImageTimes[String(hwnd)] = new Date().toISOString();
  }
  monitorState = await api("/api/monitor");
  render();
  if (result.ok) {
    const title = displayLabel(result.title, "微信窗口");
    const sourceText = result.readSource || readModeLabel(result.readMode || readModeFromConfig());
    lockHint.textContent = silent
      ? `实时读取：${title} · ${sourceText} · ${(result.urls || []).length} 条有效链接`
      : `读取完成：${sourceText} · ${(result.urls || []).length} 条有效链接`;
  } else {
    lockHint.textContent = result.error || "读取失败";
  }
  return result;
}

async function removeWindow(hwnd) {
  const config = currentConfig();
  const removed = (config.windowBindings || []).find((binding) => String(binding.hwnd) === String(hwnd));
  const windowBindings = (config.windowBindings || []).filter((binding) => String(binding.hwnd) !== String(hwnd));
  const usedSourceIds = new Set(windowBindings.map((binding) => binding.sourceId));
  const sources = (config.sources || []).filter((source) => (
    usedSourceIds.has(source.id)
    || !removed
    || source.id !== removed.sourceId
    || !String(source.id || "").startsWith("window-source-")
  ));

  delete proofImages[String(hwnd)];
  delete proofImageTimes[String(hwnd)];
  await saveMonitorConfig({ sources, windowBindings, enabled: windowBindings.length > 0 });
  if (!windowBindings.length) {
    monitorState = await api("/api/monitor/stop", { method: "POST" });
  }
  render();
}

async function probeWindows() {
  lockHint.textContent = "正在扫描当前打开的微信窗口";
  await saveMonitorConfig();
  const recovered = await recoverLostWechatWindows(true).catch(() => ({ recovered: 0 }));
  const result = await api("/api/monitor/probe", { method: "POST" });
  availableWindows = result.windows || [];
  renderAvailable();
  renderEvents();
  lockHint.textContent = recovered && recovered.recovered
    ? `已从虚拟屏找回 ${recovered.recovered} 个窗口，并扫描到 ${availableWindows.length} 个微信窗口`
    : `已扫描到 ${availableWindows.length} 个微信窗口`;
}

async function recoverLostWechatWindows(silent = false) {
  if (!silent) {
    lockHint.textContent = "正在找回虚拟屏里的未接入微信窗口";
  }
  const result = await api("/api/monitor/recover-windows", { method: "POST" });
  if (!silent) {
    lockHint.textContent = result.recovered
      ? `已移回主屏：${result.recovered} 个微信窗口`
      : "没有发现需要移回主屏的未接入微信窗口";
    await probeWindows();
  }
  return result;
}

function showLockOverlay(count, title, message) {
  lockOverlay.hidden = false;
  lockCount.textContent = String(count);
  lockTitle.textContent = title;
  lockMessage.textContent = message;
}

function hideLockOverlay() {
  lockOverlay.hidden = true;
}

async function lockForegroundWindow() {
  if (lockBusy) {
    return;
  }

  lockBusy = true;
  lockZone.classList.add("active");
  try {
    for (let count = 5; count > 0; count -= 1) {
      showLockOverlay(
        count,
        "锁定监控窗口",
        "请现在点击目标微信独立聊天窗口，倒计时结束时自动接入。"
      );
      lockHint.textContent = `${count} 秒后锁定当前最前面的微信窗口`;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    showLockOverlay("…", "正在确认窗口", "正在读取当前最前面的微信窗口");
    const picked = await api("/api/monitor/foreground-window", { method: "POST" });
    window.focus();
    await addWindowToAccount(picked);
    showLockOverlay("✓", "锁定成功", displayLabel(picked.title, "微信窗口已进入监控台"));
    await new Promise((resolve) => setTimeout(resolve, 900));
  } catch (error) {
    window.focus();
    showLockOverlay("!", "锁定失败", error.message);
    lockHint.textContent = error.message;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    hideLockOverlay();
    lockZone.classList.remove("active");
    lockBusy = false;
  }
}

async function toggleMonitor() {
  if (monitorState && monitorState.running) {
    monitorState = await api("/api/monitor/stop", { method: "POST" });
  } else {
    monitorState = await api("/api/monitor/start", { method: "POST" });
  }
  renderSummary();
  renderSlots();
  renderEvents();
}

async function toggleAutoFill() {
  const next = !(currentConfig().autoFill === true);
  await saveMonitorConfig({ autoFill: next });
  lockHint.textContent = next ? "联动填表已开启" : "已切换为只记录";
  render();
}

async function toggleQueueSync() {
  const next = !(currentConfig().syncQueue === true);
  if (syncQueueBtn) {
    syncQueueBtn.disabled = true;
  }
  try {
    const result = await api("/api/monitor/sync", {
      method: "POST",
      body: JSON.stringify({ enabled: next })
    });
    monitorState = result.state || await api("/api/monitor");
    eventFollowLatest = true;
    lockHint.textContent = next
      ? `同步已开启：当前画面同步 ${result.syncedCount || 0} 条链接`
      : "同步已暂停：左侧继续识别，右侧不再接收新链接";
    render();
  } finally {
    if (syncQueueBtn) {
      syncQueueBtn.disabled = false;
    }
  }
}

async function setMonitorStartPointFromButton(button) {
  const payload = {
    hwnd: button.dataset.startHwnd || "",
    eventId: button.dataset.startEvent || "",
    url: button.dataset.startUrl || ""
  };
  if (button.dataset.startUrls) {
    try {
      payload.urls = JSON.parse(button.dataset.startUrls);
    } catch (error) {
      payload.urls = [];
    }
  }
  const result = await api("/api/monitor/start-point", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  monitorState = result.state || await api("/api/monitor");
  lockHint.textContent = `已设为起点：${shortLink(result.startAfterUrl || payload.url)}。回到填表单页开始后才会处理`;
  render();
}

async function refresh() {
  [appState, monitorState] = await Promise.all([
    api("/api/state"),
    api("/api/monitor")
  ]);

  ensureSelectedAccount();
  render();
}

async function refreshNextProofImage() {
  if (proofRefreshBusy || !(monitorState && monitorState.running)) {
    return;
  }
  const bindings = activeBindings();
  if (!bindings.length) {
    return;
  }

  proofRefreshBusy = true;
  try {
    const minAgeMs = presetScanDelayMs();
    const candidates = bindings.filter((binding) => {
      const stat = statFor(binding);
      const hwnd = String(binding.hwnd || "");
      const last = proofImageTimes[hwnd] ? new Date(proofImageTimes[hwnd]).getTime() : 0;
      return !(stat && stat.lastError) && Date.now() - last > minAgeMs;
    });
    if (candidates.length) {
      const binding = candidates[proofRefreshIndex % candidates.length];
      proofRefreshIndex += 1;
      await verifyWindow(binding.hwnd, true);
    }
  } catch (error) {
  } finally {
    proofRefreshBusy = false;
  }
}

function updateSettingsPreview() {
  settingsDirty = true;
  settingsHint.textContent = settingsHintText(
    scanPresetSelect.value,
    monitorState && monitorState.scanPlan || {},
    readModeSelect ? readModeSelect.value : readModeFromConfig()
  );
}

async function saveSettings() {
  const preset = scanPresets[scanPresetSelect.value] || scanPresets.balanced;
  settingsDirty = false;
  await saveMonitorConfig({
    scanBatchSize: preset.scanBatchSize,
    intervalMs: preset.intervalMs,
    targetCycleSeconds: preset.targetCycleSeconds,
    readMode: readModeSelect ? readModeSelect.value : readModeFromConfig()
  });
  lockHint.textContent = "扫描设置已保存";
  render();
}

accountTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-account-name]");
  if (!button) {
    return;
  }
  setSelectedAccount(button.dataset.accountName);
  lockHint.textContent = "正在查看全部监控窗口";
});

scanPresetSelect.addEventListener("input", updateSettingsPreview);
scanPresetSelect.addEventListener("change", updateSettingsPreview);
if (readModeSelect) {
  readModeSelect.addEventListener("input", updateSettingsPreview);
  readModeSelect.addEventListener("change", updateSettingsPreview);
}

saveSettingsBtn.addEventListener("click", () => {
  saveSettings().catch((error) => alert(error.message));
});

lockZone.addEventListener("click", () => {
  lockForegroundWindow();
});

lockZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    lockForegroundWindow();
  }
});

lockZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  lockZone.classList.add("active");
});

lockZone.addEventListener("dragleave", () => {
  if (!lockBusy) {
    lockZone.classList.remove("active");
  }
});

lockZone.addEventListener("drop", (event) => {
  event.preventDefault();
  lockForegroundWindow();
});

scanWindowsBtn.addEventListener("click", () => {
  probeWindows().catch((error) => {
    lockHint.textContent = error.message;
    alert(error.message);
  });
});

if (recoverWindowsBtn) {
  recoverWindowsBtn.addEventListener("click", () => {
    recoverLostWechatWindows().catch((error) => {
      lockHint.textContent = error.message;
      alert(error.message);
    });
  });
}

pauseBtn.addEventListener("click", () => {
  toggleMonitor().catch((error) => alert(error.message));
});

if (autoFillToggle) {
  autoFillToggle.addEventListener("click", () => {
    toggleAutoFill().catch((error) => alert(error.message));
  });
}

if (syncQueueBtn) {
  syncQueueBtn.addEventListener("click", () => {
    toggleQueueSync().catch((error) => alert(error.message));
  });
}

if (clearEventsBtn) {
  clearEventsBtn.addEventListener("click", () => {
    clearEventQueue().catch((error) => alert(error.message));
  });
}

if (clearSelectedEventsBtn) {
  clearSelectedEventsBtn.disabled = true;
  clearSelectedEventsBtn.addEventListener("click", () => {
    const urls = Array.from(selectedQueueLinks)
      .map((key) => selectedQueueUrlByKey.get(key))
      .filter(Boolean);
    if (!urls.length) {
      return;
    }
    clearEventQueue(urls).catch((error) => alert(error.message));
  });
}

if (eventPrevBtn) {
  eventPrevBtn.addEventListener("click", () => {
    eventFollowLatest = false;
    eventPage = Math.max(1, eventPage - 1);
    renderEvents();
  });
}

if (eventNextBtn) {
  eventNextBtn.addEventListener("click", () => {
    eventPage += 1;
    eventFollowLatest = false;
    renderEvents();
  });
}

if (eventPageSizeSelect) {
  eventPageSizeSelect.value = String(eventPageSize);
  eventPageSizeSelect.addEventListener("change", () => {
    eventPageSize = Number(eventPageSizeSelect.value) === 20 ? 20 : 10;
    localStorage.setItem("monitor-platform:event-page-size", String(eventPageSize));
    eventFollowLatest = true;
    renderEvents();
  });
}

availableList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-hwnd]");
  if (!button) {
    return;
  }
  const windowItem = availableWindows.find((item) => String(item.hwnd) === String(button.dataset.addHwnd));
  if (windowItem) {
    addWindowToAccount(windowItem).catch((error) => alert(error.message));
  }
});

gridList.addEventListener("click", (event) => {
  const startPoint = event.target.closest("[data-start-hwnd]");
  if (startPoint) {
    setMonitorStartPointFromButton(startPoint).catch((error) => alert(error.message));
    return;
  }

  const read = event.target.closest("[data-read]");
  if (read) {
    verifyWindow(read.dataset.read).catch((error) => alert(error.message));
    return;
  }

  const resize = event.target.closest("[data-resize]");
  if (resize) {
    optimizeWindowSize(resize.dataset.resize)
      .then(() => verifyWindow(resize.dataset.resize, true))
      .catch((error) => alert(error.message));
    return;
  }

  const sizeTest = event.target.closest("[data-size-test]");
  if (sizeTest) {
    runSizeTest(sizeTest.dataset.sizeTest).catch((error) => alert(error.message));
    return;
  }

  const dock = event.target.closest("[data-dock]");
  if (dock) {
    dockWindowToVirtualScreen(dock.dataset.dock).catch((error) => alert(error.message));
    return;
  }

  const restore = event.target.closest("[data-restore]");
  if (restore) {
    restoreWindowToMainScreen(restore.dataset.restore).catch((error) => alert(error.message));
    return;
  }

  const focus = event.target.closest("[data-focus]");
  if (focus) {
    api("/api/monitor/focus-window", {
      method: "POST",
      body: JSON.stringify({ hwnd: focus.dataset.focus })
    }).catch((error) => alert(error.message));
    return;
  }

  const remove = event.target.closest("[data-remove]");
  if (remove) {
    removeWindow(remove.dataset.remove).catch((error) => alert(error.message));
  }
});

eventList.addEventListener("click", (event) => {
  const startPoint = event.target.closest("[data-start-event]");
  if (!startPoint) {
    return;
  }
  setMonitorStartPointFromButton(startPoint).catch((error) => alert(error.message));
});

eventList.addEventListener("change", (event) => {
  const checkbox = event.target.closest("[data-queue-url]");
  if (!checkbox) {
    return;
  }
  const key = linkKey(checkbox.dataset.queueUrl);
  if (!key) {
    return;
  }
  if (checkbox.checked) {
    selectedQueueLinks.add(key);
    selectedQueueUrlByKey.set(key, checkbox.dataset.queueUrl);
  } else {
    selectedQueueLinks.delete(key);
    selectedQueueUrlByKey.delete(key);
  }
  if (clearSelectedEventsBtn) {
    clearSelectedEventsBtn.disabled = selectedQueueLinks.size === 0;
    clearSelectedEventsBtn.textContent = selectedQueueLinks.size
      ? `清除选中 ${selectedQueueLinks.size}`
      : "清除选中";
  }
});

refresh().catch((error) => {
  lockHint.textContent = error.message;
});

setInterval(() => {
  api("/api/monitor").then((state) => {
    monitorState = state;
    renderSummary();
    renderSlots();
    renderEvents();
  }).catch(() => {});
}, 1200);

setInterval(() => {
  refreshNextProofImage();
}, liveReadPollMs);
