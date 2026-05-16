let state = null;
let activeJobId = "";
let activeJobIds = [];
let pollTimer = null;
let monitorPollTimer = null;
let preferredAccountName = "";
let douyinOwnerName = "";
let editingDouyinAccountName = "";
let editingDouyinIndex = -1;
let monitorState = null;
let historyItems = [];
let historyTimeFilter = { range: "today", start: "", end: "" };
let historyTypeFilter = "submitted";
let historyPage = 1;
let monitorLinkPage = 1;
let formMode = "auto";
let parsedBatchItems = [];
let batchTrackDetectTimer = null;
let batchTrackDetectSeq = 0;
let latestMonitorProbe = null;
const batchTrackDetections = new Map();
const monitorProofImages = {};
const historyPageSize = 10;
const monitorLinkPageSize = 8;

const navButtons = Array.from(document.querySelectorAll(".nav-btn"));
const pageViews = Array.from(document.querySelectorAll(".page"));
const formModeButtons = Array.from(document.querySelectorAll("[data-form-mode]"));
const formModePanels = Array.from(document.querySelectorAll("[data-form-mode-panel]"));
const formRegularOnlyBlocks = Array.from(document.querySelectorAll("[data-form-regular-only]"));
const formAdvancedOnlyBlocks = Array.from(document.querySelectorAll("[data-form-advanced-only]"));
const pageTitle = document.querySelector("#pageTitle");
const pageStatus = document.querySelector("#pageStatus");
const openMonitorTopBtn = document.querySelector("#openMonitorTopBtn");
const accountSelect = document.querySelector("#accountSelect");
const accountCount = document.querySelector("#accountCount");
const fillAccountPicker = document.querySelector("#fillAccountPicker");
const templateAccountList = document.querySelector("#templateAccountList");
const accountEditStatus = document.querySelector("#accountEditStatus");
const accountNameInput = document.querySelector("#accountNameInput");
const newAccountName = document.querySelector("#newAccountName");
const contactPhone = document.querySelector("#contactPhone");
const contactName = document.querySelector("#contactName");
const contactAlipayAccount = document.querySelector("#contactAlipayAccount");
const contactAlipayName = document.querySelector("#contactAlipayName");
const contactIdCard = document.querySelector("#contactIdCard");
const accountReleaseLink = document.querySelector("#accountReleaseLink");
const accountLevel = document.querySelector("#accountLevel");
const accountGradeScreenshot = document.querySelector("#accountGradeScreenshot");
const pickGradeScreenshotBtn = document.querySelector("#pickGradeScreenshotBtn");
const addAccountBtn = document.querySelector("#addAccountBtn");
const renameAccountBtn = document.querySelector("#renameAccountBtn");
const saveAccountBtn = document.querySelector("#saveAccountBtn");
const loginBtn = document.querySelector("#loginBtn");
const fillBtn = document.querySelector("#fillBtn");
const importMonitorLinksBtn = document.querySelector("#importMonitorLinksBtn");
const fillMonitorLinksBtn = document.querySelector("#fillMonitorLinksBtn");
const monitorAutoUseBtn = document.querySelector("#monitorAutoUseBtn");
const stopMonitorAutoFillBtn = document.querySelector("#stopMonitorAutoFillBtn");
const monitorImportSummary = document.querySelector("#monitorImportSummary");
const monitorFillProgress = document.querySelector("#monitorFillProgress");
const monitorLinkPanel = document.querySelector("#monitorLinkPanel");
const monitorLinkPanelSummary = document.querySelector("#monitorLinkPanelSummary");
const monitorLinkList = document.querySelector("#monitorLinkList");
const monitorLinkPager = document.querySelector("#monitorLinkPager");
const monitorLinkFirstPageBtn = document.querySelector("#monitorLinkFirstPageBtn");
const monitorLinkPrevPageBtn = document.querySelector("#monitorLinkPrevPageBtn");
const monitorLinkPageSelect = document.querySelector("#monitorLinkPageSelect");
const monitorLinkNextPageBtn = document.querySelector("#monitorLinkNextPageBtn");
const clearMonitorQueueBtn = document.querySelector("#clearMonitorQueueBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const stopFillBtn = document.querySelector("#stopFillBtn");
const stopFillInlineBtn = document.querySelector("#stopFillInlineBtn");
const formUrl = document.querySelector("#formUrl");
const batchPreview = document.querySelector("#batchPreview");
const batchList = document.querySelector("#batchList");
const batchSummary = document.querySelector("#batchSummary");
const douyinSelect = document.querySelector("#douyinSelect");
const douyinList = document.querySelector("#douyinList");
const douyinAccountOwner = document.querySelector("#douyinAccountOwner");
const douyinName = document.querySelector("#douyinName");
const douyinId = document.querySelector("#douyinId");
const trackLibraryList = document.querySelector("#trackLibraryList");
const newTrackName = document.querySelector("#newTrackName");
const addTrackBtn = document.querySelector("#addTrackBtn");
const douyinTrackPicker = document.querySelector("#douyinTrackPicker");
const addDouyinBtn = document.querySelector("#addDouyinBtn");
const cancelDouyinEditBtn = document.querySelector("#cancelDouyinEditBtn");
const douyinEditStatus = document.querySelector("#douyinEditStatus");
const dryRun = document.querySelector("#dryRun");
const logBox = document.querySelector("#logBox");
const jobState = document.querySelector("#jobState");
const typeList = document.querySelector("#typeList");
const manualSubmitMode = document.querySelector("#manualSubmitMode");
const autoSubmitMode = document.querySelector("#autoSubmitMode");
const monitorStatus = document.querySelector("#monitorStatus");
const monitorWechatWindow = document.querySelector("#monitorWechatWindow");
const monitorClipboard = document.querySelector("#monitorClipboard");
const monitorReadMode = document.querySelector("#monitorReadMode");
const monitorReadModeHint = document.querySelector("#monitorReadModeHint");
const monitorAutoFill = document.querySelector("#monitorAutoFill");
const saveMonitorBtn = document.querySelector("#saveMonitorBtn");
const startMonitorBtn = document.querySelector("#startMonitorBtn");
const stopMonitorBtn = document.querySelector("#stopMonitorBtn");
const monitorSourceName = document.querySelector("#monitorSourceName");
const monitorAccountSelect = document.querySelector("#monitorAccountSelect");
const monitorDouyinSelect = document.querySelector("#monitorDouyinSelect");
const addMonitorSourceBtn = document.querySelector("#addMonitorSourceBtn");
const openMonitorBoardBtn = document.querySelector("#openMonitorBoardBtn");
const probeMonitorBtn = document.querySelector("#probeMonitorBtn");
const monitorSourceList = document.querySelector("#monitorSourceList");
const monitorSummary = document.querySelector("#monitorSummary");
const monitorLiveStatus = document.querySelector("#monitorLiveStatus");
const monitorProbeResult = document.querySelector("#monitorProbeResult");
const monitorMetricAccounts = document.querySelector("#monitorMetricAccounts");
const monitorMetricWindows = document.querySelector("#monitorMetricWindows");
const monitorMetricPending = document.querySelector("#monitorMetricPending");
const monitorMetricToday = document.querySelector("#monitorMetricToday");
const refreshHistoryBtn = document.querySelector("#refreshHistoryBtn");
const exportTodayFilledBtn = document.querySelector("#exportTodayFilledBtn");
const historyList = document.querySelector("#historyList");
const historyRangeButtons = Array.from(document.querySelectorAll("[data-history-range]"));
const historyTypeButtons = Array.from(document.querySelectorAll("[data-history-type]"));
const historyStartDate = document.querySelector("#historyStartDate");
const historyEndDate = document.querySelector("#historyEndDate");
const historyApplyDateBtn = document.querySelector("#historyApplyDateBtn");
const historyFilterSummary = document.querySelector("#historyFilterSummary");
const historyQuickSummary = document.querySelector("#historyQuickSummary");
const historyPager = document.querySelector("#historyPager");
const historyFirstPageBtn = document.querySelector("#historyFirstPageBtn");
const historyPrevPageBtn = document.querySelector("#historyPrevPageBtn");
const historyPageSelect = document.querySelector("#historyPageSelect");
const historyNextPageBtn = document.querySelector("#historyNextPageBtn");
const loginStatusSummary = document.querySelector("#loginStatusSummary");
const loginStatusList = document.querySelector("#loginStatusList");
const checkAllLoginBtn = document.querySelector("#checkAllLoginBtn");
const activeJobStatuses = new Set(["queued", "running", "stopping"]);

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

function setLog(text) {
  logBox.textContent = text || "就绪";
  logBox.scrollTop = logBox.scrollHeight;
}

function showPage(name) {
  const labels = {
    form: "填表单",
    monitor: "监控概览",
    history: "历史记录",
    accounts: "填表资料",
    content: "抖音账号库",
    status: "运行状态"
  };
  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.page === name);
  });
  pageViews.forEach((page) => {
    page.classList.toggle("active", page.dataset.view === name);
  });
  pageTitle.textContent = labels[name] || "自动填表助手";
}

function setPageStatus(text) {
  pageStatus.textContent = text || "就绪";
}

function formPanelHasMode(panel, mode) {
  return String(panel.dataset.formModePanel || "")
    .split(/\s+/)
    .filter(Boolean)
    .includes(mode);
}

function renderFormMode() {
  formModeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.formMode === formMode);
  });
  formModePanels.forEach((panel) => {
    panel.classList.toggle("hidden", !formPanelHasMode(panel, formMode));
    panel.classList.toggle("active", formPanelHasMode(panel, formMode));
  });
  formRegularOnlyBlocks.forEach((block) => {
    block.classList.toggle("hidden", formMode === "advanced");
  });
  formAdvancedOnlyBlocks.forEach((block) => {
    block.classList.toggle("hidden", formMode !== "advanced");
  });
  if (dryRun) {
    dryRun.checked = formMode === "advanced";
    dryRun.disabled = formMode === "advanced";
  }
  if (fillBtn) {
    fillBtn.textContent = formMode === "advanced" ? "开始测试" : "开始补填";
  }
}

function setFormMode(mode) {
  if (!["auto", "manual", "advanced"].includes(mode)) {
    return;
  }
  formMode = mode;
  renderFormMode();
  renderMonitorImportSummary();
  renderBatchPreview();
}

function selectedAccount() {
  return resolveAccountName(preferredAccountName);
}

function accounts() {
  return state && state.accounts && state.accounts.accounts || [];
}

function currentAccount() {
  return accountByName(selectedAccount()) || null;
}

function accountByName(name) {
  return accounts().find((account) => account.name === name) || null;
}

function accountNames() {
  return accounts().map((account) => account.name);
}

function resolveAccountName(name = "") {
  const names = accountNames();
  if (name && names.includes(name)) {
    return name;
  }
  const defaultName = state && state.accounts && state.accounts.defaultAccount || "";
  if (defaultName && names.includes(defaultName)) {
    return defaultName;
  }
  return names[0] || "";
}

function selectedDouyinOwner() {
  return resolveAccountName(douyinOwnerName || selectedAccount());
}

function selectedFillAccounts() {
  if (!fillAccountPicker) {
    return [];
  }
  const checked = Array.from(fillAccountPicker.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value)
    .filter(Boolean);
  return uniqueCleanList(checked).filter((name) => accountByName(name));
}

function renderFillAccountPicker() {
  if (!fillAccountPicker) {
    return;
  }
  const names = accountNames();
  const configuredFillAccounts = currentMonitorConfig().fillAccounts || [];
  const configuredChecked = configuredFillAccounts.filter((name) => names.includes(name));
  const currentChecked = configuredChecked.length
    ? configuredChecked
    : (fillAccountPicker.children.length ? selectedFillAccounts() : []);
  const checkedNames = currentChecked.length ? currentChecked : names;
  fillAccountPicker.innerHTML = "";
  if (!names.length) {
    fillAccountPicker.innerHTML = '<div class="empty compact-empty">暂无微信号</div>';
    return;
  }
  for (const name of names) {
    const label = document.createElement("label");
    label.className = "account-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = name;
    input.checked = checkedNames.includes(name);
    const text = document.createElement("span");
    text.textContent = name;
    label.append(input, text);
    fillAccountPicker.appendChild(label);
  }
}

function renderTemplateAccountList() {
  if (!templateAccountList) {
    return;
  }
  const selected = selectedAccount();
  templateAccountList.innerHTML = "";
  if (!accounts().length) {
    templateAccountList.innerHTML = '<div class="empty compact-empty">暂无微信号</div>';
    return;
  }
  for (const account of accounts()) {
    const contact = account.contact || {};
    const images = account.images || {};
    const row = document.createElement("div");
    row.className = `template-account-row${account.name === selected ? " active" : ""}`;
    row.innerHTML = `
      <div class="template-account-main">
        <strong></strong>
        <span></span>
      </div>
      <button type="button" data-edit-template="">编辑</button>
    `;
    row.querySelector("strong").textContent = account.name;
    row.querySelector("span").textContent = `${contact.phone || "未填手机号"} · ${contact.realName || "未填姓名"} · ${(account.douyinAccounts || []).length} 个抖音号 · ${images.screenshot || images.gradeScreenshot || images.postScreenshot ? "已绑定截图" : "未绑定截图"}`;
    row.querySelector("button").dataset.editTemplate = account.name;
    templateAccountList.appendChild(row);
  }
}

function formatTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatMonitorTime(value) {
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

function loginStatusData() {
  if (!state) {
    return {};
  }
  if (!state.loginStatus) {
    state.loginStatus = { items: {} };
  }
  if (!state.loginStatus.items) {
    state.loginStatus.items = {};
  }
  return state.loginStatus.items;
}

function loginStatusText(item) {
  const status = item && item.status || "unknown";
  if (status === "logged-in" || item && item.loggedIn === true) {
    return "已登录";
  }
  if (status === "not-logged-in") {
    return "未登录";
  }
  if (status === "checking") {
    return "检测中";
  }
  if (status === "error") {
    return "检测失败";
  }
  if (status === "unknown" && item && item.checkedAt) {
    return "无法确认";
  }
  return "未检测";
}

function loginStatusClass(item) {
  const status = item && item.status || "unknown";
  if (status === "logged-in" || item && item.loggedIn === true) {
    return "ok";
  }
  if (status === "checking") {
    return "warn";
  }
  if (status === "not-logged-in" || status === "error") {
    return "bad";
  }
  if (status === "unknown" && item && item.checkedAt) {
    return "warn";
  }
  return "";
}

function hasRawBrowserLog(value) {
  return /browserType|launchPersistentContext|Browser logs|Target page|context or browser has been closed|msedge\.exe|stderr:|Call log|--disable-|pid=|exitCode|ProcessSingleton|remote-debugging-pipe/i.test(String(value || ""));
}

function loginStatusMessage(item) {
  const text = String(item && item.message || "").replace(/\s+/g, " ").trim();
  if (!text || hasRawBrowserLog(text)) {
    return loginStatusText(item);
  }
  return text.length > 36 ? `${text.slice(0, 36)}...` : text;
}

function renderLoginStatus() {
  if (!loginStatusList || !loginStatusSummary) {
    return;
  }
  const items = loginStatusData();
  const list = accounts();
  const loggedInCount = list.filter((account) => {
    const item = items[account.name];
    return item && (item.status === "logged-in" || item.loggedIn === true);
  }).length;
  loginStatusSummary.textContent = list.length
    ? `${loggedInCount}/${list.length} 个账号已登录`
    : "暂无账号";
  loginStatusList.innerHTML = "";
  if (!list.length) {
    loginStatusList.innerHTML = '<div class="empty compact-empty">暂无账号</div>';
    return;
  }
  for (const account of list) {
    const item = items[account.name] || {};
    const row = document.createElement("div");
    row.className = "account-row login-status-row";
    row.innerHTML = `
      <div class="login-status-main">
        <strong></strong>
        <span></span>
      </div>
      <div class="account-row-actions">
        <span class="badge"></span>
        <button type="button" data-check-login="">检测</button>
        <button type="button" data-open-login-account="">打开登录窗口</button>
      </div>
    `;
    row.querySelector("strong").textContent = account.name;
    const checkedText = item.checkedAt ? `上次检测 ${formatTime(item.checkedAt)}` : "尚未检测";
    row.querySelector(".login-status-main span").textContent = `${checkedText} · ${loginStatusMessage(item)}`;
    const badge = row.querySelector(".badge");
    badge.className = `badge ${loginStatusClass(item)}`;
    badge.textContent = loginStatusText(item);
    row.querySelector("[data-check-login]").dataset.checkLogin = account.name;
    row.querySelector("[data-open-login-account]").dataset.openLoginAccount = account.name;
    loginStatusList.appendChild(row);
  }
}

function markLoginChecking(names) {
  const items = loginStatusData();
  for (const name of names) {
    items[name] = {
      ...(items[name] || {}),
      account: name,
      status: "checking",
      loggedIn: false,
      checkedAt: new Date().toISOString(),
      message: "检测中"
    };
  }
  renderLoginStatus();
}

async function checkLoginStatus(accountName) {
  if (!accountName) {
    alert("先选择账号");
    return;
  }
  markLoginChecking([accountName]);
  const result = await api("/api/login-status/check", {
    method: "POST",
    body: JSON.stringify({ account: accountName })
  });
  if (result.loginStatus) {
    state.loginStatus = result.loginStatus;
  } else if (result.item) {
    loginStatusData()[accountName] = result.item;
  }
  renderLoginStatus();
  setPageStatus(`${accountName}：${loginStatusText(result.item || loginStatusData()[accountName])}`);
}

async function checkAllLoginStatus() {
  const names = accountNames();
  if (!names.length) {
    alert("先添加账号");
    return;
  }
  markLoginChecking(names);
  if (checkAllLoginBtn) {
    checkAllLoginBtn.disabled = true;
    checkAllLoginBtn.textContent = "检测中";
  }
  try {
    const result = await api("/api/login-status/check-all", { method: "POST" });
    state.loginStatus = { items: result.items || {} };
    renderLoginStatus();
    const loggedInCount = Object.values(result.items || {}).filter((item) => item.loggedIn === true || item.status === "logged-in").length;
    setPageStatus(`登录检测完成：${loggedInCount}/${names.length} 已登录`);
  } finally {
    if (checkAllLoginBtn) {
      checkAllLoginBtn.disabled = false;
      checkAllLoginBtn.textContent = "检测全部";
    }
  }
}

function startOfLocalDay(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function parseLocalDateTimeInput(value, endOfRange = false) {
  const text = String(value || "").trim();
  const dateOnly = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    return endOfRange ? addDays(date, 1) : date;
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] || 0),
    0
  );
  return endOfRange ? addMinutes(date, 1) : date;
}

function formatHistoryFilterValue(value) {
  return String(value || "").trim().replace("T", " ");
}

function historyFilterBounds() {
  const today = startOfLocalDay();
  const now = new Date();
  if (historyTimeFilter.range === "all") {
    return { start: null, end: null, label: "全部记录" };
  }
  if (historyTimeFilter.range === "1h") {
    return { start: addMinutes(now, -60), end: now, label: "近1小时" };
  }
  if (historyTimeFilter.range === "3h") {
    return { start: addMinutes(now, -180), end: now, label: "近3小时" };
  }
  if (historyTimeFilter.range === "yesterday") {
    return { start: addDays(today, -1), end: today, label: "昨天" };
  }
  if (historyTimeFilter.range === "7d") {
    return { start: addDays(today, -6), end: addDays(today, 1), label: "近7天" };
  }
  if (historyTimeFilter.range === "30d") {
    return { start: addDays(today, -29), end: addDays(today, 1), label: "近30天" };
  }
  if (historyTimeFilter.range === "custom") {
    const start = parseLocalDateTimeInput(historyTimeFilter.start, false);
    const end = parseLocalDateTimeInput(historyTimeFilter.end, true);
    const startLabel = formatHistoryFilterValue(historyTimeFilter.start) || "不限开始";
    const endLabel = formatHistoryFilterValue(historyTimeFilter.end) || "不限结束";
    return {
      start,
      end,
      label: `${startLabel} 至 ${endLabel}`
    };
  }
  return { start: today, end: addDays(today, 1), label: "今天" };
}

function historyItemTime(item) {
  const date = new Date(item && item.createdAt || item && item.updatedAt || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function historyTimeFilteredItems() {
  const bounds = historyFilterBounds();
  const startTime = bounds.start ? bounds.start.getTime() : -Infinity;
  const endTime = bounds.end ? bounds.end.getTime() : Infinity;
  return historyItems.filter((item) => {
    const time = historyItemTime(item);
    return time >= startTime && time < endTime;
  });
}

function historyTypeLabel(type = historyTypeFilter) {
  const labels = {
    all: "全部明细",
    processing: "处理中",
    submitted: "成功记录",
    doneBefore: "已填过",
    failed: "失败",
    pending: "处理中",
    running: "处理中",
    filled: "处理中",
    unfillable: "失败"
  };
  return labels[type] || labels.all;
}

function historyItemMatchesType(item, type = historyTypeFilter) {
  if (type === "all") {
    return true;
  }
  const status = simplifiedStatus(item && item.status);
  if (["processing", "pending", "running", "filled"].includes(type)) {
    return status === "处理中";
  }
  if (type === "submitted") {
    return status === "已提交";
  }
  if (type === "doneBefore") {
    return status === "已填过";
  }
  if (["failed", "unfillable"].includes(type)) {
    return status === "失败";
  }
  return true;
}

function filteredHistoryItems() {
  return historyTimeFilteredItems().filter((item) => historyItemMatchesType(item));
}

function renderHistoryFilterState(count = 0, timeTotal = historyItems.length) {
  const bounds = historyFilterBounds();
  historyRangeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.historyRange === historyTimeFilter.range);
  });
  historyTypeButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.historyType === historyTypeFilter);
  });
  if (historyFilterSummary) {
    historyFilterSummary.textContent = `${bounds.label} · ${historyTypeLabel()} · ${count}/${timeTotal} 条`;
  }
}

function renderHistoryPager(totalRows, pageCount) {
  if (!historyPager || !historyPageSelect) {
    return;
  }
  const showPager = totalRows > historyPageSize;
  historyPager.classList.toggle("hidden", !showPager);
  if (!showPager) {
    return;
  }
  historyPageSelect.innerHTML = "";
  for (let index = 1; index <= pageCount; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `第 ${index} 页`;
    historyPageSelect.appendChild(option);
  }
  historyPageSelect.value = String(historyPage);
  if (historyFirstPageBtn) {
    historyFirstPageBtn.disabled = historyPage <= 1;
  }
  if (historyPrevPageBtn) {
    historyPrevPageBtn.disabled = historyPage <= 1;
  }
  if (historyNextPageBtn) {
    historyNextPageBtn.disabled = historyPage >= pageCount;
  }
}

function shortUrl(value) {
  const text = String(value || "");
  return text.length > 58 ? `${text.slice(0, 55)}...` : text;
}

function formIdFromUrl(value) {
  const match = String(value || "").match(/\/form\/page\/([^#?/\s]+)/i);
  return match ? match[1] : "";
}

function displayStatus(status) {
  if (status === "已发现" || status === "待分配") {
    return "待填写";
  }
  if (status === "已同步") {
    return "填写中";
  }
  if (status === "已跳过") {
    return "已填过";
  }
  return status || "待填写";
}

function simplifiedStatus(status) {
  const visibleStatus = displayStatus(status);
  if (visibleStatus === "已提交") {
    return "已提交";
  }
  if (visibleStatus.includes("已填过") || visibleStatus.includes("跳过")) {
    return "已填过";
  }
  if (/失败|错误|不可填写|不可|已停止|部分失败|有失败|校验失败/.test(visibleStatus)) {
    return "失败";
  }
  return "处理中";
}

function isInternalMonitorHistoryItem(item) {
  return !item.account && (item.douyinIndex === "__monitor__" || item.douyinLabel === "监控链接池");
}

function isObsoleteTrackHistoryItem(item) {
  return item && (
    item.douyinLabel === "旧赛道误判记录"
    || String(item.message || "").includes("旧赛道误判记录已作废")
  );
}

function primaryHistoryItems(items) {
  const urlsWithAccountRows = new Set((items || [])
    .filter((item) => item && item.account && item.url && !isObsoleteTrackHistoryItem(item))
    .map((item) => monitorLinkKey(item.url)));
  return (items || []).filter((item) => (
    !isObsoleteTrackHistoryItem(item)
    && (!isInternalMonitorHistoryItem(item) || !urlsWithAccountRows.has(monitorLinkKey(item.url)))
  ));
}

function historyStatusBucket(item) {
  const status = simplifiedStatus(item && item.status);
  if (status === "处理中") {
    return "running";
  }
  if (status === "已提交") {
    return "submitted";
  }
  if (status === "已填过") {
    return "skipped";
  }
  if (status === "失败") {
    return "failed";
  }
  return "other";
}

function douyinShortText(label) {
  const parts = String(label || "").split("/").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) {
    return "未匹配";
  }
  return parts.length >= 2 ? `${parts[0]} / ${parts[1]}` : parts[0];
}

function cleanHistoryMessage(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || /监控采集已加入填表队列|已分配到/.test(text)) {
    return "";
  }
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function statusClass(status) {
  const visibleStatus = simplifiedStatus(status);
  if (visibleStatus === "已提交") {
    return "ok";
  }
  if (visibleStatus === "失败") {
    return "bad";
  }
  if (visibleStatus === "处理中") {
    return "warn";
  }
  return "";
}

function uniqueCleanList(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
  }
  return result;
}

function splitTracks(value) {
  return uniqueCleanList(String(value || "")
    .split(/[、,，;；/|\s]+/g)
    .map((item) => item.trim()));
}

function douyinTracks(item) {
  if (!item) {
    return [];
  }
  return uniqueCleanList([
    ...(Array.isArray(item.tracks) ? item.tracks : []),
    item.contentType
  ]);
}

function trackText(item) {
  const tracks = douyinTracks(item);
  return tracks.length ? tracks.join("、") : "未分类";
}

function normalizeFormUrl(value) {
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

function monitorCanonicalUrl(value) {
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
  return match ? `https://docs.qq.com/form/page/${match[1]}` : normalizeFormUrl(value);
}

function monitorLinkKey(value) {
  return monitorCanonicalUrl(value).toLowerCase();
}

function extractFormUrls(text) {
  const directMatches = String(text || "").match(/https?:\/\/docs\.qq\.com\/form\/page\/[^\s"'<>，。)）\]}]+/gi) || [];
  const compact = String(text || "")
    .replace(/[：﹕]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[．。]/g, ".")
    .replace(/\s+/g, "");
  const compactMatches = compact.match(/https?:\/\/docs\.qq\.com\/form\/page\/[A-Za-z0-9_-]+/gi) || [];
  const nakedMatches = compact.match(/docs\.qq\.com\/form\/page\/[A-Za-z0-9_-]+/gi) || [];
  return uniqueCleanList([
    ...directMatches,
    ...compactMatches,
    ...nakedMatches.map((url) => `https://${url}`)
  ].map(normalizeFormUrl));
}

function compactForScore(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[：﹕]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[．。]/g, ".")
    .replace(/[\s"'“”‘’《》【】（）()，,。.;；:：!！?？\-_/|]+/g, "");
}

function implicitKeywords(typeName) {
  const text = compactForScore(typeName);
  if (/冰雪|frozen/.test(text)) {
    return ["冰雪奇缘", "冰雪", "雪", "冰雪女王", "雪女王", "女王", "艾莎", "安娜", "frozen", "letitgo"];
  }
  if (/奥特/.test(text)) {
    return ["奥特曼", "奥特", "迪迦", "赛罗", "泰罗", "怪兽", "光之巨人", "特摄"];
  }
  if (/西游/.test(text)) {
    return ["西游记", "西游", "西海记", "大闹天宫", "天宫", "猴子", "美猴王", "大王叫我来巡山", "巡山", "悟空", "孙悟空", "唐僧", "八戒", "沙僧"];
  }
  return [];
}

function scoreTrack(text, track) {
  const body = compactForScore(text);
  if (!body || !track) {
    return 0;
  }
  let score = 0;
  for (const keyword of uniqueCleanList([track, ...implicitKeywords(track)])) {
    const key = compactForScore(keyword);
    if (!key) {
      continue;
    }
    if (body.includes(key)) {
      score += key.length === 1 ? 3 : 8 + key.length;
    }
  }
  return score;
}

function guessTrack(text) {
  const ranked = allContentTypes()
    .map((track) => ({ track, score: scoreTrack(text, track) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score > 0 ? ranked[0].track : "";
}

function parseBatchText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const byUrl = new Map();
  let previousContext = "";
  for (const line of lines) {
    const urls = extractFormUrls(line);
    const context = line.replace(/https?:\/\/docs\.qq\.com\/form\/page\/[^\s"'<>，。)）\]}]+/gi, "").trim() || previousContext;
    if (urls.length) {
      for (const rawUrl of urls) {
        const url = normalizeFormUrl(rawUrl);
        const key = monitorLinkKey(url);
        const existing = byUrl.get(key);
        if (existing) {
          if (!existing.context && context) {
            existing.context = context;
          }
        } else {
          byUrl.set(key, {
            url,
            context,
            expectedTrack: "",
            trackScore: 0,
            detectStatus: "pending",
            detectMessage: ""
          });
        }
      }
    } else if (line.trim()) {
      previousContext = line.trim();
    }
  }
  return Array.from(byUrl.values());
}

function batchTrackText(item) {
  if (item.expectedTrack) {
    return `赛道 ${item.expectedTrack}`;
  }
  if (item.detectStatus === "loading") {
    return "正在扫描表单内容";
  }
  if (item.detectStatus === "unknown") {
    return "表单内容未识别";
  }
  if (item.detectStatus === "failed") {
    return "扫描失败";
  }
  return "赛道待判断";
}

function scheduleBatchTrackDetection() {
  const pending = parsedBatchItems
    .filter((item) => item && item.url && !batchTrackDetections.has(monitorLinkKey(item.url)));
  if (!pending.length) {
    return;
  }
  for (const item of pending) {
    batchTrackDetections.set(monitorLinkKey(item.url), {
      status: "loading",
      expectedTrack: "",
      trackScore: 0,
      message: "正在扫描表单内容"
    });
  }
  if (batchTrackDetectTimer) {
    clearTimeout(batchTrackDetectTimer);
  }
  const seq = batchTrackDetectSeq + 1;
  batchTrackDetectSeq = seq;
  batchTrackDetectTimer = setTimeout(() => {
    detectBatchTracks(seq).catch((error) => {
      for (const item of pending) {
        batchTrackDetections.set(monitorLinkKey(item.url), {
          status: "failed",
          expectedTrack: "",
          trackScore: 0,
          message: error.message
        });
      }
      renderBatchPreview({ detect: false });
    });
  }, 350);
  renderBatchPreview({ detect: false });
}

async function detectBatchTracks(seq) {
  const items = parsedBatchItems.map((item) => ({ url: item.url }));
  if (!items.length) {
    return;
  }
  const result = await api("/api/forms/detect-tracks", {
    method: "POST",
    body: JSON.stringify({
      accounts: selectedFillAccounts(),
      items
    })
  });
  if (seq !== batchTrackDetectSeq) {
    return;
  }
  for (const item of result.items || []) {
    batchTrackDetections.set(monitorLinkKey(item.url), {
      status: item.status || (item.expectedTrack ? "ok" : "unknown"),
      expectedTrack: item.expectedTrack || "",
      trackScore: Number(item.trackScore || 0),
      message: item.message || ""
    });
  }
  for (const item of items) {
    const key = monitorLinkKey(item.url);
    const current = batchTrackDetections.get(key);
    if (current && current.status === "loading") {
      batchTrackDetections.set(key, {
        status: "unknown",
        expectedTrack: "",
        trackScore: 0,
        message: "无法根据表单内容判断赛道"
      });
    }
  }
  renderBatchPreview({ detect: false });
}

function renderBatchPreview(options = {}) {
  parsedBatchItems = parseBatchText(formUrl.value);
  for (const item of parsedBatchItems) {
    const detected = batchTrackDetections.get(monitorLinkKey(item.url));
    if (detected) {
      item.expectedTrack = detected.expectedTrack || "";
      item.trackScore = Number(detected.trackScore || 0);
      item.detectStatus = detected.status || (item.expectedTrack ? "ok" : "unknown");
      item.detectMessage = detected.message || "";
    }
  }
  batchSummary.textContent = parsedBatchItems.length ? `${parsedBatchItems.length} 条链接` : "0 条链接";
  batchList.innerHTML = "";
  if (!parsedBatchItems.length) {
    batchList.innerHTML = '<div class="batch-empty">粘贴消息后会自动整理链接和赛道</div>';
    return;
  }
  parsedBatchItems.forEach((item) => {
    const row = document.createElement("div");
    row.className = "batch-row";
    row.innerHTML = `
      <div class="batch-link">
        <strong></strong>
        <span></span>
      </div>
      <div class="batch-track"></div>
    `;
    row.querySelector("strong").textContent = shortUrl(item.url);
    row.querySelector(".batch-link span").textContent = item.context || "无标题文字";
    row.querySelector(".batch-track").textContent = batchTrackText(item);
    batchList.appendChild(row);
  });
  if (options.detect !== false) {
    scheduleBatchTrackDetection();
  }
}

function batchItemsForSubmit() {
  if (!parsedBatchItems.length) {
    renderBatchPreview();
  }
  const selectedDouyinIndex = douyinSelect.value || "__auto__";
  return parsedBatchItems.map((item) => ({
    url: item.url,
    expectedTrack: item.expectedTrack || "",
    trackScore: Number(item.trackScore || 0),
    contextText: item.context || "",
    douyinIndex: selectedDouyinIndex === "__auto__" ? "__auto__" : selectedDouyinIndex
  }));
}

function allContentTypes(extraTracks = []) {
  const types = new Set(state && state.answerTypes || []);
  for (const account of accounts()) {
    for (const item of account.douyinAccounts || []) {
      for (const track of douyinTracks(item)) {
        types.add(track);
      }
    }
  }
  const extraList = Array.isArray(extraTracks) ? extraTracks : splitTracks(extraTracks);
  for (const track of extraList) {
    types.add(track);
  }
  return Array.from(types).filter(Boolean);
}

function renderTrackLibrary() {
  if (!trackLibraryList) {
    return;
  }
  const types = allContentTypes();
  trackLibraryList.innerHTML = "";
  if (!types.length) {
    trackLibraryList.innerHTML = '<div class="empty compact-empty">暂无赛道</div>';
    return;
  }
  for (const type of types) {
    const item = document.createElement("span");
    item.className = "track-chip";
    item.textContent = type;
    trackLibraryList.appendChild(item);
  }
}

function renderDouyinTrackPicker(selectedTracks = []) {
  if (!douyinTrackPicker) {
    return;
  }
  const selected = new Set(selectedTracks);
  const types = allContentTypes(selectedTracks);
  douyinTrackPicker.innerHTML = "";
  if (!types.length) {
    douyinTrackPicker.innerHTML = '<div class="empty compact-empty">先在赛道设定里添加赛道</div>';
    return;
  }
  for (const type of types) {
    const label = document.createElement("label");
    label.className = "track-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = type;
    input.checked = selected.has(type);
    const text = document.createElement("span");
    text.textContent = type;
    label.append(input, text);
    douyinTrackPicker.appendChild(label);
  }
}

function clearDouyinEditor() {
  editingDouyinAccountName = "";
  editingDouyinIndex = -1;
  douyinName.value = "";
  douyinId.value = "";
  renderDouyinTrackPicker();
  addDouyinBtn.textContent = "添加抖音号";
  cancelDouyinEditBtn.classList.add("hidden");
  douyinEditStatus.textContent = "抖音账号库";
}

function renderState(preferredName = "") {
  const currentName = resolveAccountName(preferredName || preferredAccountName);
  preferredAccountName = currentName;
  douyinOwnerName = resolveAccountName(douyinOwnerName || currentName);
  if (editingDouyinAccountName && !accountByName(editingDouyinAccountName)) {
    clearDouyinEditor();
  }
  accountCount.textContent = `${accounts().length} 个账号`;
  const visibleTypes = allContentTypes();
  if (typeList) {
    typeList.textContent = visibleTypes.length ? `类型：${visibleTypes.join("、")}` : "暂无类型";
  }
  renderSubmitMode();
  renderTrackLibrary();
  renderTemplateAccountList();
  renderAccountDetails();
  renderDouyinOwnerSelect();
  renderDouyinList();
  renderFillAccountPicker();
  renderMonitorSelectors();
  renderLoginStatus();
}

function renderSubmitMode() {
  if (!manualSubmitMode || !autoSubmitMode) {
    return;
  }
  const autoSubmit = state && state.autoSubmit === true;
  manualSubmitMode.classList.toggle("active", !autoSubmit);
  autoSubmitMode.classList.toggle("active", autoSubmit);
}

async function setSubmitMode(autoSubmit) {
  const result = await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ autoSubmit })
  });
  state.autoSubmit = result.autoSubmit === true;
  renderSubmitMode();
  setPageStatus(state.autoSubmit ? "已切换为全自动" : "已切换为手动提交");
}

function renderAccountDetails() {
  const account = currentAccount();
  const contact = account && account.contact || {};
  const images = account && account.images || {};
  const fillDefaults = account && account.fillDefaults || {};
  if (accountEditStatus) {
    accountEditStatus.textContent = account ? `正在编辑：${account.name}` : "选择一个微信号后编辑填表资料";
  }
  accountNameInput.value = account && account.name || "";
  contactPhone.value = contact.phone || "";
  contactName.value = contact.realName || "";
  contactAlipayAccount.value = contact.alipayAccount || contact.phone || "";
  contactAlipayName.value = contact.alipayName || contact.realName || "";
  contactIdCard.value = contact.idCard || "";
  if (accountReleaseLink) {
    accountReleaseLink.value = fillDefaults.releaseLink || "好";
  }
  if (accountLevel) {
    accountLevel.value = fillDefaults.douyinGroupLevel || "好";
  }
  if (accountGradeScreenshot) {
    accountGradeScreenshot.value = images.screenshot || images.gradeScreenshot || images.postScreenshot || "";
  }

  if (!douyinSelect) {
    return;
  }
  douyinSelect.innerHTML = "";
  const autoOption = document.createElement("option");
  autoOption.value = "__auto__";
  autoOption.textContent = "智能匹配（按每条链接自动选择抖音号）";
  douyinSelect.appendChild(autoOption);
  douyinSelect.value = "__auto__";
}

function renderDouyinOwnerSelect() {
  if (!douyinAccountOwner) {
    return;
  }
  const names = accountNames();
  const owner = selectedDouyinOwner();
  douyinAccountOwner.innerHTML = "";
  if (!names.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "暂无微信号";
    douyinAccountOwner.appendChild(option);
    douyinAccountOwner.disabled = true;
    return;
  }
  douyinAccountOwner.disabled = false;
  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    douyinAccountOwner.appendChild(option);
  }
  douyinAccountOwner.value = owner;
  douyinOwnerName = owner;
}

function renderDouyinList() {
  if (!douyinList) {
    return;
  }
  douyinList.innerHTML = "";
  if (!accounts().length) {
    douyinList.innerHTML = '<div class="empty">暂无微信号</div>';
    return;
  }
  if (editingDouyinAccountName) {
    const editingAccount = accountByName(editingDouyinAccountName);
    const editingItems = editingAccount && editingAccount.douyinAccounts || [];
    if (!editingAccount || editingDouyinIndex >= editingItems.length) {
      clearDouyinEditor();
    } else {
      renderDouyinTrackPicker(douyinTracks(editingItems[editingDouyinIndex]));
    }
  } else {
    renderDouyinTrackPicker();
  }
  for (const account of accounts()) {
    const douyins = account.douyinAccounts || [];
    const group = document.createElement("div");
    group.className = "douyin-account-group";
    const head = document.createElement("div");
    head.className = "douyin-account-head";
    const title = document.createElement("strong");
    const count = document.createElement("span");
    title.textContent = account.name;
    count.textContent = `${douyins.length} 个抖音号`;
    head.append(title, count);
    group.appendChild(head);
    if (!douyins.length) {
      const empty = document.createElement("div");
      empty.className = "empty compact-empty";
      empty.textContent = "暂无抖音号";
      group.appendChild(empty);
      douyinList.appendChild(group);
      continue;
    }
    for (const [index, item] of douyins.entries()) {
      const row = document.createElement("div");
      row.className = "account-row";
      const info = document.createElement("div");
      const name = document.createElement("strong");
      const detail = document.createElement("span");
      const actions = document.createElement("div");
      const editButton = document.createElement("button");
      const removeButton = document.createElement("button");

      actions.className = "account-row-actions";
      name.textContent = item.nickname || "未命名";
      detail.textContent = `${item.douyinId || "无ID"} / ${trackText(item)}`;
      editButton.textContent = "编辑";
      editButton.dataset.editDouyinAccount = account.name;
      editButton.dataset.edit = String(index);
      removeButton.textContent = "删除";
      removeButton.dataset.removeDouyinAccount = account.name;
      removeButton.dataset.remove = String(index);
      removeButton.className = "danger";

      info.appendChild(name);
      info.appendChild(detail);
      actions.appendChild(editButton);
      actions.appendChild(removeButton);
      row.appendChild(info);
      row.appendChild(actions);
      group.appendChild(row);
    }
    douyinList.appendChild(group);
  }
}

async function loadState() {
  state = await api("/api/state");
  renderState(preferredAccountName);
}

function renderMonitorSelectors() {
  if (!monitorAccountSelect || !state) {
    return;
  }
  const config = currentMonitorConfig();
  const sourceById = new Map((config.sources || []).map((source) => [source.id, source]));
  const configuredAccount = (config.windowBindings || [])
    .map((binding) => binding.account || (sourceById.get(binding.sourceId) || {}).account || "")
    .find(Boolean)
    || (config.sources || []).map((source) => source.account || "").find(Boolean)
    || "";
  const previous = monitorAccountSelect.dataset.userSelected === "1"
    ? monitorAccountSelect.value
    : (configuredAccount || monitorAccountSelect.value || resolveAccountName());
  monitorAccountSelect.innerHTML = "";
  for (const account of accounts()) {
    const option = document.createElement("option");
    option.value = account.name;
    option.textContent = account.name;
    monitorAccountSelect.appendChild(option);
  }
  if (accountNames().includes(previous)) {
    monitorAccountSelect.value = previous;
  } else if (resolveAccountName()) {
    monitorAccountSelect.value = resolveAccountName();
  }
  renderMonitorDouyinOptions();
}

function renderMonitorDouyinOptions(selectedValue = "") {
  if (!monitorDouyinSelect) {
    return;
  }
  monitorDouyinSelect.innerHTML = "";
}

function currentMonitorConfig() {
  return monitorState && monitorState.config || {
    enabled: false,
    autoFill: false,
    detectClipboard: true,
    detectWechatWindow: true,
    readMode: "ocr",
    intervalMs: 10000,
    scanBatchSize: 0,
    targetCycleSeconds: 60,
    fillAccounts: [],
    autoFillStartedAt: "",
    sources: [],
    windowBindings: []
  };
}

const monitorReadModes = {
  ocr: {
    label: "Paddle OCR",
    hint: "识别微信窗口画面，优先使用 PaddleOCR。"
  },
  local: {
    label: "微信本地",
    hint: "读取本地消息库；如果数据库加密或密钥未获取，会显示原因。"
  }
};

function monitorReadModeValue(config = currentMonitorConfig()) {
  return monitorReadModes[config.readMode] ? config.readMode : "ocr";
}

function monitorReadModeLabel(value = monitorReadModeValue()) {
  return (monitorReadModes[value] || monitorReadModes.ocr).label;
}

function updateMonitorReadModeHint(value = monitorReadModeValue()) {
  if (monitorReadModeHint) {
    monitorReadModeHint.textContent = (monitorReadModes[value] || monitorReadModes.ocr).hint;
  }
}

function statForBinding(binding) {
  const stats = monitorState && monitorState.bindingStats || {};
  return stats[String(binding && binding.hwnd || "")] || null;
}

function accountNameForBinding(binding, sourcesById = new Map()) {
  const source = sourcesById.get(binding && binding.sourceId);
  return (source && source.account) || (binding && binding.account) || "";
}

function monitorBindingLabel(stat, running) {
  if (!running) {
    return "待开始";
  }
  if (stat && stat.lastError) {
    return "需要确认";
  }
  if (stat && stat.lastNewLinkCount > 0) {
    return `新增 ${stat.lastNewLinkCount} 条`;
  }
  if (stat && stat.lastUrlCount > 0) {
    return "无新链接";
  }
  if (stat && stat.lastTextLength > 80) {
    return "读到聊天内容";
  }
  if (stat && stat.lastScanAt) {
    return "只读到窗口";
  }
  return "等待扫描";
}

function monitorBindingBadgeClass(stat, running) {
  if (stat && stat.lastError) {
    return "bad";
  }
  if (running && stat && (stat.lastUrlCount > 0 || stat.lastTextLength > 80)) {
    return "ok";
  }
  return "warn";
}

function appendLiveLine(parent, label, value) {
  const row = document.createElement("div");
  row.className = "live-line";
  const name = document.createElement("span");
  name.textContent = label;
  const text = document.createElement("strong");
  text.textContent = value || "等待";
  row.append(name, text);
  parent.appendChild(row);
}

function proofMetric(text) {
  const item = document.createElement("span");
  item.textContent = text;
  return item;
}

function renderWindowProof(stat, binding) {
  const proof = document.createElement("div");
  proof.className = "monitor-proof";

  const stages = document.createElement("div");
  stages.className = "monitor-stage-row";
  const hasCapture = Boolean(stat && stat.lastScanAt && !stat.lastError);
  const hasContent = Boolean(stat && (stat.lastTextLength > 80 || stat.lastUrlCount > 0));
  const hasLinks = Boolean(stat && stat.lastUrlCount > 0);
  [
    ["窗口捕获", hasCapture],
    ["内容识别", hasContent],
    ["链接捕捉", hasLinks]
  ].forEach(([label, ok]) => {
    const item = document.createElement("span");
    item.className = ok ? "stage-ok" : "stage-wait";
    item.textContent = label;
    stages.appendChild(item);
  });

  const metrics = document.createElement("div");
  metrics.className = "monitor-proof-metrics";
  metrics.append(
    proofMetric(`扫描 ${Number(stat && stat.scanCount || 0)} 次`),
    proofMetric(`读取 ${Number(stat && stat.lastTextLength || 0)} 字`),
    proofMetric(`变化 ${Number(stat && stat.changeCount || 0)} 次`),
    proofMetric(`可见链接 ${Number(stat && stat.lastUrlCount || 0)} 条`),
    proofMetric(`新增 ${Number(stat && stat.lastNewLinkCount || 0)} 条`)
  );

  const preview = document.createElement("div");
  preview.className = "monitor-preview";
  const previewText = stat && stat.lastPreview ? stat.lastPreview : "";
  if (previewText && hasContent) {
    preview.textContent = `最新识别内容：${previewText}`;
  } else if (previewText) {
    preview.textContent = `目前只读到窗口信息：${previewText}`;
  } else {
    preview.textContent = "还没有读取到窗口内容，点“验证读取”可以立即试一次。";
  }

  proof.append(stages, metrics, preview);

  const image = monitorProofImages[String(binding && binding.hwnd || "")];
  if (image) {
    const imageWrap = document.createElement("div");
    imageWrap.className = "monitor-capture-preview";
    const img = document.createElement("img");
    img.src = image;
    img.alt = "窗口截图预览";
    imageWrap.appendChild(img);
    proof.appendChild(imageWrap);
  }

  const links = Array.isArray(stat && stat.lastNewLinks) ? stat.lastNewLinks : [];
  if (links.length) {
    const linkBox = document.createElement("div");
    linkBox.className = "monitor-link-proof";
    for (const link of links) {
      const row = document.createElement("div");
      row.textContent = link;
      linkBox.appendChild(row);
    }
    proof.appendChild(linkBox);
  }

  return proof;
}

function monitorProcessingText(stat) {
  if (stat && stat.lastUrlCount > 0) {
    if (stat.lastNewLinkCount > 0) {
      return `处理状态：发现 ${stat.lastNewLinkCount} 条新链接，已进入历史记录`;
    }
    return "处理状态：无新链接，旧链接已去重";
  }
  if (stat && stat.lastTextLength > 80) {
    return "处理状态：已读到聊天内容，等待表单链接";
  }
  if (stat && stat.lastScanAt) {
    return "处理状态：窗口已锁定，正在尝试识别聊天内容";
  }
  return "处理状态：等待第一次扫描";
}

function monitorRangeText(stat, running) {
  if (!running) {
    return "已固定，未开始监控";
  }
  if (stat && stat.lastError) {
    return "已固定，需要重新确认窗口";
  }
  if (stat && stat.lastScanAt) {
    return "已纳入监控范围";
  }
  return "已固定，等待心跳";
}

function monitorHistoryItems() {
  return historyItems.filter((item) => item && item.url && item.channel !== "manual");
}

function monitorPendingItems(items = monitorHistoryItems()) {
  return (items || []).filter((item) => displayStatus(item.status) === "待填写");
}

function monitorTodayItems(items = monitorHistoryItems()) {
  const today = startOfLocalDay().getTime();
  const tomorrow = addDays(startOfLocalDay(), 1).getTime();
  return (items || []).filter((item) => {
    const time = historyItemTime(item);
    return time >= today && time < tomorrow;
  });
}

function monitorUniqueLinkCount(items) {
  const links = new Set();
  for (const item of items || []) {
    const key = monitorLinkKey(item && item.url);
    if (key) {
      links.add(key);
    }
  }
  return links.size;
}

function monitorItemLatestTime(item) {
  const times = [item && item.lastSeenAt, item && item.updatedAt, item && item.createdAt]
    .map((value) => {
      const date = new Date(value || "");
      return Number.isNaN(date.getTime()) ? 0 : date.getTime();
    });
  return Math.max(...times, 0);
}

function monitorSessionTime(item) {
  const date = new Date(item && item.monitorSessionAt || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function isCurrentMonitorSessionItem(item, modeStartedAt) {
  if (!modeStartedAt) {
    return true;
  }
  const sessionAt = monitorSessionTime(item);
  if (sessionAt) {
    return sessionAt >= modeStartedAt;
  }
  return historyItemTime(item) >= modeStartedAt;
}

function monitorStatusSummary(items) {
  const statuses = uniqueCleanList((items || []).map((item) => simplifiedStatus(item.status)));
  if (!statuses.length) {
    return "处理中";
  }
  if (statuses.includes("处理中")) {
    return "处理中";
  }
  if (statuses.includes("失败")) {
    return "失败";
  }
  if (statuses.includes("已提交")) {
    return "已提交";
  }
  return "已填过";
}

function monitorGroupedLinks(items) {
  const groups = new Map();
  for (const item of items || []) {
    const url = monitorCanonicalUrl(item && item.url);
    const urlKey = monitorLinkKey(url);
    if (!urlKey) {
      continue;
    }
    const account = item.account || "";
    const track = item.expectedTrack || "";
    const key = [urlKey, account, track].join("|");
    if (!groups.has(key)) {
      groups.set(key, {
        url,
        account,
        expectedTrack: track,
        latestTime: 0,
        sources: new Set(),
        douyinKeys: new Set(),
        items: []
      });
    }
    const group = groups.get(key);
    group.latestTime = Math.max(group.latestTime, monitorItemLatestTime(item));
    group.sources.add(item.source || "微信采集");
    group.items.push(item);
    const douyinKey = item.douyinIndex || item.douyinLabel || item.id;
    if (douyinKey) {
      group.douyinKeys.add(String(douyinKey));
    }
    if (!group.expectedTrack && item.expectedTrack) {
      group.expectedTrack = item.expectedTrack;
    }
  }
  return Array.from(groups.values()).sort((a, b) => b.latestTime - a.latestTime);
}

function monitorItemsForBindings(activeBindings, sources) {
  const config = currentMonitorConfig();
  const modeStartedAt = historyItemTime({ createdAt: config.autoFillStartedAt || "" });
  if (!activeBindings || !activeBindings.length) {
    return [];
  }
  const sourcesById = new Map((sources || []).map((source) => [source.id, source]));
  const scopes = activeBindings.map((binding) => {
    const source = sourcesById.get(binding.sourceId) || null;
    const startDate = new Date(binding.startAfterSetAt || binding.boundAt || "");
    const ignoredUrls = new Set((binding.ignoredUrls || []).map(monitorLinkKey).filter(Boolean));
    return {
      account: accountNameForBinding(binding, sourcesById),
      names: new Set([source && source.name, binding.title].filter(Boolean)),
      startAt: Number.isNaN(startDate.getTime()) ? 0 : startDate.getTime(),
      ignoredUrls
    };
  });
  return monitorHistoryItems().filter((item) => scopes.some((scope) => {
    const accountMatches = !scope.account || item.account === scope.account;
    const sourceMatches = !scope.names.size || scope.names.has(item.source || "");
    const itemTime = historyItemTime(item);
    const sessionOrItemTime = monitorSessionTime(item) || itemTime;
    const afterStart = !scope.startAt || sessionOrItemTime >= scope.startAt;
    const afterModeStart = isCurrentMonitorSessionItem(item, modeStartedAt);
    const notIgnored = !scope.ignoredUrls.has(monitorLinkKey(item.url));
    return accountMatches && sourceMatches && afterStart && afterModeStart && notIgnored;
  }));
}

function trackMatchesForUi(track, candidateTrack) {
  if (!track || !candidateTrack) {
    return false;
  }
  const left = compactForScore(track);
  const right = compactForScore(candidateTrack);
  return left === right || scoreTrack(track, candidateTrack) > 0 || scoreTrack(candidateTrack, track) > 0;
}

function matchedDouyinCount(accountName, track) {
  const account = accountByName(accountName);
  if (!account || !track) {
    return 0;
  }
  return (account.douyinAccounts || [])
    .filter((douyin) => douyinTracks(douyin).some((item) => trackMatchesForUi(track, item)))
    .length;
}

function eventUrls(event) {
  return Array.isArray(event && event.urls) && event.urls.length
    ? event.urls
    : Array.isArray(event && event.candidateUrls) ? event.candidateUrls : [];
}

function setMonitorMetric(element, value) {
  if (element) {
    element.textContent = String(value);
  }
}

function renderMonitorLivePanel(config, enabledSources, activeBindings, activeMonitorItems) {
  if (!monitorLiveStatus) {
    return;
  }
  monitorLiveStatus.innerHTML = "";
  if (!activeBindings.length) {
    monitorLiveStatus.textContent = "还没有固定窗口。点“管理监控窗口”添加微信独立聊天窗口。";
    return;
  }
  if (monitorState && monitorState.lastError) {
    monitorLiveStatus.textContent = `检测异常：${monitorState.lastError}`;
    return;
  }

  const running = Boolean(monitorState && monitorState.running);
  const lastTick = formatMonitorTime(monitorState && monitorState.lastTickAt);
  const lastFound = formatMonitorTime(monitorState && monitorState.lastFoundAt);

  const overview = document.createElement("div");
  overview.className = "live-overview";
  const title = document.createElement("strong");
  title.textContent = running ? "监控台运行中" : "监控台已暂停";
  const meta = document.createElement("span");
  const pendingCount = monitorUniqueLinkCount(monitorPendingItems(activeMonitorItems));
  meta.textContent = `${activeBindings.length} 个窗口${lastTick ? ` · 最近扫描 ${lastTick}` : ""}${lastFound ? ` · 最近捕捉 ${lastFound}` : ""} · 待处理 ${pendingCount} 条`;
  overview.append(title, meta);
  monitorLiveStatus.appendChild(overview);
}

function renderMonitorRecentEvents(activeBindings, sources) {
  if (!monitorSourceList) {
    return;
  }
  const groups = monitorGroupedLinks(monitorItemsForBindings(activeBindings, sources)).slice(0, 8);
  monitorSourceList.innerHTML = "";
  if (!groups.length) {
    monitorSourceList.innerHTML = '<div class="empty">暂无新采集</div>';
    return;
  }
  for (const group of groups) {
    const row = document.createElement("div");
    row.className = "monitor-result-row";
    const sourceNames = Array.from(group.sources).filter(Boolean);
    const matchedCount = Math.max(
      group.douyinKeys.size,
      matchedDouyinCount(group.account, group.expectedTrack)
    );
    row.innerHTML = `
      <div class="monitor-result-main">
        <strong></strong>
        <span></span>
      </div>
      <div class="monitor-result-state"></div>
    `;
    row.querySelector("strong").textContent = sourceNames.length > 1
      ? `${sourceNames[0]}等 ${sourceNames.length} 个来源`
      : sourceNames[0] || "微信采集";
    row.querySelector("span").textContent = [
      group.latestTime ? formatTime(group.latestTime) : "",
      group.account || "",
      shortUrl(group.url),
      group.account && group.expectedTrack ? `赛道：${group.expectedTrack}` : "赛道填表时判断",
      matchedCount ? `匹配 ${matchedCount} 个抖音号` : ""
    ].filter(Boolean).join(" · ");
    row.querySelector(".monitor-result-state").textContent = monitorStatusSummary(group.items);
    monitorSourceList.appendChild(row);
  }
}

function renderMonitorWindowStatus(activeBindings, sources) {
  if (!monitorProbeResult) {
    return;
  }
  const sourcesById = new Map((sources || []).map((source) => [source.id, source]));
  const rows = activeBindings.map((binding) => {
    const source = sourcesById.get(binding.sourceId) || null;
    const stat = statForBinding(binding);
    return { binding, source, stat };
  }).sort((a, b) => Number(Boolean(b.stat && b.stat.lastError)) - Number(Boolean(a.stat && a.stat.lastError)));

  monitorProbeResult.classList.remove("hidden");
  monitorProbeResult.innerHTML = "";
  if (!rows.length) {
    monitorProbeResult.innerHTML = '<div class="empty">暂无固定窗口</div>';
    return;
  }
  const errorRows = rows.filter((row) => row.stat && row.stat.lastError);
  const shownRows = (errorRows.length ? errorRows : rows).slice(0, 6);
  for (const item of shownRows) {
    const row = document.createElement("div");
    row.className = `monitor-alert-row${item.stat && item.stat.lastError ? " bad" : ""}`;
    const title = item.binding.title || item.source && item.source.name || "微信窗口";
    const status = item.stat && item.stat.lastError
      ? item.stat.lastError
      : item.stat && item.stat.lastScanAt
        ? `正常 · 最近扫描 ${formatMonitorTime(item.stat.lastScanAt)}`
        : "等待心跳";
    row.innerHTML = '<strong></strong><span></span>';
    row.querySelector("strong").textContent = title;
    row.querySelector("span").textContent = `${accountNameForBinding(item.binding, sourcesById) || "未绑定"} · ${status}`;
    monitorProbeResult.appendChild(row);
  }
}

function renderMonitor() {
  const config = currentMonitorConfig();
  const sources = config.sources || [];
  const enabledSources = sources.filter((source) => source.enabled !== false);
  const activeBindings = (config.windowBindings || []).filter((binding) => binding.enabled !== false);
  const activeMonitorItems = monitorItemsForBindings(activeBindings, sources);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const running = Boolean(monitorState && monitorState.running);
  monitorStatus.textContent = running ? "运行中" : "已暂停";
  monitorStatus.className = running ? "state-ok" : "state-muted";
  setPageStatus(running ? "监控运行中" : "就绪");
  monitorWechatWindow.checked = config.detectWechatWindow !== false;
  monitorClipboard.checked = config.detectClipboard !== false;
  if (monitorReadMode) {
    monitorReadMode.value = monitorReadModeValue(config);
    updateMonitorReadModeHint(monitorReadMode.value);
  }
  if (monitorAutoFill) {
    monitorAutoFill.checked = false;
  }
  if (startMonitorBtn) {
    startMonitorBtn.classList.toggle("hidden", running);
  }
  if (stopMonitorBtn) {
    stopMonitorBtn.classList.toggle("hidden", !running);
  }
  if (monitorSummary) {
    const runningText = monitorState && monitorState.running ? " · 正在检测" : "";
    const scanPlan = monitorState && monitorState.scanPlan || {};
    const batchSize = scanPlan.batchSize || config.scanBatchSize || 1;
    const intervalSeconds = Math.max(5, Number(scanPlan.intervalMs || config.intervalMs || 10000) / 1000);
    const windowSeconds = scanPlan.estimatedCycleSeconds || (activeBindings.length
      ? Math.ceil(activeBindings.length / Math.max(1, batchSize)) * intervalSeconds
      : 0);
    const batchText = activeBindings.length > 2
      ? ` · ${scanPlan.mode === "manual" ? "固定" : "智能"}扫描 · 单窗约 ${windowSeconds.toFixed(0)} 秒`
      : "";
    monitorSummary.textContent = `${activeBindings.length} 个监控窗口 · ${monitorReadModeLabel(monitorReadModeValue(config))}${batchText}${runningText}`;
  }
  setMonitorMetric(monitorMetricAccounts, activeBindings.length);
  setMonitorMetric(monitorMetricWindows, activeBindings.length);
  setMonitorMetric(monitorMetricPending, monitorUniqueLinkCount(monitorPendingItems(activeMonitorItems)));
  setMonitorMetric(monitorMetricToday, monitorUniqueLinkCount(monitorTodayItems(activeMonitorItems)));
  renderMonitorLivePanel(config, enabledSources, activeBindings, activeMonitorItems);
  renderMonitorRecentEvents(activeBindings, sources);
  renderMonitorWindowStatus(activeBindings, sources);
  renderMonitorAutoUseState();
}

function getDouyinLabelForSource(source) {
  if (source && source.douyinIndex === "__auto__") {
    return "智能匹配抖音号/赛道";
  }
  const account = accountByName(source.account);
  const index = Number(source.douyinIndex);
  const douyin = account && Number.isInteger(index) ? (account.douyinAccounts || [])[index] : null;
  if (!douyin) {
    return "";
  }
  return `${douyin.nickname || "未命名"} / ${trackText(douyin)}`;
}

function nextMonitorConfig(patch = {}) {
  const config = currentMonitorConfig();
  return {
    ...config,
    detectWechatWindow: monitorWechatWindow.checked,
    detectClipboard: monitorClipboard.checked,
    readMode: monitorReadMode ? monitorReadMode.value : monitorReadModeValue(config),
    autoFill: config.autoFill === true,
    fillAccounts: config.fillAccounts || [],
    autoFillStartedAt: config.autoFillStartedAt || "",
    sources: config.sources || [],
    windowBindings: config.windowBindings || [],
    ...patch
  };
}

async function loadMonitor() {
  monitorState = await api("/api/monitor");
  renderFillAccountPicker();
  renderMonitorSelectors();
  renderMonitor();
}

async function saveMonitorConfig(patch = {}) {
  monitorState = await api("/api/monitor", {
    method: "POST",
    body: JSON.stringify(nextMonitorConfig(patch))
  });
  renderMonitor();
}

async function saveMonitorFillAccounts() {
  if (!monitorState) {
    return;
  }
  await saveMonitorConfig({ fillAccounts: selectedFillAccounts() });
  renderMonitorImportSummary();
}

async function addMonitorSource() {
  const name = monitorSourceName.value.trim();
  if (!name) {
    alert("填写群聊或好友名称");
    return;
  }
  if (!monitorAccountSelect.value) {
    alert("选择账号");
    return;
  }
  const config = currentMonitorConfig();
  const sources = [
    ...(config.sources || []),
    {
      id: `source-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      account: monitorAccountSelect.value,
      douyinIndex: "__auto__",
      enabled: true
    }
  ];
  monitorSourceName.value = "";
  await saveMonitorConfig({ sources });
  setPageStatus("已添加监控对象");
}

function windowTitleForMonitor(windowItem, index = 0) {
  const title = String(windowItem && windowItem.title || "").trim();
  if (title && title !== "微信") {
    return title;
  }
  return `微信窗口 ${index + 1}`;
}

function renderProbeResult(result) {
  if (!monitorProbeResult) {
    return;
  }
  latestMonitorProbe = result;
  const windows = result.windows || [];
  const config = currentMonitorConfig();
  const bindings = config.windowBindings || [];
  const currentAccount = monitorAccountSelect.value || resolveAccountName() || "";
  const fixedCount = windows.filter((item) => bindings.some((binding) => String(binding.hwnd) === String(item.hwnd))).length;
  monitorProbeResult.classList.remove("hidden");
  monitorProbeResult.innerHTML = "";

  const head = document.createElement("div");
  head.className = "probe-head";
  const title = document.createElement("strong");
  title.textContent = "可添加窗口";
  const summary = document.createElement("span");
  summary.textContent = `${windows.length} 个微信窗口 · ${fixedCount} 个已固定`;
  head.append(title, summary);
  monitorProbeResult.appendChild(head);

  if (!windows.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "没有识别到打开的微信窗口。";
    monitorProbeResult.appendChild(empty);
    return;
  }

  for (const [index, item] of windows.entries()) {
    const existingBinding = bindings.find((binding) => String(binding.hwnd) === String(item.hwnd));
    const linkCount = (item.urls || []).length;
    const row = document.createElement("div");
    row.className = existingBinding ? "probe-row fixed" : "probe-row";
    const top = document.createElement("div");
    top.className = "probe-row-top";
    const name = document.createElement("strong");
    name.textContent = windowTitleForMonitor(item, index);
    const badge = document.createElement("span");
    badge.className = existingBinding ? "badge ok" : "badge";
    badge.textContent = existingBinding ? "已固定" : "可添加";
    top.append(name, badge);

    const meta = document.createElement("div");
    meta.className = "probe-urls";
    meta.textContent = `${item.process || "微信"} · ${linkCount ? `当前可见 ${linkCount} 条表单链接` : "等待新链接"}`;

    const actions = document.createElement("div");
    actions.className = "probe-actions inline";
    const focusButton = document.createElement("button");
    focusButton.type = "button";
    focusButton.textContent = "定位";
    focusButton.dataset.focusWindow = item.hwnd;
    actions.appendChild(focusButton);
    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "primary compact-primary";
    addButton.textContent = existingBinding ? "更新并验证" : `添加到${currentAccount || "当前微信号"}并验证`;
    addButton.dataset.addWindowToAccount = item.hwnd;
    actions.appendChild(addButton);

    row.append(top, meta, actions);
    monitorProbeResult.appendChild(row);
  }
}

function sourceOptionLabel(source) {
  return `${source.account || "未绑定"} · ${source.name}`;
}

function windowBindingKey(windowItem) {
  return String(windowItem && windowItem.hwnd || "");
}

function existingBindingForWindow(windowItem) {
  const key = windowBindingKey(windowItem);
  return (currentMonitorConfig().windowBindings || []).find((binding) => String(binding.hwnd || "") === key) || null;
}

function createWindowBindingControl(windowItem) {
  const config = currentMonitorConfig();
  const sources = (config.sources || []).filter((source) => source.enabled !== false);
  const binding = existingBindingForWindow(windowItem);
  const wrap = document.createElement("div");
  wrap.className = "probe-bind";

  const label = document.createElement("span");
  label.textContent = "绑定到";

  const select = document.createElement("select");
  select.dataset.windowBinding = windowBindingKey(windowItem);
  select.dataset.windowPid = String(windowItem.pid || "");
  select.dataset.windowTitle = String(windowItem.title || "微信窗口");

  const emptyOption = document.createElement("option");
  emptyOption.value = "";
  emptyOption.textContent = "不绑定";
  select.appendChild(emptyOption);

  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source.id;
    option.textContent = sourceOptionLabel(source);
    select.appendChild(option);
  }

  if (binding && sources.some((source) => source.id === binding.sourceId)) {
    select.value = binding.sourceId;
  } else if (windowItem.bindingSource) {
    select.value = windowItem.bindingSource.id;
  } else if (sources.length === 1 && (windowItem.urls || []).length) {
    select.value = sources[0].id;
  }

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "primary compact-primary";
  startButton.textContent = "绑定并开始监控";
  startButton.dataset.bindStartWindow = windowBindingKey(windowItem);

  wrap.append(label, select, startButton);
  return wrap;
}

function buildBindingFromSelect(select, sources) {
  const source = sources.find((item) => item.id === select.value);
  if (!source) {
    return null;
  }
  return {
    id: `binding-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    hwnd: select.dataset.windowBinding,
    pid: select.dataset.windowPid || "",
    title: select.dataset.windowTitle || "微信窗口",
    sourceId: source.id,
    account: source.account || "",
    enabled: true,
    boundAt: new Date().toISOString()
  };
}

async function saveWindowBindingsFromProbe() {
  if (!latestMonitorProbe || !(latestMonitorProbe.windows || []).length) {
    alert("先点一次识别");
    return;
  }
  const config = currentMonitorConfig();
  const sources = config.sources || [];
  const currentKeys = new Set((latestMonitorProbe.windows || []).map(windowBindingKey).filter(Boolean));
  const kept = (config.windowBindings || []).filter((binding) => !currentKeys.has(String(binding.hwnd || "")));
  const selected = [];

  for (const select of Array.from(document.querySelectorAll("[data-window-binding]"))) {
    const binding = buildBindingFromSelect(select, sources);
    if (!binding) {
      continue;
    }
    selected.push(binding);
  }

  await saveMonitorConfig({ windowBindings: [...kept, ...selected] });
  setPageStatus(`已保存 ${selected.length} 个窗口绑定`);
  renderProbeResult({
    ...latestMonitorProbe,
    windows: (latestMonitorProbe.windows || []).map((windowItem) => {
      const binding = selected.find((item) => item.hwnd === windowBindingKey(windowItem));
      const source = binding ? sources.find((item) => item.id === binding.sourceId) : null;
      return source ? { ...windowItem, matchedSource: source, bindingSource: source } : windowItem;
    })
  });
}

async function bindWindowAndStart(hwnd) {
  const config = currentMonitorConfig();
  const sources = config.sources || [];
  const select = Array.from(document.querySelectorAll("[data-window-binding]"))
    .find((item) => item.dataset.windowBinding === String(hwnd || ""));
  if (!select) {
    alert("先识别到这个微信窗口");
    return;
  }
  const binding = buildBindingFromSelect(select, sources);
  if (!binding) {
    alert("先选择要绑定的监控对象");
    return;
  }

  monitorState = await api("/api/monitor", {
    method: "POST",
    body: JSON.stringify(nextMonitorConfig({
      enabled: false,
      windowBindings: [binding]
    }))
  });
  monitorState = await api("/api/monitor/start", { method: "POST" });
  renderProbeResult({
    ...latestMonitorProbe,
    windows: (latestMonitorProbe.windows || []).map((windowItem) => {
      const source = sources.find((item) => item.id === binding.sourceId);
      return windowBindingKey(windowItem) === binding.hwnd
        ? { ...windowItem, matchedSource: source, bindingSource: source }
        : windowItem;
    })
  });
  renderMonitor();
  startMonitorPolling();
  setPageStatus("已绑定并开始监控");
}

async function addWindowToSelectedAccount(hwnd) {
  const accountName = monitorAccountSelect.value || resolveAccountName();
  if (!accountName) {
    alert("先选择微信号");
    return;
  }
  const windowItem = latestMonitorProbe && (latestMonitorProbe.windows || [])
    .find((item) => String(item.hwnd) === String(hwnd));
  if (!windowItem) {
    alert("先识别到这个微信窗口");
    return;
  }

  const config = currentMonitorConfig();
  const title = windowTitleForMonitor(windowItem, 0);
  const existingSource = (config.sources || []).find((source) => (
    source.enabled !== false
    && source.account === accountName
    && source.name === title
  ));
  const source = existingSource || {
    id: `window-source-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: title,
    account: accountName,
    douyinIndex: "__auto__",
    enabled: true
  };
  const sources = existingSource
    ? (config.sources || []).map((item) => item.id === existingSource.id
      ? { ...item, douyinIndex: item.douyinIndex || "__auto__" }
      : item)
    : [...(config.sources || []), source];
  const nextBindings = (config.windowBindings || [])
    .filter((binding) => String(binding.hwnd) !== String(hwnd));
  nextBindings.push({
    id: `binding-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    hwnd: String(windowItem.hwnd || ""),
    pid: String(windowItem.pid || ""),
    title,
    sourceId: source.id,
    account: accountName,
    enabled: true,
    boundAt: new Date().toISOString()
  });

  monitorState = await api("/api/monitor", {
    method: "POST",
    body: JSON.stringify(nextMonitorConfig({
      enabled: true,
      detectWechatWindow: true,
      sources,
      windowBindings: nextBindings
    }))
  });
  monitorState = await api("/api/monitor/start", { method: "POST" });
  renderMonitor();
  renderProbeResult(latestMonitorProbe);
  startMonitorPolling();
  setPageStatus(`已添加到监控范围：${title}`);
  await verifyMonitorWindow(windowItem.hwnd);
}

async function probeMonitor() {
  setPageStatus("正在识别微信窗口");
  await saveMonitorConfig();
  const result = await api("/api/monitor/probe", { method: "POST" });
  renderProbeResult(result);
  await loadHistory();
  setPageStatus("识别完成");
}

async function focusMonitorWindow(hwnd) {
  if (!hwnd) {
    return;
  }
  await api("/api/monitor/focus-window", {
    method: "POST",
    body: JSON.stringify({ hwnd })
  });
  setPageStatus("已定位微信窗口");
}

async function verifyMonitorWindow(hwnd) {
  if (!hwnd) {
    return;
  }
  setPageStatus("正在验证读取");
  const result = await api("/api/monitor/read-window", {
    method: "POST",
    body: JSON.stringify({ hwnd })
  });
  if (result.image) {
    monitorProofImages[String(hwnd)] = result.image;
  }
  await Promise.all([
    loadMonitor(),
    loadHistory()
  ]);
  if (!result.ok) {
    setPageStatus(result.error || "读取失败");
    return;
  }
  setPageStatus(`已读取 ${result.textLength || 0} 字，链接 ${(result.urls || []).length} 条`);
}

async function removeMonitorSource(id) {
  const config = currentMonitorConfig();
  await saveMonitorConfig({
    sources: (config.sources || []).filter((source) => source.id !== id),
    windowBindings: (config.windowBindings || []).filter((binding) => binding.sourceId !== id)
  });
}

async function removeMonitorWindow(hwnd) {
  const config = currentMonitorConfig();
  const removed = (config.windowBindings || []).find((binding) => String(binding.hwnd) === String(hwnd));
  const windowBindings = (config.windowBindings || []).filter((binding) => String(binding.hwnd) !== String(hwnd));
  const usedSourceIds = new Set(windowBindings.map((binding) => binding.sourceId));
  const sources = (config.sources || []).filter((source) => (
    usedSourceIds.has(source.id)
    || !removed
    || source.id !== removed.sourceId
    || !String(source.id || "").startsWith("window-source-")
  ));
  await saveMonitorConfig({ sources, windowBindings });
  setPageStatus("已移除固定窗口");
}

async function startMonitor() {
  const config = currentMonitorConfig();
  const sources = (config.sources || []).filter((source) => source.enabled !== false);
  const bindings = (config.windowBindings || []).filter((binding) => binding.enabled !== false);
  if (!sources.length) {
    alert("先识别窗口，并添加到一个微信号下面。");
    return;
  }
  if (monitorWechatWindow.checked && !bindings.length) {
    alert("先点“识别可添加窗口”，把微信独立窗口添加到监控台。");
    return;
  }
  monitorState = await api("/api/monitor", {
    method: "POST",
    body: JSON.stringify(nextMonitorConfig({ enabled: false }))
  });
  monitorState = await api("/api/monitor/start", { method: "POST" });
  renderMonitor();
  startMonitorPolling();
}

async function stopMonitor() {
  monitorState = await api("/api/monitor/stop", { method: "POST" });
  renderMonitor();
}

function startMonitorPolling() {
  if (monitorPollTimer) {
    clearInterval(monitorPollTimer);
  }
  monitorPollTimer = setInterval(() => {
    Promise.all([
      loadMonitor().catch(() => {}),
      loadHistory().catch(() => {})
    ]);
  }, 1200);
}

async function addAccount() {
  const name = newAccountName.value.trim();
  if (!name) {
    alert("先填微信名称，例如：微信2");
    return;
  }
  if (accountByName(name)) {
    alert("这个微信号已经存在，点上方列表里的“编辑”即可修改。");
    return;
  }
  state.accounts = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({
      name,
      browser: "edge",
      mode: "managed",
      contact: { phone: "", realName: "", alipayAccount: "", alipayName: "", idCard: "" },
      fillDefaults: { releaseLink: "好", douyinGroupLevel: "好" },
      images: { screenshot: "", gradeScreenshot: "", postScreenshot: "" },
      douyinAccounts: []
    })
  });
  newAccountName.value = "";
  preferredAccountName = name;
  douyinOwnerName = name;
  renderState(name);
  setPageStatus(`已新增微信号：${name}`);
  setLog(`已新增微信号：${name}`);
}

async function renameCurrentAccount() {
  const account = currentAccount();
  if (!account) {
    alert("先选择账号");
    return;
  }
  const newName = accountNameInput.value.trim();
  if (!newName) {
    alert("微信名称不能为空");
    return;
  }
  if (newName === account.name) {
    setLog("微信名称没有变化。");
    return;
  }

  state.accounts = await api("/api/accounts/rename", {
    method: "POST",
    body: JSON.stringify({ oldName: account.name, newName })
  });
  if (douyinOwnerName === account.name) {
    douyinOwnerName = newName;
  }
  if (editingDouyinAccountName === account.name) {
    editingDouyinAccountName = newName;
  }
  preferredAccountName = newName;
  renderState(newName);
  setLog(`微信名称已改为：${newName}`);
}

async function saveCurrentAccount() {
  const account = currentAccount();
  if (!account) {
    alert("先选择账号");
    return;
  }
  const requestedName = accountNameInput.value.trim();
  if (!requestedName) {
    alert("微信名称不能为空");
    return;
  }
  let saveName = account.name;
  if (requestedName !== account.name) {
    state.accounts = await api("/api/accounts/rename", {
      method: "POST",
      body: JSON.stringify({ oldName: account.name, newName: requestedName })
    });
    if (douyinOwnerName === account.name) {
      douyinOwnerName = requestedName;
    }
    if (editingDouyinAccountName === account.name) {
      editingDouyinAccountName = requestedName;
    }
    preferredAccountName = requestedName;
    saveName = requestedName;
  }
  const latestAccount = accountByName(saveName) || { ...account, name: saveName };
  const phone = contactPhone.value.trim();
  const realName = contactName.value.trim();
  const alipayAccount = contactAlipayAccount.value.trim() || phone;
  const alipayName = contactAlipayName.value.trim() || realName;
  const idCard = contactIdCard.value.trim();
  const releaseLink = accountReleaseLink ? accountReleaseLink.value.trim() || "好" : "好";
  const douyinGroupLevel = accountLevel ? accountLevel.value.trim() || "好" : "好";
  const gradeScreenshot = accountGradeScreenshot ? accountGradeScreenshot.value.trim() : "";
  state.accounts = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({
      ...latestAccount,
      contact: {
        ...(latestAccount.contact || {}),
        phone,
        realName,
        alipayAccount,
        alipayName,
        idCard
      },
      fillDefaults: {
        ...(latestAccount.fillDefaults || {}),
        releaseLink,
        douyinGroupLevel
      },
      images: {
        ...(latestAccount.images || {}),
        screenshot: gradeScreenshot,
        gradeScreenshot,
        postScreenshot: gradeScreenshot
      }
    })
  });
  renderState(saveName);
  setPageStatus("文档模板已保存");
  setLog("文档模板已保存。");
}

async function addTrack() {
  const tracks = splitTracks(newTrackName && newTrackName.value || "");
  if (!tracks.length) {
    alert("先填写赛道名称");
    return;
  }
  const nextTracks = uniqueCleanList([...allContentTypes(), ...tracks]);
  const result = await api("/api/tracks", {
    method: "POST",
    body: JSON.stringify({ tracks: nextTracks })
  });
  const selectedTracks = uniqueCleanList([...chosenTracks(), ...tracks]);
  state.answerTypes = result.answerTypes || result.tracks || nextTracks;
  if (newTrackName) {
    newTrackName.value = "";
  }
  renderTrackLibrary();
  renderDouyinTrackPicker(selectedTracks);
  if (typeList) {
    typeList.textContent = allContentTypes().length ? `类型：${allContentTypes().join("、")}` : "暂无类型";
  }
  setPageStatus(`已添加赛道：${tracks.join("、")}`);
}

async function pickGradeScreenshot() {
  if (!currentAccount()) {
    alert("先选择微信号");
    return;
  }
  const result = await api("/api/pick-path", {
    method: "POST",
    body: JSON.stringify({
      type: "file",
      title: "选择这个微信号的截图",
      filter: "图片文件|*.png;*.jpg;*.jpeg;*.webp;*.bmp|所有文件|*.*"
    })
  });
  if (result.path && accountGradeScreenshot) {
    accountGradeScreenshot.value = result.path;
  }
}

function chosenTracks() {
  if (!douyinTrackPicker) {
    return [];
  }
  return uniqueCleanList(Array.from(douyinTrackPicker.querySelectorAll("input[type='checkbox']:checked"))
    .map((input) => input.value));
}

function editDouyin(accountName, index) {
  const account = accountByName(accountName);
  const item = account && (account.douyinAccounts || [])[index];
  if (!item) {
    return;
  }
  douyinOwnerName = account.name;
  editingDouyinAccountName = account.name;
  editingDouyinIndex = index;
  renderDouyinOwnerSelect();
  douyinName.value = item.nickname || "";
  douyinId.value = item.douyinId || "";
  const tracks = douyinTracks(item);
  renderDouyinTrackPicker(tracks);
  addDouyinBtn.textContent = "保存修改";
  cancelDouyinEditBtn.classList.remove("hidden");
  douyinEditStatus.textContent = `正在编辑：${item.nickname || "未命名"}`;
}

async function saveDouyin() {
  const ownerName = douyinAccountOwner && douyinAccountOwner.value || selectedDouyinOwner();
  const account = accountByName(ownerName);
  if (!account) {
    alert("先选择归属微信号");
    return;
  }
  const tracks = chosenTracks();
  const previousAccount = accountByName(editingDouyinAccountName);
  const previousItems = previousAccount && previousAccount.douyinAccounts || [];
  const previous = editingDouyinIndex >= 0 && editingDouyinIndex < previousItems.length
    ? previousItems[editingDouyinIndex]
    : {};
  const next = {
    ...previous,
    nickname: douyinName.value.trim(),
    douyinId: douyinId.value.trim(),
    contentType: tracks[0] || "",
    tracks
  };
  if (!next.nickname || !next.douyinId) {
    alert("抖音昵称和抖音ID都要填");
    return;
  }
  if (!next.tracks.length) {
    alert("请选择或填写至少一个赛道");
    return;
  }

  let nextAccount = account;
  let douyinAccounts = [...(account.douyinAccounts || [])];
  const movingFromOtherAccount = previousAccount && previousAccount.name !== account.name;
  if (editingDouyinIndex >= 0 && !movingFromOtherAccount && editingDouyinIndex < douyinAccounts.length) {
    douyinAccounts[editingDouyinIndex] = next;
  } else {
    if (movingFromOtherAccount) {
      const oldItems = previousItems.filter((_, itemIndex) => itemIndex !== editingDouyinIndex);
      state.accounts = await api("/api/accounts", {
        method: "POST",
        body: JSON.stringify({ ...previousAccount, douyinAccounts: oldItems })
      });
      nextAccount = accountByName(account.name) || account;
      douyinAccounts = [...(nextAccount.douyinAccounts || [])];
    }
    douyinAccounts.push(next);
  }
  state.accounts = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ ...nextAccount, douyinAccounts })
  });
  douyinOwnerName = account.name;
  clearDouyinEditor();
  renderState(preferredAccountName);
  setLog("抖音号资料已保存。");
}

async function removeDouyin(accountName, index) {
  const account = accountByName(accountName);
  if (!account) {
    return;
  }
  const douyinAccounts = (account.douyinAccounts || []).filter((_, itemIndex) => itemIndex !== index);
  state.accounts = await api("/api/accounts", {
    method: "POST",
    body: JSON.stringify({ ...account, douyinAccounts })
  });
  douyinOwnerName = account.name;
  clearDouyinEditor();
  renderState(preferredAccountName);
}

async function rememberSelectedAccount() {
  const name = selectedAccount();
  preferredAccountName = name;
  renderTemplateAccountList();
  renderAccountDetails();
  renderDouyinOwnerSelect();
  renderDouyinList();
  renderFillAccountPicker();
  renderMonitorSelectors();
  renderMonitorImportSummary();
  if (!name) {
    return;
  }
  state.accounts = await api("/api/default-account", {
    method: "POST",
    body: JSON.stringify({ name })
  });
}

async function loadHistory() {
  const data = await api("/api/history");
  historyItems = data.items || [];
  renderHistory();
  if (monitorState) {
    renderMonitor();
  }
}

function renderHistory() {
  renderMonitorImportSummary();
  const timeItems = primaryHistoryItems(historyTimeFilteredItems());
  const visibleItems = primaryHistoryItems(filteredHistoryItems());
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / historyPageSize));
  historyPage = Math.min(Math.max(historyPage, 1), pageCount);
  const pageStart = (historyPage - 1) * historyPageSize;
  const pageItems = visibleItems.slice(pageStart, pageStart + historyPageSize);
  renderHistoryFilterState(visibleItems.length, timeItems.length);
  if (historyQuickSummary) {
    historyQuickSummary.classList.toggle("hidden", historyTypeFilter !== "all");
  }
  if (historyTypeFilter === "all") {
    renderHistoryQuickSummary(timeItems);
  }
  renderHistoryPager(visibleItems.length, pageCount);
  historyList.innerHTML = "";
  if (!historyItems.length) {
    historyList.innerHTML = '<div class="empty">暂无记录</div>';
    return;
  }
  if (!visibleItems.length) {
    historyList.innerHTML = historyTypeFilter === "submitted"
      ? '<div class="empty">当前时间范围暂无成功记录</div>'
      : '<div class="empty">当前筛选暂无记录</div>';
    return;
  }

  for (const item of pageItems) {
    const row = document.createElement("div");
    const status = displayStatus(item.status);
    const badgeStatus = simplifiedStatus(status);
    row.className = `history-row history-row-${historyStatusBucket(item)}`;
    const id = formIdFromUrl(item.url);
    const message = cleanHistoryMessage(item.message);
    const source = item.source || (item.channel === "manual" ? "手动添加" : "监控采集");
    const timeText = formatTime(item.filledAt || item.updatedAt || item.createdAt);
    row.innerHTML = `
      <div class="history-status">
        <span class="badge"></span>
        <time></time>
      </div>
      <div class="history-main">
        <div class="history-title-row">
          <strong></strong>
          <span class="history-form-id hidden"></span>
        </div>
        <div class="history-fields">
          <span><b>微信</b><em data-field="account"></em></span>
          <span><b>抖音</b><em data-field="douyin"></em></span>
          <span><b>赛道</b><em data-field="track"></em></span>
        </div>
        <button class="history-url" data-open-history-url="" type="button"></button>
        <div class="history-note hidden"></div>
      </div>
      <div class="history-actions">
        <button data-fill-history="${item.id}" type="button">填表</button>
        <button data-open-history-shot="" type="button">检查截图</button>
        <button data-submit-history="${item.id}" type="button">标记提交</button>
      </div>
    `;
    const badge = row.querySelector(".badge");
    badge.className = `badge ${statusClass(badgeStatus)}`;
    badge.textContent = badgeStatus;
    row.querySelector("time").textContent = timeText || "--";
    row.querySelector("strong").textContent = source;
    const formId = row.querySelector(".history-form-id");
    formId.textContent = id ? `表单 ${id.slice(-8)}` : "表单链接";
    formId.classList.toggle("hidden", historyTypeFilter !== "all");
    row.querySelector("[data-field='account']").textContent = item.account || "未分配";
    row.querySelector("[data-field='douyin']").textContent = douyinShortText(item.douyinLabel);
    row.querySelector("[data-field='track']").textContent = item.expectedTrack || "待判断";
    const urlButton = row.querySelector("[data-open-history-url]");
    urlButton.dataset.openHistoryUrl = item.url || "";
    urlButton.textContent = shortUrl(item.url);
    const note = row.querySelector(".history-note");
    if (message) {
      note.textContent = message;
      note.classList.remove("hidden");
    }
    const fillButton = row.querySelector("[data-fill-history]");
    const shotButton = row.querySelector("[data-open-history-shot]");
    const submitButton = row.querySelector("[data-submit-history]");
    const canFillHistory = status === "待填写" && Boolean(item.account);
    const canOpenShot = Boolean(item.screenshotPath);
    fillButton.classList.toggle("hidden", !canFillHistory);
    fillButton.disabled = !canFillHistory;
    shotButton.dataset.openHistoryShot = item.screenshotPath || "";
    shotButton.classList.toggle("hidden", !canOpenShot);
    shotButton.disabled = !canOpenShot;
    submitButton.classList.toggle("hidden", status !== "待提交");
    historyList.appendChild(row);
  }
}

function renderHistoryQuickSummary(items = []) {
  if (!historyQuickSummary) {
    return;
  }
  const counts = {
    all: items.length,
    processing: 0,
    submitted: 0,
    doneBefore: 0,
    failed: 0
  };
  for (const item of items) {
    const status = simplifiedStatus(item.status);
    if (status === "处理中") counts.processing += 1;
    if (status === "已提交") counts.submitted += 1;
    if (status === "已填过") counts.doneBefore += 1;
    if (status === "失败") counts.failed += 1;
  }
  const summaryItems = [
    ["显示", counts.all, ""],
    ["处理中", counts.processing, "warn"],
    ["已提交", counts.submitted, "ok"],
    ["已填过", counts.doneBefore, ""],
    ["失败", counts.failed, "bad"]
  ];
  historyQuickSummary.innerHTML = "";
  for (const [label, value, tone] of summaryItems) {
    const item = document.createElement("div");
    item.className = `history-summary-item ${tone}`.trim();
    item.innerHTML = "<span></span><strong></strong>";
    item.querySelector("span").textContent = label;
    item.querySelector("strong").textContent = value;
    historyQuickSummary.appendChild(item);
  }
}

async function exportTodayFilledHistory() {
  if (exportTodayFilledBtn) {
    exportTodayFilledBtn.disabled = true;
    exportTodayFilledBtn.textContent = "导出中";
  }
  try {
    const result = await api("/api/history/export", {
      method: "POST",
      body: JSON.stringify({ range: "today" })
    });
    setPageStatus(`已导出 ${result.count} 条今日成功记录`);
    await api("/api/open-path", {
      method: "POST",
      body: JSON.stringify({ path: result.path })
    }).catch(() => {});
  } finally {
    if (exportTodayFilledBtn) {
      exportTodayFilledBtn.disabled = false;
      exportTodayFilledBtn.textContent = "导出今日成功记录";
    }
  }
}

function monitorFillableItems() {
  const config = currentMonitorConfig();
  const modeStartedAt = historyItemTime({ createdAt: config.autoFillStartedAt || "" });
  if (!modeStartedAt) {
    return [];
  }
  const byLink = new Map();
  for (const item of historyItems) {
    if (!item.url || item.channel === "manual" || item.account || displayStatus(item.status) !== "待填写") {
      continue;
    }
    if (!isCurrentMonitorSessionItem(item, modeStartedAt)) {
      continue;
    }
    const key = monitorLinkKey(item.url);
    if (!byLink.has(key)) {
      byLink.set(key, item);
      continue;
    }
    const existing = byLink.get(key);
    const existingScore = existing.douyinIndex === "__monitor__" || !existing.account ? 2 : 1;
    const itemScore = item.douyinIndex === "__monitor__" || !item.account ? 2 : 1;
    if (itemScore > existingScore || monitorSessionTime(item) > monitorSessionTime(existing)) {
      byLink.set(key, item);
    }
  }
  return Array.from(byLink.values()).sort((a, b) => (monitorSessionTime(b) || historyItemTime(b)) - (monitorSessionTime(a) || historyItemTime(a)));
}

function monitorSessionItems() {
  const config = currentMonitorConfig();
  const modeStartedAt = historyItemTime({ createdAt: config.autoFillStartedAt || "" });
  if (!modeStartedAt) {
    return [];
  }
  return monitorHistoryItems().filter((item) => (
    item.url
    && item.channel !== "manual"
    && !item.account
    && isCurrentMonitorSessionItem(item, modeStartedAt)
  ));
}

function hasMonitorStartPoint() {
  return (currentMonitorConfig().windowBindings || []).some((binding) => binding.startAfterUrl);
}

function renderMonitorFillProgress() {
  if (!monitorFillProgress) {
    return;
  }
  const progress = monitorState && monitorState.autoFillProgress || {};
  const jobIds = Array.isArray(progress.currentJobIds) ? progress.currentJobIds : [];
  const shouldShow = progress.enabled
    || progress.running
    || Number(progress.pending || 0) > 0
    || jobIds.length
    || ["cancelled", "failed", "finished", "finished-with-errors"].includes(progress.currentStatus);
  monitorFillProgress.classList.toggle("hidden", !shouldShow);
  monitorFillProgress.innerHTML = "";
  if (!shouldShow) {
    return;
  }

  const total = Number(progress.total || 0);
  const currentIndex = Number(progress.currentIndex || 0);
  const currentTotal = Number(progress.currentTotal || 0);
  const currentFinished = Number(progress.currentDone || 0) + Number(progress.currentFailed || 0);
  const main = document.createElement("strong");
  if (progress.running && progress.currentUrl) {
    main.textContent = `正在填第 ${currentIndex || 1}/${total || currentIndex || 1} 条`;
  } else if (progress.pending) {
    main.textContent = `等待填写 ${progress.pending} 条`;
  } else if (progress.currentStatus === "cancelled") {
    main.textContent = "已中止";
  } else if (progress.currentStatus === "finished" || progress.currentStatus === "finished-with-errors") {
    main.textContent = "本轮完成";
  } else {
    main.textContent = progress.enabled ? "等待新链接" : "未启动";
  }

  const detail = document.createElement("span");
  const parts = [];
  if (progress.currentUrl) {
    parts.push(shortUrl(progress.currentUrl));
  }
  if (currentTotal) {
    parts.push(`${currentFinished}/${currentTotal}`);
  }
  if (progress.pending) {
    parts.push(`队列 ${progress.pending}`);
  }
  if (progress.message) {
    parts.push(progress.message);
  }
  detail.textContent = parts.join(" · ");
  monitorFillProgress.append(main, detail);
}

function monitorProgressQueue() {
  const progress = monitorState && monitorState.autoFillProgress || {};
  return Array.isArray(progress.queue) ? progress.queue : [];
}

function monitorTaskSummary(children) {
  if (!children.length) {
    return "";
  }
  const counts = new Map();
  for (const child of children) {
    const status = displayStatus(child.status);
    counts.set(status, (counts.get(status) || 0) + 1);
  }
  const statusText = Array.from(counts.entries())
    .map(([status, count]) => `${status} ${count}`)
    .join(" / ");
  return `${children.length} 个任务${statusText ? ` · ${statusText}` : ""}`;
}

function historyDouyinLabel(child) {
  if (!child) {
    return "";
  }
  if (child.douyinLabel) {
    return child.douyinLabel;
  }
  const account = accountByName(child.account);
  const index = Number(child.douyinIndex);
  const douyin = account && Number.isInteger(index) ? (account.douyinAccounts || [])[index] : null;
  if (!douyin) {
    return "";
  }
  return [douyin.nickname, douyin.douyinId, trackText(douyin)].filter(Boolean).join(" / ");
}

function monitorTaskDetailItems(children) {
  const seen = new Set();
  return (children || [])
    .map((child) => {
      const account = child.account || "未分配微信";
      const douyin = historyDouyinLabel(child) || "未匹配抖音号";
      const status = simplifiedStatus(child.status);
      const track = child.expectedTrack || "";
      return {
        key: [account, douyin, status, track].join("|"),
        account,
        douyin,
        status,
        track,
        screenshotPath: child.screenshotPath || ""
      };
    })
    .filter((item) => {
      if (seen.has(item.key)) {
        return false;
      }
      seen.add(item.key);
      return true;
    })
    .sort((a, b) => `${a.account} ${a.douyin}`.localeCompare(`${b.account} ${b.douyin}`, "zh-Hans-CN"));
}

function monitorRowStatus(row) {
  if (row.current) {
    const progress = monitorState && monitorState.autoFillProgress || {};
    if (progress.currentStatus === "skipped") {
      return "已跳过";
    }
    if (progress.currentStatus === "finished" || progress.currentStatus === "finished-with-errors") {
      return progress.currentStatus === "finished-with-errors" ? "部分失败" : "已处理";
    }
    return "填写中";
  }
  if (row.queued) {
    return "排队中";
  }
  const childStatuses = row.children.map((child) => displayStatus(child.status));
  if (childStatuses.length) {
    if (childStatuses.some((status) => status.includes("填写中"))) {
      return "填写中";
    }
    if (childStatuses.some((status) => status.includes("失败") || status.includes("已停止"))) {
      return "失败";
    }
    if (childStatuses.some((status) => status.includes("不可填写"))) {
      return "不可填写";
    }
    if (childStatuses.some((status) => status.includes("待提交"))) {
      return "待提交";
    }
    if (childStatuses.every((status) => status.includes("已填过"))) {
      return "已填过";
    }
    if (childStatuses.every((status) => status.includes("已提交"))) {
      return "已提交";
    }
    return "已处理";
  }
  const status = displayStatus(row.item && row.item.status);
  if (status.includes("已填过")) {
    return "已填过";
  }
  if (status.includes("不可填写")) {
    return "不可填写";
  }
  if (status.includes("已同步")) {
    return "填写中";
  }
  if (status.includes("待填写")) {
    return "待填写";
  }
  return status || "待填写";
}

function monitorRowStatusClass(status) {
  const visibleStatus = simplifiedStatus(status);
  if (visibleStatus === "处理中") {
    return "running";
  }
  if (visibleStatus === "失败") {
    return "bad";
  }
  if (visibleStatus === "已提交") {
    return "ok";
  }
  if (visibleStatus === "已填过") {
    return "muted";
  }
  return "";
}

function monitorRowMessage(row) {
  const progress = monitorState && monitorState.autoFillProgress || {};
  if (row.current && progress.message) {
    return progress.message;
  }
  const childWithMessage = row.children
    .filter((child) => cleanHistoryMessage(child.message))
    .sort((a, b) => historyItemTime(b) - historyItemTime(a))[0];
  if (childWithMessage) {
    return cleanHistoryMessage(childWithMessage.message);
  }
  return cleanHistoryMessage(row.item && row.item.message);
}

function monitorRowSortRank(row) {
  const status = monitorRowStatus(row);
  if (row.current || status.includes("填写中") || status.includes("已处理")) {
    return 0;
  }
  if (row.queued || status.includes("排队")) {
    return 1;
  }
  if (status.includes("待提交")) {
    return 2;
  }
  if (status.includes("待填写")) {
    return 3;
  }
  if (status.includes("失败") || status.includes("不可")) {
    return 4;
  }
  if (status.includes("已提交")) {
    return 5;
  }
  if (status.includes("已填过") || status.includes("跳过")) {
    return 6;
  }
  return 7;
}

function monitorRowLatestTime(row) {
  return Math.max(row.latestTime || 0, row.firstTime || 0);
}

function buildMonitorLinkRows() {
  const config = currentMonitorConfig();
  const modeStartedAt = historyItemTime({ createdAt: config.autoFillStartedAt || "" });
  const progress = monitorState && monitorState.autoFillProgress || {};
  const rowsByKey = new Map();

  function ensureRow(url, seed = {}) {
    const key = monitorLinkKey(url);
    if (!key) {
      return null;
    }
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, {
        key,
        url: monitorCanonicalUrl(url),
        item: null,
        children: [],
        queued: null,
        current: false,
        source: "",
        firstTime: Infinity,
        latestTime: 0,
        contextText: "",
        expectedTrack: ""
      });
    }
    const row = rowsByKey.get(key);
    if (seed.url && !row.url) {
      row.url = monitorCanonicalUrl(seed.url);
    }
    if (seed.source && !row.source) {
      row.source = seed.source;
    }
    if (seed.contextText && !row.contextText) {
      row.contextText = seed.contextText;
    }
    if (seed.expectedTrack && !row.expectedTrack) {
      row.expectedTrack = seed.expectedTrack;
    }
    const time = seed.time || 0;
    if (time) {
      row.firstTime = Math.min(row.firstTime, time);
      row.latestTime = Math.max(row.latestTime, time);
    }
    return row;
  }

  for (const item of monitorSessionItems()) {
    const row = ensureRow(item.url, {
      source: item.source || "",
      contextText: item.contextText || "",
      expectedTrack: item.expectedTrack || "",
      time: monitorSessionTime(item) || monitorItemLatestTime(item) || historyItemTime(item)
    });
    if (row) {
      row.item = item;
    }
  }

  for (const item of historyItems) {
    if (!item || !item.url || item.channel === "manual" || !item.account || isObsoleteTrackHistoryItem(item)) {
      continue;
    }
    if (modeStartedAt && !isCurrentMonitorSessionItem(item, modeStartedAt)) {
      continue;
    }
    const row = ensureRow(item.url, {
      source: item.source || "",
      contextText: item.contextText || "",
      expectedTrack: item.expectedTrack || "",
      time: monitorItemLatestTime(item) || historyItemTime(item)
    });
    if (row) {
      row.children.push(item);
    }
  }

  for (const queued of monitorProgressQueue()) {
    const row = ensureRow(queued.url, {
      source: queued.source || "",
      time: historyItemTime({ createdAt: queued.createdAt || "" })
    });
    if (row) {
      row.queued = queued;
    }
  }

  const progressTime = historyItemTime({ createdAt: progress.startedAt || progress.updatedAt || "" });
  if (progress.currentUrl && (!modeStartedAt || !progressTime || progressTime >= modeStartedAt)) {
    const row = ensureRow(progress.currentUrl, {
      source: progress.currentSource || "",
      time: progressTime
    });
    if (row) {
      row.current = progress.running || progress.currentStatus !== "idle";
    }
  }

  return Array.from(rowsByKey.values())
    .map((row) => ({
      ...row,
      firstTime: Number.isFinite(row.firstTime) ? row.firstTime : row.latestTime
    }))
    .sort((a, b) => (
      monitorRowSortRank(a) - monitorRowSortRank(b)
      || monitorRowLatestTime(b) - monitorRowLatestTime(a)
      || (b.firstTime || 0) - (a.firstTime || 0)
    ));
}

function renderMonitorLinkPager(totalRows, pageCount) {
  if (!monitorLinkPager || !monitorLinkPageSelect) {
    return;
  }
  const showPager = totalRows > monitorLinkPageSize;
  monitorLinkPager.classList.toggle("hidden", !showPager);
  if (!showPager) {
    return;
  }
  monitorLinkPageSelect.innerHTML = "";
  for (let index = 1; index <= pageCount; index += 1) {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `第 ${index} 页`;
    monitorLinkPageSelect.appendChild(option);
  }
  monitorLinkPageSelect.value = String(monitorLinkPage);
  if (monitorLinkFirstPageBtn) {
    monitorLinkFirstPageBtn.disabled = monitorLinkPage <= 1;
  }
  if (monitorLinkPrevPageBtn) {
    monitorLinkPrevPageBtn.disabled = monitorLinkPage <= 1;
  }
  if (monitorLinkNextPageBtn) {
    monitorLinkNextPageBtn.disabled = monitorLinkPage >= pageCount;
  }
}

function renderMonitorLinkPanel() {
  if (!monitorLinkPanel || !monitorLinkPanelSummary || !monitorLinkList) {
    return;
  }
  const modeOn = currentMonitorConfig().autoFill === true && currentMonitorConfig().autoFillStartedAt;
  const rows = buildMonitorLinkRows();
  const progress = monitorState && monitorState.autoFillProgress || {};
  if (clearMonitorQueueBtn) {
    clearMonitorQueueBtn.disabled = !rows.length && Number(progress.pending || 0) <= 0;
    clearMonitorQueueBtn.textContent = "清空队列";
  }
  monitorLinkPanel.classList.toggle("hidden", !modeOn && !rows.length);
  if (!modeOn && !rows.length) {
    return;
  }

  const statusCounts = rows.reduce((counts, row) => {
    const status = simplifiedStatus(monitorRowStatus(row));
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const pageCount = Math.max(1, Math.ceil(rows.length / monitorLinkPageSize));
  monitorLinkPage = Math.min(Math.max(monitorLinkPage, 1), pageCount);
  const pageStart = (monitorLinkPage - 1) * monitorLinkPageSize;
  const pageRows = rows.slice(pageStart, pageStart + monitorLinkPageSize);
  monitorLinkPanelSummary.textContent = rows.length
    ? `${rows.length} 条 · 第 ${monitorLinkPage}/${pageCount} 页 · 处理中 ${statusCounts["处理中"] || 0} · 已提交 ${statusCounts["已提交"] || 0} · 已填过 ${statusCounts["已填过"] || 0} · 失败 ${statusCounts["失败"] || 0}`
    : "0 条";
  renderMonitorLinkPager(rows.length, pageCount);
  monitorLinkList.innerHTML = "";

  if (!rows.length) {
    monitorLinkList.innerHTML = '<div class="monitor-link-empty">等待监控台采集链接</div>';
    return;
  }

  pageRows.forEach((row, index) => {
    const status = monitorRowStatus(row);
    const visibleStatus = simplifiedStatus(status);
    const message = monitorRowMessage(row);
    const taskSummary = monitorTaskSummary(row.children);
    const taskDetails = monitorTaskDetailItems(row.children);
    const timeText = row.firstTime ? formatTime(row.firstTime) : "";
    const sourceText = row.source || row.item && row.item.source || "监控采集";
    const trackTextValue = row.expectedTrack || row.item && row.item.expectedTrack || "";
    const rowEl = document.createElement("div");
    rowEl.className = "monitor-link-row";
    rowEl.innerHTML = `
      <div class="monitor-link-index"></div>
      <div class="monitor-link-main">
        <div class="monitor-link-top">
          <a target="_blank" rel="noreferrer"></a>
          <span class="monitor-link-status"></span>
        </div>
        <div class="monitor-link-meta"></div>
        <div class="monitor-link-tasks hidden"></div>
        <div class="monitor-link-note"></div>
      </div>
    `;
    rowEl.querySelector(".monitor-link-index").textContent = String(pageStart + index + 1);
    const link = rowEl.querySelector("a");
    link.href = row.url;
    link.textContent = shortUrl(row.url);
    const badge = rowEl.querySelector(".monitor-link-status");
    badge.className = `monitor-link-status ${monitorRowStatusClass(visibleStatus)}`.trim();
    badge.textContent = visibleStatus;
    rowEl.querySelector(".monitor-link-meta").textContent = [
      timeText,
      sourceText,
      trackTextValue ? `赛道 ${trackTextValue}` : "",
      taskSummary
    ].filter(Boolean).join(" · ");
    const tasks = rowEl.querySelector(".monitor-link-tasks");
    if (taskDetails.length) {
      tasks.classList.remove("hidden");
      for (const detail of taskDetails) {
        const taskEl = document.createElement("div");
        taskEl.className = "monitor-link-task";
        taskEl.innerHTML = '<span class="monitor-link-task-status"></span><span class="monitor-link-task-text"></span><button class="monitor-link-check hidden" data-open-history-shot="" type="button">检查截图</button>';
        const statusEl = taskEl.querySelector(".monitor-link-task-status");
        statusEl.className = `monitor-link-task-status ${monitorRowStatusClass(detail.status)}`.trim();
        statusEl.textContent = detail.status;
        taskEl.querySelector(".monitor-link-task-text").textContent = [
          detail.account,
          detail.douyin,
          detail.track ? `赛道 ${detail.track}` : ""
        ].filter(Boolean).join(" / ");
        const checkButton = taskEl.querySelector(".monitor-link-check");
        const canCheck = Boolean(detail.screenshotPath);
        checkButton.dataset.openHistoryShot = detail.screenshotPath || "";
        checkButton.classList.toggle("hidden", !canCheck);
        checkButton.disabled = !canCheck;
        tasks.appendChild(taskEl);
      }
    }
    const note = rowEl.querySelector(".monitor-link-note");
    note.textContent = message || "";
    note.classList.toggle("hidden", !message);
    monitorLinkList.appendChild(rowEl);
  });
}

function renderMonitorImportSummary() {
  if (!monitorImportSummary) {
    return;
  }
  const pendingItems = monitorFillableItems();
  const sessionItems = monitorSessionItems();
  const modeOn = currentMonitorConfig().autoFill === true && currentMonitorConfig().autoFillStartedAt;
  const sessionCount = monitorUniqueLinkCount(sessionItems);
  const progress = monitorState && monitorState.autoFillProgress || {};
  if (modeOn) {
    monitorImportSummary.classList.remove("hidden");
    if (progress.running && progress.currentUrl) {
      monitorImportSummary.textContent = `自动填写中 · 第 ${progress.currentIndex || 1}/${progress.total || progress.currentIndex || 1} 条`;
    } else if (Number(progress.pending || 0) > 0) {
      monitorImportSummary.textContent = `自动队列 ${progress.pending} 条`;
    } else {
      monitorImportSummary.textContent = sessionCount
        ? `自动监听中 · 待处理 ${sessionCount} 条`
        : "等待监控台新链接";
    }
  } else {
    monitorImportSummary.textContent = "";
    monitorImportSummary.classList.add("hidden");
  }
  if (batchPreview) {
    batchPreview.classList.toggle("hidden", formMode === "auto" && modeOn);
  }
  renderMonitorFillProgress();
  renderMonitorLinkPanel();
  renderMonitorAutoUseState();
}

function renderMonitorAutoUseState() {
  if (!monitorAutoUseBtn || !monitorState) {
    return;
  }
  const enabled = currentMonitorConfig().autoFill === true;
  const accounts = currentMonitorConfig().fillAccounts || [];
  const progress = monitorState && monitorState.autoFillProgress || {};
  const jobIds = Array.isArray(progress.currentJobIds) ? progress.currentJobIds : [];
  monitorAutoUseBtn.classList.toggle("active", enabled);
  monitorAutoUseBtn.textContent = enabled
    ? "自动处理中（点击关闭）"
    : hasMonitorStartPoint() ? "从起点开始自动处理" : "开启自动处理";
  monitorAutoUseBtn.title = enabled
    ? `正在自动处理新链接。填表账号：${accounts.length ? accounts.join("、") : "当前参与填表微信号"}`
    : hasMonitorStartPoint()
      ? "从监控台设定的起点开始处理新链接"
      : "开启后，监控台新采集的链接会自动进入填表任务，历史旧链接不参与";
  if (importMonitorLinksBtn) {
    importMonitorLinksBtn.classList.toggle("hidden", enabled);
  }
  if (fillMonitorLinksBtn) {
    fillMonitorLinksBtn.classList.toggle("hidden", enabled);
  }
  if (stopMonitorAutoFillBtn) {
    const canStop = progress.running || Number(progress.pending || 0) > 0 || jobIds.length;
    stopMonitorAutoFillBtn.classList.toggle("hidden", !canStop);
    stopMonitorAutoFillBtn.disabled = !canStop;
    stopMonitorAutoFillBtn.textContent = progress.currentStatus === "stopping" ? "正在中止" : "中止当前填写";
  }
  if (stopFillInlineBtn && (progress.running || jobIds.length)) {
    stopFillInlineBtn.disabled = false;
    stopFillInlineBtn.textContent = "中止填表";
  }
  renderMonitorFillProgress();
  renderMonitorLinkPanel();
}

async function toggleMonitorAutoUse() {
  const accounts = selectedFillAccounts();
  if (!accounts.length) {
    alert("先选择参与填表的微信号");
    return;
  }
  const next = !(currentMonitorConfig().autoFill === true);
  await saveMonitorConfig({
    autoFill: next,
    fillAccounts: accounts,
    autoFillStartedAt: next ? new Date().toISOString() : ""
  });
  monitorLinkPage = 1;
  if (next && !(monitorState && monitorState.running)) {
    monitorState = await api("/api/monitor/start", { method: "POST" });
  }
  await loadMonitor();
  renderMonitorImportSummary();
  setPageStatus(next ? "已开启自动处理，只处理之后的新链接" : "已关闭自动处理");
}

async function stopMonitorAutoFill() {
  if (stopMonitorAutoFillBtn) {
    stopMonitorAutoFillBtn.disabled = true;
    stopMonitorAutoFillBtn.textContent = "正在中止";
  }
  const result = await api("/api/monitor/auto-fill/stop", { method: "POST" });
  const ids = result && result.progress && Array.isArray(result.progress.currentJobIds)
    ? result.progress.currentJobIds
    : [];
  if (ids.length) {
    watchJobs(ids);
  } else {
    updateStopFillButton([]);
  }
  await Promise.all([
    loadMonitor().catch(() => {}),
    loadHistory().catch(() => {})
  ]);
  renderMonitorImportSummary();
  setPageStatus("已中止监控填写");
}

async function clearMonitorLinkQueue() {
  if (!window.confirm("确定清空新链接队列吗？")) {
    return;
  }
  if (clearMonitorQueueBtn) {
    clearMonitorQueueBtn.disabled = true;
    clearMonitorQueueBtn.textContent = "正在清空";
  }
  try {
    const result = await api("/api/monitor/events/clear", {
      method: "POST",
      body: JSON.stringify({ resetSession: true })
    });
    monitorLinkPage = 1;
    await Promise.all([
      loadMonitor().catch(() => {}),
      loadHistory().catch(() => {})
    ]);
    renderMonitorImportSummary();
    const removed = Number(result.removedEvents || 0) + Number(result.removedHistory || 0);
    setPageStatus(removed ? `已清空队列，移除 ${removed} 条` : "队列已清空");
  } finally {
    if (clearMonitorQueueBtn) {
      clearMonitorQueueBtn.textContent = "清空队列";
    }
    renderMonitorLinkPanel();
  }
}

async function syncMonitorLinksToForm() {
  await loadHistory();
  if (!currentMonitorConfig().autoFillStartedAt) {
    alert("先开启自动处理，再同步监控队列");
    return;
  }
  const items = monitorFillableItems();
  if (!items.length) {
    alert("暂时没有待填写的监控采集链接");
    return;
  }
  formUrl.value = items
    .map((item) => `${item.source || "监控采集"} ${item.url}`)
    .join("\n");
  douyinSelect.value = "__auto__";
  renderBatchPreview();
  setFormMode("manual");
  showPage("form");
  setPageStatus(`已同步 ${items.length} 条监控采集链接`);
}

async function fillMonitorCollectedLinks() {
  await loadHistory();
  if (!currentMonitorConfig().autoFillStartedAt) {
    alert("先开启自动处理，再处理监控队列");
    return;
  }
  const items = monitorFillableItems();
  if (!items.length) {
    alert("暂时没有待填写的监控采集链接");
    return;
  }
  const accounts = selectedFillAccounts();
  if (!accounts.length) {
    alert("先选择参与填表的微信号");
    return;
  }
  const result = await api("/api/history/fill-batch", {
    method: "POST",
    body: JSON.stringify({
      accounts,
      ids: items.map((item) => item.id)
    })
  });
  showPage("status");
  watchJobs(result.jobIds || [result.jobId]);
  await loadHistory();
}

async function markHistorySubmitted(id) {
  await api("/api/history/status", {
    method: "POST",
    body: JSON.stringify({ id, status: "已提交" })
  });
  await loadHistory();
}

async function openHistoryScreenshot(path) {
  if (!path) {
    alert("这条记录还没有填写截图");
    return;
  }
  await api("/api/open-path", {
    method: "POST",
    body: JSON.stringify({ path })
  });
}

async function fillFromHistory(id) {
  const result = await api("/api/history/fill", {
    method: "POST",
    body: JSON.stringify({ id })
  });
  showPage("status");
  watchJobs([result.jobId]);
  await loadHistory();
}

function jobStatusText(status) {
  if (status === "queued") {
    return "排队中";
  }
  if (status === "running") {
    return "运行中";
  }
  if (status === "stopping") {
    return "正在停止";
  }
  if (status === "cancelled") {
    return "已停止";
  }
  if (status === "done") {
    return "已完成";
  }
  if (status === "skipped") {
    return "已跳过";
  }
  return "失败";
}

function updateStopFillButton(jobs = []) {
  const buttons = [stopFillBtn, stopFillInlineBtn].filter(Boolean);
  if (!buttons.length) {
    return;
  }
  const cancelable = jobs.filter((job) => job && job.kind === "fill" && activeJobStatuses.has(job.status));
  const stopping = cancelable.some((job) => job.status === "stopping");
  for (const button of buttons) {
    button.disabled = cancelable.length === 0 || stopping;
    button.textContent = stopping ? "正在中止" : (button === stopFillInlineBtn ? "中止填表" : "停止填表");
  }
}

function watchJobs(jobIds, options = {}) {
  activeJobIds = uniqueCleanList(jobIds);
  activeJobId = activeJobIds[0] || "";
  if (pollTimer) {
    clearInterval(pollTimer);
  }
  updateStopFillButton([]);
  if (!activeJobIds.length) {
    return;
  }

  async function poll() {
    const jobs = await Promise.all(activeJobIds.map((id) => api(`/api/jobs/${encodeURIComponent(id)}`)));
    const running = jobs.filter((job) => job.status === "running").length;
    const queued = jobs.filter((job) => job.status === "queued").length;
    const stopping = jobs.filter((job) => job.status === "stopping").length;
    const done = jobs.filter((job) => job.status === "done").length;
    const failed = jobs.filter((job) => job.status === "failed").length;
    const cancelled = jobs.filter((job) => job.status === "cancelled").length;
    const skipped = jobs.filter((job) => job.status === "skipped").length;
    updateStopFillButton(jobs);
    if (jobs.length === 1) {
      jobState.textContent = jobStatusText(jobs[0].status);
      setLog(jobs[0].logs);
    } else {
      jobState.textContent = `批量 ${done + failed + cancelled + skipped}/${jobs.length} 已结束`;
      const summary = `批量任务：${jobs.length} 条链接 · 运行中 ${running} · 排队 ${queued} · 正在停止 ${stopping} · 完成 ${done} · 已跳过 ${skipped} · 已停止 ${cancelled} · 失败 ${failed}`;
      const logs = jobs.map((job, index) => (
        `【${index + 1}. ${jobStatusText(job.status)}】\n${job.logs || "等待执行..."}`
      )).join("\n\n");
      setLog(`${summary}\n\n${logs}`);
    }
    if (!jobs.some((job) => activeJobStatuses.has(job.status))) {
      clearInterval(pollTimer);
      pollTimer = null;
      updateStopFillButton(jobs);
      if (!options.skipHistoryRefresh) {
        loadHistory().catch(() => {});
      }
    }
  }

  poll().catch((error) => setLog(error.message));
  pollTimer = setInterval(() => poll().catch((error) => setLog(error.message)), 1500);
}

function watchJob(jobId) {
  watchJobs([jobId]);
}

async function stopFillJobs() {
  const progressJobIds = monitorState && monitorState.autoFillProgress && Array.isArray(monitorState.autoFillProgress.currentJobIds)
    ? monitorState.autoFillProgress.currentJobIds
    : [];
  const ids = uniqueCleanList([
    ...(activeJobIds.length ? activeJobIds : [activeJobId]),
    ...progressJobIds
  ]);
  for (const button of [stopFillBtn, stopFillInlineBtn].filter(Boolean)) {
    button.disabled = true;
    button.textContent = "正在中止";
  }
  setLog(`${logBox.textContent || ""}\n已发送停止请求，正在关闭填表窗口...`.trim());
  const result = await api("/api/jobs/cancel", {
    method: "POST",
    body: JSON.stringify(ids.length ? { jobIds: ids, kind: "fill" } : { all: true, kind: "fill" })
  });
  const nextIds = uniqueCleanList([
    ...ids,
    ...((result.jobs || []).map((job) => job.id))
  ]);
  if (nextIds.length) {
    watchJobs(nextIds);
  } else {
    updateStopFillButton([]);
  }
  await loadHistory();
}

async function openLogin(accountName = "") {
  const account = accountName || selectedAccount();
  if (!account) {
    alert("先添加或选择一个账号");
    return;
  }
  setLog("正在打开登录窗口...");
  const result = await api("/api/open-login", {
    method: "POST",
    body: JSON.stringify({ account })
  });
  watchJob(result.jobId);
}

async function startFill() {
  const targetAccounts = selectedFillAccounts();
  const account = targetAccounts[0] || "";
  const url = formUrl.value.trim();
  renderBatchPreview();
  const items = batchItemsForSubmit();
  if (!targetAccounts.length) {
    alert("先选择参与填表的微信号");
    return;
  }
  if (!url || !items.length) {
    alert("先粘贴表单链接");
    return;
  }
  if (!dryRun.checked) {
    const selectedMatchMode = douyinSelect.value || "__auto__";
    for (const accountName of targetAccounts) {
      const accountData = accountByName(accountName);
      const contact = accountData && accountData.contact || {};
      if (selectedMatchMode === "__auto__") {
        if (!(accountData && accountData.douyinAccounts || []).length) {
          alert(`先给「${accountName}」添加抖音号，才能智能匹配`);
          return;
        }
      } else {
        const douyinIndex = Number(douyinSelect.value);
        const selectedDouyin = Number.isInteger(douyinIndex) && douyinIndex >= 0
          ? (accountData && accountData.douyinAccounts || [])[douyinIndex]
          : null;
        if (!selectedDouyin) {
          alert(`「${accountName}」没有这个抖音号，请改用智能匹配`);
          return;
        }
      }
      if (!(contact.phone || contact.alipayAccount) || !(contact.realName || contact.alipayName)) {
        alert(`先保存「${accountName}」的号码和姓名`);
        return;
      }
    }
  }
  const isTestRun = dryRun.checked;
  setLog(isTestRun ? "正在启动测试..." : "正在启动自动填表...");
  if (!isTestRun) {
    showPage("status");
  } else {
    setPageStatus("测试已开始，结果会留在当前页和运行状态里");
  }
  const result = await api("/api/fill", {
    method: "POST",
    body: JSON.stringify({ account, accounts: targetAccounts, url, items, dryRun: isTestRun, douyinIndex: douyinSelect.value || "__auto__" })
  });
  if (result.count > 1) {
    const skippedText = result.skipped && result.skipped.length ? `，跳过 ${result.skipped.length} 条已处理链接` : "";
    setLog(`已创建 ${result.count} 条批量任务${skippedText}。同一个微信号会自动排队，不同微信号可同时运行。`);
  }
  watchJobs(result.jobIds || [result.jobId], { skipHistoryRefresh: isTestRun });
  if (!isTestRun) {
    loadHistory().catch(() => {});
  }
}

navButtons.forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});
formModeButtons.forEach((button) => {
  button.addEventListener("click", () => setFormMode(button.dataset.formMode || "auto"));
});
if (fillAccountPicker) {
  fillAccountPicker.addEventListener("change", () => {
    batchTrackDetections.clear();
    renderBatchPreview();
    saveMonitorFillAccounts().catch((error) => setLog(error.message));
  });
}
addAccountBtn.addEventListener("click", () => addAccount().catch((error) => alert(error.message)));
renameAccountBtn.addEventListener("click", () => renameCurrentAccount().catch((error) => alert(error.message)));
saveAccountBtn.addEventListener("click", () => saveCurrentAccount().catch((error) => alert(error.message)));
if (pickGradeScreenshotBtn) {
  pickGradeScreenshotBtn.addEventListener("click", () => pickGradeScreenshot().catch((error) => alert(error.message)));
}
if (addTrackBtn) {
  addTrackBtn.addEventListener("click", () => addTrack().catch((error) => alert(error.message)));
}
if (newTrackName) {
  newTrackName.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addTrack().catch((error) => alert(error.message));
    }
  });
}
if (templateAccountList) {
  templateAccountList.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-template]");
    if (!editButton) {
      return;
    }
    const name = editButton.dataset.editTemplate || "";
    if (!accountByName(name)) {
      return;
    }
    preferredAccountName = name;
    rememberSelectedAccount()
      .then(() => {
        showPage("accounts");
        setPageStatus(`正在编辑：${name}`);
      })
      .catch((error) => alert(error.message));
  });
}
saveMonitorBtn.addEventListener("click", () => saveMonitorConfig().catch((error) => alert(error.message)));
if (monitorReadMode) {
  monitorReadMode.addEventListener("change", () => {
    updateMonitorReadModeHint(monitorReadMode.value);
    saveMonitorConfig({ readMode: monitorReadMode.value })
      .then(() => setPageStatus(`读取方式：${monitorReadModeLabel(monitorReadMode.value)}`))
      .catch((error) => alert(error.message));
  });
}
startMonitorBtn.addEventListener("click", () => startMonitor().catch((error) => alert(error.message)));
stopMonitorBtn.addEventListener("click", () => stopMonitor().catch((error) => alert(error.message)));
addMonitorSourceBtn.addEventListener("click", () => addMonitorSource().catch((error) => alert(error.message)));
openMonitorBoardBtn.addEventListener("click", () => window.open("/monitor-platform.html", "_blank"));
if (openMonitorTopBtn) {
  openMonitorTopBtn.addEventListener("click", () => window.open("/monitor-platform.html", "_blank"));
}
probeMonitorBtn.addEventListener("click", () => probeMonitor().catch((error) => alert(error.message)));
if (manualSubmitMode) {
  manualSubmitMode.addEventListener("click", () => setSubmitMode(false).catch((error) => alert(error.message)));
}
if (autoSubmitMode) {
  autoSubmitMode.addEventListener("click", () => setSubmitMode(true).catch((error) => alert(error.message)));
}
monitorAccountSelect.addEventListener("change", () => {
  monitorAccountSelect.dataset.userSelected = "1";
  renderMonitorDouyinOptions();
  if (latestMonitorProbe) {
    renderProbeResult(latestMonitorProbe);
  }
});
monitorSourceList.addEventListener("click", (event) => {
  const focusButton = event.target.closest("[data-focus-window]");
  if (focusButton) {
    focusMonitorWindow(focusButton.dataset.focusWindow).catch((error) => alert(error.message));
    return;
  }
  const readButton = event.target.closest("[data-read-window]");
  if (readButton) {
    verifyMonitorWindow(readButton.dataset.readWindow).catch((error) => alert(error.message));
    return;
  }
  const removeWindowButton = event.target.closest("[data-remove-window]");
  if (removeWindowButton) {
    removeMonitorWindow(removeWindowButton.dataset.removeWindow).catch((error) => alert(error.message));
    return;
  }
  const button = event.target.closest("[data-remove-source]");
  if (button) {
    removeMonitorSource(button.dataset.removeSource).catch((error) => alert(error.message));
  }
});
monitorProbeResult.addEventListener("click", (event) => {
  const focusButton = event.target.closest("[data-focus-window]");
  if (focusButton) {
    focusMonitorWindow(focusButton.dataset.focusWindow).catch((error) => alert(error.message));
    return;
  }
  const addWindowButton = event.target.closest("[data-add-window-to-account]");
  if (addWindowButton) {
    addWindowToSelectedAccount(addWindowButton.dataset.addWindowToAccount).catch((error) => alert(error.message));
    return;
  }
  const bindStartButton = event.target.closest("[data-bind-start-window]");
  if (bindStartButton) {
    bindWindowAndStart(bindStartButton.dataset.bindStartWindow).catch((error) => alert(error.message));
    return;
  }
  const button = event.target.closest("[data-save-window-bindings]");
  if (button) {
    saveWindowBindingsFromProbe().catch((error) => alert(error.message));
  }
});
monitorLiveStatus.addEventListener("click", (event) => {
  const focusButton = event.target.closest("[data-focus-window]");
  if (focusButton) {
    focusMonitorWindow(focusButton.dataset.focusWindow).catch((error) => alert(error.message));
  }
});
refreshHistoryBtn.addEventListener("click", () => loadHistory().catch((error) => alert(error.message)));
if (exportTodayFilledBtn) {
  exportTodayFilledBtn.addEventListener("click", () => exportTodayFilledHistory().catch((error) => alert(error.message)));
}
if (checkAllLoginBtn) {
  checkAllLoginBtn.addEventListener("click", () => checkAllLoginStatus().catch((error) => alert(error.message)));
}
if (loginStatusList) {
  loginStatusList.addEventListener("click", (event) => {
    const checkButton = event.target.closest("[data-check-login]");
    if (checkButton) {
      checkLoginStatus(checkButton.dataset.checkLogin).catch((error) => alert(error.message));
      return;
    }
    const loginButton = event.target.closest("[data-open-login-account]");
    if (loginButton) {
      openLogin(loginButton.dataset.openLoginAccount).catch((error) => alert(error.message));
    }
  });
}
historyRangeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    historyTimeFilter = { range: button.dataset.historyRange || "today", start: "", end: "" };
    historyPage = 1;
    renderHistory();
  });
});
historyTypeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    historyTypeFilter = button.dataset.historyType || "all";
    historyPage = 1;
    renderHistory();
  });
});
historyApplyDateBtn.addEventListener("click", () => {
  historyTimeFilter = {
    range: "custom",
    start: historyStartDate.value,
    end: historyEndDate.value
  };
  historyPage = 1;
  renderHistory();
});
if (historyFirstPageBtn) {
  historyFirstPageBtn.addEventListener("click", () => {
    historyPage = 1;
    renderHistory();
  });
}
if (historyPrevPageBtn) {
  historyPrevPageBtn.addEventListener("click", () => {
    historyPage = Math.max(1, historyPage - 1);
    renderHistory();
  });
}
if (historyNextPageBtn) {
  historyNextPageBtn.addEventListener("click", () => {
    const total = primaryHistoryItems(filteredHistoryItems()).length;
    const pageCount = Math.max(1, Math.ceil(total / historyPageSize));
    historyPage = Math.min(pageCount, historyPage + 1);
    renderHistory();
  });
}
if (historyPageSelect) {
  historyPageSelect.addEventListener("change", () => {
    historyPage = Number(historyPageSelect.value) || 1;
    renderHistory();
  });
}
formUrl.addEventListener("input", () => renderBatchPreview());
historyList.addEventListener("click", (event) => {
  const shotButton = event.target.closest("[data-open-history-shot]");
  if (shotButton) {
    openHistoryScreenshot(shotButton.dataset.openHistoryShot).catch((error) => alert(error.message));
    return;
  }
  const openButton = event.target.closest("[data-open-history-url]");
  if (openButton) {
    const url = openButton.dataset.openHistoryUrl || "";
    if (url) {
      window.open(url, "_blank");
    }
    return;
  }
  const fillButton = event.target.closest("[data-fill-history]");
  if (fillButton) {
    fillFromHistory(fillButton.dataset.fillHistory).catch((error) => alert(error.message));
    return;
  }
  const submitButton = event.target.closest("[data-submit-history]");
  if (submitButton) {
    markHistorySubmitted(submitButton.dataset.submitHistory).catch((error) => alert(error.message));
  }
});
if (monitorLinkList) {
  monitorLinkList.addEventListener("click", (event) => {
    const shotButton = event.target.closest("[data-open-history-shot]");
    if (shotButton) {
      openHistoryScreenshot(shotButton.dataset.openHistoryShot).catch((error) => alert(error.message));
    }
  });
}
addDouyinBtn.addEventListener("click", () => saveDouyin().catch((error) => alert(error.message)));
cancelDouyinEditBtn.addEventListener("click", clearDouyinEditor);
douyinList.addEventListener("click", (event) => {
  const editButton = event.target.closest("[data-edit]");
  if (editButton) {
    editDouyin(editButton.dataset.editDouyinAccount || "", Number(editButton.dataset.edit));
    return;
  }
  const removeButton = event.target.closest("[data-remove]");
  if (removeButton) {
    removeDouyin(removeButton.dataset.removeDouyinAccount || "", Number(removeButton.dataset.remove)).catch((error) => alert(error.message));
  }
});
if (douyinAccountOwner) {
  douyinAccountOwner.addEventListener("change", () => {
    douyinOwnerName = douyinAccountOwner.value || "";
    clearDouyinEditor();
    renderDouyinOwnerSelect();
    renderDouyinList();
  });
}
if (accountSelect) {
  accountSelect.addEventListener("change", () => rememberSelectedAccount().catch((error) => setLog(error.message)));
}
loginBtn.addEventListener("click", () => openLogin().catch((error) => alert(error.message)));
fillBtn.addEventListener("click", () => startFill().catch((error) => alert(error.message)));
if (stopFillBtn) {
  stopFillBtn.addEventListener("click", () => stopFillJobs().catch((error) => alert(error.message)));
}
if (stopFillInlineBtn) {
  stopFillInlineBtn.addEventListener("click", () => stopFillJobs().catch((error) => alert(error.message)));
}
if (monitorAutoUseBtn) {
  monitorAutoUseBtn.addEventListener("click", () => toggleMonitorAutoUse().catch((error) => alert(error.message)));
}
if (stopMonitorAutoFillBtn) {
  stopMonitorAutoFillBtn.addEventListener("click", () => stopMonitorAutoFill().catch((error) => alert(error.message)));
}
if (clearMonitorQueueBtn) {
  clearMonitorQueueBtn.addEventListener("click", () => clearMonitorLinkQueue().catch((error) => alert(error.message)));
}
if (monitorLinkFirstPageBtn) {
  monitorLinkFirstPageBtn.addEventListener("click", () => {
    monitorLinkPage = 1;
    renderMonitorLinkPanel();
  });
}
if (monitorLinkPrevPageBtn) {
  monitorLinkPrevPageBtn.addEventListener("click", () => {
    monitorLinkPage = Math.max(1, monitorLinkPage - 1);
    renderMonitorLinkPanel();
  });
}
if (monitorLinkNextPageBtn) {
  monitorLinkNextPageBtn.addEventListener("click", () => {
    const pageCount = Math.max(1, Math.ceil(buildMonitorLinkRows().length / monitorLinkPageSize));
    monitorLinkPage = Math.min(pageCount, monitorLinkPage + 1);
    renderMonitorLinkPanel();
  });
}
if (monitorLinkPageSelect) {
  monitorLinkPageSelect.addEventListener("change", () => {
    monitorLinkPage = Number(monitorLinkPageSelect.value) || 1;
    renderMonitorLinkPanel();
  });
}
importMonitorLinksBtn.addEventListener("click", () => syncMonitorLinksToForm().catch((error) => alert(error.message)));
fillMonitorLinksBtn.addEventListener("click", () => fillMonitorCollectedLinks().catch((error) => alert(error.message)));
refreshBtn.addEventListener("click", () => {
  if (activeJobIds.length) {
    watchJobs(activeJobIds);
  } else if (activeJobId) {
    watchJobs([activeJobId]);
  } else {
    loadState().catch((error) => setLog(error.message));
  }
});

async function boot() {
  renderFormMode();
  await loadState();
  renderBatchPreview();
  await Promise.all([
    loadMonitor(),
    loadHistory()
  ]);
  if (monitorState && monitorState.running) {
    startMonitorPolling();
  }
}

boot().catch((error) => setLog(error.message));
