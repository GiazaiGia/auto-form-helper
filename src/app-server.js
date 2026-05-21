const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const XLSX = require("xlsx");
const { runFromArgs, detectTrackByOpeningForm } = require("./fill-qq-form");
const { generateDrafts, previewBatch } = require("./jianying-batch");

const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.FORM_HELPER_DATA_DIR || rootDir;
const uiDir = path.join(rootDir, "ui");
const sourceConfigDir = path.join(rootDir, "config");
const configDir = path.join(dataDir, "config");
const accountsPath = path.join(configDir, "accounts.json");
const answersPath = path.join(configDir, "answers.json");
const monitorPath = path.join(configDir, "monitor.json");
const historyPath = path.join(dataDir, "history.json");
const monitorEventsPath = path.join(dataDir, "monitor-events.json");
const loginStatusPath = path.join(dataDir, "login-status.json");
const outputDir = path.join(dataDir, "output");
const fillScript = path.join(__dirname, "fill-qq-form.js");
const recommendedMonitorWindow = { width: 960, height: 780 };
const recommendedVirtualMonitorWindow = { width: 1280, height: 980 };
const monitorSizeTestCandidates = [
  { width: 840, height: 680 },
  { width: 900, height: 720 },
  { width: 960, height: 780 },
  { width: 1040, height: 820 },
  { width: 1120, height: 860 },
  { width: 1200, height: 900 }
];
const jobs = new Map();
const jobQueues = new Map();
let monitorTimer = null;
let monitorBusy = false;
const qqFormValidationCache = new Map();
const qqFormTextCache = new Map();
const QQ_FORM_VALIDATION_SUCCESS_CACHE_MS = 30 * 60 * 1000;
const QQ_FORM_VALIDATION_FAILURE_CACHE_MS = 30 * 1000;
const QQ_FORM_TEXT_CACHE_MS = 10 * 60 * 1000;
const LOGIN_STATUS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TRACK_MATCH_MIN_SCORE = 8;
const monitorRuntime = {
  running: false,
  lastTickAt: "",
  lastScanDurationMs: 0,
  lastFoundAt: "",
  lastError: "",
  logs: "",
  lastClipboard: "",
  seenKeys: new Set(),
  baselineHwnds: new Set(),
  bindingStats: {},
  scanCursor: 0,
  lastScanPlan: {
    total: 0,
    batchSize: 0,
    selected: []
  },
  autoFillQueue: [],
  autoFillProcessing: false,
  autoFillStopRequested: false,
  trackDetectQueue: [],
  trackDetectProcessing: false,
  trackDetectActiveUrls: new Set(),
  autoFillProgress: {
    enabled: false,
    running: false,
    pending: 0,
    completed: 0,
    currentIndex: 0,
    total: 0,
    currentUrl: "",
    currentSource: "",
    currentStatus: "idle",
    currentJobIds: [],
    currentDone: 0,
    currentFailed: 0,
    currentRunning: 0,
    currentTotal: 0,
    message: "",
    startedAt: "",
    updatedAt: ""
  }
};
const fillTerminalStatuses = new Set(["done", "failed", "cancelled", "skipped"]);

function ensureDataFiles() {
  fs.mkdirSync(configDir, { recursive: true });
  const configSeeds = {
    "accounts.json": defaultAccountsConfig(),
    "answers.json": defaultAnswersConfig()
  };
  for (const [name, fallback] of Object.entries(configSeeds)) {
    const target = path.join(configDir, name);
    if (fs.existsSync(target)) {
      continue;
    }
    const source = path.join(sourceConfigDir, name);
    if (fs.existsSync(source)) {
      fs.copyFileSync(source, target);
    } else {
      writeJson(target, fallback);
    }
  }
  if (!fs.existsSync(monitorPath)) {
    writeJson(monitorPath, defaultMonitorConfig());
  }
  if (!fs.existsSync(historyPath)) {
    writeJson(historyPath, { items: [] });
  }
  if (!fs.existsSync(monitorEventsPath)) {
    writeJson(monitorEventsPath, { items: [] });
  }
  if (!fs.existsSync(loginStatusPath)) {
    writeJson(loginStatusPath, { items: {} });
  }
  fs.mkdirSync(outputDir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendText(res, status, value, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(value);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        resolve({});
      }
    });
  });
}

function defaultMonitorConfig() {
  return {
    enabled: false,
    autoFill: false,
    detectClipboard: true,
    detectWechatWindow: true,
    syncQueue: false,
    syncQueueStartedAt: "",
    readMode: "ocr",
    intervalMs: 15000,
    scanBatchSize: 1,
    targetCycleSeconds: 15,
    fillAccounts: [],
    autoFillStartedAt: "",
    sources: [],
    windowBindings: []
  };
}

function defaultAccountsConfig() {
  return {
    defaultAccount: "",
    accounts: []
  };
}

function defaultAnswersConfig() {
  return {
    wechatNickname: "",
    defaultType: "",
    browser: "edge",
    autoSubmit: false,
    openVisibleBrowser: false,
    typeKeywords: {},
    tracks: [],
    profiles: {}
  };
}

function safeAccountName(value) {
  return String(value || "").trim().slice(0, 60);
}

function makeId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function compactForScore(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[：﹕]/g, ":")
    .replace(/[／]/g, "/")
    .replace(/[．。]/g, ".")
    .replace(/[\s"'“”‘’《》【】（）()，,。.;；:：!！?？\-_/|]+/g, "");
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

function douyinTracks(douyin) {
  if (!douyin) {
    return [];
  }
  return uniqueCleanList([
    ...(Array.isArray(douyin.tracks) ? douyin.tracks : []),
    douyin.contentType
  ]);
}

function implicitKeywords(typeName) {
  const text = compactForScore(typeName);
  if (/冰雪|frozen/.test(text)) {
    return ["冰雪奇缘", "冰雪", "冰雪女王", "雪女王", "艾莎", "安娜", "frozen", "letitgo"];
  }
  if (/奥特/.test(text)) {
    return ["奥特曼", "奥特", "迪迦", "赛罗", "泰罗", "怪兽", "光之巨人", "宇宙英雄", "特摄"];
  }
  if (/西游/.test(text)) {
    return ["西游记", "西游", "西海记", "大闹天宫", "天宫", "猴子", "美猴王", "大王叫我来巡山", "巡山", "悟空", "孙悟空", "齐天", "齐天大圣", "大圣", "金箍棒", "唐僧", "八戒", "猪八戒", "沙僧"];
  }
  if (/汪汪|pawpatrol/.test(text)) {
    return ["汪汪队", "汪汪", "阿奇", "毛毛", "天天", "灰灰", "小砾", "路马", "莱德", "pawpatrol", "pawpatrol"];
  }
  if (/红楼/.test(text)) {
    return ["红楼梦", "红楼", "宝玉", "黛玉", "林黛玉", "贾宝玉", "宝钗", "薛宝钗", "大观园"];
  }
  return [];
}

function bigrams(value) {
  const text = compactForScore(value);
  const parts = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    parts.push(text.slice(index, index + 2));
  }
  return parts;
}

function scoreTrack(text, track, answers = {}) {
  const body = compactForScore(text);
  if (!body || !track) {
    return 0;
  }
  const customKeywords = answers.typeKeywords && answers.typeKeywords[track] || [];
  let score = 0;
  for (const keyword of uniqueCleanList([track, ...implicitKeywords(track), ...customKeywords])) {
    const key = compactForScore(keyword);
    if (!key) {
      continue;
    }
    if (body.includes(key)) {
      score += key.length === 1 ? 3 : 8 + key.length;
      continue;
    }
    const keyBigrams = bigrams(key);
    if (keyBigrams.length) {
      const matched = keyBigrams.filter((part) => body.includes(part)).length;
      const ratio = matched / keyBigrams.length;
      if (ratio >= 0.65) {
        score += Math.round(ratio * Math.min(8, key.length));
      }
    }
  }
  return score;
}

function guessTrackForAccount(text, accountName, douyinIndex = "") {
  const answers = readJson(answersPath, {});
  const accountsData = getAccounts();
  const account = (accountsData.accounts || []).find((item) => item.name === accountName) || null;
  const accountTracks = [];
  const selectedIndex = Number(douyinIndex);
  if (account && Number.isInteger(selectedIndex) && selectedIndex >= 0) {
    accountTracks.push(...douyinTracks((account.douyinAccounts || [])[selectedIndex]));
  } else if (account) {
    for (const douyin of account.douyinAccounts || []) {
      accountTracks.push(...douyinTracks(douyin));
    }
  }
  const tracks = uniqueCleanList([
    ...accountTracks,
    ...getAnswerTypes(accountsData, answers)
  ]);
  const ranked = tracks
    .map((track) => ({ track, score: scoreTrack(text, track, answers) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= TRACK_MATCH_MIN_SCORE ? ranked[0] : { track: "", score: 0 };
}

function normalizeUrl(value) {
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
  if (match) {
    return `https://docs.qq.com/form/page/${match[1]}`;
  }
  return text;
}

function extractFormUrls(text) {
  const rawText = String(text || "");
  const directMatches = rawText.match(/https?:\/\/docs\.qq\.com\/form\/page\/[A-Za-z0-9_-]{4,80}/gi) || [];
  const ocrText = rawText
    .replace(/[：﹕]/g, ":")
    .replace(/[／\\|]/g, "/")
    .replace(/[．。]/g, ".")
    .replace(/[•·]/g, ".")
    .replace(/[‘’“”"'「」『』《》【】（）()]/g, " ")
    .replace(/\s+/g, "")
    .replace(/aocs\.qq\.com/gi, "docs.qq.com")
    .replace(/d0cs\.qq\.com/gi, "docs.qq.com")
    .replace(/d〇cs\.qq\.com/gi, "docs.qq.com")
    .replace(/docs\.qg\.com/gi, "docs.qq.com")
    .replace(/docsqq\.com/gi, "docs.qq.com")
    .replace(/docs\.qqcom/gi, "docs.qq.com")
    .replace(/docs\.qq\.c[o0]m/gi, "docs.qq.com")
    .replace(/(?:torm|fom|from|forrn)\/page/gi, "form/page")
    .replace(/formlpage/gi, "form/page")
    .replace(/formIpage/gi, "form/page");
  const ocrMatches = ocrText.match(/https?:\/\/docs\.qq\.com\/form\/page\/[A-Za-z0-9_-]{4,80}/gi) || [];
  const slashMatches = ocrText.match(/\/\/docs\.qq\.com\/form\/page\/[A-Za-z0-9_-]{4,80}/gi) || [];
  const nakedMatches = ocrText.match(/(?<![A-Za-z0-9_-])docs\.qq\.com\/form\/page\/[A-Za-z0-9_-]{4,80}/gi) || [];
  const pageOnlyMatches = ocrText.match(/(?<![A-Za-z0-9_-])form\/page\/[A-Za-z0-9_-]{12,80}/gi) || [];
  return cleanExtractedFormUrls([
    ...directMatches,
    ...ocrMatches,
    ...slashMatches.map((url) => `https:${url}`),
    ...nakedMatches.map((url) => `https://${url}`),
    ...pageOnlyMatches.map((url) => `https://docs.qq.com/${url}`)
  ]);
}

function qqFormIdFromUrl(url) {
  const match = String(url || "").match(/docs\.qq\.com\/form\/page\/([A-Za-z0-9_-]+)/i);
  return match ? match[1] : "";
}

function cleanExtractedFormUrls(values) {
  const records = [];
  for (const value of values || []) {
    const url = normalizeUrl(value);
    const id = qqFormIdFromUrl(url);
    if (id && id.length >= 12) {
      records.push({ url, id });
    }
  }
  const filtered = records.filter((record) => !records.some((other) => (
    other !== record
    && record.id.length > other.id.length
    && record.id.startsWith(other.id)
    && record.id.length - other.id.length <= 4
  )));
  return uniqueCleanList(filtered.map((record) => record.url));
}

function normalizeLinkText(value) {
  return String(value || "")
    .trim()
    .replace(/[\uFF1A\uFE55\uA789]/g, ":")
    .replace(/[\uFF0F\u2215\u2044\\|]/g, "/")
    .replace(/[\uFF0E\u3002\u2022\u00B7]/g, ".")
    .replace(/[\u2018\u2019\u201C\u201D"'`]/g, "")
    .replace(/aocs\.qq\.com/gi, "docs.qq.com")
    .replace(/d0cs\.qq\.com/gi, "docs.qq.com")
    .replace(/d\u3007cs\.qq\.com/gi, "docs.qq.com")
    .replace(/docs\.qg\.com/gi, "docs.qq.com")
    .replace(/docsqq\.com/gi, "docs.qq.com")
    .replace(/docs\.qqcom/gi, "docs.qq.com")
    .replace(/docs\.qq\.c[o0]m/gi, "docs.qq.com")
    .replace(/(?:torm|fom|from|forrn)\/page/gi, "form/page")
    .replace(/formlpage/gi, "form/page")
    .replace(/formIpage/gi, "form/page");
}

function normalizeUrl(value) {
  const text = normalizeLinkText(value)
    .replace(/\s+/g, "")
    .replace(/[,\uFF0C\u3002.;:!?\]\)\}]+$/g, "");
  const match = text.match(/(?:https?:\/\/)?docs\.qq\.com\/form\/page\/([A-Za-z0-9_-]{12,40}?)(?=(?:https?:\/\/|\/\/docs|docs\.qq\.com|form\/page|$|[^A-Za-z0-9_-]))/i)
    || text.match(/(?:https?:\/\/)?docs\.qq\.com\/form\/page\/([A-Za-z0-9_-]+)/i);
  if (match) {
    return `https://docs.qq.com/form/page/${match[1]}`;
  }
  return text;
}

function pushQqFormCandidate(list, id) {
  const cleanId = String(id || "").replace(/[^A-Za-z0-9_-]/g, "");
  if (cleanId.length >= 12 && cleanId.length <= 40) {
    list.push(canonicalQqFormUrl(cleanId));
  }
}

function collectFormUrlCandidates(source, list) {
  const text = String(source || "");
  if (!text) {
    return;
  }
  const suffixBoundary = "(?=(?:https?:\\/\\/|\\/\\/docs|docs\\.qq\\.com|form\\/page|$|[^A-Za-z0-9_-]))";
  const fullPattern = new RegExp(`(?:https?:\\/\\/)?(?:\\/\\/)?docs\\.qq\\.com\\/form\\/page\\/([A-Za-z0-9_-]{12,40}?)${suffixBoundary}`, "gi");
  const pagePattern = new RegExp(`form\\/page\\/([A-Za-z0-9_-]{12,40}?)${suffixBoundary}`, "gi");
  const idOnlyPattern = /(?:^|[^A-Za-z0-9_-])(D[A-Za-z0-9_-]{15,23})(?=$|[^A-Za-z0-9_-])/g;
  for (const match of text.matchAll(fullPattern)) {
    pushQqFormCandidate(list, match[1]);
  }
  for (const match of text.matchAll(pagePattern)) {
    pushQqFormCandidate(list, match[1]);
  }
  for (const match of text.matchAll(idOnlyPattern)) {
    const idStart = match.index + match[0].indexOf(match[1]);
    const before = text.slice(Math.max(0, idStart - 44), idStart).toLowerCase();
    const after = text.slice(idStart + match[1].length, idStart + match[1].length + 24).toLowerCase();
    if (before.includes("docs.qq.com/form/page/") || before.includes("form/page/")) {
      continue;
    }
    if (/^(?:https?:\/\/|\/\/docs|docs\.qq\.com|form\/page)/i.test(after)) {
      continue;
    }
    pushQqFormCandidate(list, match[1]);
  }
}

function extractFormUrls(text) {
  const rawText = String(text || "");
  const normalizedText = normalizeLinkText(rawText)
    .replace(/[\u300C\u300D\u300E\u300F\u300A\u300B\u3010\u3011\uFF08\uFF09]/g, " ");
  const compactText = normalizedText.replace(/\s+/g, "");
  const candidates = [];
  collectFormUrlCandidates(rawText, candidates);
  collectFormUrlCandidates(normalizedText, candidates);
  collectFormUrlCandidates(compactText, candidates);
  return cleanExtractedFormUrls(candidates);
}

function cleanExtractedFormUrls(values) {
  const records = [];
  for (const value of values || []) {
    const url = normalizeUrl(value);
    const id = qqFormIdFromUrl(url);
    if (id && id.length >= 12) {
      records.push({ url, id });
    }
  }
  return uniqueCleanList(records.map((record) => record.url));
}

function canonicalQqFormUrl(id) {
  return `https://docs.qq.com/form/page/${id}`;
}

function isLikelyQqFormUrl(url) {
  const id = qqFormIdFromUrl(url);
  return /^[A-Za-z0-9_-]{16,20}$/.test(id);
}

function isValidQqFormHtml(html) {
  const text = String(html || "");
  const title = (text.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "";
  const cleanTitle = title.trim();
  const genericTitle = /^(?:\u817e\u8baf\u6587\u6863|Tencent Docs)$/i.test(cleanTitle);
  return text.length > 70000 && cleanTitle && !genericTitle;
}

async function validateQqFormUrl(url) {
  const normalized = normalizeUrl(url);
  const id = qqFormIdFromUrl(normalized);
  if (!id || id.length < 12) {
    return { ok: false, url: normalized, reason: "too-short" };
  }
  const cached = qqFormValidationCache.get(normalized);
  if (cached) {
    if (typeof cached.then === "function") {
      return cached;
    }
    const age = Date.now() - Number(cached.checkedAt || 0);
    const maxAge = cached.ok ? QQ_FORM_VALIDATION_SUCCESS_CACHE_MS : QQ_FORM_VALIDATION_FAILURE_CACHE_MS;
    if (age < maxAge) {
      return cached;
    }
  }
  const fetchOnce = async (timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(normalized, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const html = await response.text();
      return { ok: response.ok && isValidQqFormHtml(html), url: normalized, status: response.status };
    } catch (error) {
      return { ok: false, url: normalized, reason: error.message };
    } finally {
      clearTimeout(timer);
    }
  };
  const promise = (async () => {
    let result = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = await fetchOnce(attempt === 0 ? 3000 : 4500);
      if (result.status) {
        break;
      }
      await delay(250);
    }
    const cachedResult = { ...(result || { ok: false, url: normalized, reason: "empty" }), checkedAt: Date.now() };
    qqFormValidationCache.set(normalized, cachedResult);
    return cachedResult;
  })();
  qqFormValidationCache.set(normalized, promise);
  return promise;
}

async function confirmQqFormUrl(url, options = {}) {
  const candidates = repairCandidatesForUrl(url);
  if (!candidates.length) {
    return "";
  }
  const direct = await validateQqFormUrl(candidates[0]);
  if (direct.ok) {
    return direct.url;
  }
  let fallbackUrl = isLikelyQqFormUrl(candidates[0]) ? candidates[0] : "";
  const rest = uniqueCleanList(candidates.slice(1)).slice(0, 48);
  for (let index = 0; index < rest.length; index += 6) {
    const batch = rest.slice(index, index + 6);
    for (const possible of batch) {
      if (!fallbackUrl && isLikelyQqFormUrl(possible)) {
        fallbackUrl = possible;
      }
    }
    const checkedBatch = await Promise.all(batch.map((possible) => validateQqFormUrl(possible)));
    const found = checkedBatch.find((checked) => checked.ok);
    if (found) {
      return found.url;
    }
  }
  return options.allowLikelyFallback ? fallbackUrl : "";
}

function htmlAttrValue(tag, attrName) {
  const match = String(tag || "").match(new RegExp(`${attrName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? match[2] : "";
}

function decodeHtmlText(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function collectQqFormStrings(value, output = [], limit = 24000) {
  if (output.join(" ").length >= limit || value === null || value === undefined) {
    return output;
  }
  if (typeof value === "string") {
    const text = decodeHtmlText(value);
    if (text) {
      output.push(text);
    }
    return output;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectQqFormStrings(item, output, limit);
      if (output.join(" ").length >= limit) {
        break;
      }
    }
    return output;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) {
      collectQqFormStrings(item, output, limit);
      if (output.join(" ").length >= limit) {
        break;
      }
    }
  }
  return output;
}

function extractQqFormEmbeddedText(html) {
  const match = String(html || "").match(/window\.basicClientVars=JSON\.parse\(decodeURIComponent\(escape\(atob\('([^']+)'\)\)\)\)/);
  if (!match) {
    return "";
  }
  try {
    const data = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    const parts = [
      data && data.docInfo && data.docInfo.padInfo && data.docInfo.padInfo.padTitle
    ];
    const rawPadText = data && data.padData && data.padData.text;
    if (rawPadText) {
      try {
        const padData = JSON.parse(rawPadText);
        parts.push(...collectQqFormStrings(padData));
      } catch (error) {
        parts.push(rawPadText);
      }
    }
    return uniqueCleanList(parts.map(decodeHtmlText)).join(" ");
  } catch (error) {
    return "";
  }
}

function extractQqFormMetaText(html) {
  const parts = [];
  const title = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    parts.push(title[1]);
  }
  const metaTags = String(html || "").match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const key = (htmlAttrValue(tag, "property") || htmlAttrValue(tag, "name")).toLowerCase();
    if (!["og:title", "og:description", "description", "keywords"].includes(key)) {
      continue;
    }
    const content = htmlAttrValue(tag, "content");
    if (content) {
      parts.push(content);
    }
  }
  const embeddedText = extractQqFormEmbeddedText(html);
  if (embeddedText) {
    parts.push(embeddedText);
  }
  return uniqueCleanList(parts.map(decodeHtmlText)).join(" ");
}

async function fetchQqFormTextForTrack(url) {
  const normalized = normalizeUrl(url);
  if (!qqFormIdFromUrl(normalized)) {
    return { ok: false, text: "", title: "", url: normalized };
  }
  const cached = qqFormTextCache.get(normalized);
  if (cached) {
    if (typeof cached.then === "function") {
      return cached;
    }
    if (Date.now() - Number(cached.checkedAt || 0) < QQ_FORM_TEXT_CACHE_MS) {
      return cached;
    }
  }
  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(normalized, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0" }
      });
      const html = await response.text();
      const text = extractQqFormMetaText(html);
      const result = {
        ok: response.ok,
        status: response.status,
        url: normalized,
        text,
        title: text,
        checkedAt: Date.now()
      };
      qqFormTextCache.set(normalized, result);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        url: normalized,
        text: "",
        title: "",
        reason: error.message,
        checkedAt: Date.now()
      };
      qqFormTextCache.set(normalized, result);
      return result;
    } finally {
      clearTimeout(timer);
    }
  })();
  qqFormTextCache.set(normalized, promise);
  return promise;
}

function guessTrackFromTexts(texts = [], options = {}) {
  const config = options.config || getMonitorConfig();
  const accountNames = uniqueCleanList(options.accountNames || options.fillAccounts || monitorFillAccountNames(config))
    .map(safeAccountName)
    .filter((name) => !name || getAccount(name));
  const candidates = uniqueCleanList((texts || []).map((text) => normalizeText(text)).filter(Boolean));
  const guessFrom = (text) => (accountNames.length ? accountNames : [""])
    .map((accountName) => ({
      accountName,
      ...guessTrackForAccount(text, accountName, "__auto__")
    }))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))[0] || { track: "", score: 0 };

  let best = { track: "", score: 0 };
  for (const text of candidates) {
    const current = guessFrom(text);
    if (Number(current.score || 0) > Number(best.score || 0)) {
      best = current;
    }
  }
  return {
    track: best.track || "",
    score: Number(best.score || 0),
    contextText: candidates.join(" ").slice(0, 1500)
  };
}

async function enrichRecordTrackByOpeningForm(record, options = {}) {
  if (!record || !record.url) {
    return record;
  }
  const confirmedUrl = await confirmQqFormUrl(record.url, { allowLikelyFallback: true });
  if (!confirmedUrl) {
    return record;
  }

  const opened = await detectTrackByOpeningForm(confirmedUrl, {
    visible: false,
    waitMs: Number(options.waitMs || 3200)
  });
  const fallbackText = options.formOnly ? "" : record.contextText || "";
  const guessed = opened.typeName
    ? {
      track: opened.typeName,
      score: Number(opened.score || 0),
      contextText: uniqueCleanList([opened.pageText || "", fallbackText]).join(" ").slice(0, 1500)
    }
    : guessTrackFromTexts([opened.pageText || "", fallbackText], options);
  const patch = {
    url: confirmedUrl,
    ...(guessed.contextText ? { contextText: guessed.contextText } : {})
  };
  if (guessed.track) {
    patch.expectedTrack = guessed.track;
    patch.trackScore = Number(guessed.score || 0);
    patch.message = `已进入表单确认赛道：${guessed.track}`;
  } else {
    patch.expectedTrack = "";
    patch.trackScore = 0;
    patch.message = "已进入表单，但暂时无法确认赛道";
  }
  if (record.id) {
    return updateHistoryItem(record.id, patch) || { ...record, ...patch };
  }
  return { ...record, ...patch };
}

async function enrichRecordTrackFromForm(record, options = {}) {
  if (!record || !record.url) {
    return record;
  }
  const config = options.config || getMonitorConfig();
  const formInfo = await fetchQqFormTextForTrack(record.url);
  const formText = formInfo.text || "";
  const fallbackText = record.contextText || "";
  const combinedText = uniqueCleanList([formText, fallbackText]).join(" ");
  if (!combinedText) {
    if (options.formOnly && record.expectedTrack) {
      const patch = {
        expectedTrack: "",
        trackScore: 0,
        message: "无法根据表单内容判断赛道，保持待填写"
      };
      if (record.id) {
        return updateHistoryItem(record.id, patch) || { ...record, ...patch };
      }
      return { ...record, ...patch };
    }
    return record;
  }
  const best = guessTrackFromTexts([
    formText,
    options.formOnly ? "" : fallbackText
  ], options);
  const patch = {
    contextText: best.contextText || combinedText.slice(0, 1500)
  };
  if (best.track) {
    patch.expectedTrack = best.track;
    patch.trackScore = Number(best.score || 0);
    patch.message = `已根据表单内容识别赛道：${best.track}`;
  } else if (options.formOnly) {
    patch.expectedTrack = "";
    patch.trackScore = 0;
    patch.message = "无法根据表单内容判断赛道，保持待填写";
  }
  if (record.id) {
    return updateHistoryItem(record.id, patch) || { ...record, ...patch };
  }
  return { ...record, ...patch };
}

async function detectFormTracksForItems(rawItems = [], options = {}) {
  const items = Array.isArray(rawItems) ? rawItems : [];
  const accountNames = uniqueCleanList(options.accountNames || []).map(safeAccountName);
  const results = [];
  const seen = new Set();
  for (const raw of items.slice(0, 80)) {
    const rawUrl = raw && raw.url || raw;
    const url = normalizeUrl(rawUrl);
    if (!qqFormIdFromUrl(url)) {
      continue;
    }
    const key = normalizeUrl(url).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const enriched = await enrichRecordTrackFromForm(
      {
        url,
        expectedTrack: "",
        trackScore: 0,
        contextText: ""
      },
      { accountNames, formOnly: true }
    );
    results.push({
      url,
      expectedTrack: enriched.expectedTrack || "",
      trackScore: Number(enriched.trackScore || 0),
      status: enriched.expectedTrack ? "ok" : "unknown",
      message: enriched.message || (enriched.expectedTrack ? `已根据表单内容识别赛道：${enriched.expectedTrack}` : "无法根据表单内容判断赛道")
    });
  }
  return { items: results };
}

function repairCandidatesForUrl(url) {
  const id = qqFormIdFromUrl(url);
  if (!id) {
    return [];
  }
  const cleanId = id.replace(/[^A-Za-z0-9_-]/g, "");
  const ids = [];
  const addId = (value) => {
    const text = String(value || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (text.length >= 12 && !ids.includes(text)) {
      ids.push(text);
    }
  };
  addId(cleanId);
  for (let trim = 1; trim <= 10; trim += 1) {
    if (cleanId.length - trim >= 12) {
      addId(cleanId.slice(0, cleanId.length - trim));
    }
  }
  for (const match of cleanId.matchAll(/^(D[A-Za-z0-9_-]{15,23}?)(?:ME|https|http|Weixin|WeiXin|[0-9]{1,4})?$/g)) {
    addId(match[1]);
  }

  const variants = [];
  const maxVariants = 96;
  const addVariant = (value) => {
    if (value.length >= 12 && variants.length < maxVariants && !variants.includes(value)) {
      variants.push(value);
      return true;
    }
    return false;
  };
  const strongReplacementGroups = [
    [/O/g, "0"],
    [/8/g, "B"],
    [/l/g, "I"],
    [/L/g, "I"]
  ];
  const commonReplacementGroups = [
    ...strongReplacementGroups,
    [/o/g, "0"]
  ];
  const shapeReplacements = [
    ["LJ", "U"],
    ["Lj", "U"],
    ["LI", "U"],
    ["Li", "U"],
    ["L1", "U"],
    ["lJ", "U"],
    ["IJ", "U"],
    ["VvnW", "WWJ"],
    ["VvW", "WWJ"],
    ["vvW", "WWJ"],
    ["VVJ", "WWJ"],
    ["VV", "W"],
    ["Vv", "W"],
    ["vV", "W"],
    ["vv", "W"],
    ["VnW", "WWJ"],
    ["BLJR", "BUR"],
    ["8UR", "BUR"],
    ["BUK", "BUR"],
    ["FLJ", "FU"],
    ["KLJ", "KU"],
    ["kLJ", "kU"],
    ["rn", "m"],
    ["cl", "d"]
  ];
  const replacements = {
    "O": ["0"],
    "o": ["0"],
    "8": ["B"],
    "l": ["I"],
    "L": ["I"],
    "Q": ["O", "0"],
    "I": ["l", "1"],
    "1": ["I", "l"],
    "B": ["8"],
    "0": ["O"],
    "2": ["Z"],
    "Z": ["2"],
    "5": ["S"],
    "S": ["5"],
    "6": ["G"],
    "G": ["6"],
    "U": ["V"],
    "V": ["U"],
    "9": ["g", "q"],
    "g": ["9", "q"],
    "q": ["g", "9"]
  };
  const addCommonVariants = (value) => {
    let current = value;
    for (const [pattern, replacement] of strongReplacementGroups) {
      current = current.replace(pattern, replacement);
    }
    addVariant(current);
    for (const [pattern, replacement] of commonReplacementGroups) {
      addVariant(value.replace(pattern, replacement));
    }
  };
  const addShapeVariants = (value) => {
    let frontier = [value];
    const seenShapes = new Set(frontier);
    for (let depth = 0; depth < 2 && variants.length < maxVariants; depth += 1) {
      const next = [];
      for (const current of frontier) {
        for (const [from, to] of shapeReplacements) {
          if (!current.includes(from)) {
            continue;
          }
          const candidate = current.split(from).join(to);
          if (seenShapes.has(candidate)) {
            continue;
          }
          seenShapes.add(candidate);
          addVariant(candidate);
          next.push(candidate);
          if (variants.length >= maxVariants) {
            break;
          }
        }
        if (variants.length >= maxVariants) {
          break;
        }
      }
      frontier = next;
    }
  };
  const addCharVariants = (value) => {
    let frontier = [value];
    for (let depth = 0; depth < 2 && variants.length < maxVariants; depth += 1) {
      const next = [];
      const seenNext = new Set();
      for (const current of frontier) {
        for (let index = 0; index < current.length && variants.length < maxVariants; index += 1) {
          const choices = replacements[current[index]] || [];
          for (const choice of choices) {
            const candidate = `${current.slice(0, index)}${choice}${current.slice(index + 1)}`;
            addVariant(candidate);
            if (!seenNext.has(candidate) && next.length < 96) {
              seenNext.add(candidate);
              next.push(candidate);
            }
            if (variants.length >= maxVariants) {
              break;
            }
          }
        }
      }
      frontier = next;
    }
  };
  for (const item of ids) {
    addVariant(item);
    addCommonVariants(item);
    addShapeVariants(item);
  }
  for (const item of ids.filter((value) => value.length <= 22)) {
    addCharVariants(item);
  }
  return uniqueCleanList(variants).map(canonicalQqFormUrl);
}

async function resolveFormUrls(text, options = {}) {
  const rawCandidates = extractFormUrls(text);
  const resolved = await Promise.all(rawCandidates.slice(0, 36).map((url) => confirmQqFormUrl(url, {
    allowLikelyFallback: options.allowLikelyFallback === true
  })));
  return cleanExtractedFormUrls(resolved);
}

function normalizeMonitorReadMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "local" || mode === "ocr") {
    return mode;
  }
  return "ocr";
}

function sanitizeMonitorConfig(input) {
  const fallback = defaultMonitorConfig();
  const raw = input && typeof input === "object" ? input : {};
  const sources = Array.isArray(raw.sources) ? raw.sources : [];
  const windowBindings = Array.isArray(raw.windowBindings) ? raw.windowBindings : [];
  const rawIntervalMs = Number(raw.intervalMs);
  let intervalMs = rawIntervalMs && rawIntervalMs >= 5000
    ? Math.max(5000, Math.min(60000, rawIntervalMs))
    : fallback.intervalMs;
  const rawScanBatchSize = raw.scanBatchSize === undefined || raw.scanBatchSize === null
    ? fallback.scanBatchSize
    : Number(raw.scanBatchSize);
  let scanBatchSize = Math.max(1, Math.min(8, rawScanBatchSize || fallback.scanBatchSize));
  let targetCycleSeconds = Math.max(5, Math.min(300, Number(raw.targetCycleSeconds) || fallback.targetCycleSeconds));
  if (rawScanBatchSize === 0) {
    if (intervalMs <= 10000 || targetCycleSeconds <= 75) {
      intervalMs = 5000;
      scanBatchSize = 2;
      targetCycleSeconds = 5;
    } else if (intervalMs >= 18000 || targetCycleSeconds >= 160) {
      intervalMs = 30000;
      scanBatchSize = 1;
      targetCycleSeconds = 30;
    } else {
      intervalMs = 15000;
      scanBatchSize = 1;
      targetCycleSeconds = 15;
    }
  }
  return {
    enabled: raw.enabled === true,
    autoFill: raw.autoFill === true,
    detectClipboard: raw.detectClipboard !== false,
    detectWechatWindow: raw.detectWechatWindow !== false,
    syncQueue: raw.syncQueue === true,
    syncQueueStartedAt: String(raw.syncQueueStartedAt || "").slice(0, 40),
    readMode: normalizeMonitorReadMode(raw.readMode || fallback.readMode),
    intervalMs,
    scanBatchSize,
    targetCycleSeconds,
    fillAccounts: uniqueCleanList(raw.fillAccounts || []).map(safeAccountName).filter(Boolean).slice(0, 20),
    autoFillStartedAt: String(raw.autoFillStartedAt || "").slice(0, 40),
    sources: sources.map((source, index) => ({
      id: String(source.id || makeId("source")),
      name: monitorLabel(source.name, `微信窗口 ${index + 1}`).slice(0, 80),
      account: "",
      douyinIndex: source.douyinIndex === undefined || source.douyinIndex === null ? "" : String(source.douyinIndex),
      enabled: source.enabled !== false
    })).filter((source) => source.name),
    windowBindings: windowBindings.map((binding, index) => ({
      id: String(binding.id || makeId("binding")),
      hwnd: String(binding.hwnd || "").trim().slice(0, 40),
      pid: String(binding.pid || "").trim().slice(0, 20),
      title: monitorLabel(binding.title, `微信窗口 ${index + 1}`).slice(0, 80),
      sourceId: String(binding.sourceId || "").trim().slice(0, 120),
      account: "",
      enabled: binding.enabled !== false,
      boundAt: String(binding.boundAt || "").slice(0, 40),
      startAfterUrl: normalizeUrl(binding.startAfterUrl || ""),
      startInclusive: binding.startInclusive === true,
      startAfterSetAt: String(binding.startAfterSetAt || "").slice(0, 40),
      pendingStartUrls: normalizeMonitorUrlList(binding.pendingStartUrls || []).slice(0, 60),
      pendingStartContextText: String(binding.pendingStartContextText || "").slice(0, 1000),
      virtualScreen: binding.virtualScreen === true,
      virtualScreenDevice: String(binding.virtualScreenDevice || "").slice(0, 120),
      virtualScreenDockedAt: String(binding.virtualScreenDockedAt || "").slice(0, 40),
      ignoredUrls: uniqueCleanList(binding.ignoredUrls || [])
        .map(normalizeUrl)
        .filter((url) => qqFormIdFromUrl(url))
        .slice(-120)
    })).filter((binding) => binding.hwnd && binding.sourceId)
  };
}

function getMonitorConfig() {
  return sanitizeMonitorConfig(readJson(monitorPath, defaultMonitorConfig()));
}

function writeMonitorConfig(config) {
  const next = sanitizeMonitorConfig(config);
  writeJson(monitorPath, next);
  return next;
}

function isUnreadableMonitorLabel(value) {
  const text = String(value || "").trim();
  return !text || /^[?\uFFFD\s]+$/.test(text);
}

function monitorLabel(value, fallback) {
  const text = String(value || "").trim();
  return isUnreadableMonitorLabel(text) ? fallback : text;
}

function displayStatusForServer(status) {
  return status === "已发现" || status === "待分配" ? "待填写" : String(status || "待填写");
}

function readHistory() {
  const data = readJson(historyPath, { items: [] });
  if (!Array.isArray(data.items)) {
    return { items: [] };
  }
  return {
    items: data.items.map((item) => {
      const douyinIndex = item.douyinIndex === undefined || item.douyinIndex === null ? "" : String(item.douyinIndex);
      const status = item.status === "已发现" || item.status === "待分配" ? "待填写" : item.status;
      return {
        ...item,
        douyinIndex,
        douyinLabel: douyinIndex ? item.douyinLabel || "" : "",
        status: status || "待填写",
        contextText: item.contextText || "",
        linkStatus: item.linkStatus || (item.url ? "已验证" : ""),
        verifiedAt: item.verifiedAt || "",
        trackScore: Number(item.trackScore || 0),
        duplicateSources: Array.isArray(item.duplicateSources) ? item.duplicateSources : [],
        monitorSessionAt: item.monitorSessionAt || "",
        filledAt: item.filledAt || ""
      };
    })
  };
}

function writeHistory(data) {
  const next = {
    items: (Array.isArray(data.items) ? data.items : []).slice(0, 500)
  };
  writeJson(historyPath, next);
  return next;
}

function deleteHistoryItems(ids = []) {
  const idSet = new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || "")).filter(Boolean));
  if (!idSet.size) {
    return { deleted: 0, items: readHistory().items };
  }
  const data = readHistory();
  const before = data.items.length;
  const items = data.items.filter((item) => !idSet.has(String(item.id || "")));
  writeHistory({ items });
  return {
    deleted: before - items.length,
    items: readHistory().items
  };
}

function getDouyinLabel(accountName, douyinIndex) {
  if (douyinIndex === undefined || douyinIndex === null || String(douyinIndex) === "") {
    return "";
  }
  if (douyinIndex === "__auto__") {
    return "智能匹配抖音号 / 赛道";
  }
  const account = getAccount(accountName);
  const index = Number(douyinIndex);
  const douyin = account && Number.isInteger(index) ? (account.douyinAccounts || [])[index] : null;
  if (!douyin) {
    return "";
  }
  const tracks = douyinTracks(douyin);
  return `${douyin.nickname || "未命名"} / ${douyin.douyinId || "无ID"} / ${tracks.length ? tracks.join("、") : "未分类"}`;
}

function trackMatches(expectedTrack, candidateTrack) {
  const expected = compactForScore(expectedTrack);
  const candidate = compactForScore(candidateTrack);
  if (!expected || !candidate) {
    return false;
  }
  return expected === candidate
    || scoreTrack(expectedTrack, candidateTrack) >= TRACK_MATCH_MIN_SCORE
    || scoreTrack(candidateTrack, expectedTrack) >= TRACK_MATCH_MIN_SCORE;
}

function matchingDouyinTargets(account, expectedTrack) {
  if (!account || !expectedTrack) {
    return [];
  }
  return (account.douyinAccounts || [])
    .map((douyin, index) => ({ douyin, index, tracks: douyinTracks(douyin) }))
    .filter((item) => item.tracks.some((track) => trackMatches(expectedTrack, track)));
}

function resolveFillTargets(account, item = {}, fallbackText = "", options = {}) {
  const requireExpectedTrack = options.requireExpectedTrack === true;
  const includeTrackSiblings = options.includeTrackSiblings === true;
  const requestedIndex = item.douyinIndex === undefined || item.douyinIndex === null ? "__auto__" : String(item.douyinIndex);
  if (requestedIndex && requestedIndex !== "__auto__") {
    if (requireExpectedTrack && !item.expectedTrack) {
      return { track: "", targets: [], reason: "无法根据表单内容判断赛道，已停止自动填写" };
    }
    const index = Number(requestedIndex);
    const douyin = account && Number.isInteger(index) ? (account.douyinAccounts || [])[index] : null;
    if (!douyin) {
      return { track: item.expectedTrack || "", targets: [], reason: `${account && account.name || "当前微信号"} 没有这个抖音号` };
    }
    if (includeTrackSiblings && item.expectedTrack) {
      const targets = matchingDouyinTargets(account, item.expectedTrack);
      if (targets.some((target) => Number(target.index) === index)) {
        return { track: item.expectedTrack || "", targets, trackScore: item.trackScore || 0 };
      }
    }
    return { track: item.expectedTrack || "", targets: [{ douyin, index, tracks: douyinTracks(douyin) }] };
  }

  const guessed = item.expectedTrack
    ? { track: item.expectedTrack, score: Number(item.trackScore || 0) }
    : requireExpectedTrack
      ? { track: "", score: 0 }
      : guessTrackForAccount(item.contextText || fallbackText || "", account && account.name || "", "__auto__");
  const track = guessed.track || "";
  if (!track) {
    return { track: "", targets: [], reason: requireExpectedTrack ? "无法根据表单内容判断赛道，已停止自动填写" : "无法判断表单赛道，先补充赛道文字后再填写" };
  }
  const targets = matchingDouyinTargets(account, track);
  return targets.length
    ? { track, trackScore: guessed.score || 0, targets }
    : { track, trackScore: guessed.score || 0, targets: [], reason: `${account.name} 没有匹配「${track}」赛道的抖音号` };
}

function createHistoryItem(item) {
  const data = readHistory();
  const now = new Date().toISOString();
  const url = normalizeUrl(item.url);
  const source = String(item.source || "手动").trim();
  const account = safeAccountName(item.account);
  const douyinIndex = item.douyinIndex === undefined || item.douyinIndex === null ? "" : String(item.douyinIndex);
  if (item.dedupe !== false) {
    const duplicate = data.items.find((existing) => (
      existing.url === url
      && existing.account === account
      && String(existing.douyinIndex || "") === douyinIndex
      && existing.status !== "失败"
    ));
    if (duplicate) {
      return duplicate;
    }
  }

  const next = {
    id: makeId("history"),
    createdAt: now,
    updatedAt: now,
    source,
    channel: String(item.channel || "manual"),
    url,
    account,
    douyinIndex,
    douyinLabel: item.douyinLabel || getDouyinLabel(account, item.douyinIndex),
    expectedTrack: item.expectedTrack || "",
    trackScore: Number(item.trackScore || 0),
    attemptLabel: item.attemptLabel || "",
    status: item.status || "待填写",
    jobId: item.jobId || "",
    message: item.message || "",
    contextText: item.contextText || "",
    linkStatus: item.linkStatus || "已验证",
    verifiedAt: item.verifiedAt || now,
    screenshotPath: item.screenshotPath || "",
    duplicateCount: Number(item.duplicateCount || 0),
    duplicateSources: Array.isArray(item.duplicateSources) ? item.duplicateSources : [],
    lastSeenAt: item.lastSeenAt || "",
    monitorSessionAt: item.monitorSessionAt || "",
    filledAt: item.filledAt || ""
  };
  data.items.unshift(next);
  writeHistory(data);
  return next;
}

function updateHistoryItem(id, patch) {
  const data = readHistory();
  const index = data.items.findIndex((item) => item.id === id);
  if (index < 0) {
    return null;
  }
  data.items[index] = {
    ...data.items[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };
  writeHistory(data);
  return data.items[index];
}

function getHistoryItem(id) {
  return readHistory().items.find((item) => item.id === id) || null;
}

function startOfLocalDayMs(value = new Date()) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function addLocalDaysMs(startMs, days) {
  const date = new Date(startMs);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function historyExportTime(item) {
  const date = new Date(item && (item.filledAt || item.updatedAt || item.createdAt) || "");
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function formatExportDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  ].join(" ");
}

function exportFileStamp() {
  const date = new Date();
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function isFilledHistoryItem(item) {
  return displayStatusForServer(item && item.status) === "已提交";
}

function historyItemsForExport({ range = "today" } = {}) {
  const today = startOfLocalDayMs();
  const tomorrow = addLocalDaysMs(today, 1);
  return readHistory().items
    .filter((item) => {
      if (!item.url || !item.account || !isFilledHistoryItem(item)) {
        return false;
      }
      if (range !== "today") {
        return true;
      }
      const time = historyExportTime(item);
      return time >= today && time < tomorrow;
    })
    .sort((a, b) => historyExportTime(a) - historyExportTime(b));
}

function resolveHistoryExportDir(options = {}) {
  const requested = String(options.outputDir || options.dir || "").trim();
  if (!requested) {
    fs.mkdirSync(outputDir, { recursive: true });
    return outputDir;
  }
  const target = path.resolve(requested);
  if (fs.existsSync(target) && !fs.statSync(target).isDirectory()) {
    throw new Error("导出路径不是文件夹");
  }
  fs.mkdirSync(target, { recursive: true });
  return target;
}

function exportHistoryExcel(options = {}) {
  const range = String(options.range || "today");
  const items = historyItemsForExport({ range });
  if (!items.length) {
    throw new Error(range === "today" ? "今天还没有成功记录" : "没有可导出的成功记录");
  }

  const rows = [
    ["日期", "链接", "微信号", "对应抖音号", "是否已剪辑"],
    ...items.map((item) => [
      formatExportDateTime(item.filledAt || item.updatedAt || item.createdAt),
      item.url || "",
      item.account || "",
      item.douyinLabel || getDouyinLabel(item.account, item.douyinIndex) || "",
      ""
    ])
  ];
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 18 },
    { wch: 52 },
    { wch: 18 },
    { wch: 42 },
    { wch: 14 }
  ];
  XLSX.utils.book_append_sheet(workbook, worksheet, "成功记录");

  const exportDir = resolveHistoryExportDir(options);
  const fileName = `填表记录-${range === "today" ? "今日成功记录" : "成功记录"}-${exportFileStamp()}.xlsx`;
  const filePath = path.join(exportDir, fileName);
  XLSX.writeFile(workbook, filePath);
  return {
    path: filePath,
    dir: exportDir,
    fileName,
    count: items.length
  };
}

function fillableHistoryItems({ ids = [], account = "" } = {}) {
  const idSet = new Set((ids || []).map((id) => String(id || "")));
  return readHistory().items.filter((item) => {
    if (idSet.size && !idSet.has(String(item.id || ""))) {
      return false;
    }
    if (account && item.account !== account) {
      return false;
    }
    return item.url && item.account && item.status === "待填写";
  });
}

function accountNamesFromBody(body) {
  const names = Array.isArray(body && body.accounts) && body.accounts.length
    ? body.accounts
    : [body && body.account];
  return uniqueCleanList(names.map(safeAccountName));
}

function findHistoryByUrlAccount(url, accountName, douyinIndex = "") {
  const normalizedUrl = normalizeUrl(url);
  const safeAccount = safeAccountName(accountName);
  const targetDouyin = douyinIndex === undefined || douyinIndex === null ? "" : String(douyinIndex);
  return readHistory().items.find((item) => (
    item.url === normalizedUrl
    && item.account === safeAccount
    && (!targetDouyin || String(item.douyinIndex || "") === targetDouyin)
    && item.status !== "失败"
  )) || null;
}

function blocksRepeatFill(item) {
  return ["填写中", "待提交", "已提交", "已填过", "不可填写", "已同步"].includes(item && item.status);
}

function monitorFillAccountNames(config = getMonitorConfig()) {
  return uniqueCleanList(config.fillAccounts || [])
    .map(safeAccountName)
    .filter((name) => getAccount(name));
}

function createMonitorLinkRecord({ url, sourceName, channel, expectedTrack, trackScore, contextText, monitorSessionAt, includeExistingInSession }) {
  const normalizedUrl = normalizeUrl(url);
  const now = new Date().toISOString();
  const existing = findHistoryByUrlAccount(normalizedUrl, "", "__monitor__");
  if (existing) {
    const canJoinSession = includeExistingInSession === true
      && displayStatusForServer(existing.status) !== "填写中";
    const updated = updateHistoryItem(existing.id, {
      duplicateCount: Number(existing.duplicateCount || 0) + 1,
      duplicateSources: uniqueCleanList([
        ...(Array.isArray(existing.duplicateSources) ? existing.duplicateSources : []),
        existing.source,
        sourceName
      ]),
      lastSeenAt: now,
      ...(contextText ? { contextText } : {}),
      ...(expectedTrack && !existing.expectedTrack ? { expectedTrack, trackScore } : {}),
      ...(canJoinSession ? { monitorSessionAt: monitorSessionAt || now } : {})
    }) || existing;
    return { item: updated, created: false, sessionActivated: canJoinSession };
  }
  return {
    item: createHistoryItem({
      source: sourceName,
      channel,
      url: normalizedUrl,
      account: "",
      douyinIndex: "__monitor__",
      douyinLabel: "监控链接池",
      expectedTrack,
      trackScore: Number(trackScore || 0),
      status: "待填写",
      linkStatus: "已验证",
      verifiedAt: now,
      message: "待填写",
      contextText,
      monitorSessionAt: monitorSessionAt || "",
      dedupe: false
    }),
    created: true,
    sessionActivated: Boolean(monitorSessionAt)
  };
}

async function confirmMonitorRecordTrack(record, options = {}) {
  if (!record || !record.url || record.expectedTrack) {
    return record;
  }
  const config = options.config || getMonitorConfig();
  const accountNames = uniqueCleanList(options.accountNames || monitorFillAccountNames(config));
  let nextRecord = record;
  let browserError = null;

  try {
    nextRecord = await enrichRecordTrackByOpeningForm(record, {
      config,
      accountNames,
      formOnly: true
    });
  } catch (error) {
    browserError = error;
  }

  if (!nextRecord.expectedTrack) {
    nextRecord = await enrichRecordTrackFromForm(nextRecord, {
      config,
      accountNames,
      formOnly: true
    });
  }

  const trackMessage = nextRecord.expectedTrack
    ? nextRecord.message || `已进入表单确认赛道：${nextRecord.expectedTrack}`
    : browserError
      ? `赛道确认失败：${browserError.message}`
      : nextRecord.message || "已进入表单，但暂时无法确认赛道";
  updateMonitorEventsForUrls([record.url, nextRecord.url], {
    expectedTrack: nextRecord.expectedTrack || "",
    trackScore: Number(nextRecord.trackScore || 0),
    trackStatus: nextRecord.expectedTrack ? "confirmed" : "unknown",
    trackMessage,
    contextText: nextRecord.contextText || record.contextText || ""
  });
  if (browserError && !nextRecord.expectedTrack) {
    monitorLog(`表单赛道确认失败：${browserError.message}`);
  }
  return nextRecord;
}

function queueMonitorTrackConfirmation(record, options = {}) {
  if (!record || !record.url || record.expectedTrack) {
    return false;
  }
  const normalizedUrl = normalizeUrl(record.url).toLowerCase();
  if (!normalizedUrl || monitorRuntime.trackDetectActiveUrls.has(normalizedUrl)) {
    return false;
  }
  monitorRuntime.trackDetectActiveUrls.add(normalizedUrl);
  monitorRuntime.trackDetectQueue.push({
    id: record.id || "",
    url: normalizeUrl(record.url),
    contextText: record.contextText || "",
    accountNames: uniqueCleanList(options.accountNames || monitorFillAccountNames(options.config || getMonitorConfig()))
  });
  updateMonitorEventsForUrl(record.url, {
    trackStatus: "checking",
    trackMessage: "正在进入表单确认赛道"
  });
  processMonitorTrackConfirmationQueue().catch((error) => {
    monitorLog(`赛道确认队列异常：${error.message}`);
  });
  return true;
}

async function processMonitorTrackConfirmationQueue() {
  if (monitorRuntime.trackDetectProcessing) {
    return;
  }
  monitorRuntime.trackDetectProcessing = true;
  try {
    while (monitorRuntime.trackDetectQueue.length) {
      const queued = monitorRuntime.trackDetectQueue.shift();
      const key = normalizeUrl(queued.url).toLowerCase();
      try {
        const current = queued.id ? getHistoryItem(queued.id) || queued : queued;
        if (!current || !current.url || current.expectedTrack) {
          continue;
        }
        await confirmMonitorRecordTrack(current, {
          config: getMonitorConfig(),
          accountNames: queued.accountNames,
          formOnly: true
        });
      } catch (error) {
        updateMonitorEventsForUrl(queued.url, {
          trackStatus: "unknown",
          trackMessage: `赛道确认失败：${error.message}`
        });
        monitorLog(`赛道确认失败：${error.message}`);
      } finally {
        monitorRuntime.trackDetectActiveUrls.delete(key);
      }
    }
  } finally {
    monitorRuntime.trackDetectProcessing = false;
  }
}

async function waitForPendingMonitorTrackConfirmation(record, timeoutMs = 30000) {
  const key = normalizeUrl(record && record.url).toLowerCase();
  if (!key || !monitorRuntime.trackDetectActiveUrls.has(key)) {
    return record;
  }
  const startedAt = Date.now();
  while (monitorRuntime.trackDetectActiveUrls.has(key) && Date.now() - startedAt < timeoutMs) {
    const current = record && record.id ? getHistoryItem(record.id) : null;
    if (current && current.expectedTrack) {
      return current;
    }
    await delay(300);
  }
  return record && record.id ? getHistoryItem(record.id) || record : record;
}

async function startAutoFillFromMonitorRecord(record, config) {
  if (!record || !record.url) {
    return [];
  }
  record = await waitForPendingMonitorTrackConfirmation(record);
  record = await confirmMonitorRecordTrack(record, { config, formOnly: true });
  const isMonitorRecord = !record.account || record.douyinIndex === "__monitor__";
  if (!isMonitorRecord && displayStatusForServer(record.status) !== "待填写") {
    return [];
  }
  const accountNames = monitorFillAccountNames(config);
  if (!accountNames.length) {
    updateHistoryItem(record.id, { message: "待填写：请选择参与填表微信号" });
    monitorLog("待填写：未设置参与填表微信号");
    return [];
  }

  const started = [];
  const errors = [];
  const skippedExisting = [];
  const answerSettings = readJson(answersPath, {});
  const canUseRepeatButton = answerSettings.autoSubmit === true;
  for (const accountName of accountNames) {
    try {
      const account = getAccount(accountName);
      if (!account) {
        throw new Error(`没有找到账号：${accountName}`);
      }
      const targetInfo = resolveFillTargets(account, {
        ...record,
        douyinIndex: "__auto__"
      }, record.contextText || record.expectedTrack || "", { requireExpectedTrack: true });
      if (!targetInfo.targets.length) {
        errors.push(targetInfo.reason || `${account.name} 没有匹配的抖音号`);
        continue;
      }
      const preparedTargets = [];
      for (const target of targetInfo.targets) {
        const douyinIndex = String(target.index);
        validateFillRequest(account, douyinIndex, false);
        const prepared = prepareFillHistory({
          source: record.source || "监控采集",
          channel: record.channel || "wechat",
          url: record.url,
          accountName: account.name,
          douyinIndex,
          expectedTrack: targetInfo.track || record.expectedTrack,
          trackScore: targetInfo.trackScore || record.trackScore,
          contextText: record.contextText,
          message: targetInfo.track ? `监控采集已加入填表队列 · 匹配赛道：${targetInfo.track}` : "监控采集已加入填表队列",
          dedupe: true
        });
        if (prepared.skipped) {
          errors.push(prepared.reason);
          skippedExisting.push(prepared.reason);
          continue;
        }
        const historyItem = prepared.item;
        preparedTargets.push({ douyinIndex, historyId: historyItem.id });
      }
      if (!preparedTargets.length) {
        continue;
      }
      const targetGroups = canUseRepeatButton
        ? [preparedTargets]
        : preparedTargets.map((target) => [target]);
      for (const groupTargets of targetGroups) {
        const historyTargets = groupTargets.map((target) => ({
          historyId: target.historyId,
          douyinIndex: target.douyinIndex,
          expectedTrack: targetInfo.track || record.expectedTrack
        }));
        const job = startFillJob({
          accountName: account.name,
          url: record.url,
          douyinIndex: groupTargets[0].douyinIndex,
          douyinIndexes: groupTargets.map((target) => target.douyinIndex),
          expectedTrack: targetInfo.track || record.expectedTrack,
          historyId: historyTargets[0] && historyTargets[0].historyId || "",
          historyTargets,
          includeTrackSiblings: canUseRepeatButton
        });
        for (const groupTarget of groupTargets) {
          updateHistoryItem(groupTarget.historyId, { status: "填写中", jobId: job.id, message: "监控采集已加入填表队列" });
          started.push({ jobId: job.id, historyId: groupTarget.historyId, account: account.name });
        }
      }
    } catch (error) {
      errors.push(error.message);
    }
  }
  if (started.length) {
    updateHistoryItem(record.id, {
      status: "已同步",
      message: `已分配到 ${started.length} 个填表任务`
    });
  } else if (skippedExisting.length && skippedExisting.length === errors.length) {
    updateHistoryItem(record.id, {
      status: "已填过",
      message: "这条链接对应的抖音号已有记录，已跳过"
    });
  } else if (errors.length) {
    updateHistoryItem(record.id, { message: errors[0] });
  }
  return started;
}

function monitorAutoFillProgressPatch(patch = {}) {
  monitorRuntime.autoFillProgress = {
    ...monitorRuntime.autoFillProgress,
    ...patch,
    enabled: getMonitorConfig().autoFill === true,
    pending: monitorRuntime.autoFillQueue.length,
    running: monitorRuntime.autoFillProcessing === true,
    updatedAt: new Date().toISOString()
  };
  return monitorRuntime.autoFillProgress;
}

function publicMonitorAutoFillProgress() {
  const progress = monitorRuntime.autoFillProgress || {};
  return {
    ...progress,
    enabled: getMonitorConfig().autoFill === true,
    pending: monitorRuntime.autoFillQueue.length,
    running: monitorRuntime.autoFillProcessing === true,
    queue: monitorRuntime.autoFillQueue.slice(0, 50).map((item) => ({
      id: item.id || "",
      url: item.url || "",
      source: item.source || "",
      createdAt: item.createdAt || ""
    }))
  };
}

function monitorRecordTrackStatus(item) {
  if (item && item.expectedTrack) {
    return "confirmed";
  }
  const key = normalizeUrl(item && item.url).toLowerCase();
  const message = String(item && item.message || "");
  if (key && monitorRuntime.trackDetectActiveUrls.has(key)) {
    return "checking";
  }
  if (/确认中|正在|进入表单/.test(message)) {
    return "checking";
  }
  if (/无法|失败|暂时无法|未确认/.test(message)) {
    return "unknown";
  }
  return "";
}

function publicMonitorRecords(limit = 200) {
  return readHistory().items
    .filter((item) => item && item.url && !item.account && String(item.douyinIndex || "") === "__monitor__")
    .slice(0, Math.max(1, Math.min(500, Number(limit) || 200)))
    .map((item) => {
      const trackStatus = monitorRecordTrackStatus(item);
      return {
        id: item.id || "",
        url: item.url || "",
        source: item.source || "",
        expectedTrack: item.expectedTrack || "",
        trackScore: Number(item.trackScore || 0),
        trackStatus,
        trackMessage: trackStatus
          ? item.message || (item.expectedTrack ? `已确认赛道：${item.expectedTrack}` : "")
          : "",
        status: displayStatusForServer(item.status),
        createdAt: item.createdAt || "",
        updatedAt: item.updatedAt || item.lastSeenAt || item.createdAt || "",
        monitorSessionAt: item.monitorSessionAt || ""
      };
    });
}

function resetMonitorAutoFillProgress(patch = {}) {
  const now = new Date().toISOString();
  monitorRuntime.autoFillProgress = {
    enabled: getMonitorConfig().autoFill === true,
    running: monitorRuntime.autoFillProcessing === true,
    pending: monitorRuntime.autoFillQueue.length,
    completed: 0,
    currentIndex: 0,
    total: 0,
    currentUrl: "",
    currentSource: "",
    currentStatus: "idle",
    currentJobIds: [],
    currentDone: 0,
    currentFailed: 0,
    currentRunning: 0,
    currentTotal: 0,
    message: "",
    startedAt: "",
    updatedAt: now,
    ...patch
  };
  return publicMonitorAutoFillProgress();
}

function stopMonitorAutoFillQueue(message = "监控填写已中止") {
  const config = getMonitorConfig();
  if (config.autoFill) {
    writeMonitorConfig({
      ...config,
      autoFill: false
    });
  }
  monitorRuntime.autoFillStopRequested = true;
  monitorRuntime.autoFillQueue = [];
  const currentJobIds = uniqueCleanList(monitorRuntime.autoFillProgress.currentJobIds || []);
  const cancelled = currentJobIds.length
    ? cancelJobsById(currentJobIds, "fill")
    : { jobs: [], missing: [], ignored: [] };
  monitorAutoFillProgressPatch({
    currentStatus: "cancelled",
    currentRunning: 0,
    pending: 0,
    message
  });
  monitorLog(message);
  return {
    ok: true,
    cancelled: cancelled.jobs.length,
    missing: cancelled.missing,
    ignored: cancelled.ignored,
    progress: publicMonitorAutoFillProgress()
  };
}

function queueMonitorAutoFillRecord(record, config = getMonitorConfig()) {
  if (!config.autoFill || !record || !record.url) {
    return false;
  }
  monitorRuntime.autoFillStopRequested = false;
  const normalizedUrl = normalizeUrl(record.url);
  const key = normalizeUrl(normalizedUrl).toLowerCase();
  const currentKey = normalizeUrl(monitorRuntime.autoFillProgress.currentUrl || "").toLowerCase();
  if (currentKey && currentKey === key && monitorRuntime.autoFillProcessing) {
    return false;
  }
  if (monitorRuntime.autoFillQueue.some((item) => normalizeUrl(item.url).toLowerCase() === key)) {
    return false;
  }
  monitorRuntime.autoFillQueue.push({
    id: record.id || "",
    url: normalizedUrl,
    source: record.source || "",
    channel: record.channel || "wechat",
    contextText: record.contextText || "",
    expectedTrack: record.expectedTrack || "",
    createdAt: record.createdAt || new Date().toISOString()
  });
  monitorAutoFillProgressPatch({
    total: Number(monitorRuntime.autoFillProgress.completed || 0)
      + monitorRuntime.autoFillQueue.length
      + (monitorRuntime.autoFillProcessing ? 1 : 0),
    message: "已加入监控填表队列"
  });
  processMonitorAutoFillQueue().catch((error) => {
    monitorAutoFillProgressPatch({
      currentStatus: "failed",
      message: error.message || "监控填表队列异常"
    });
  });
  return true;
}

async function waitForMonitorAutoFillJobs(jobIds, progressBase) {
  const ids = uniqueCleanList(jobIds || []);
  if (!ids.length) {
    return { done: 0, failed: 0, running: 0, total: 0 };
  }
  while (true) {
    const currentJobs = ids.map((id) => jobs.get(id)).filter(Boolean);
    const done = currentJobs.filter((job) => job.status === "done" || job.status === "skipped").length;
    const failed = currentJobs.filter((job) => job.status === "failed" || job.status === "cancelled").length;
    const running = currentJobs.filter((job) => !fillTerminalStatuses.has(job.status)).length;
    monitorAutoFillProgressPatch({
      ...progressBase,
      currentJobIds: ids,
      currentDone: done,
      currentFailed: failed,
      currentRunning: running,
      currentTotal: ids.length,
      message: `正在填写：${done + failed}/${ids.length} 个任务完成`
    });
    if (currentJobs.length === ids.length && currentJobs.every((job) => fillTerminalStatuses.has(job.status))) {
      return { done, failed, running: 0, total: ids.length };
    }
    await delay(1200);
  }
}

async function processMonitorAutoFillQueue() {
  if (monitorRuntime.autoFillProcessing) {
    return;
  }
  const config = getMonitorConfig();
  if (!config.autoFill || monitorRuntime.autoFillStopRequested) {
    monitorAutoFillProgressPatch({ currentStatus: "idle", message: "监控填写模式未开启" });
    return;
  }
  monitorRuntime.autoFillProcessing = true;
  try {
    while (getMonitorConfig().autoFill && !monitorRuntime.autoFillStopRequested && monitorRuntime.autoFillQueue.length) {
      const queued = monitorRuntime.autoFillQueue.shift();
      const completed = Number(monitorRuntime.autoFillProgress.completed || 0);
      const total = completed + 1 + monitorRuntime.autoFillQueue.length;
      const base = {
        currentIndex: completed + 1,
        total,
        currentUrl: queued.url,
        currentSource: queued.source || "监控采集",
        currentStatus: "running",
        currentJobIds: [],
        currentDone: 0,
        currentFailed: 0,
        currentRunning: 0,
        currentTotal: 0,
        startedAt: new Date().toISOString()
      };
      monitorAutoFillProgressPatch({
        ...base,
        message: `开始填写第 ${completed + 1}/${total} 条`
      });
      const record = queued.id ? getHistoryItem(queued.id) || queued : queued;
      const started = await startAutoFillFromMonitorRecord({
        ...record,
        url: queued.url,
        source: queued.source || record.source || "监控采集",
        channel: queued.channel || record.channel || "wechat",
        contextText: queued.contextText || record.contextText || "",
        expectedTrack: queued.expectedTrack || record.expectedTrack || "",
        status: record.status || "待填写"
      }, getMonitorConfig());
      const jobIds = started.map((item) => item.jobId).filter(Boolean);
      if (!jobIds.length) {
        monitorAutoFillProgressPatch({
          ...base,
          currentStatus: "skipped",
          message: "这条链接没有可启动的填表任务，已跳过",
          completed: completed + 1
        });
        continue;
      }
      const result = await waitForMonitorAutoFillJobs(jobIds, base);
      if (monitorRuntime.autoFillStopRequested || !getMonitorConfig().autoFill) {
        monitorAutoFillProgressPatch({
          ...base,
          currentStatus: "cancelled",
          currentDone: result.done,
          currentFailed: result.failed,
          currentRunning: 0,
          currentTotal: result.total,
          message: "监控填写已中止"
        });
        break;
      }
      monitorAutoFillProgressPatch({
        ...base,
        currentStatus: result.failed ? "finished-with-errors" : "finished",
        currentDone: result.done,
        currentFailed: result.failed,
        currentRunning: 0,
        currentTotal: result.total,
        completed: completed + 1,
        message: result.failed
          ? `第 ${completed + 1}/${total} 条已完成，${result.failed} 个任务失败或停止`
          : `第 ${completed + 1}/${total} 条已完成`
      });
    }
  } finally {
    monitorRuntime.autoFillProcessing = false;
    const progress = monitorRuntime.autoFillProgress;
    if (monitorRuntime.autoFillStopRequested || !getMonitorConfig().autoFill) {
      monitorAutoFillProgressPatch({
        running: false,
        currentStatus: "cancelled",
        message: progress.message || "监控填写已中止"
      });
      return;
    }
    monitorAutoFillProgressPatch({
      running: false,
      currentStatus: monitorRuntime.autoFillQueue.length ? progress.currentStatus : "idle",
      currentUrl: monitorRuntime.autoFillQueue.length ? progress.currentUrl : "",
      currentSource: monitorRuntime.autoFillQueue.length ? progress.currentSource : "",
      currentJobIds: monitorRuntime.autoFillQueue.length ? progress.currentJobIds : [],
      currentDone: monitorRuntime.autoFillQueue.length ? progress.currentDone : 0,
      currentFailed: monitorRuntime.autoFillQueue.length ? progress.currentFailed : 0,
      currentRunning: monitorRuntime.autoFillQueue.length ? progress.currentRunning : 0,
      currentTotal: monitorRuntime.autoFillQueue.length ? progress.currentTotal : 0,
      message: monitorRuntime.autoFillQueue.length ? progress.message : "等待新链接"
    });
  }
}

function prepareFillHistory({ url, accountName, douyinIndex, expectedTrack, trackScore, source, channel, attemptLabel, message, contextText, dedupe }) {
  const normalizedUrl = normalizeUrl(url);
  const safeAccount = safeAccountName(accountName);
  const safeDouyinIndex = douyinIndex === undefined || douyinIndex === null ? "" : String(douyinIndex);
  const existing = dedupe !== false ? findHistoryByUrlAccount(normalizedUrl, safeAccount, safeDouyinIndex) : null;
  if (existing) {
    if (blocksRepeatFill(existing)) {
      return {
        item: existing,
        skipped: true,
        reason: `${safeAccount} · ${getDouyinLabel(safeAccount, safeDouyinIndex) || "抖音号"} 已有这条链接记录：${existing.status}`
      };
    }
    return {
      item: updateHistoryItem(existing.id, {
        douyinIndex: safeDouyinIndex,
        douyinLabel: getDouyinLabel(safeAccount, safeDouyinIndex),
        expectedTrack: expectedTrack || existing.expectedTrack || "",
        trackScore: Number(trackScore || existing.trackScore || 0),
        attemptLabel: attemptLabel || existing.attemptLabel || "",
        linkStatus: "已验证",
        verifiedAt: new Date().toISOString(),
        ...(contextText ? { contextText } : {}),
        message: message || existing.message || ""
      }) || existing,
      skipped: false
    };
  }
  return {
    item: createHistoryItem({
      source,
      channel,
      url: normalizedUrl,
      account: safeAccount,
      douyinIndex: safeDouyinIndex,
      expectedTrack,
      trackScore: Number(trackScore || 0),
      attemptLabel,
      status: "填写中",
      linkStatus: "已验证",
      verifiedAt: new Date().toISOString(),
      message,
      contextText,
      dedupe
    }),
    skipped: false
  };
}

async function ensureHistoryLinkReady(item) {
  const confirmedUrl = await confirmQqFormUrl(item && item.url, { allowLikelyFallback: true });
  if (!confirmedUrl) {
    updateHistoryItem(item.id, {
      status: "不可填写",
      linkStatus: "校验失败",
      message: "链接无法打开，已停止填写"
    });
    throw new Error("链接无法打开，已停止填写");
  }
  return updateHistoryItem(item.id, {
    url: confirmedUrl,
    linkStatus: "已验证",
    verifiedAt: new Date().toISOString()
  }) || { ...item, url: confirmedUrl };
}

function readMonitorEvents(limit = 120) {
  const data = readJson(monitorEventsPath, { items: [] });
  const rawItems = Array.isArray(data.items) ? data.items : [];
  const seen = new Set();
  const items = [];
  for (const item of rawItems) {
    const key = [
      safeAccountName(item.account),
      item.sourceName || "",
      item.hwnd || "",
      item.fingerprint || monitorFingerprint(`${(item.urls || []).join("\n")}\n${(item.candidateUrls || []).join("\n")}`)
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    items.push(item);
  }
  return {
    items: items.slice(0, Math.max(1, Math.min(1000, Number(limit) || 120)))
  };
}

function writeMonitorEvents(data) {
  const next = {
    items: (Array.isArray(data.items) ? data.items : []).slice(0, 1000)
  };
  writeJson(monitorEventsPath, next);
  return next;
}

function clearMonitorQueue(options = {}) {
  const config = getMonitorConfig();
  const resetSession = options.resetSession !== false;
  const clearedAt = new Date().toISOString();
  const activeBindings = (config.windowBindings || []).filter((binding) => binding.enabled !== false);
  const requestedUrls = normalizeMonitorUrlList(options.urls || []);
  const currentStatUrls = normalizeMonitorUrlList(activeBindings.flatMap((binding) => {
    const stat = monitorRuntime.bindingStats[binding.hwnd] || {};
    return [
      ...(stat.lastLinks || []),
      ...(stat.lastCandidateLinks || [])
    ];
  }));
  const eventItems = readMonitorEvents(1000).items;
  const eventUrls = normalizeMonitorUrlList(eventItems.flatMap((item) => [
    ...(item.urls || []),
    ...(item.candidateUrls || [])
  ]));
  const targetUrls = requestedUrls.length
    ? requestedUrls
    : normalizeMonitorUrlList([...eventUrls, ...currentStatUrls]);
  const targetSet = new Set(targetUrls.map(normalizeUrl));
  monitorRuntime.autoFillQueue = targetSet.size
    ? monitorRuntime.autoFillQueue.filter((item) => !targetSet.has(normalizeUrl(item.url)))
    : [];
  monitorRuntime.trackDetectQueue = targetSet.size
    ? monitorRuntime.trackDetectQueue.filter((item) => !targetSet.has(normalizeUrl(item.url)))
    : [];
  if (targetSet.size) {
    for (const key of Array.from(monitorRuntime.trackDetectActiveUrls)) {
      if (targetSet.has(normalizeUrl(key))) {
        monitorRuntime.trackDetectActiveUrls.delete(key);
      }
    }
  } else {
    monitorRuntime.trackDetectActiveUrls.clear();
  }
  if (resetSession) {
    writeMonitorConfig({ ...config, autoFillStartedAt: clearedAt });
    resetMonitorAutoFillProgress({
      enabled: config.autoFill === true,
      currentStatus: "idle",
      message: "队列已清空"
    });
  } else {
    monitorAutoFillProgressPatch({
      pending: monitorRuntime.autoFillQueue.length
    });
  }

  const history = readHistory();
  let removedHistory = 0;
  const keepItems = [];
  for (const item of history.items || []) {
    const status = displayStatusForServer(item.status);
    const isMonitorPoolItem = !item.account
      && item.url
      && item.channel !== "manual"
      && !["填写中", "待提交", "已提交"].includes(status);
    const matchesTarget = !targetSet.size || targetSet.has(normalizeUrl(item.url));
    if (isMonitorPoolItem && matchesTarget) {
      removedHistory += 1;
      continue;
    }
    keepItems.push(item);
  }
  writeHistory({ items: keepItems });
  let removedEvents = 0;
  if (targetSet.size) {
    const nextEvents = [];
    for (const item of eventItems) {
      const urls = normalizeMonitorUrlList(item.urls || []).filter((url) => !targetSet.has(normalizeUrl(url)));
      const candidateUrls = normalizeMonitorUrlList(item.candidateUrls || []).filter((url) => !targetSet.has(normalizeUrl(url)));
      if (urls.length || candidateUrls.length) {
        nextEvents.push({
          ...item,
          urls,
          candidateUrls,
          fingerprint: monitorFingerprint((urls.length ? urls : candidateUrls).slice().sort().join("\n"))
        });
      } else {
        removedEvents += 1;
      }
    }
    writeMonitorEvents({ items: nextEvents });
  } else {
    removedEvents = eventItems.length;
    writeMonitorEvents({ items: [] });
  }
  if (targetUrls.length) {
    for (const binding of activeBindings) {
      addIgnoredUrlsForBinding(binding.hwnd, targetUrls);
    }
  }
  monitorRuntime.seenKeys.clear();
  monitorRuntime.lastFoundAt = "";
  for (const stat of Object.values(monitorRuntime.bindingStats || {})) {
    stat.lastNewLinkCount = 0;
    stat.lastNewLinks = [];
    stat.lastNewAt = "";
    if (targetSet.size) {
      stat.lastLinks = normalizeMonitorUrlList(stat.lastLinks || []).filter((url) => !targetSet.has(normalizeUrl(url)));
      stat.lastCandidateLinks = normalizeMonitorUrlList(stat.lastCandidateLinks || []).filter((url) => !targetSet.has(normalizeUrl(url)));
      stat.lastUrlCount = stat.lastLinks.length;
      stat.lastCandidateUrlCount = stat.lastCandidateLinks.length;
      stat.lastIgnoredLinkCount = Number(stat.lastIgnoredLinkCount || 0) + targetSet.size;
    } else {
      stat.lastLinks = [];
      stat.lastCandidateLinks = [];
      stat.lastUrlCount = 0;
      stat.lastCandidateUrlCount = 0;
    }
  }
  monitorLog(`已清空新链接队列：${removedEvents} 条采集，${removedHistory} 条待填写链接`);
  return {
    ok: true,
    removedEvents,
    removedHistory,
    ignoredUrls: targetUrls.length,
    resetSessionAt: resetSession ? clearedAt : ""
  };
}

function addMonitorEvent(event) {
  const data = readMonitorEvents(1000);
  const urls = uniqueCleanList(event.urls || []).slice(0, 80);
  const candidateUrls = uniqueCleanList(event.candidateUrls || []).slice(0, 80);
  if (!urls.length && !candidateUrls.length) {
    return null;
  }
  const eventTrackByUrl = event.trackByUrl && typeof event.trackByUrl === "object" && !Array.isArray(event.trackByUrl)
    ? event.trackByUrl
    : {};
  const eventUrls = normalizeMonitorUrlList([...urls, ...candidateUrls]);
  const singleUrl = eventUrls.length === 1 ? eventUrls[0] : "";
  const trackByUrl = { ...eventTrackByUrl };
  if (singleUrl && (event.expectedTrack || event.trackStatus || event.trackMessage)) {
    trackByUrl[singleUrl] = {
      ...(trackByUrl[singleUrl] || {}),
      expectedTrack: String(event.expectedTrack || "").trim().slice(0, 60),
      trackScore: Number(event.trackScore || 0),
      trackStatus: String(event.trackStatus || "").trim().slice(0, 20),
      trackMessage: String(event.trackMessage || "").trim().slice(0, 160)
    };
  }
  const fingerprint = monitorFingerprint((urls.length ? urls : candidateUrls).slice().sort().join("\n"));
  const last = data.items[0];
  if (last && last.hwnd === event.hwnd && last.fingerprint === fingerprint) {
    last.lastSeenAt = event.createdAt || new Date().toISOString();
    last.seenCount = Number(last.seenCount || 1) + 1;
    last.trackByUrl = {
      ...(last.trackByUrl && typeof last.trackByUrl === "object" && !Array.isArray(last.trackByUrl) ? last.trackByUrl : {}),
      ...trackByUrl
    };
    if (singleUrl && event.expectedTrack) {
      last.expectedTrack = String(event.expectedTrack || "").trim().slice(0, 60);
      last.trackScore = Number(event.trackScore || 0);
    }
    if (singleUrl && event.trackStatus) {
      last.trackStatus = String(event.trackStatus || "").trim().slice(0, 20);
    }
    if (singleUrl && event.trackMessage) {
      last.trackMessage = String(event.trackMessage || "").trim().slice(0, 160);
    }
    writeMonitorEvents(data);
    return last;
  }
  const recentDuplicate = data.items.find((item) => (
    item.fingerprint === fingerprint
    && String(item.hwnd || "") === String(event.hwnd || "")
    && safeAccountName(item.account) === safeAccountName(event.account)
    && String(item.sourceName || "") === String(event.sourceName || "")
  ));
  if (recentDuplicate) {
    recentDuplicate.lastSeenAt = event.createdAt || new Date().toISOString();
    recentDuplicate.seenCount = Number(recentDuplicate.seenCount || 1) + 1;
    if (event.text || event.preview) {
      recentDuplicate.contextText = monitorSample(event.text || event.preview || "", 1000);
      recentDuplicate.preview = monitorSample(recentDuplicate.contextText, 500);
    }
    recentDuplicate.trackByUrl = {
      ...(recentDuplicate.trackByUrl && typeof recentDuplicate.trackByUrl === "object" && !Array.isArray(recentDuplicate.trackByUrl) ? recentDuplicate.trackByUrl : {}),
      ...trackByUrl
    };
    if (singleUrl && event.expectedTrack) {
      recentDuplicate.expectedTrack = String(event.expectedTrack || "").trim().slice(0, 60);
      recentDuplicate.trackScore = Number(event.trackScore || 0);
    }
    if (singleUrl && event.trackStatus) {
      recentDuplicate.trackStatus = String(event.trackStatus || "").trim().slice(0, 20);
    }
    if (singleUrl && event.trackMessage) {
      recentDuplicate.trackMessage = String(event.trackMessage || "").trim().slice(0, 160);
    }
    writeMonitorEvents(data);
    return recentDuplicate;
  }
  const contextText = monitorSample(event.text || event.preview || "", 1000);
  const item = {
    id: makeId("monitor-event"),
    createdAt: event.createdAt || new Date().toISOString(),
    channel: String(event.channel || "wechat"),
    account: safeAccountName(event.account),
    sourceName: String(event.sourceName || "").trim().slice(0, 120),
    title: String(event.title || "").trim().slice(0, 120),
    hwnd: String(event.hwnd || "").trim().slice(0, 40),
    textLength: Number(event.textLength || 0),
    preview: monitorSample(contextText, 500),
    contextText,
    expectedTrack: singleUrl ? String(event.expectedTrack || "").trim().slice(0, 60) : "",
    trackScore: singleUrl ? Number(event.trackScore || 0) : 0,
    trackStatus: singleUrl ? String(event.trackStatus || "").trim().slice(0, 20) : "",
    trackMessage: singleUrl ? String(event.trackMessage || "").trim().slice(0, 160) : "",
    trackByUrl,
    readMode: normalizeMonitorReadMode(event.readMode),
    readSource: String(event.readSource || "").trim().slice(0, 40),
    originalTextLength: Number(event.originalTextLength || 0),
    ocrTextLength: Number(event.ocrTextLength || 0),
    urls,
    candidateUrls,
    seenCount: 1,
    lastSeenAt: "",
    fingerprint
  };
  data.items.unshift(item);
  writeMonitorEvents(data);
  return item;
}

function updateMonitorEventsForUrl(url, patch = {}) {
  const normalizedUrl = normalizeUrl(url);
  if (!normalizedUrl) {
    return 0;
  }
  const data = readMonitorEvents(1000);
  let changed = 0;
  for (const item of data.items || []) {
    const urls = normalizeMonitorUrlList(item.urls || []);
    const candidateUrls = normalizeMonitorUrlList(item.candidateUrls || []);
    const matches = urls.includes(normalizedUrl) || candidateUrls.includes(normalizedUrl);
    if (!matches) {
      continue;
    }
    const allUrls = normalizeMonitorUrlList([...urls, ...candidateUrls]);
    const linkTrack = {
      ...(item.trackByUrl && typeof item.trackByUrl === "object" && !Array.isArray(item.trackByUrl) && item.trackByUrl[normalizedUrl]
        ? item.trackByUrl[normalizedUrl]
        : {})
    };
    if (patch.expectedTrack !== undefined) {
      linkTrack.expectedTrack = String(patch.expectedTrack || "").trim().slice(0, 60);
    }
    if (patch.trackScore !== undefined) {
      linkTrack.trackScore = Number(patch.trackScore || 0);
    }
    if (patch.trackStatus !== undefined) {
      linkTrack.trackStatus = String(patch.trackStatus || "").trim().slice(0, 20);
    }
    if (patch.trackMessage !== undefined) {
      linkTrack.trackMessage = String(patch.trackMessage || "").trim().slice(0, 160);
    }
    if (patch.contextText) {
      linkTrack.contextText = monitorSample(patch.contextText, 1000);
    }
    item.trackByUrl = {
      ...(item.trackByUrl && typeof item.trackByUrl === "object" && !Array.isArray(item.trackByUrl) ? item.trackByUrl : {}),
      [normalizedUrl]: linkTrack
    };
    if (allUrls.length <= 1 && patch.expectedTrack !== undefined) {
      item.expectedTrack = String(patch.expectedTrack || "").trim().slice(0, 60);
    }
    if (allUrls.length <= 1 && patch.trackScore !== undefined) {
      item.trackScore = Number(patch.trackScore || 0);
    }
    if (allUrls.length <= 1 && patch.trackStatus !== undefined) {
      item.trackStatus = String(patch.trackStatus || "").trim().slice(0, 20);
    }
    if (allUrls.length <= 1 && patch.trackMessage !== undefined) {
      item.trackMessage = String(patch.trackMessage || "").trim().slice(0, 160);
    }
    if (allUrls.length > 1 && (
      patch.expectedTrack !== undefined
      || patch.trackStatus !== undefined
      || patch.trackMessage !== undefined
    )) {
      item.expectedTrack = "";
      item.trackScore = 0;
      item.trackStatus = "";
      item.trackMessage = "";
    }
    if (patch.contextText) {
      item.contextText = monitorSample(patch.contextText, 1000);
      item.preview = monitorSample(item.contextText, 500);
    }
    changed += 1;
  }
  if (changed) {
    writeMonitorEvents(data);
  }
  return changed;
}

function updateMonitorEventsForUrls(urls, patch = {}) {
  return uniqueCleanList((urls || []).map((url) => normalizeUrl(url)).filter(Boolean))
    .reduce((count, url) => count + updateMonitorEventsForUrl(url, patch), 0);
}

function classifyFillError(message) {
  const text = String(message || "");
  if (/用户已停止填表|任务已取消/.test(text)) {
    return "待填写";
  }
  if (/已提交|填过/.test(text)) {
    return "已填过";
  }
  if (/暂停|上限|停止|结束|不可填写/.test(text)) {
    return "不可填写";
  }
  return "失败";
}

function isNonFillableError(message) {
  return classifyFillError(message) === "不可填写";
}

function getAccounts() {
  const source = readJson(path.join(sourceConfigDir, "accounts.json"), defaultAccountsConfig());
  const data = readJson(accountsPath, source);
  let changed = false;

  if (!Array.isArray(data.accounts)) {
    data.accounts = [];
    changed = true;
  }
  if (!data.defaultAccount && data.accounts[0]) {
    data.defaultAccount = data.accounts[0].name;
    changed = true;
  }

  if (changed) {
    writeJson(accountsPath, data);
  }
  return data;
}

function getAccount(name) {
  const data = getAccounts();
  return data.accounts.find((account) => account.name === name);
}

function loginStatusLabel(status, loggedIn) {
  if (status === "logged-in" || loggedIn === true) {
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
  if (status === "unknown") {
    return "无法确认";
  }
  return "未检测";
}

function hasRawBrowserLog(value) {
  return /browserType|launchPersistentContext|Browser logs|Target page|context or browser has been closed|msedge\.exe|stderr:|Call log|--disable-|pid=|exitCode|ProcessSingleton|remote-debugging-pipe/i.test(String(value || ""));
}

function normalizeLoginStatusRecord(name, item = {}) {
  let status = String(item.status || "unknown");
  let loggedIn = item.loggedIn === true || status === "logged-in";
  let message = String(item.message || "");
  if (hasRawBrowserLog(message)) {
    status = "not-logged-in";
    loggedIn = false;
    message = "未登录";
  }
  const checkedTime = Date.parse(String(item.checkedAt || ""));
  const staleLoggedIn = loggedIn && (!Number.isFinite(checkedTime) || Date.now() - checkedTime > LOGIN_STATUS_MAX_AGE_MS);
  if (staleLoggedIn) {
    status = "unknown";
    loggedIn = false;
    message = "上次检测已过期，请重新检测";
  }
  if (!message || message.length > 80) {
    message = loginStatusLabel(status, loggedIn);
  }
  return {
    account: name,
    status,
    loggedIn,
    checkedAt: String(item.checkedAt || ""),
    message,
    pageTitle: String(item.pageTitle || ""),
    pageUrl: String(item.pageUrl || ""),
    preview: String(item.preview || "").slice(0, 240)
  };
}

function loginCheckErrorStatus(message) {
  const text = String(message || "");
  if (/another application is using|being used by another process|ProcessSingleton|已打开的 Edge 占用/i.test(text)) {
    return { status: "error", message: "检测被占用，请关闭登录窗口再试" };
  }
  if (hasRawBrowserLog(text)) {
    return { status: "not-logged-in", message: "未登录" };
  }
  return { status: "error", message: "检测失败" };
}

function readLoginStatus() {
  const data = readJson(loginStatusPath, { items: {} });
  const items = data && typeof data.items === "object" && !Array.isArray(data.items) ? data.items : {};
  const accountNames = new Set((getAccounts().accounts || []).map((account) => account.name));
  const filtered = {};
  for (const [name, item] of Object.entries(items)) {
    if (!accountNames.has(name)) {
      continue;
    }
    filtered[name] = normalizeLoginStatusRecord(name, item);
  }
  return { items: filtered };
}

function writeLoginStatus(data) {
  const next = {
    items: data && typeof data.items === "object" && !Array.isArray(data.items) ? data.items : {}
  };
  writeJson(loginStatusPath, next);
  return readLoginStatus();
}

function updateLoginStatus(accountName, patch) {
  const account = getAccount(accountName);
  if (!account) {
    throw new Error("没有找到这个账号");
  }
  const data = readLoginStatus();
  const previous = data.items[account.name] || { account: account.name, status: "unknown", loggedIn: false };
  data.items[account.name] = {
    ...previous,
    ...patch,
    account: account.name
  };
  writeLoginStatus(data);
  return readLoginStatus().items[account.name];
}

function renameLoginStatus(oldName, newName) {
  const data = readLoginStatus();
  if (!data.items[oldName]) {
    return;
  }
  data.items[newName] = {
    ...data.items[oldName],
    account: newName
  };
  delete data.items[oldName];
  writeLoginStatus(data);
}

function getAnswerTypes(accountsData, answers) {
  const types = new Set([
    ...(Array.isArray(answers.tracks) ? answers.tracks : []),
    ...Object.keys(answers.typeKeywords || {}),
    ...Object.keys(answers.profiles || {})
  ]);
  for (const account of accountsData.accounts || []) {
    for (const douyin of account.douyinAccounts || []) {
      for (const track of douyinTracks(douyin)) {
        types.add(track);
      }
    }
  }
  return Array.from(types);
}

function updateTrackLibrary(tracks) {
  const answers = readJson(answersPath, {});
  answers.tracks = uniqueCleanList(tracks).slice(0, 80);
  writeJson(answersPath, answers);
  return {
    tracks: answers.tracks,
    answerTypes: getAnswerTypes(getAccounts(), answers)
  };
}

function setDefaultAccount(name) {
  const safeName = safeAccountName(name);
  const data = getAccounts();
  if (!data.accounts.some((account) => account.name === safeName)) {
    throw new Error("没有找到这个账号");
  }
  data.defaultAccount = safeName;
  writeJson(accountsPath, data);
  return data;
}

function profileDirNameFor(account, name) {
  const browser = String(account.browser || "edge").toLowerCase();
  const prefix = browser === "edge" || browser === "msedge" ? ".qqdocs-edge-profile" : ".qqdocs-profile";
  return `${prefix}-${name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, "_").slice(0, 60)}`;
}

function moveAccountProfile(account, oldName, newName) {
  const oldDir = path.join(dataDir, profileDirNameFor(account, oldName));
  const newDir = path.join(dataDir, profileDirNameFor(account, newName));

  if (oldDir === newDir || !fs.existsSync(oldDir)) {
    return;
  }
  if (fs.existsSync(newDir)) {
    throw new Error("新的微信名称已经有登录档案了，换一个名称再试。");
  }
  fs.renameSync(oldDir, newDir);
}

function renameAccount(oldName, newName) {
  const from = safeAccountName(oldName);
  const to = safeAccountName(newName);
  if (!from || !to) {
    throw new Error("微信名称不能为空");
  }
  if (from === to) {
    return getAccounts();
  }

  const data = getAccounts();
  const index = data.accounts.findIndex((account) => account.name === from);
  if (index < 0) {
    throw new Error("没有找到这个账号");
  }
  if (data.accounts.some((account) => account.name === to)) {
    throw new Error("这个微信名称已经存在");
  }

  moveAccountProfile(data.accounts[index], from, to);
  renameLoginStatus(from, to);
  data.accounts[index] = { ...data.accounts[index], name: to };
  if (data.defaultAccount === from) {
    data.defaultAccount = to;
  }
  writeJson(accountsPath, data);
  return data;
}

function upsertAccount(account) {
  const data = getAccounts();
  const existing = data.accounts.find((item) => item.name === account.name) || {};
  const existingDefaults = existing.fillDefaults || {};
  const incomingDefaults = account.fillDefaults || {};
  const existingImages = existing.images || {};
  const incomingImages = account.images || {};
  const hasIncomingImages = account.images && typeof account.images === "object";
  const sharedScreenshot = hasIncomingImages
    ? incomingImages.screenshot || incomingImages.gradeScreenshot || incomingImages.postScreenshot || ""
    : existingImages.screenshot || existingImages.gradeScreenshot || existingImages.postScreenshot || "";
  const next = {
    name: safeAccountName(account.name),
    browser: account.browser || "edge",
    mode: account.mode || "managed",
    note: account.note || "",
    contact: {
      phone: account.contact && account.contact.phone || "",
      realName: account.contact && account.contact.realName || "",
      alipayAccount: account.contact && account.contact.alipayAccount || account.contact && account.contact.phone || "",
      alipayName: account.contact && account.contact.alipayName || account.contact && account.contact.realName || "",
      idCard: account.contact && account.contact.idCard || ""
    },
    fillDefaults: {
      ...existingDefaults,
      releaseLink: incomingDefaults.releaseLink || existingDefaults.releaseLink || "好",
      douyinGroupLevel: incomingDefaults.douyinGroupLevel || existingDefaults.douyinGroupLevel || "好"
    },
    images: {
      ...existingImages,
      screenshot: sharedScreenshot,
      gradeScreenshot: sharedScreenshot,
      postScreenshot: sharedScreenshot
    },
    douyinAccounts: Array.isArray(account.douyinAccounts) ? account.douyinAccounts.map((item) => {
      const tracks = douyinTracks(item);
      return {
        nickname: String(item.nickname || "").trim(),
        douyinId: String(item.douyinId || "").trim(),
        contentType: tracks[0] || "",
        tracks
      };
    }).filter((item) => item.nickname || item.douyinId) : []
  };
  if (!next.name) {
    throw new Error("账号名称不能为空");
  }

  const index = data.accounts.findIndex((item) => item.name === next.name);
  if (index >= 0) {
    data.accounts[index] = { ...existing, ...next };
  } else {
    data.accounts.push(next);
  }
  if (!data.defaultAccount) {
    data.defaultAccount = next.name;
  }
  writeJson(accountsPath, data);
  return data;
}

function historyTargetsFromMeta(meta = {}) {
  const targets = Array.isArray(meta.historyTargets)
    ? meta.historyTargets.map((item) => ({
      historyId: String(item && item.historyId || item && item.id || ""),
      douyinIndex: item && item.douyinIndex !== undefined && item.douyinIndex !== null ? String(item.douyinIndex) : "",
      expectedTrack: item && item.expectedTrack || ""
    })).filter((item) => item.historyId)
    : [];
  if (targets.length) {
    return targets;
  }
  return meta.historyId ? [{ historyId: meta.historyId, douyinIndex: "", expectedTrack: "" }] : [];
}

function fillResultForHistoryTarget(result, target, index) {
  const results = Array.isArray(result && result.results)
    ? result.results
    : result ? [result] : [];
  if (target && target.douyinIndex !== "") {
    const matched = results.find((item) => String(item && item.douyinIndex) === String(target.douyinIndex));
    if (matched) {
      return matched;
    }
  }
  return results[index] || results[0] || {};
}

function updateFillHistorySuccess(meta, result, filledAt) {
  const targets = historyTargetsFromMeta(meta);
  for (let index = 0; index < targets.length; index += 1) {
    const target = targets[index];
    const itemResult = fillResultForHistoryTarget(result, target, index);
    updateHistoryItem(target.historyId, {
      status: itemResult && itemResult.submitted ? "已提交" : "待提交",
      filledAt,
      screenshotPath: itemResult && itemResult.screenshotPath || "",
      douyinIndex: itemResult && itemResult.douyinIndex !== undefined ? String(itemResult.douyinIndex) : target.douyinIndex || undefined,
      douyinLabel: itemResult && itemResult.douyinLabel || undefined,
      expectedTrack: itemResult && itemResult.typeName || target.expectedTrack || undefined,
      message: itemResult && itemResult.typeName ? `填写完成，赛道：${itemResult.typeName}` : "填写完成"
    });
  }
}

function updateFillHistoryError(meta, patch) {
  for (const target of historyTargetsFromMeta(meta)) {
    updateHistoryItem(target.historyId, patch);
  }
}

function runJob(kind, args, meta = {}) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const abortController = new AbortController();
  const job = {
    id,
    kind,
    historyId: meta.historyId || "",
    status: meta.queueKey ? "queued" : "running",
    queueKey: meta.queueKey || "",
    queueLabel: meta.queueLabel || "",
    startedAt: new Date().toISOString(),
    endedAt: "",
    cancelRequested: false,
    logs: ""
  };
  Object.defineProperty(job, "abortController", {
    value: abortController,
    enumerable: false
  });
  jobs.set(id, job);

  const append = (text) => {
    job.logs += text;
    if (job.logs.length > 30000) {
      job.logs = job.logs.slice(-30000);
    }
  };

  if (meta.queueKey) {
    append(`已加入队列：${meta.queueLabel || meta.queueKey}\n`);
  }

  const execute = () => {
    if (job.cancelRequested) {
      const error = new Error("用户已停止填表");
      error.name = "AbortError";
      throw error;
    }
    job.status = "running";
    if (meta.queueKey) {
      append(`开始执行：${meta.queueLabel || meta.queueKey}\n`);
    }
    return runFromArgs(args, (line) => append(`${line}\n`), { signal: abortController.signal });
  };

  const previous = meta.queueKey ? jobQueues.get(meta.queueKey) || Promise.resolve() : Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(execute)
    .then((result) => {
      if (job.cancelRequested) {
        const error = new Error("用户已停止填表");
        error.name = "AbortError";
        throw error;
      }
      job.status = "done";
      job.exitCode = 0;
      job.result = result || {};
      job.endedAt = new Date().toISOString();
      updateFillHistorySuccess(meta, result, job.endedAt);
    })
    .catch((error) => {
      const stopped = job.cancelRequested || error.name === "AbortError" || /用户已停止填表|任务已取消|Target page, context or browser has been closed/i.test(error.message || "");
      const nonFillable = !stopped && isNonFillableError(error.message);
      job.status = stopped ? "cancelled" : nonFillable ? "skipped" : "failed";
      job.exitCode = stopped ? null : nonFillable ? 0 : 1;
      job.endedAt = new Date().toISOString();
      append(stopped
        ? "已停止填表\n"
        : nonFillable
          ? `表单不可填写，已自动跳过：${error.message}\n`
          : `自动填表失败：${error.message}\n`);
      updateFillHistoryError(meta, stopped
        ? { status: "待填写", jobId: "", message: "已停止填表，可重新开始" }
        : nonFillable
          ? { status: "不可填写", jobId: "", message: `已自动跳过：${error.message}` }
          : { status: classifyFillError(error.message), message: error.message });
    });

  if (meta.queueKey) {
    const tracked = current.finally(() => {
      if (jobQueues.get(meta.queueKey) === tracked) {
        jobQueues.delete(meta.queueKey);
      }
    });
    jobQueues.set(meta.queueKey, tracked);
  }

  return job;
}

function cancelJob(id) {
  const job = jobs.get(String(id || ""));
  if (!job) {
    return null;
  }
  if (["done", "failed", "cancelled", "skipped"].includes(job.status)) {
    return job;
  }
  job.cancelRequested = true;
  if (job.status === "queued") {
    job.status = "cancelled";
    job.endedAt = new Date().toISOString();
  } else {
    job.status = "stopping";
  }
  if (job.abortController) {
    job.abortController.abort();
  }
  job.logs += job.logs.endsWith("\n") ? "正在停止填表...\n" : "\n正在停止填表...\n";
  if (job.historyId) {
    updateHistoryItem(job.historyId, {
      status: "待填写",
      jobId: "",
      message: "已停止填表，可重新开始"
    });
  }
  return job;
}

function cancelJobsById(ids, kind = "") {
  const requestedIds = uniqueCleanList(ids);
  const cancelled = [];
  const missing = [];
  const ignored = [];

  for (const id of requestedIds) {
    const job = jobs.get(id);
    if (!job) {
      missing.push(id);
      continue;
    }
    if (kind && job.kind !== kind) {
      ignored.push(id);
      continue;
    }
    cancelled.push(cancelJob(id));
  }

  return {
    jobs: cancelled.filter(Boolean),
    missing,
    ignored
  };
}

function markMonitorStartHistoryIgnored(accountName, sourceName, urls) {
  const safeAccount = safeAccountName(accountName);
  const ignored = new Set(normalizeMonitorUrlList(urls));
  if (!safeAccount || !ignored.size) {
    return 0;
  }
  const data = readHistory();
  const now = new Date().toISOString();
  let changed = 0;
  for (const item of data.items) {
    const status = displayStatusForServer(item.status);
    if (
      item.account === safeAccount
      && ignored.has(normalizeUrl(item.url))
      && ["待填写", "待提交"].includes(status)
    ) {
      item.status = "已填过";
      item.jobId = "";
      item.message = "已设为监控起点之前的旧链接，不再自动填写";
      item.updatedAt = now;
      changed += 1;
    }
  }
  if (changed) {
    writeHistory(data);
  }
  return changed;
}

function setMonitorStartPoint(body = {}) {
  const eventId = String(body.eventId || "").trim();
  const event = eventId
    ? readMonitorEvents(1000).items.find((item) => item.id === eventId)
    : null;
  const targetUrl = normalizeUrl(body.url || event && ((event.urls || [])[0] || (event.candidateUrls || [])[0]) || "");
  if (!qqFormIdFromUrl(targetUrl)) {
    throw new Error("没有找到可设置为起点的表单链接");
  }

  const config = getMonitorConfig();
  const safeHwnd = String(body.hwnd || event && event.hwnd || "").trim();
  const eventUrls = normalizeMonitorUrlList(body.urls || event && (event.urls && event.urls.length ? event.urls : event.candidateUrls) || []);
  const selectedIndex = eventUrls.findIndex((url) => normalizeUrl(url) === targetUrl);
  const ignoredUrls = selectedIndex > 0 ? eventUrls.slice(0, selectedIndex) : [];
  const bindings = config.windowBindings || [];
  let bindingIndex = bindings.findIndex((binding) => safeHwnd && String(binding.hwnd || "") === safeHwnd);
  if (bindingIndex < 0 && event) {
    bindingIndex = bindings.findIndex((binding) => {
      const source = sourceForBinding(binding, config);
      return source
        && source.name === event.sourceName;
    });
  }
  if (bindingIndex < 0) {
    throw new Error("没有找到这条链接对应的监控窗口");
  }

  const now = new Date().toISOString();
  const binding = bindings[bindingIndex];
  const activeUrls = selectedIndex >= 0 ? eventUrls.slice(selectedIndex) : [targetUrl];
  const startContextText = event && (event.contextText || event.preview)
    || (safeHwnd && monitorRuntime.bindingStats[safeHwnd] && monitorRuntime.bindingStats[safeHwnd].lastPreview)
    || "";
  const mergedIgnoredUrls = uniqueCleanList([
    ...(binding.ignoredUrls || []),
    ...ignoredUrls
  ].map(normalizeUrl)).filter((url) => qqFormIdFromUrl(url)).slice(-120);
  const windowBindings = bindings.map((item, index) => index === bindingIndex
    ? {
      ...item,
      startAfterUrl: targetUrl,
      startInclusive: true,
      startAfterSetAt: now,
      pendingStartUrls: activeUrls,
      pendingStartContextText: startContextText,
      ignoredUrls: mergedIgnoredUrls
    }
    : item);
  const nextConfig = writeMonitorConfig({
    ...config,
    windowBindings
  });
  const nextBinding = nextConfig.windowBindings[bindingIndex];
  const source = sourceForBinding(nextBinding, nextConfig);
  updateBindingStat(nextBinding, source, {
    startAfterUrl: targetUrl,
    startInclusive: true,
    startAfterSetAt: now,
    ignoredUrlCount: mergedIgnoredUrls.length,
    lastIgnoredLinkCount: ignoredUrls.length,
    lastNewLinkCount: 0,
    lastNewLinks: []
  });
  monitorRuntime.seenKeys.clear();
  if (safeHwnd) {
    monitorRuntime.baselineHwnds.delete(safeHwnd);
  }
  monitorLog(`已设置监控起点：${source && source.name || nextBinding.title || "微信窗口"} · ${qqFormIdFromUrl(targetUrl)}`);
  return {
    state: getMonitorState(),
    ignoredUrls,
    ignoredHistoryCount: 0,
    pendingUrls: activeUrls,
    startAfterUrl: targetUrl
  };
}

function runLocalJob(kind, executor) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const job = {
    id,
    kind,
    status: "running",
    startedAt: new Date().toISOString(),
    endedAt: "",
    logs: ""
  };
  jobs.set(id, job);

  const append = (text) => {
    job.logs += text.endsWith("\n") ? text : `${text}\n`;
    if (job.logs.length > 30000) {
      job.logs = job.logs.slice(-30000);
    }
  };

  Promise.resolve()
    .then(() => executor((line) => append(line)))
    .then((result) => {
      job.status = "done";
      job.exitCode = 0;
      job.result = result || {};
      job.endedAt = new Date().toISOString();
      append("任务完成");
    })
    .catch((error) => {
      job.status = "failed";
      job.exitCode = 1;
      job.endedAt = new Date().toISOString();
      append(`任务失败：${error.message}`);
    });

  return job;
}

function fillArgsFor(account, extra = []) {
  const browser = account.browser || "edge";
  const args = [`--browser=${browser}`, `--account=${account.name}`, ...extra];
  return args;
}

async function checkLoginStatusForAccount(accountName) {
  const account = getAccount(accountName);
  if (!account) {
    throw new Error("没有找到这个账号");
  }
  updateLoginStatus(account.name, {
    status: "checking",
    loggedIn: false,
    checkedAt: new Date().toISOString(),
    message: "检测中"
  });

  const logs = [];
  try {
    const result = await runFromArgs(fillArgsFor(account, ["--check-login", "--background"]), (line) => logs.push(String(line)), {});
    const item = updateLoginStatus(account.name, {
      status: result && result.status || (result && result.loggedIn ? "logged-in" : "unknown"),
      loggedIn: result && result.loggedIn === true,
      checkedAt: result && result.checkedAt || new Date().toISOString(),
      message: result && result.message || "检测完成",
      pageTitle: result && result.pageTitle || "",
      pageUrl: result && result.pageUrl || "",
      preview: result && result.preview || "",
      signals: result && result.signals || {},
      logs: logs.slice(-20).join("\n")
    });
    return item;
  } catch (error) {
    const cleanError = loginCheckErrorStatus(error.message);
    return updateLoginStatus(account.name, {
      status: cleanError.status,
      loggedIn: false,
      checkedAt: new Date().toISOString(),
      message: cleanError.message,
      logs: ""
    });
  }
}

async function checkAllLoginStatus() {
  const items = [];
  for (const account of getAccounts().accounts || []) {
    items.push(await checkLoginStatusForAccount(account.name));
  }
  return {
    ...readLoginStatus(),
    checked: items
  };
}

function validateFillRequest(account, douyinIndex, dryRun) {
  if (!account) {
    throw new Error("没有找到这个账号");
  }
  if (dryRun) {
    return;
  }

  const contact = account.contact || {};
  if (douyinIndex === "__auto__") {
    if (!(account.douyinAccounts || []).length) {
      throw new Error("当前账号还没有可匹配的抖音号");
    }
  } else {
    const index = Number(douyinIndex);
    const selectedDouyin = Number.isInteger(index) && index >= 0
      ? (account.douyinAccounts || [])[index]
      : null;
    if (!selectedDouyin) {
      throw new Error("当前账号未选择抖音号");
    }
  }
  if (!(contact.phone || contact.alipayAccount) || !(contact.realName || contact.alipayName)) {
    throw new Error("当前账号缺少号码或姓名");
  }
}

function normalizeFillItems(body) {
  const fallbackDouyinIndex = body.douyinIndex === undefined || body.douyinIndex === null
    ? "__auto__"
    : String(body.douyinIndex);
  const rawItems = Array.isArray(body.items) && body.items.length
    ? body.items
    : extractFormUrls(body.url).map((url) => ({ url }));
  const items = [];
  for (const raw of rawItems) {
    const urls = extractFormUrls(raw && raw.url || raw);
    const url = urls[0];
    if (!url) {
      continue;
    }
    const douyinIndex = raw && raw.douyinIndex !== undefined && raw.douyinIndex !== null && raw.douyinIndex !== ""
      ? String(raw.douyinIndex)
      : fallbackDouyinIndex;
    items.push({
      url,
      douyinIndex: douyinIndex || "__auto__",
      expectedTrack: String(raw && raw.expectedTrack || "").trim().slice(0, 60),
      trackScore: Number(raw && raw.trackScore || 0),
      contextText: String(raw && (raw.contextText || raw.context) || "").trim().slice(0, 1000)
    });
  }
  return items;
}

function startFillJob({
  accountName,
  url,
  douyinIndex = "",
  douyinIndexes = [],
  dryRun = false,
  historyId = "",
  historyTargets = [],
  expectedTrack = "",
  visible = false,
  forceAutoSubmit = false,
  includeTrackSiblings = false
}) {
  const account = getAccount(accountName);
  const targetDouyinIndexes = Array.isArray(douyinIndexes)
    ? uniqueCleanList(douyinIndexes.map((item) => String(item || "").trim()).filter(Boolean))
    : [];
  const validationIndexes = targetDouyinIndexes.length ? targetDouyinIndexes : [douyinIndex];
  for (const targetDouyinIndex of validationIndexes) {
    validateFillRequest(account, targetDouyinIndex, dryRun);
    if (expectedTrack && targetDouyinIndex && targetDouyinIndex !== "__auto__") {
      const index = Number(targetDouyinIndex);
      const selectedDouyin = Number.isInteger(index) ? (account.douyinAccounts || [])[index] : null;
      const matchesTrack = selectedDouyin && douyinTracks(selectedDouyin).some((track) => trackMatches(expectedTrack, track));
      if (!matchesTrack) {
        throw new Error(`已停止填写：表单赛道「${expectedTrack}」与选中的抖音号赛道不一致`);
      }
    }
  }

  const answers = readJson(answersPath, {});
  const autoSubmit = (forceAutoSubmit || answers.autoSubmit === true) && !dryRun;
  const holdMs = autoSubmit ? 3000 : 1000;
  const extra = [normalizeUrl(url)];
  if (dryRun) {
    extra.push("--visible", "--keep-open");
  } else {
    extra.push(visible ? "--visible" : "--background", `--hold-ms=${holdMs}`);
  }
  if (targetDouyinIndexes.length > 1) {
    extra.push(`--douyin-indexes=${targetDouyinIndexes.join(",")}`);
  } else if (douyinIndex === "__auto__") {
    extra.push("--auto-douyin");
  } else if (targetDouyinIndexes.length === 1) {
    extra.push(`--douyin-index=${targetDouyinIndexes[0]}`);
  } else if (douyinIndex !== undefined && douyinIndex !== "") {
    extra.push(`--douyin-index=${douyinIndex}`);
  }
  if (expectedTrack) {
    extra.push(`--expected-track=${expectedTrack}`);
  }
  if (dryRun) {
    extra.push("--dry-run");
  }
  if (forceAutoSubmit) {
    extra.push("--auto-submit");
  }
  if (includeTrackSiblings) {
    extra.push("--include-track-siblings");
  }
  return runJob("fill", fillArgsFor(account, extra), {
    historyId,
    historyTargets,
    queueKey: `fill:${account.name}`,
    queueLabel: account.name
  });
}

function monitorLog(message) {
  const line = `${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${message}`;
  monitorRuntime.logs = `${line}\n${monitorRuntime.logs}`.slice(0, 12000);
}

function getMonitorState() {
  const recentLinkEvents = readMonitorEvents(1000).items
    .filter((event) => (
      Array.isArray(event.urls) && event.urls.length
    ))
    .slice(0, 60);
  return {
    config: getMonitorConfig(),
    ocrEngine: {
      advanced: Boolean(findPaddleOcrExe()),
      name: findPaddleOcrExe() ? "PaddleOCR+系统OCR" : "系统OCR",
      readModes: [
        { value: "ocr", label: "Paddle OCR" },
        { value: "local", label: "微信本地" }
      ]
    },
    running: monitorRuntime.running,
    lastTickAt: monitorRuntime.lastTickAt,
    lastScanDurationMs: monitorRuntime.lastScanDurationMs || 0,
    lastFoundAt: monitorRuntime.lastFoundAt,
    lastError: monitorRuntime.lastError,
    logs: monitorRuntime.logs,
    bindingStats: monitorRuntime.bindingStats || {},
    autoFillProgress: publicMonitorAutoFillProgress(),
    monitorRecords: publicMonitorRecords(),
    recentEvents: recentLinkEvents,
    scanPlan: monitorRuntime.lastScanPlan || {
      total: 0,
      batchSize: 0,
      selected: [],
      intervalMs: 15000,
      targetCycleSeconds: 15,
      estimatedCycleSeconds: 0,
      mode: "preset"
    }
  };
}

async function focusWindow(hwnd) {
  const safeHwnd = String(hwnd || "").replace(/[^\d]/g, "");
  if (!safeHwnd) {
    throw new Error("没有找到要定位的微信窗口");
  }
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class FocusWindowApi {
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
}
'@
$hwnd = [IntPtr]::new([Int64]'${safeHwnd}')
if (-not [FocusWindowApi]::IsWindow($hwnd)) {
  Write-Output 'MISSING'
  return
}
[FocusWindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
Start-Sleep -Milliseconds 120
[FocusWindowApi]::SetForegroundWindow($hwnd) | Out-Null
Write-Output 'OK'
`;
  const output = await execPowerShell(script, 5000, true);
  if (!/OK/.test(output)) {
    throw new Error("这个微信窗口可能已经关闭，请重新识别并绑定");
  }
  return { ok: true };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSizeLabel(value) {
  const match = String(value || "").match(/(\d{3,4})\s*[×xX*]\s*(\d{3,4})/);
  if (!match) {
    return null;
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

async function resizeMonitorWindow(hwnd, width, height) {
  const safeHwnd = String(hwnd || "").replace(/[^\d]/g, "");
  if (!safeHwnd) {
    throw new Error("没有找到要调整的微信窗口");
  }
  const config = getMonitorConfig();
  const binding = (config.windowBindings || []).find((item) => String(item.hwnd || "") === safeHwnd) || { hwnd: safeHwnd };
  const stat = monitorRuntime.bindingStats[safeHwnd] || {};
  const testedBest = parseSizeLabel(stat.sizeTestBest);
  const requestedWidth = Number(width) || testedBest && testedBest.width || recommendedMonitorWindow.width;
  const requestedHeight = Number(height) || testedBest && testedBest.height || recommendedMonitorWindow.height;
  const safeWidth = Math.max(820, Math.min(1280, requestedWidth));
  const safeHeight = Math.max(640, Math.min(980, requestedHeight));
  const sizeSource = Number(width) && Number(height)
    ? "manual"
    : testedBest ? "tested-best" : "default";
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class MonitorDpiApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
try { [MonitorDpiApi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch { try { [MonitorDpiApi]::SetProcessDPIAware() | Out-Null } catch {} }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ResizeWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
try { [ResizeWindowApi]::SetProcessDPIAware() | Out-Null } catch {}
$hwnd = [IntPtr]::new([Int64]'${safeHwnd}')
if (-not [ResizeWindowApi]::IsWindow($hwnd)) {
  Write-Output '{"ok":false,"error":"missing"}'
  return
}
if ([ResizeWindowApi]::IsIconic($hwnd)) {
  [ResizeWindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
  Start-Sleep -Milliseconds 120
}
$rect = New-Object ResizeWindowApi+RECT
[ResizeWindowApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
$screen = [System.Windows.Forms.Screen]::FromHandle($hwnd).WorkingArea
$width = ${Math.round(safeWidth)}
$height = ${Math.round(safeHeight)}
$left = $rect.Left
$top = $rect.Top
if ($left -lt $screen.Left) { $left = $screen.Left }
if ($top -lt $screen.Top) { $top = $screen.Top }
if (($left + $width) -gt $screen.Right) { $left = [Math]::Max($screen.Left, $screen.Right - $width) }
if (($top + $height) -gt $screen.Bottom) { $top = [Math]::Max($screen.Top, $screen.Bottom - $height) }
$ok = [ResizeWindowApi]::SetWindowPos($hwnd, [IntPtr]::Zero, [int]$left, [int]$top, [int]$width, [int]$height, 0x0014)
Start-Sleep -Milliseconds 120
$nextRect = New-Object ResizeWindowApi+RECT
[ResizeWindowApi]::GetWindowRect($hwnd, [ref]$nextRect) | Out-Null
[PSCustomObject]@{
  ok = $ok
  hwnd = '${safeHwnd}'
  width = [Math]::Max(0, $nextRect.Right - $nextRect.Left)
  height = [Math]::Max(0, $nextRect.Bottom - $nextRect.Top)
  left = $nextRect.Left
  top = $nextRect.Top
} | ConvertTo-Json -Compress
`;
  const output = await execPowerShell(script, 7000, true);
  const parsed = JSON.parse(String(output || "{}").trim().split(/\r?\n/).pop() || "{}");
  if (!parsed.ok) {
    throw new Error("窗口尺寸调整失败，请确认微信窗口还打开着");
  }
  updateBindingStat(binding, sourceForBinding(binding, config), {
    lastResizeAt: new Date().toISOString(),
    recommendedWidth: recommendedMonitorWindow.width,
    recommendedHeight: recommendedMonitorWindow.height,
    appliedSizeSource: sizeSource,
    windowWidth: Number(parsed.width || 0),
    windowHeight: Number(parsed.height || 0)
  });
  return {
    ok: true,
    hwnd: safeHwnd,
    width: Number(parsed.width || 0),
    height: Number(parsed.height || 0),
    source: sizeSource,
    recommended: recommendedMonitorWindow
  };
}

async function dockMonitorWindowToVirtualScreen(hwnd, options = {}) {
  const safeHwnd = String(hwnd || "").replace(/[^\d]/g, "");
  if (!safeHwnd) {
    throw new Error("没有找到要移动的微信窗口");
  }
  const requestedWidth = Number(options.width) || recommendedVirtualMonitorWindow.width;
  const requestedHeight = Number(options.height) || recommendedVirtualMonitorWindow.height;
  const safeWidth = Math.max(820, Math.min(1500, requestedWidth));
  const safeHeight = Math.max(640, Math.min(1020, requestedHeight));
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class VirtualScreenDpiApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
try { [VirtualScreenDpiApi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch { try { [VirtualScreenDpiApi]::SetProcessDPIAware() | Out-Null } catch {} }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class VirtualScreenWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
try { [VirtualScreenWindowApi]::SetProcessDPIAware() | Out-Null } catch {}
$hwnd = [IntPtr]::new([Int64]'${safeHwnd}')
if (-not [VirtualScreenWindowApi]::IsWindow($hwnd)) {
  Write-Output '{"ok":false,"error":"missing"}'
  return
}
$screens = @([System.Windows.Forms.Screen]::AllScreens)
$target = $screens |
  Where-Object { -not $_.Primary } |
  Sort-Object @{ Expression = { if ($_.Bounds.Width -ge $_.Bounds.Height) { 0 } else { 1 } } }, @{ Expression = { [Math]::Abs($_.Bounds.Width - 1920) + [Math]::Abs($_.Bounds.Height - 1080) } }, @{ Expression = { if ($_.Bounds.X -ge 0) { 0 } else { 1 } } }, @{ Expression = { [Math]::Abs($_.Bounds.X) + [Math]::Abs($_.Bounds.Y) } } |
  Select-Object -First 1
if ($null -eq $target) {
  [PSCustomObject]@{
    ok = $false
    error = "no-secondary-screen"
    screenCount = $screens.Count
  } | ConvertTo-Json -Compress
  return
}
if ([VirtualScreenWindowApi]::IsIconic($hwnd)) {
  [VirtualScreenWindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
  Start-Sleep -Milliseconds 160
}
$area = $target.WorkingArea
$width = [Math]::Min(${Math.round(safeWidth)}, [Math]::Max(360, $area.Width - 40))
$height = [Math]::Min(${Math.round(safeHeight)}, [Math]::Max(360, $area.Height - 40))
$left = [int]($area.Left + [Math]::Max(0, ($area.Width - $width) / 2))
$top = [int]($area.Top + [Math]::Max(0, ($area.Height - $height) / 2))
$ok = [VirtualScreenWindowApi]::SetWindowPos($hwnd, [IntPtr]::Zero, $left, $top, [int]$width, [int]$height, 0x0014)
Start-Sleep -Milliseconds 160
$rect = New-Object VirtualScreenWindowApi+RECT
[VirtualScreenWindowApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
[PSCustomObject]@{
  ok = $ok
  hwnd = '${safeHwnd}'
  screenCount = $screens.Count
  target = [PSCustomObject]@{
    deviceName = $target.DeviceName
    primary = $target.Primary
    left = $target.Bounds.Left
    top = $target.Bounds.Top
    width = $target.Bounds.Width
    height = $target.Bounds.Height
    workingLeft = $area.Left
    workingTop = $area.Top
    workingWidth = $area.Width
    workingHeight = $area.Height
  }
  bounds = [PSCustomObject]@{
    left = $rect.Left
    top = $rect.Top
    width = [Math]::Max(0, $rect.Right - $rect.Left)
    height = [Math]::Max(0, $rect.Bottom - $rect.Top)
  }
} | ConvertTo-Json -Compress -Depth 5
`;
  const output = await execPowerShell(script, 7000, true);
  const parsed = JSON.parse(String(output || "{}").trim().split(/\r?\n/).pop() || "{}");
  if (!parsed.ok) {
    if (parsed.error === "no-secondary-screen") {
      throw new Error("没有检测到第二块屏幕。请确认 HDMI 假显示器已插入，并且 Windows 显示模式是“扩展”。");
    }
    throw new Error("移动到虚拟屏失败，请确认微信窗口还打开着");
  }

  const config = getMonitorConfig();
  const binding = (config.windowBindings || []).find((item) => String(item.hwnd || "") === safeHwnd) || { hwnd: safeHwnd };
  const source = sourceForBinding(binding, config);
  const deviceName = parsed.target && parsed.target.deviceName || "";
  if (options.persist !== false && binding.sourceId) {
    const dockedAt = new Date().toISOString();
    const windowBindings = (config.windowBindings || []).map((item) => (
      String(item.hwnd || "") === safeHwnd
        ? {
            ...item,
            virtualScreen: true,
            virtualScreenDevice: deviceName,
            virtualScreenDockedAt: dockedAt
          }
        : item
    ));
    writeMonitorConfig({ ...config, windowBindings });
  }
  updateBindingStat(binding, source, {
    lastVirtualScreenAt: new Date().toISOString(),
    virtualScreen: true,
    virtualScreenDevice: deviceName,
    lastError: "",
    windowWidth: Number(parsed.bounds && parsed.bounds.width || 0),
    windowHeight: Number(parsed.bounds && parsed.bounds.height || 0)
  });
  return {
    ok: true,
    hwnd: safeHwnd,
    screenCount: Number(parsed.screenCount || 0),
    target: parsed.target || null,
    bounds: parsed.bounds || null
  };
}

async function restoreMonitorWindowToPrimaryScreen(hwnd, options = {}) {
  const safeHwnd = String(hwnd || "").replace(/[^\d]/g, "");
  if (!safeHwnd) {
    throw new Error("没有找到要移回的微信窗口");
  }
  const requestedWidth = Number(options.width) || recommendedMonitorWindow.width;
  const requestedHeight = Number(options.height) || recommendedMonitorWindow.height;
  const safeWidth = Math.max(820, Math.min(1280, requestedWidth));
  const safeHeight = Math.max(640, Math.min(980, requestedHeight));
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PrimaryScreenDpiApi {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
try { [PrimaryScreenDpiApi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch { try { [PrimaryScreenDpiApi]::SetProcessDPIAware() | Out-Null } catch {} }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PrimaryScreenWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
}
'@
$hwnd = [IntPtr]::new([Int64]'${safeHwnd}')
if (-not [PrimaryScreenWindowApi]::IsWindow($hwnd)) {
  Write-Output '{"ok":false,"error":"missing"}'
  return
}
$target = [System.Windows.Forms.Screen]::PrimaryScreen
if ($null -eq $target) {
  Write-Output '{"ok":false,"error":"no-primary-screen"}'
  return
}
if ([PrimaryScreenWindowApi]::IsIconic($hwnd)) {
  [PrimaryScreenWindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
  Start-Sleep -Milliseconds 160
}
$area = $target.WorkingArea
$width = [Math]::Min(${Math.round(safeWidth)}, [Math]::Max(360, $area.Width - 80))
$height = [Math]::Min(${Math.round(safeHeight)}, [Math]::Max(360, $area.Height - 80))
$left = [int]($area.Left + [Math]::Max(0, ($area.Width - $width) / 2))
$top = [int]($area.Top + [Math]::Max(0, ($area.Height - $height) / 2))
$ok = [PrimaryScreenWindowApi]::SetWindowPos($hwnd, [IntPtr]::Zero, $left, $top, [int]$width, [int]$height, 0x0014)
Start-Sleep -Milliseconds 160
$rect = New-Object PrimaryScreenWindowApi+RECT
[PrimaryScreenWindowApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
[PSCustomObject]@{
  ok = $ok
  hwnd = '${safeHwnd}'
  target = [PSCustomObject]@{
    deviceName = $target.DeviceName
    primary = $target.Primary
    left = $target.Bounds.Left
    top = $target.Bounds.Top
    width = $target.Bounds.Width
    height = $target.Bounds.Height
  }
  bounds = [PSCustomObject]@{
    left = $rect.Left
    top = $rect.Top
    width = [Math]::Max(0, $rect.Right - $rect.Left)
    height = [Math]::Max(0, $rect.Bottom - $rect.Top)
  }
} | ConvertTo-Json -Compress -Depth 5
`;
  const output = await execPowerShell(script, 7000, true);
  const parsed = JSON.parse(String(output || "{}").trim().split(/\r?\n/).pop() || "{}");
  if (!parsed.ok) {
    throw new Error("移回主屏失败，请确认微信窗口还打开着");
  }

  const config = getMonitorConfig();
  const binding = (config.windowBindings || []).find((item) => String(item.hwnd || "") === safeHwnd) || { hwnd: safeHwnd };
  const source = sourceForBinding(binding, config);
  if (options.persist !== false && binding.sourceId) {
    const windowBindings = (config.windowBindings || []).map((item) => (
      String(item.hwnd || "") === safeHwnd
        ? {
            ...item,
            virtualScreen: false,
            virtualScreenDevice: "",
            virtualScreenDockedAt: ""
          }
        : item
    ));
    writeMonitorConfig({ ...config, windowBindings });
  }
  updateBindingStat(binding, source, {
    lastPrimaryScreenAt: new Date().toISOString(),
    virtualScreen: false,
    virtualScreenDevice: "",
    lastError: "",
    windowWidth: Number(parsed.bounds && parsed.bounds.width || 0),
    windowHeight: Number(parsed.bounds && parsed.bounds.height || 0)
  });
  return {
    ok: true,
    hwnd: safeHwnd,
    target: parsed.target || null,
    bounds: parsed.bounds || null
  };
}

async function recoverUnboundWechatWindowsToPrimaryScreen() {
  const config = getMonitorConfig();
  const boundHwnds = new Set((config.windowBindings || [])
    .filter((binding) => binding.enabled !== false)
    .map((binding) => String(binding.hwnd || "").replace(/[^\d]/g, ""))
    .filter(Boolean));
  const boundLiteral = Array.from(boundHwnds).map((value) => `'${value}'`).join(", ");
  const targetWidth = recommendedMonitorWindow.width;
  const targetHeight = recommendedMonitorWindow.height;
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class RecoverWechatWindowApi {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
try { [RecoverWechatWindowApi]::SetProcessDpiAwarenessContext([IntPtr]::new(-4)) | Out-Null } catch { try { [RecoverWechatWindowApi]::SetProcessDPIAware() | Out-Null } catch {} }
Add-Type -AssemblyName System.Windows.Forms
$boundHwnds = @(${boundLiteral})
$boundMap = @{}
foreach ($boundHwnd in $boundHwnds) {
  if (-not [string]::IsNullOrWhiteSpace($boundHwnd)) { $boundMap[$boundHwnd] = $true }
}
function Get-WindowTitle($handle) {
  try {
    $length = [RecoverWechatWindowApi]::GetWindowTextLength($handle)
    $builder = New-Object System.Text.StringBuilder ([Math]::Max(256, $length + 1))
    [RecoverWechatWindowApi]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
    return $builder.ToString()
  } catch {
    return ""
  }
}
function Is-MonitorChatWindow($title, [int]$width, [int]$height) {
  $text = if ($null -eq $title) { "" } else { $title.Trim() }
  $wechatTitle = ([char]0x5FAE).ToString() + ([char]0x4FE1).ToString()
  if ([string]::IsNullOrWhiteSpace($text)) { return $false }
  if ($text -eq $wechatTitle -or $text -match '^(?:WeChat|Weixin|Tencent WeChat)$') { return $false }
  if ($text -match 'Images and Videos') { return $false }
  if ($text -match (([char]0x56FE).ToString() + ([char]0x7247).ToString() + '.*' + ([char]0x89C6).ToString() + ([char]0x9891).ToString())) { return $false }
  if ($text -match (([char]0x5716).ToString() + ([char]0x7247).ToString() + '.*' + ([char]0x5F71).ToString() + ([char]0x7247).ToString())) { return $false }
  if ($width -lt 240 -or $height -lt 220) { return $false }
  return $true
}
$primary = [System.Windows.Forms.Screen]::PrimaryScreen
if ($null -eq $primary) {
  Write-Output '{"ok":false,"error":"no-primary-screen","items":[]}'
  return
}
$area = $primary.WorkingArea
$items = New-Object System.Collections.Generic.List[object]
$enumCallback = [RecoverWechatWindowApi+EnumWindowsProc]{
  param([IntPtr]$handle, [IntPtr]$lParam)
  try {
    if (-not [RecoverWechatWindowApi]::IsWindowVisible($handle)) { return $true }
    if ([RecoverWechatWindowApi]::IsIconic($handle)) { return $true }
    $hwndText = $handle.ToInt64().ToString()
    if ($boundMap.ContainsKey($hwndText)) { return $true }
    [uint32]$windowPid = 0
    [RecoverWechatWindowApi]::GetWindowThreadProcessId($handle, [ref]$windowPid) | Out-Null
    if ($windowPid -le 0) { return $true }
    $proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
    if ($null -eq $proc -or $proc.ProcessName -notmatch 'WeChat|Weixin|WXWork') { return $true }
    $rect = New-Object RecoverWechatWindowApi+RECT
    [RecoverWechatWindowApi]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $oldWidth = [Math]::Max(0, $rect.Right - $rect.Left)
    $oldHeight = [Math]::Max(0, $rect.Bottom - $rect.Top)
    if ($oldWidth -lt 240 -or $oldHeight -lt 220) { return $true }
    $title = Get-WindowTitle $handle
    if (-not (Is-MonitorChatWindow $title $oldWidth $oldHeight)) { return $true }
    $screen = [System.Windows.Forms.Screen]::FromHandle($handle)
    if ($null -ne $screen -and $screen.Primary) { return $true }
    $width = [Math]::Min(${Math.round(targetWidth)}, [Math]::Max(360, $area.Width - 80))
    $height = [Math]::Min(${Math.round(targetHeight)}, [Math]::Max(360, $area.Height - 80))
    $left = [int]($area.Left + [Math]::Max(0, ($area.Width - $width) / 2))
    $top = [int]($area.Top + [Math]::Max(0, ($area.Height - $height) / 2))
    $ok = [RecoverWechatWindowApi]::SetWindowPos($handle, [IntPtr]::Zero, $left, $top, [int]$width, [int]$height, 0x0014)
    Start-Sleep -Milliseconds 80
    $nextRect = New-Object RecoverWechatWindowApi+RECT
    [RecoverWechatWindowApi]::GetWindowRect($handle, [ref]$nextRect) | Out-Null
    $items.Add([PSCustomObject]@{
      ok = $ok
      hwnd = $hwndText
      pid = $windowPid
      process = $proc.ProcessName
      title = $title
      fromScreen = if ($null -ne $screen) { $screen.DeviceName } else { "" }
      bounds = [PSCustomObject]@{
        left = $nextRect.Left
        top = $nextRect.Top
        width = [Math]::Max(0, $nextRect.Right - $nextRect.Left)
        height = [Math]::Max(0, $nextRect.Bottom - $nextRect.Top)
      }
    }) | Out-Null
  } catch {}
  return $true
}
[RecoverWechatWindowApi]::EnumWindows($enumCallback, [IntPtr]::Zero) | Out-Null
[PSCustomObject]@{
  ok = $true
  recovered = $items.Count
  items = $items
} | ConvertTo-Json -Compress -Depth 5
`;
  const output = await execPowerShell(script, 10000, true);
  const parsed = JSON.parse(String(output || "{}").trim().split(/\r?\n/).pop() || "{}");
  if (!parsed.ok) {
    throw new Error("找回虚拟屏微信窗口失败，请确认主屏和虚拟屏都处于扩展模式");
  }
  return {
    ok: true,
    recovered: Number(parsed.recovered || 0),
    windows: Array.isArray(parsed.items) ? parsed.items : parsed.items ? [parsed.items] : []
  };
}

function scoreSizeTestResult(result) {
  return Math.round(
    Number(result.validCount || 0) * 1000
    + Number(result.stableCount || 0) * 260
    + Number(result.candidateCount || 0) * 120
    + Math.min(Number(result.textLength || 0), 3500) / 8
    - Math.min(Number(result.elapsedMs || 0), 30000) / 40
  );
}

async function readWindowForSizeTest(hwnd) {
  const safeHwnd = String(hwnd || "").trim();
  const snapshot = await getWechatSnapshotForHwnd(safeHwnd, 3, getMonitorConfig().readMode);
  if (!snapshot) {
    throw new Error("窗口未打开、已最小化或已关闭");
  }
  const analysis = await analyzeWechatSnapshot(snapshot);
  const text = analysis.text;
  const candidateUrls = analysis.candidateUrls;
  const urls = analysis.urls;
  return {
    text,
    candidateUrls,
    urls,
    readSource: analysis.detectionSource,
    readMode: analysis.readMode,
    originalTextLength: analysis.originalTextLength,
    ocrTextLength: analysis.ocrTextLength,
    localStatus: analysis.localStatus,
    localMessage: analysis.localMessage,
    localAccounts: analysis.localAccounts,
    title: snapshot.title || ""
  };
}

async function testMonitorWindowSizes(hwnd) {
  const config = getMonitorConfig();
  const safeHwnd = String(hwnd || "").trim();
  const binding = (config.windowBindings || [])
    .filter((item) => item.enabled !== false)
    .find((item) => String(item.hwnd || "") === safeHwnd);
  if (!binding) {
    throw new Error("这个窗口还没有固定到监控台");
  }
  const source = sourceForBinding(binding, config);
  const checkedAt = new Date().toISOString();
  const results = [];

  for (const size of monitorSizeTestCandidates) {
    const startedAt = Date.now();
    let resizeResult = null;
    const passes = [];
    let error = "";
    try {
      resizeResult = await resizeMonitorWindow(safeHwnd, size.width, size.height);
      await delay(350);
      for (let pass = 0; pass < 2; pass += 1) {
        if (pass > 0) {
          await delay(250);
        }
        passes.push(await readWindowForSizeTest(safeHwnd));
      }
    } catch (currentError) {
      error = currentError.message;
    }
    const allUrls = normalizeMonitorUrlList(passes.flatMap((pass) => pass.urls || []));
    const allCandidateUrls = normalizeMonitorUrlList(passes.flatMap((pass) => pass.candidateUrls || []));
    const stableUrls = passes.length > 1
      ? allUrls.filter((url) => passes.every((pass) => normalizeMonitorUrlList(pass.urls || []).includes(url)))
      : allUrls;
    const textLength = Math.max(0, ...passes.map((pass) => String(pass.text || "").length));
    const result = {
      width: size.width,
      height: size.height,
      actualWidth: resizeResult && resizeResult.width || 0,
      actualHeight: resizeResult && resizeResult.height || 0,
      textLength,
      candidateCount: allCandidateUrls.length,
      validCount: allUrls.length,
      stableCount: stableUrls.length,
      urls: allUrls.slice(0, 6),
      candidateUrls: allCandidateUrls.slice(0, 6),
      elapsedMs: Date.now() - startedAt,
      passes: passes.length,
      error
    };
    result.score = scoreSizeTestResult(result);
    results.push({
      ...result
    });
  }

  const best = [...results].sort((a, b) => (
    b.score - a.score
    || b.validCount - a.validCount
    || b.stableCount - a.stableCount
    || b.candidateCount - a.candidateCount
    || b.textLength - a.textLength
    || a.elapsedMs - b.elapsedMs
  ))[0] || { ...recommendedMonitorWindow, validCount: 0, candidateCount: 0, textLength: 0 };

  try {
    await resizeMonitorWindow(safeHwnd, best.width || recommendedMonitorWindow.width, best.height || recommendedMonitorWindow.height);
  } catch {}

  updateBindingStat(binding, source, {
    lastSizeTestAt: checkedAt,
    sizeTestBest: `${best.width}×${best.height}`,
    sizeTestValidCount: Number(best.validCount || 0),
    sizeTestCandidateCount: Number(best.candidateCount || 0),
    sizeTestStableCount: Number(best.stableCount || 0),
    sizeTestScore: Number(best.score || 0),
    sizeTestResults: results.slice(0, 12),
    sizeTestMessage: best.validCount
      ? `推荐 ${best.width}×${best.height}：有效 ${best.validCount} 条，稳定 ${best.stableCount} 条`
      : `推荐 ${best.width}×${best.height}：当前画面没有有效链接，按文字量和疑似链接评分`
  });

  return {
    ok: true,
    hwnd: safeHwnd,
    best,
    results,
    message: best.validCount
      ? `最佳尺寸 ${best.width}×${best.height}，有效 ${best.validCount} 条，稳定 ${best.stableCount} 条`
      : `没有识别到有效链接，已按测试评分保留 ${best.width || recommendedMonitorWindow.width}×${best.height || recommendedMonitorWindow.height}`
  };
}

async function getWindowUnderCursor() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class PickWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT lpPoint);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
function Get-WindowTitle($handle) {
  try {
    $length = [PickWindowApi]::GetWindowTextLength($handle)
    $builder = New-Object System.Text.StringBuilder ([Math]::Max(256, $length + 1))
    [PickWindowApi]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
    return $builder.ToString()
  } catch {
    return ""
  }
}
$point = New-Object PickWindowApi+POINT
if (-not [PickWindowApi]::GetCursorPos([ref]$point)) { return }
$handle = [PickWindowApi]::WindowFromPoint($point)
if ($handle -eq [IntPtr]::Zero) { return }
$root = [PickWindowApi]::GetAncestor($handle, 2)
if ($root -ne [IntPtr]::Zero) { $handle = $root }
if (-not [PickWindowApi]::IsWindowVisible($handle) -or [PickWindowApi]::IsIconic($handle)) { return }
[uint32]$windowPid = 0
[PickWindowApi]::GetWindowThreadProcessId($handle, [ref]$windowPid) | Out-Null
$proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
$rect = New-Object PickWindowApi+RECT
[PickWindowApi]::GetWindowRect($handle, [ref]$rect) | Out-Null
[PSCustomObject]@{
  pid = $windowPid
  hwnd = $handle.ToInt64().ToString()
  process = if ($proc) { $proc.ProcessName } else { "" }
  title = Get-WindowTitle $handle
  bounds = [PSCustomObject]@{
    left = $rect.Left
    top = $rect.Top
    width = [Math]::Max(0, $rect.Right - $rect.Left)
    height = [Math]::Max(0, $rect.Bottom - $rect.Top)
  }
} | ConvertTo-Json -Compress -Depth 4
`;
  const output = await execPowerShell(script, 8000, true);
  if (!output) {
    throw new Error("没有吸取到窗口，请把鼠标放在微信独立窗口上再试");
  }
  try {
    const picked = JSON.parse(output);
    const processName = String(picked.process || "");
    if (!/WeChat|Weixin|WXWork/i.test(processName)) {
      throw new Error(`吸取到的不是微信窗口：${picked.title || processName || "未知窗口"}`);
    }
    if (isMainWechatWindowTitle(picked.title)) {
      throw new Error("这是微信主界面，不是独立聊天窗口");
    }
    return picked;
  } catch (error) {
    if (error.message && error.message.includes("不是微信窗口")) {
      throw error;
    }
    throw new Error("吸取窗口失败，请重试");
  }
}

async function getForegroundWechatWindow() {
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ForegroundWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
function Get-WindowTitle($handle) {
  try {
    $length = [ForegroundWindowApi]::GetWindowTextLength($handle)
    $builder = New-Object System.Text.StringBuilder ([Math]::Max(256, $length + 1))
    [ForegroundWindowApi]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
    return $builder.ToString()
  } catch {
    return ""
  }
}
$handle = [ForegroundWindowApi]::GetForegroundWindow()
if ($handle -eq [IntPtr]::Zero) { return }
$root = [ForegroundWindowApi]::GetAncestor($handle, 2)
if ($root -ne [IntPtr]::Zero) { $handle = $root }
if (-not [ForegroundWindowApi]::IsWindowVisible($handle) -or [ForegroundWindowApi]::IsIconic($handle)) { return }
[uint32]$windowPid = 0
[ForegroundWindowApi]::GetWindowThreadProcessId($handle, [ref]$windowPid) | Out-Null
$proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
$rect = New-Object ForegroundWindowApi+RECT
[ForegroundWindowApi]::GetWindowRect($handle, [ref]$rect) | Out-Null
[PSCustomObject]@{
  pid = $windowPid
  hwnd = $handle.ToInt64().ToString()
  process = if ($proc) { $proc.ProcessName } else { "" }
  title = Get-WindowTitle $handle
  bounds = [PSCustomObject]@{
    left = $rect.Left
    top = $rect.Top
    width = [Math]::Max(0, $rect.Right - $rect.Left)
    height = [Math]::Max(0, $rect.Bottom - $rect.Top)
  }
} | ConvertTo-Json -Compress -Depth 4
`;
  const output = await execPowerShell(script, 8000, true);
  if (!output) {
    throw new Error("没有锁定到前台窗口，请先点一下目标微信独立窗口");
  }
  try {
    const picked = JSON.parse(output);
    const processName = String(picked.process || "");
    if (!/WeChat|Weixin|WXWork/i.test(processName)) {
      throw new Error(`前台不是微信窗口：${picked.title || processName || "未知窗口"}`);
    }
    if (isMainWechatWindowTitle(picked.title)) {
      throw new Error("这是微信主界面，不是独立聊天窗口");
    }
    return picked;
  } catch (error) {
    if (error.message && error.message.includes("不是微信窗口")) {
      throw error;
    }
    throw new Error("锁定前台窗口失败，请重试");
  }
}

async function captureWindowImage(hwnd) {
  const safeHwnd = String(hwnd || "").replace(/[^\d]/g, "");
  if (!safeHwnd) {
    return "";
  }
  const script = `
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class CaptureWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
}
'@
$handle = [IntPtr]::new([Int64]'${safeHwnd}')
if (-not [CaptureWindowApi]::IsWindow($handle) -or [CaptureWindowApi]::IsIconic($handle)) { return }
$rect = New-Object CaptureWindowApi+RECT
[CaptureWindowApi]::GetWindowRect($handle, [ref]$rect) | Out-Null
$width = [Math]::Max(1, $rect.Right - $rect.Left)
$height = [Math]::Max(1, $rect.Bottom - $rect.Top)
if ($width -lt 80 -or $height -lt 80) { return }
$bitmap = New-Object System.Drawing.Bitmap($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$printed = $false
try {
  $hdc = $graphics.GetHdc()
  $printed = [CaptureWindowApi]::PrintWindow($handle, $hdc, 2)
  $graphics.ReleaseHdc($hdc)
} catch {
  $printed = $false
}
if (-not $printed) {
  $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
}
$graphics.Dispose()
$maxWidth = 760
$maxHeight = 520
if ($bitmap.Width -gt $maxWidth -or $bitmap.Height -gt $maxHeight) {
  $scale = [Math]::Min($maxWidth / [double]$bitmap.Width, $maxHeight / [double]$bitmap.Height)
  $scaledWidth = [Math]::Max(1, [int]($bitmap.Width * $scale))
  $scaledHeight = [Math]::Max(1, [int]($bitmap.Height * $scale))
  $scaled = New-Object System.Drawing.Bitmap($scaledWidth, $scaledHeight)
  $scaleGraphics = [System.Drawing.Graphics]::FromImage($scaled)
  $scaleGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $scaleGraphics.DrawImage($bitmap, 0, 0, $scaledWidth, $scaledHeight)
  $scaleGraphics.Dispose()
  $bitmap.Dispose()
  $bitmap = $scaled
}
$tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ("wechat-window-proof-" + [Guid]::NewGuid().ToString("N") + ".png"))
$bitmap.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$bitmap.Dispose()
$bytes = [System.IO.File]::ReadAllBytes($tmp)
Remove-Item -LiteralPath $tmp -Force
[Convert]::ToBase64String($bytes)
`;
  const output = await execPowerShell(script, 15000, true);
  return output ? `data:image/png;base64,${output}` : "";
}

function execPowerShell(script, timeout = 8000, sta = false) {
  return new Promise((resolve) => {
    const wrappedScript = `
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
$ProgressPreference = 'SilentlyContinue'
${script}`;
    const encoded = Buffer.from(wrappedScript, "utf16le").toString("base64");
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass"];
    if (sta) {
      args.push("-STA");
    }
    let tempScript = "";
    if (encoded.length > 24000) {
      tempScript = path.join(os.tmpdir(), `wechat-monitor-${Date.now()}-${Math.random().toString(16).slice(2)}.ps1`);
      fs.writeFileSync(tempScript, `\ufeff${wrappedScript}`, "utf8");
      args.push("-File", tempScript);
    } else {
      args.push("-EncodedCommand", encoded);
    }
    execFile(
      "powershell.exe",
      args,
      { windowsHide: true, timeout, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (tempScript) {
          fs.rm(tempScript, { force: true }, () => {});
        }
        if (error) {
          resolve("");
          return;
        }
        resolve(String(stdout || "").trim());
      }
    );
  });
}

async function getClipboardText() {
  return execPowerShell("Get-Clipboard -Raw", 5000);
}

async function pickLocalPath({ type, title, filter }) {
  if (type === "file") {
    const safeTitle = String(title || "选择文件").replace(/'/g, "''");
    const safeFilter = String(filter || "任务单|*.xlsx;*.xls;*.csv;*.tsv;*.json|所有文件|*.*").replace(/'/g, "''");
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = '${safeTitle}'
$dialog.Filter = '${safeFilter}'
$dialog.Multiselect = $false
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.FileName
}
`;
    return execPowerShell(script, 120000, true);
  }

  const safeTitle = String(title || "选择文件夹").replace(/'/g, "''");
  const script = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '${safeTitle}'
$dialog.ShowNewFolderButton = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
`;
  return execPowerShell(script, 120000, true);
}

function openLocalPath(targetPath) {
  const safePath = String(targetPath || "").trim();
  if (!safePath || !fs.existsSync(safePath)) {
    throw new Error("路径不存在");
  }
  execFile("explorer.exe", [safePath], { windowsHide: true }, () => {});
}

function detectJianyingPaths() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    {
      name: "剪映专业版",
      draftDir: path.join(localAppData, "JianyingPro", "User Data", "Projects", "com.lveditor.draft")
    },
    {
      name: "CapCut",
      draftDir: path.join(localAppData, "CapCut", "User Data", "Projects", "com.lveditor.draft")
    }
  ].map((item) => ({
    ...item,
    exists: Boolean(item.draftDir && fs.existsSync(item.draftDir) && fs.statSync(item.draftDir).isDirectory())
  }));

  return {
    candidates,
    preferred: candidates.find((item) => item.exists) || null
  };
}

function findPaddleOcrExe() {
  const candidates = [
    path.join(rootDir, "tools", "PaddleOCR-json", "PaddleOCR-json_v1.4.1", "PaddleOCR-json.exe"),
    path.join(process.resourcesPath || "", "tools", "PaddleOCR-json", "PaddleOCR-json_v1.4.1", "PaddleOCR-json.exe")
  ].filter(Boolean);
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  }) || "";
}

async function getWechatSnapshots(targetHwnds = [], readMode = getMonitorConfig().readMode) {
  const normalizedReadMode = normalizeMonitorReadMode(readMode);
  const targetList = uniqueCleanList(targetHwnds)
    .map((value) => String(value || "").replace(/[^\d]/g, ""))
    .filter(Boolean);
  const targetLiteral = targetList.map((value) => `'${value}'`).join(", ");
  const paddleOcrExe = findPaddleOcrExe().replace(/'/g, "''");
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$paddleOcrExe = '${paddleOcrExe}'
$readMode = '${normalizedReadMode}'
$readControls = $false
$readOcr = $readMode -eq 'ocr'
$targetHwnds = @(${targetLiteral})
$targetMap = @{}
foreach ($targetHwnd in $targetHwnds) {
  if (-not [string]::IsNullOrWhiteSpace($targetHwnd)) {
    $targetMap[$targetHwnd] = $true
  }
}
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class MonitorWindowRect {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
}
'@
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 })[0]
function Await-Result($operation, [Type]$resultType) {
  if ($null -eq $operation -or $null -eq $script:asTaskGeneric) { return $null }
  $task = $script:asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait()
  return $task.Result
}
function Add-Name($value) {
  if ([string]::IsNullOrWhiteSpace($value)) { return }
  $text = $value.Trim()
  if ($text.Length -gt 520) { $text = $text.Substring(0, 520) }
  $script:names += $text
}
function Walk($element, [int]$depth) {
  if ($null -eq $element -or $depth -gt 8 -or $script:names.Count -gt 700) { return }
  try { Add-Name $element.Current.Name } catch {}
  try {
    $valuePattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($null -ne $valuePattern) { Add-Name $valuePattern.Current.Value }
  } catch {}
  try {
    $legacyPattern = $element.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
    if ($null -ne $legacyPattern) {
      Add-Name $legacyPattern.Current.Name
      Add-Name $legacyPattern.Current.Value
      Add-Name $legacyPattern.Current.Description
    }
  } catch {}
  try {
    $textPattern = $element.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    if ($null -ne $textPattern) { Add-Name $textPattern.DocumentRange.GetText(2000) }
  } catch {}
  try {
    $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($child in $children) { Walk $child ($depth + 1) }
  } catch {}
}
function Copy-BitmapRegion($source, [int]$x, [int]$y, [int]$width, [int]$height) {
  $safeX = [Math]::Max(0, [Math]::Min($x, $source.Width - 1))
  $safeY = [Math]::Max(0, [Math]::Min($y, $source.Height - 1))
  $safeWidth = [Math]::Max(1, [Math]::Min($width, $source.Width - $safeX))
  $safeHeight = [Math]::Max(1, [Math]::Min($height, $source.Height - $safeY))
  $target = New-Object System.Drawing.Bitmap($safeWidth, $safeHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $graphics.DrawImage($source, 0, 0, (New-Object System.Drawing.Rectangle($safeX, $safeY, $safeWidth, $safeHeight)), [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()
  return $target
}
function Measure-Light($bitmap) {
  $sampleTotal = 0
  $sampleCount = 0
  for ($sy = 0; $sy -lt $bitmap.Height; $sy += 28) {
    for ($sx = 0; $sx -lt $bitmap.Width; $sx += 28) {
      $color = $bitmap.GetPixel($sx, $sy)
      $sampleTotal += [int](($color.R * 0.299) + ($color.G * 0.587) + ($color.B * 0.114))
      $sampleCount += 1
    }
  }
  if ($sampleCount -le 0) { return 255 }
  return $sampleTotal / [double]$sampleCount
}
function Invert-Bitmap($bitmap) {
  $target = New-Object System.Drawing.Bitmap($bitmap.Width, $bitmap.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $matrix = New-Object System.Drawing.Imaging.ColorMatrix
  $matrix.Matrix00 = -1
  $matrix.Matrix11 = -1
  $matrix.Matrix22 = -1
  $matrix.Matrix33 = 1
  $matrix.Matrix40 = 1
  $matrix.Matrix41 = 1
  $matrix.Matrix42 = 1
  $matrix.Matrix44 = 1
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetColorMatrix($matrix)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)
  $graphics.DrawImage($bitmap, $rect, 0, 0, $bitmap.Width, $bitmap.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
  $attrs.Dispose()
  $graphics.Dispose()
  return $target
}
function Resize-BitmapForOcr($bitmap, [int]$maxDimension) {
  if ($maxDimension -lt 900) { $maxDimension = 2200 }
  $largest = [Math]::Max($bitmap.Width, $bitmap.Height)
  if ($largest -le 0) {
    return $bitmap
  }
  $targetMax = [Math]::Min($maxDimension, 2200)
  $scale = 1.0
  if ($largest -lt 1500) {
    $scale = [Math]::Min(2.4, $targetMax / [double]$largest)
  } elseif ($bitmap.Width -gt $maxDimension -or $bitmap.Height -gt $maxDimension) {
    $scale = [Math]::Min($maxDimension / [double]$bitmap.Width, $maxDimension / [double]$bitmap.Height)
  }
  if ([Math]::Abs($scale - 1.0) -lt 0.05) {
    return $bitmap
  }
  $scaledWidth = [Math]::Max(1, [int]($bitmap.Width * $scale))
  $scaledHeight = [Math]::Max(1, [int]($bitmap.Height * $scale))
  $scaled = New-Object System.Drawing.Bitmap($scaledWidth, $scaledHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($scaled)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($bitmap, 0, 0, $scaledWidth, $scaledHeight)
  $graphics.Dispose()
  return $scaled
}
function Resize-BitmapForPaddle($bitmap, [int]$targetMax) {
  if ($targetMax -lt 1200) { $targetMax = 2600 }
  $largest = [Math]::Max($bitmap.Width, $bitmap.Height)
  if ($largest -le 0) { return $bitmap }
  $scale = 1.0
  if ($largest -lt $targetMax) {
    $scale = [Math]::Min(3.6, $targetMax / [double]$largest)
  } elseif ($largest -gt $targetMax) {
    $scale = $targetMax / [double]$largest
  }
  if ([Math]::Abs($scale - 1.0) -lt 0.05) {
    return $bitmap
  }
  $scaledWidth = [Math]::Max(1, [int]($bitmap.Width * $scale))
  $scaledHeight = [Math]::Max(1, [int]($bitmap.Height * $scale))
  $scaled = New-Object System.Drawing.Bitmap($scaledWidth, $scaledHeight)
  $graphics = [System.Drawing.Graphics]::FromImage($scaled)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($bitmap, 0, 0, $scaledWidth, $scaledHeight)
  $graphics.Dispose()
  return $scaled
}
function Adjust-BitmapForText($bitmap) {
  $target = New-Object System.Drawing.Bitmap($bitmap.Width, $bitmap.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($target)
  $matrix = New-Object System.Drawing.Imaging.ColorMatrix
  $matrix.Matrix00 = 1.35
  $matrix.Matrix11 = 1.35
  $matrix.Matrix22 = 1.35
  $matrix.Matrix33 = 1
  $matrix.Matrix40 = -0.08
  $matrix.Matrix41 = -0.08
  $matrix.Matrix42 = -0.08
  $matrix.Matrix44 = 1
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetColorMatrix($matrix)
  $rect = New-Object System.Drawing.Rectangle(0, 0, $bitmap.Width, $bitmap.Height)
  $graphics.DrawImage($bitmap, $rect, 0, 0, $bitmap.Width, $bitmap.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
  $attrs.Dispose()
  $graphics.Dispose()
  return $target
}
function Invoke-PaddleOcrBitmap($bitmap) {
  if ([string]::IsNullOrWhiteSpace($script:paddleOcrExe) -or -not (Test-Path -LiteralPath $script:paddleOcrExe)) {
    return ""
  }
  $tmp = ""
  $work = $bitmap
  $inverted = $null
  $enhanced = $null
  $scaled = $null
  try {
    if ((Measure-Light $work) -lt 150) {
      $inverted = Invert-Bitmap $work
      $work = $inverted
    }
    $enhanced = Adjust-BitmapForText $work
    $work = $enhanced
    $scaled = Resize-BitmapForPaddle $work 2600
    $work = $scaled
    $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ("wechat-monitor-paddle-" + [Guid]::NewGuid().ToString("N") + ".png"))
    $work.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $cwd = Split-Path -LiteralPath $script:paddleOcrExe -Parent
    Push-Location -LiteralPath $cwd
    try {
      $output = & $script:paddleOcrExe "-image_path=$tmp" "-limit_side_len=2600" "-rec_img_w=960" "-rec_batch_num=8" "-det_db_thresh=0.15" "-det_db_box_thresh=0.25" "-det_db_unclip_ratio=1.8" "-use_dilation=true" 2>$null
    } finally {
      Pop-Location
    }
    if ($null -eq $output) { return "" }
    $jsonLine = ($output | Where-Object { $_ -match '^\s*\{"code"\s*:' } | Select-Object -First 1)
    if ([string]::IsNullOrWhiteSpace($jsonLine)) { return "" }
    $obj = $jsonLine | ConvertFrom-Json
    if ($null -eq $obj -or $obj.code -ne 100 -or $null -eq $obj.data) { return "" }
    $items = @($obj.data) | Sort-Object { try { $_.box[0][1] } catch { 0 } }, { try { $_.box[0][0] } catch { 0 } }
    return (($items | ForEach-Object { $_.text } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join [Environment]::NewLine)
  } catch {
    return ""
  } finally {
    if ($null -ne $scaled -and -not [object]::ReferenceEquals($scaled, $bitmap) -and -not [object]::ReferenceEquals($scaled, $enhanced)) { $scaled.Dispose() }
    if ($null -ne $enhanced) { $enhanced.Dispose() }
    if ($null -ne $inverted) { $inverted.Dispose() }
    if (-not [string]::IsNullOrWhiteSpace($tmp) -and (Test-Path -LiteralPath $tmp)) {
      Remove-Item -LiteralPath $tmp -Force
    }
  }
}
function Recognize-OcrBitmap($bitmap) {
  $tmp = ""
  try {
    $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ("wechat-monitor-ocr-" + [Guid]::NewGuid().ToString("N") + ".png"))
    $bitmap.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $file = Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
    $stream = Await-Result ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBitmap = Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $result = Await-Result ($script:ocrEngine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
    if ($null -ne $stream) { $stream.Dispose() }
    if ($null -eq $result) { return "" }
    return $result.Text
  } catch {
    return ""
  } finally {
    if (-not [string]::IsNullOrWhiteSpace($tmp) -and (Test-Path -LiteralPath $tmp)) {
      Remove-Item -LiteralPath $tmp -Force
    }
  }
}
function Invoke-OcrBitmap($bitmap) {
  $work = $bitmap
  $contrast = $null
  $enhanced = $null
  try {
    $maxDimension = 2200
    try {
      if ($null -ne $script:ocrEngine -and $script:ocrEngine.MaxImageDimension -gt 0) {
        $maxDimension = [Math]::Max(900, [int]$script:ocrEngine.MaxImageDimension - 40)
      }
    } catch {}
    $work = Resize-BitmapForOcr $bitmap $maxDimension
    if ((Measure-Light $work) -lt 145) {
      $contrast = Invert-Bitmap $work
      if (-not [object]::ReferenceEquals($work, $bitmap)) { $work.Dispose() }
      $work = $contrast
    }

    $texts = New-Object System.Collections.Generic.List[string]
    $text = Recognize-OcrBitmap $work
    if (-not [string]::IsNullOrWhiteSpace($text)) { $texts.Add($text) }
    $enhanced = Adjust-BitmapForText $work
    $text2 = Recognize-OcrBitmap $enhanced
    if (-not [string]::IsNullOrWhiteSpace($text2)) { $texts.Add($text2) }
    return (($texts | Select-Object -Unique) -join [Environment]::NewLine)
  } catch {
    return ""
  } finally {
    if ($null -ne $enhanced) { $enhanced.Dispose() }
    if ($null -ne $work -and -not [object]::ReferenceEquals($work, $bitmap)) {
      $work.Dispose()
    }
  }
}
function Get-PreferredOcrEngine() {
  try {
    $languages = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages
    foreach ($language in $languages) {
      try {
        $tag = ""
        try { $tag = $language.LanguageTag } catch {}
        if ($tag -match '^zh') {
          $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
          if ($null -ne $engine) { return $engine }
        }
      } catch {}
    }
  } catch {}
  return [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
}
function Count-FormHints($text) {
  if ([string]::IsNullOrWhiteSpace($text)) { return 0 }
  return ([regex]::Matches($text, "docs\.qq\.com|form/page|D[A-Za-z0-9_-]{12,24}", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)).Count
}
function Get-OcrText($handle) {
  try {
    $rect = New-Object MonitorWindowRect+RECT
    [MonitorWindowRect]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $width = [Math]::Max(1, $rect.Right - $rect.Left)
    $height = [Math]::Max(1, $rect.Bottom - $rect.Top)
    if ($width -lt 240 -or $height -lt 240) { return "" }

    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $printed = $false
    try {
      $hdc = $graphics.GetHdc()
      $printed = [MonitorWindowRect]::PrintWindow($handle, $hdc, 2)
      $graphics.ReleaseHdc($hdc)
    } catch {
      $printed = $false
    }
    if (-not $printed) {
      $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
    }
    $graphics.Dispose()
    $script:ocrEngine = Get-PreferredOcrEngine
    if ($null -eq $script:ocrEngine) { $bitmap.Dispose(); return "" }

    $contentTop = [Math]::Min([Math]::Max(56, [int]($height * 0.07)), [Math]::Max(0, $height - 220))
    $bottomReserved = [Math]::Max(145, [int]($height * 0.22))
    $contentBottom = [Math]::Max($contentTop + 140, $height - $bottomReserved)
    $contentHeight = [Math]::Max(1, $contentBottom - $contentTop)
    $messageWidth = [Math]::Min($width, [Math]::Max(480, [int]($width * 0.88)))
    $chunkHeight = [Math]::Min(640, [Math]::Max(360, [int]($contentHeight * 0.62)))
    $overlap = 120
    $step = [Math]::Max(220, $chunkHeight - $overlap)
    $texts = New-Object System.Collections.Generic.List[string]
    if (-not [string]::IsNullOrWhiteSpace($script:paddleOcrExe)) {
      $regions = New-Object System.Collections.Generic.List[object]
      $regions.Add([PSCustomObject]@{ X = 0; Y = $contentTop; W = $messageWidth; H = $contentHeight }) | Out-Null
      $narrowX = [Math]::Max(0, [int]($width * 0.035))
      $narrowW = [Math]::Min($width - $narrowX, [Math]::Max(460, [int]($width * 0.78)))
      $narrowH = [Math]::Min($contentHeight, [Math]::Max(260, [int]($height * 0.58)))
      $regions.Add([PSCustomObject]@{ X = $narrowX; Y = $contentTop; W = $narrowW; H = $narrowH }) | Out-Null
      $denseY = $contentTop
      while ($denseY -lt $contentBottom -and $regions.Count -lt 5) {
        $regions.Add([PSCustomObject]@{ X = 0; Y = [int]$denseY; W = $messageWidth; H = [Math]::Min($chunkHeight, $contentBottom - [int]$denseY) }) | Out-Null
        $denseY += $step
      }
      foreach ($region in $regions) {
        if ((Count-FormHints (($texts | Select-Object -Unique) -join [Environment]::NewLine)) -ge 18) { break }
        $chunk = Copy-BitmapRegion $bitmap $region.X $region.Y $region.W $region.H
        $paddleText = Invoke-PaddleOcrBitmap $chunk
        $chunk.Dispose()
        if (-not [string]::IsNullOrWhiteSpace($paddleText)) { $texts.Add($paddleText) }
      }
    }
    $seenY = @{}
    $y = $contentTop
    while ((Count-FormHints (($texts | Select-Object -Unique) -join [Environment]::NewLine)) -lt 18 -and $y -lt $contentBottom) {
      $safeY = [Math]::Max($contentTop, [int]$y)
      if (-not $seenY.ContainsKey([string]$safeY)) {
        $seenY[[string]$safeY] = $true
        $chunk = Copy-BitmapRegion $bitmap 0 $safeY $messageWidth ([Math]::Min($chunkHeight, $contentBottom - $safeY))
        $text = Invoke-OcrBitmap $chunk
        $chunk.Dispose()
        if (-not [string]::IsNullOrWhiteSpace($text)) { $texts.Add($text) }
      }
      $y += $step
    }
    if ((Count-FormHints (($texts | Select-Object -Unique) -join [Environment]::NewLine)) -lt 18 -and -not $seenY.ContainsKey([string]$contentTop)) {
      $chunk = Copy-BitmapRegion $bitmap 0 $contentTop $messageWidth ([Math]::Min($chunkHeight, $contentBottom - $contentTop))
      $text = Invoke-OcrBitmap $chunk
      $chunk.Dispose()
      if (-not [string]::IsNullOrWhiteSpace($text)) { $texts.Add($text) }
    }
    $bitmap.Dispose()
    return (($texts | Select-Object -Unique) -join [Environment]::NewLine)
  } catch {
    return ""
  }
}
function Get-WindowTitle($handle) {
  try {
    $length = [MonitorWindowRect]::GetWindowTextLength($handle)
    $builder = New-Object System.Text.StringBuilder ([Math]::Max(256, $length + 1))
    [MonitorWindowRect]::GetWindowText($handle, $builder, $builder.Capacity) | Out-Null
    return $builder.ToString()
  } catch {
    return ""
  }
}
function Is-MonitorChatWindow($title, [int]$width, [int]$height) {
  $text = if ($null -eq $title) { "" } else { $title.Trim() }
  $wechatTitle = ([char]0x5FAE).ToString() + ([char]0x4FE1).ToString()
  if ([string]::IsNullOrWhiteSpace($text)) { return $false }
  if ($text -eq $wechatTitle -or $text -match '^(?:WeChat|Weixin|Tencent WeChat)$') { return $false }
  if ($text -match 'Images and Videos') { return $false }
  if ($text -match (([char]0x56FE).ToString() + ([char]0x7247).ToString() + '.*' + ([char]0x89C6).ToString() + ([char]0x9891).ToString())) { return $false }
  if ($text -match (([char]0x5716).ToString() + ([char]0x7247).ToString() + '.*' + ([char]0x5F71).ToString() + ([char]0x7247).ToString())) { return $false }
  if ($width -lt 240 -or $height -lt 220) { return $false }
  return $true
}
$items = @()
$script:wechatWindows = @()
$enumCallback = [MonitorWindowRect+EnumWindowsProc]{
  param([IntPtr]$handle, [IntPtr]$lParam)
  try {
    if (-not [MonitorWindowRect]::IsWindowVisible($handle)) { return $true }
    if ([MonitorWindowRect]::IsIconic($handle)) { return $true }
    $handleText = $handle.ToInt64().ToString()
    if ($targetMap.Count -gt 0 -and -not $targetMap.ContainsKey($handleText)) { return $true }
    [uint32]$windowPid = 0
    [MonitorWindowRect]::GetWindowThreadProcessId($handle, [ref]$windowPid) | Out-Null
    if ($windowPid -le 0) { return $true }
    $proc = Get-Process -Id $windowPid -ErrorAction SilentlyContinue
    if ($null -eq $proc -or $proc.ProcessName -notmatch 'WeChat|Weixin|WXWork') { return $true }
    $rect = New-Object MonitorWindowRect+RECT
    [MonitorWindowRect]::GetWindowRect($handle, [ref]$rect) | Out-Null
    $width = [Math]::Max(0, $rect.Right - $rect.Left)
    $height = [Math]::Max(0, $rect.Bottom - $rect.Top)
    if ($width -lt 240 -or $height -lt 220) { return $true }
    $title = Get-WindowTitle $handle
    if ($targetMap.Count -eq 0 -and -not (Is-MonitorChatWindow $title $width $height)) { return $true }
    $screen = [System.Windows.Forms.Screen]::FromHandle($handle)
    $script:wechatWindows += [PSCustomObject]@{
      pid = $windowPid
      hwnd = $handleText
      handle = $handle
      process = $proc.ProcessName
      title = $title
      rect = $rect
      screen = $screen
    }
  } catch {}
  return $true
}
[MonitorWindowRect]::EnumWindows($enumCallback, [IntPtr]::Zero) | Out-Null
foreach ($window in ($script:wechatWindows | Sort-Object hwnd -Unique)) {
  $text = ""
  if ($readControls) {
    $script:names = @()
    try {
      $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.handle)
      if ($null -ne $root) { Walk $root 0 }
    } catch {}
    $text = ($script:names | Select-Object -Unique) -join [Environment]::NewLine
  }
  $ocrText = if ($readOcr) { Get-OcrText $window.handle } else { "" }
  $items += [PSCustomObject]@{
    pid = $window.pid
    hwnd = $window.hwnd
    process = $window.process
    title = $window.title
    readMode = $readMode
    text = $text
    ocrText = $ocrText
    screenPrimary = if ($null -ne $window.screen) { $window.screen.Primary } else { $false }
    screenDevice = if ($null -ne $window.screen) { $window.screen.DeviceName } else { "" }
    bounds = [PSCustomObject]@{
      left = $window.rect.Left
      top = $window.rect.Top
      width = [Math]::Max(0, $window.rect.Right - $window.rect.Left)
      height = [Math]::Max(0, $window.rect.Bottom - $window.rect.Top)
    }
  }
}
$items | ConvertTo-Json -Compress -Depth 5
`;
  const output = await execPowerShell(script, 25000, true);
  if (!output) {
    return [];
  }
  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    return [];
  }
}

function enabledSources(config) {
  return (config.sources || []).filter((source) => source.enabled !== false);
}

function distanceWithinLimit(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) {
    return false;
  }
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + cost
      );
      current[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > limit) {
      return false;
    }
    previous = current;
  }
  return previous[b.length] <= limit;
}

function sourceAppearsInText(sourceName, text) {
  const normalizedName = normalizeText(sourceName);
  const normalizedText = normalizeText(text);
  if (normalizedText.includes(normalizedName)) {
    return true;
  }
  const compactName = compactText(sourceName);
  const compactBody = compactText(text);
  if (!compactName || !compactBody) {
    return false;
  }
  if (compactBody.includes(compactName)) {
    return true;
  }
  if (compactName.length < 4) {
    return false;
  }
  const limit = compactName.length >= 7 ? 2 : 1;
  for (let index = 0; index <= compactBody.length - compactName.length; index += 1) {
    const candidate = compactBody.slice(index, index + compactName.length);
    if (distanceWithinLimit(compactName, candidate, limit)) {
      return true;
    }
  }
  return false;
}

function findSourceForText(text, config, allowSingleFallback) {
  const normalized = normalizeText(text);
  const compact = compactText(text);
  const sources = enabledSources(config);
  const matches = sources.filter((source) => source.name && sourceAppearsInText(source.name, text));
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    const accountMatches = matches.filter((source) => source.account && (
      normalized.includes(normalizeText(source.account)) || compact.includes(compactText(source.account))
    ));
    if (accountMatches.length === 1) {
      return accountMatches[0];
    }
    return null;
  }
  if (allowSingleFallback && sources.length === 1) {
    return sources[0];
  }
  return null;
}

function publicSource(source) {
  if (!source) {
    return null;
  }
  return {
    id: source.id,
    name: source.name,
    account: source.account || "",
    enabled: source.enabled !== false
  };
}

function findBindingForSnapshot(snapshot, config) {
  const hwnd = String(snapshot && snapshot.hwnd || "");
  const bindings = (config.windowBindings || []).filter((binding) => binding.enabled !== false);
  return bindings.find((item) => item.hwnd && item.hwnd === hwnd) || null;
}

function findBoundSourceForSnapshot(snapshot, config) {
  const binding = findBindingForSnapshot(snapshot, config);
  return binding ? sourceForBinding(binding, config) : null;
}

function sourceForBinding(binding, config) {
  return binding ? enabledSources(config).find((source) => source.id === binding.sourceId) || null : null;
}

function interleaveBindingsByAccount(bindings) {
  const groups = new Map();
  for (const binding of bindings) {
    const account = binding.account || "";
    if (!groups.has(account)) {
      groups.set(account, []);
    }
    groups.get(account).push(binding);
  }
  const lanes = Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b, "zh-CN"))
    .map(([, items]) => items.sort((a, b) => (
      String(a.title || "").localeCompare(String(b.title || ""), "zh-CN")
      || String(a.hwnd || "").localeCompare(String(b.hwnd || ""))
    )));
  const ordered = [];
  let index = 0;
  while (lanes.some((lane) => index < lane.length)) {
    for (const lane of lanes) {
      if (index < lane.length) {
        ordered.push(lane[index]);
      }
    }
    index += 1;
  }
  return ordered;
}

function selectBindingsForTick(bindings, config, tickAt) {
  if (!bindings.length) {
    monitorRuntime.lastScanPlan = { total: 0, batchSize: 0, selected: [] };
    return [];
  }
  const configuredBatchSize = Number(config.scanBatchSize);
  const intervalMs = Number(config.intervalMs || 15000);
  const targetCycleMs = Math.max(5000, Number(config.targetCycleSeconds || 15) * 1000);
  const autoBatchSize = Math.max(1, Math.min(4, Math.ceil((bindings.length * intervalMs) / targetCycleMs)));
  const batchSize = Math.min(
    bindings.length,
    configuredBatchSize > 0 ? Math.max(1, configuredBatchSize) : autoBatchSize
  );
  const ordered = interleaveBindingsByAccount(bindings);
  if (ordered.length <= batchSize) {
    monitorRuntime.scanCursor = 0;
    monitorRuntime.lastScanPlan = {
      total: ordered.length,
      batchSize,
      selected: ordered.map((binding) => binding.hwnd),
      intervalMs,
      targetCycleSeconds: Number(config.targetCycleSeconds || 15),
      estimatedCycleSeconds: Number(((Math.ceil(ordered.length / Math.max(1, batchSize)) * intervalMs) / 1000).toFixed(1)),
      mode: configuredBatchSize > 0 ? "preset" : "auto"
    };
    return ordered;
  }

  const now = Date.parse(tickAt) || Date.now();
  const selected = [];
  let cursor = monitorRuntime.scanCursor % ordered.length;
  let visited = 0;
  while (visited < ordered.length && selected.length < batchSize) {
    const binding = ordered[cursor];
    const stat = monitorRuntime.bindingStats[binding.hwnd] || {};
    const lastScan = Date.parse(stat.lastScanAt || stat.lastProbeAt || stat.lastManualReadAt || "") || 0;
    const minGap = stat.lastError
      ? Math.max(8000, Number(config.intervalMs || 15000) * 4)
      : Math.max(700, Number(config.intervalMs || 15000) - 100);
    if (!lastScan || now - lastScan >= minGap) {
      selected.push(binding);
    }
    cursor = (cursor + 1) % ordered.length;
    visited += 1;
  }

  monitorRuntime.scanCursor = cursor;
  monitorRuntime.lastScanPlan = {
    total: ordered.length,
    batchSize,
    selected: selected.map((binding) => binding.hwnd),
    intervalMs,
    targetCycleSeconds: Number(config.targetCycleSeconds || 15),
    estimatedCycleSeconds: Number(((Math.ceil(ordered.length / Math.max(1, batchSize)) * intervalMs) / 1000).toFixed(1)),
    mode: configuredBatchSize > 0 ? "preset" : "auto"
  };
  return selected;
}

function updateBindingStat(binding, source, patch = {}) {
  if (!binding || !binding.hwnd) {
    return;
  }
  const previous = monitorRuntime.bindingStats[binding.hwnd] || {};
  monitorRuntime.bindingStats[binding.hwnd] = {
    ...previous,
    hwnd: binding.hwnd,
    sourceId: binding.sourceId,
    sourceName: source && source.name || previous.sourceName || "",
    account: source && source.account || binding.account || previous.account || "",
    ...patch
  };
}

function monitorSample(text, maxLength = 260) {
  return normalizeText(text).slice(0, maxLength);
}

function isMainWechatWindowTitle(value) {
  const text = normalizeText(value);
  if (!text) {
    return true;
  }
  return text === "\u5FAE\u4FE1"
    || /^(?:Weixin|WeChat|Tencent WeChat|\u5FAE\u4FE1\(Weixin\))$/i.test(text);
}

function isWechatControlNoiseLine(line) {
  const text = normalizeText(line);
  if (!text) {
    return true;
  }
  return /^(?:Weixin|WeChat|微信|Tencent WeChat|微信\(Weixin\))$/i.test(text);
}

function textWithoutWindowTitle(text, title) {
  const titleText = normalizeText(title);
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => normalizeText(line))
    .filter((line) => line && (!titleText || line !== titleText) && !isWechatControlNoiseLine(line))
    .join("\n");
}

function readFileHeaderText(filePath, length = 16) {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(length);
      const bytes = fs.readSync(fd, buffer, 0, length, 0);
      return buffer.subarray(0, bytes).toString("latin1");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    return "";
  }
}

function wechatLocalRootCandidates() {
  const localWechatDirName = ["xwechat", "files"].join("_");
  const homeDrive = path.parse(os.homedir()).root.replace(/[:\\\/]/g, "");
  const driveLetters = uniqueCleanList([homeDrive, "C", "D", "E", "F"])
    .map((item) => item.toUpperCase())
    .filter((item) => /^[A-Z]$/.test(item));
  const candidates = [
    process.env.WECHAT_FILES_DIR || "",
    ...driveLetters.map((drive) => `${drive}:\\${localWechatDirName}`),
    path.join(os.homedir(), "Documents", "WeChat Files"),
    path.join(os.homedir(), "Documents", "Tencent Files"),
    path.join(process.env.APPDATA || "", "Tencent", "WeChat")
  ];
  return uniqueCleanList(candidates)
    .map((item) => path.resolve(item))
    .filter((item) => fs.existsSync(item));
}

function latestWechatMessageDb(accountDir) {
  const messageDir = path.join(accountDir, "db_storage", "message");
  if (!fs.existsSync(messageDir)) {
    return null;
  }
  let files = [];
  try {
    files = fs.readdirSync(messageDir)
      .filter((name) => /^message_\d+\.db$/i.test(name) || /^message_fts\.db$/i.test(name))
      .map((name) => {
        const filePath = path.join(messageDir, name);
        const stat = fs.statSync(filePath);
        return {
          name,
          path: filePath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          encrypted: !readFileHeaderText(filePath, 16).startsWith("SQLite format 3")
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (error) {
    files = [];
  }
  return files.find((item) => /^message_\d+\.db$/i.test(item.name)) || files[0] || null;
}

function discoverWechatLocalAccounts() {
  const accounts = [];
  for (const root of wechatLocalRootCandidates()) {
    let children = [];
    try {
      children = fs.readdirSync(root, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    for (const child of children) {
      if (!child.isDirectory()) {
        continue;
      }
      const accountDir = path.join(root, child.name);
      const db = latestWechatMessageDb(accountDir);
      if (!db) {
        continue;
      }
      accounts.push({
        wxid: child.name,
        dir: accountDir,
        dbPath: db.path,
        dbName: db.name,
        dbSize: db.size,
        dbMtimeMs: db.mtimeMs,
        encrypted: db.encrypted
      });
    }
  }
  return accounts.sort((a, b) => b.dbMtimeMs - a.dbMtimeMs);
}

async function getWechatLocalReadResult(snapshot) {
  const accounts = discoverWechatLocalAccounts();
  if (!accounts.length) {
    return {
      text: "",
      status: "missing",
      message: "没有找到微信本地消息库。",
      accounts: []
    };
  }
  const latest = accounts[0];
  const encryptedCount = accounts.filter((item) => item.encrypted).length;
  const accountSummary = accounts.slice(0, 5).map((item) => ({
    wxid: item.wxid,
    dbName: item.dbName,
    dbSize: item.dbSize,
    updatedAt: new Date(item.dbMtimeMs).toISOString(),
    encrypted: item.encrypted
  }));
  if (latest.encrypted) {
    return {
      text: "",
      status: "encrypted",
      message: `找到 ${accounts.length} 个本地账号消息库，最新库 ${latest.wxid}\\${latest.dbName} 已加密；当前未拿到新版 Weixin.exe 的数据库密钥。`,
      accounts: accountSummary,
      encryptedCount
    };
  }
  return {
    text: "",
    status: "readable-no-query",
    message: `找到未加密消息库 ${latest.wxid}\\${latest.dbName}，但当前版本未内置本地 SQLite 查询器。`,
    accounts: accountSummary,
    encryptedCount
  };
}

function textForWechatSnapshot(snapshot) {
  if (!snapshot) {
    return "";
  }
  return [
    textWithoutWindowTitle(snapshot.text, snapshot.title),
    textWithoutWindowTitle(snapshot.ocrText, snapshot.title)
  ].filter(Boolean).join("\n");
}

function scoreWechatSnapshot(snapshot) {
  const text = textForWechatSnapshot(snapshot);
  const parts = textPartsForWechatSnapshot(snapshot);
  return parts.ocrText.length
    + parts.originalText.length
    + extractFormUrls(text).length * 1000;
}

function shouldRetryWechatSnapshot(snapshot, previousStat = {}) {
  if (!snapshot) {
    return true;
  }
  if (normalizeMonitorReadMode(snapshot.readMode) === "local") {
    return false;
  }
  const text = textForWechatSnapshot(snapshot);
  const parts = textPartsForWechatSnapshot(snapshot);
  const textLength = parts.originalText.length + parts.ocrText.length;
  const previousTextLength = Math.max(
    Number(previousStat.lastTextLength || 0),
    Number(previousStat.lastOriginalTextLength || 0),
    Number(previousStat.lastOcrTextLength || 0)
  );
  if (!textLength) {
    return true;
  }
  if (textLength < 80 && previousTextLength > 160) {
    return true;
  }
  if (Number(previousStat.lastUrlCount || 0) > 0 && !extractFormUrls(text).length) {
    return true;
  }
  return false;
}

async function getWechatSnapshotForHwnd(hwnd, attempts = 3, readMode = getMonitorConfig().readMode) {
  const safeHwnd = String(hwnd || "").trim();
  const normalizedReadMode = normalizeMonitorReadMode(readMode);
  let best = null;
  let bestScore = -1;
  for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
    const snapshots = await getWechatSnapshots([safeHwnd], normalizedReadMode);
    const snapshot = snapshots.find((item) => String(item.hwnd || "") === safeHwnd);
    if (snapshot) {
      const score = scoreWechatSnapshot(snapshot);
      if (score > bestScore) {
        best = snapshot;
        bestScore = score;
      }
      if (normalizedReadMode === "local") {
        return snapshot;
      }
      if (score >= 1000 || String(snapshot.ocrText || "").length > 120 || String(snapshot.text || "").length > 120) {
        return snapshot;
      }
    }
    if (attempt < attempts - 1) {
      await delay(650);
    }
  }
  return best;
}

function textPartsForWechatSnapshot(snapshot) {
  const title = snapshot && snapshot.title || "";
  const originalText = textWithoutWindowTitle(snapshot && snapshot.text, title);
  const ocrText = textWithoutWindowTitle(snapshot && snapshot.ocrText, title);
  return {
    originalText,
    ocrText,
    combinedText: [
      originalText,
      ocrText
    ].filter(Boolean).join("\n")
  };
}

async function analyzeWechatSnapshot(snapshot) {
  const readMode = normalizeMonitorReadMode(snapshot && snapshot.readMode || getMonitorConfig().readMode);
  const localResult = readMode === "local" ? await getWechatLocalReadResult(snapshot) : null;
  const effectiveSnapshot = localResult
    ? { ...snapshot, text: localResult.text || "", ocrText: "" }
    : snapshot;
  const parts = textPartsForWechatSnapshot(effectiveSnapshot);
  const [originalUrls, ocrUrls] = await Promise.all([
    resolveFormUrls(parts.originalText),
    resolveFormUrls(parts.ocrText)
  ]);
  const originalCandidateUrls = extractFormUrls(parts.originalText);
  const ocrCandidateUrls = extractFormUrls(parts.ocrText);
  const urls = normalizeMonitorUrlList([...originalUrls, ...ocrUrls]);
  const candidateUrls = normalizeMonitorUrlList([...originalCandidateUrls, ...ocrCandidateUrls]);
  const originalHit = originalUrls.length > 0;
  const ocrHit = ocrUrls.some((url) => !originalUrls.includes(url));
  const detectionSource = originalHit && ocrHit
    ? "微信本地+画面识别"
    : originalHit ? (readMode === "local" ? "微信本地" : "文本读取")
      : ocrUrls.length ? "画面识别"
        : candidateUrls.length ? "疑似"
          : readMode === "local" ? "微信本地"
          : parts.originalText.trim() ? "文本读取"
            : parts.ocrText.trim() ? "画面识别" : "等待";
  return {
    ...parts,
    readMode,
    text: parts.combinedText,
    urls,
    candidateUrls,
    originalUrls,
    ocrUrls,
    originalCandidateUrls,
    ocrCandidateUrls,
    detectionSource,
    originalTextLength: parts.originalText.length,
    ocrTextLength: parts.ocrText.length,
    localStatus: localResult && localResult.status || "",
    localMessage: localResult && localResult.message || "",
    localAccounts: localResult && localResult.accounts || [],
    localEncryptedCount: localResult && localResult.encryptedCount || 0
  };
}

function contextForDetectedUrl(text, url) {
  const body = String(text || "");
  if (!body) {
    return "";
  }
  const normalizedUrl = normalizeUrl(url);
  const id = qqFormIdFromUrl(normalizedUrl);
  const lines = body.split(/\r?\n/);
  const compactId = compactText(id);
  const fragments = [];
  for (let index = 0; index < lines.length; index += 1) {
    const compactLine = compactText(lines[index]);
    if (compactId && (
      compactLine.includes(compactId)
      || compactLine.includes(compactId.slice(0, 8))
      || compactLine.includes(compactId.slice(-8))
    )) {
      fragments.push(lines[index - 1] || "", lines[index], lines[index + 1] || "");
      break;
    }
  }
  if (fragments.length) {
    return monitorSample(fragments.join(" "), 800);
  }

  const urlRegex = /https?:\/\/docs\.qq\.com\/form\/page\/[^\s"'<>，。)）\]}]+/gi;
  for (const match of body.matchAll(urlRegex)) {
    if (normalizeUrl(match[0]) === normalizedUrl) {
      const start = Math.max(0, match.index - 160);
      const end = Math.min(body.length, match.index + match[0].length + 80);
      return monitorSample(body.slice(start, end), 800);
    }
  }
  return "";
}

function monitorFingerprint(text) {
  return normalizeText(text).slice(-1200);
}

function statPatchFromWindowText(text, urls, tickAt, previousStat = {}, analysis = {}) {
  const fingerprint = monitorFingerprint(text);
  const changed = Boolean(fingerprint && fingerprint !== previousStat.lastFingerprint);
  const candidateUrls = normalizeMonitorUrlList(analysis.candidateUrls || []);
  const pendingCount = Math.max(0, candidateUrls.length - urls.length);
  return {
    changed,
    lastTextLength: text.length,
    lastUrlCount: urls.length,
    lastLinks: urls.slice(0, 80),
    lastCandidateUrlCount: candidateUrls.length,
    lastCandidateLinks: candidateUrls.slice(0, 80),
    lastPendingLinkCount: pendingCount,
    ...(pendingCount ? { lastPendingAt: tickAt } : {}),
    lastOriginalTextLength: Number(analysis.originalTextLength || 0),
    lastOcrTextLength: Number(analysis.ocrTextLength || 0),
    lastReadMode: normalizeMonitorReadMode(analysis.readMode || previousStat.lastReadMode),
    lastReadSource: analysis.detectionSource || previousStat.lastReadSource || "",
    lastLocalStatus: analysis.localStatus || "",
    lastLocalMessage: analysis.localMessage || "",
    lastLocalAccounts: Array.isArray(analysis.localAccounts) ? analysis.localAccounts.slice(0, 5) : [],
    lastLocalEncryptedCount: Number(analysis.localEncryptedCount || 0),
    lastPreview: monitorSample(text, 220),
    lastFingerprint: fingerprint,
    scanCount: Number(previousStat.scanCount || 0) + 1,
    changeCount: Number(previousStat.changeCount || 0) + (changed ? 1 : 0),
    ...(changed ? { lastChangedAt: tickAt } : {})
  };
}

function normalizeMonitorUrlList(urls) {
  return uniqueCleanList((urls || [])
    .map(normalizeUrl)
    .filter((url) => qqFormIdFromUrl(url)));
}

function urlsAfterMonitorStart(binding, urls) {
  const normalizedUrls = normalizeMonitorUrlList(urls);
  const ignored = new Set(normalizeMonitorUrlList(binding && binding.ignoredUrls || []));
  const startAfterUrl = normalizeUrl(binding && binding.startAfterUrl || "");
  const startIndex = startAfterUrl
    ? normalizedUrls.map(normalizeUrl).lastIndexOf(startAfterUrl)
    : -1;
  const candidates = startIndex >= 0
    ? normalizedUrls.slice(binding && binding.startInclusive ? startIndex : startIndex + 1)
    : normalizedUrls;
  return candidates.filter((url) => !ignored.has(normalizeUrl(url)));
}

function addIgnoredUrlsForBinding(hwnd, urls, stampedAt = new Date().toISOString()) {
  const safeHwnd = String(hwnd || "").trim();
  const ignoredUrls = normalizeMonitorUrlList(urls);
  if (!safeHwnd || !ignoredUrls.length) {
    return null;
  }
  const config = getMonitorConfig();
  let updatedBinding = null;
  const windowBindings = (config.windowBindings || []).map((binding) => {
    if (String(binding.hwnd || "") !== safeHwnd) {
      return binding;
    }
    const nextIgnored = uniqueCleanList([
      ...(binding.ignoredUrls || []),
      ...ignoredUrls
    ].map(normalizeUrl)).filter((url) => qqFormIdFromUrl(url)).slice(-120);
    updatedBinding = {
      ...binding,
      startAfterSetAt: binding.startAfterSetAt || stampedAt,
      ignoredUrls: nextIgnored
    };
    return updatedBinding;
  });
  if (updatedBinding) {
    writeMonitorConfig({ ...config, windowBindings });
  }
  return updatedBinding;
}

function consumeBaselineForBinding(binding, urls, stampedAt) {
  if (!binding || !monitorRuntime.baselineHwnds.has(String(binding.hwnd || ""))) {
    return false;
  }
  monitorRuntime.baselineHwnds.delete(String(binding.hwnd || ""));
  addIgnoredUrlsForBinding(binding.hwnd, urls, stampedAt);
  return true;
}

function activatePendingMonitorStartPoints(config, startedAt) {
  const windowBindings = (config.windowBindings || []).map((binding) => {
    const pendingUrls = normalizeMonitorUrlList(binding.pendingStartUrls || []);
    const stat = monitorRuntime.bindingStats[binding.hwnd] || {};
    const urls = pendingUrls.length ? pendingUrls : (
      binding.startAfterUrl ? urlsAfterMonitorStart(binding, stat.lastLinks || []) : []
    );
    if (!urls.length) {
      return binding;
    }
    const source = sourceForBinding(binding, config);
    markMonitorStartHistoryIgnored(
      source && source.account || binding.account,
      source && source.name || binding.title,
      binding.ignoredUrls || []
    );
    const contextText = binding.pendingStartContextText || stat.lastPreview || "";
    const startedUrls = [];
    for (const url of urls) {
      const item = handleDetectedUrl({
        url,
        source,
        channel: "wechat",
        rawText: contextText,
        monitorSessionAt: startedAt,
        includeExistingInSession: true
      });
      if (item) {
        startedUrls.push(normalizeUrl(url));
      }
    }
    updateBindingStat(binding, source, {
      lastNewLinkCount: startedUrls.length,
      lastNewLinks: startedUrls.slice(0, 8),
      ...(startedUrls.length ? { lastNewAt: startedAt, lastMatchedAt: startedAt } : {})
    });
    if (pendingUrls.length) {
      return {
        ...binding,
        pendingStartUrls: [],
        pendingStartContextText: ""
      };
    }
    return binding;
  });
  if (windowBindings.some((binding, index) => binding !== (config.windowBindings || [])[index])) {
    return writeMonitorConfig({ ...config, windowBindings });
  }
  return config;
}

function recordMonitorCapture({ binding, source, text, urls, candidateUrls, analysis, checkedAt, channel }) {
  if (!binding || !text) {
    return null;
  }
  const candidates = normalizeMonitorUrlList(candidateUrls || analysis && analysis.candidateUrls || extractFormUrls(text));
  if (!(urls || []).length) {
    return null;
  }
  return addMonitorEvent({
    createdAt: checkedAt,
    channel: channel || "wechat",
    account: "",
    sourceName: source && source.name || binding.title || "",
    title: binding.title || "",
    hwnd: binding.hwnd,
    text,
    textLength: text.length,
    originalTextLength: Number(analysis && analysis.originalTextLength || 0),
    ocrTextLength: Number(analysis && analysis.ocrTextLength || 0),
    readMode: normalizeMonitorReadMode(analysis && analysis.readMode),
    readSource: analysis && analysis.detectionSource || "",
    urls,
    candidateUrls: candidates,
    expectedTrack: "",
    trackScore: 0
  });
}

function syncDetectedUrlsForBinding({ binding, source, text, urls, candidateUrls, analysis, checkedAt, channel, includeExistingInSession }) {
  if (!binding || !source) {
    return [];
  }
  const normalizedUrls = normalizeMonitorUrlList(urls || []);
  if (!normalizedUrls.length) {
    return [];
  }
  recordMonitorCapture({
    binding,
    source,
    text,
    urls: normalizedUrls,
    candidateUrls,
    analysis,
    checkedAt,
    channel: channel || "wechat"
  });
  const newLinks = [];
  for (const url of normalizedUrls) {
    const existed = findHistoryByUrlAccount(url, "", "__monitor__");
    const handled = handleDetectedUrl({
      url,
      source,
      channel: channel || "wechat",
      rawText: text,
      monitorSessionAt: checkedAt,
      includeExistingInSession: includeExistingInSession === true
    });
    if (handled && !existed) {
      newLinks.push(normalizeUrl(url));
    }
  }
  updateBindingStat(binding, source, {
    lastNewLinkCount: newLinks.length,
    lastNewLinks: newLinks.slice(0, 8),
    lastSyncedLinkCount: normalizedUrls.length,
    lastSyncedAt: checkedAt,
    ...(newLinks.length ? { lastNewAt: checkedAt, lastMatchedAt: checkedAt } : {})
  });
  return newLinks;
}

async function setMonitorQueueSync(enabled) {
  const current = getMonitorConfig();
  const nextEnabled = enabled === true;
  const now = new Date().toISOString();
  let config = writeMonitorConfig({
    ...current,
    syncQueue: nextEnabled,
    syncQueueStartedAt: nextEnabled ? (current.syncQueueStartedAt || now) : ""
  });

  let syncedCount = 0;
  const syncedLinks = [];
  if (nextEnabled) {
    monitorRuntime.seenKeys.clear();
    const activeBindings = (config.windowBindings || []).filter((binding) => binding.enabled !== false);
    const urlsByHwnd = new Map();
    for (const binding of activeBindings) {
      const stat = monitorRuntime.bindingStats[binding.hwnd] || {};
      const urls = normalizeMonitorUrlList(stat.lastLinks || []);
      urlsByHwnd.set(String(binding.hwnd || ""), urls);
      syncedLinks.push(...urls);
    }
    const uniqueSyncedLinks = normalizeMonitorUrlList(syncedLinks);
    if (uniqueSyncedLinks.length) {
      const uniqueSet = new Set(uniqueSyncedLinks.map(normalizeUrl));
      const windowBindings = (config.windowBindings || []).map((binding) => ({
        ...binding,
        ignoredUrls: normalizeMonitorUrlList(binding.ignoredUrls || [])
          .filter((url) => !uniqueSet.has(normalizeUrl(url)))
      }));
      config = writeMonitorConfig({ ...config, windowBindings });
    }
    for (const binding of activeBindings) {
      const stat = monitorRuntime.bindingStats[binding.hwnd] || {};
      const urls = urlsByHwnd.get(String(binding.hwnd || "")) || [];
      if (!urls.length) {
        continue;
      }
      const source = sourceForBinding(binding, config);
      const analysis = {
        readMode: normalizeMonitorReadMode(stat.lastReadMode || config.readMode),
        originalTextLength: Number(stat.lastOriginalTextLength || stat.lastTextLength || 0),
        ocrTextLength: Number(stat.lastOcrTextLength || 0),
        candidateUrls: stat.lastCandidateLinks || urls,
        detectionSource: "手动同步"
      };
      const text = stat.lastPreview || "";
      const newLinks = syncDetectedUrlsForBinding({
        binding,
        source,
        text,
        urls,
        candidateUrls: stat.lastCandidateLinks || urls,
        analysis,
        checkedAt: now,
        channel: "sync",
        includeExistingInSession: true
      });
      if (source) {
        syncedCount += urls.length;
      }
      updateBindingStat(binding, source, {
        lastSyncMode: "enabled",
        lastSyncAt: now,
        lastSyncedLinkCount: urls.length,
        lastNewLinkCount: newLinks.length,
        lastNewLinks: newLinks.slice(0, 8)
      });
    }
    monitorLog(`队列同步已开启：当前画面同步 ${syncedCount} 条链接`);
  } else {
    monitorLog("队列同步已关闭：左侧继续识别，右侧暂停接收新链接");
  }

  if (config.enabled && !monitorRuntime.running) {
    startMonitor();
  }
  return {
    ok: true,
    enabled: nextEnabled,
    syncedCount,
    state: getMonitorState()
  };
}

async function runMonitorProbe() {
  const config = getMonitorConfig();
  const result = {
    checkedAt: new Date().toISOString(),
    clipboard: null,
    windows: []
  };

  if (config.detectClipboard) {
    const clipboardText = await getClipboardText();
    const urls = await resolveFormUrls(clipboardText);
    result.clipboard = {
      urls,
      matchedSource: publicSource(findSourceForText(clipboardText, config, true)),
      sample: monitorSample(clipboardText)
    };
  }

  if (config.detectWechatWindow) {
      const snapshots = await getWechatSnapshots([], config.readMode);
    for (let snapshot of snapshots) {
      let binding = findBindingForSnapshot(snapshot, config);
      let bindingSource = findBoundSourceForSnapshot(snapshot, config);
      if (binding) {
        const previousStat = monitorRuntime.bindingStats[binding.hwnd] || {};
        if (shouldRetryWechatSnapshot(snapshot, previousStat)) {
          const retrySnapshot = await getWechatSnapshotForHwnd(binding.hwnd, 2, config.readMode);
          if (retrySnapshot && scoreWechatSnapshot(retrySnapshot) >= scoreWechatSnapshot(snapshot)) {
            snapshot = retrySnapshot;
            binding = findBindingForSnapshot(snapshot, config);
            bindingSource = findBoundSourceForSnapshot(snapshot, config);
          }
        }
      }
      const analysis = await analyzeWechatSnapshot(snapshot);
      const text = analysis.text;
      const urls = analysis.urls;
      if (binding) {
        const previousStat = monitorRuntime.bindingStats[binding.hwnd] || {};
        updateBindingStat(binding, bindingSource, {
          state: bindingSource ? "ready" : "source-missing",
          lastProbeAt: result.checkedAt,
          lastScanAt: result.checkedAt,
          lastTitle: snapshot.title || "",
          ...statPatchFromWindowText(text, urls, result.checkedAt, previousStat, analysis),
          lastError: bindingSource ? "" : "监控对象已停用或已删除"
        });
        if (config.syncQueue) {
          recordMonitorCapture({
            binding,
            source: bindingSource,
            text,
            urls,
            candidateUrls: analysis.candidateUrls,
            analysis,
            checkedAt: result.checkedAt,
            channel: "probe"
          });
        }
      }
      result.windows.push({
        pid: snapshot.pid || "",
        hwnd: snapshot.hwnd || "",
        process: snapshot.process || "",
        title: snapshot.title || "微信窗口",
        bounds: snapshot.bounds || null,
        screenPrimary: snapshot.screenPrimary !== false,
        screenDevice: snapshot.screenDevice || "",
        urls,
        candidateUrls: analysis.candidateUrls,
        readMode: analysis.readMode,
        readSource: analysis.detectionSource,
        localStatus: analysis.localStatus,
        localMessage: analysis.localMessage,
        localAccounts: analysis.localAccounts,
        matchedSource: publicSource(bindingSource || findSourceForText(text, config, false)),
        bindingSource: publicSource(bindingSource),
        bindingStat: binding ? monitorRuntime.bindingStats[binding.hwnd] || null : null,
        sample: monitorSample(text),
        ocrSample: monitorSample(snapshot.ocrText || "")
      });
    }
    const seenHwnds = new Set(result.windows.map((item) => String(item.hwnd || "")));
    for (const binding of (config.windowBindings || []).filter((item) => item.enabled !== false)) {
      if (!seenHwnds.has(String(binding.hwnd || ""))) {
        updateBindingStat(binding, sourceForBinding(binding, config), {
          state: "missing",
          lastProbeAt: result.checkedAt,
          lastUrlCount: 0,
          lastError: "窗口未打开、已最小化或已关闭"
        });
      }
    }
  }

  const urlCount = result.windows.reduce((sum, item) => sum + item.urls.length, 0)
    + (result.clipboard ? result.clipboard.urls.length : 0);
  monitorLog(`识别测试：${result.windows.length} 个微信窗口，${urlCount} 条链接`);
  return result;
}

async function scrollMonitorWindow(hwnd, wheelClicks = -4) {
  const safeHwnd = String(hwnd || "").replace(/[^\d]/g, "");
  const clicks = Math.max(-20, Math.min(20, Number(wheelClicks) || 0));
  if (!safeHwnd || !clicks) {
    return { ok: false, hwnd: safeHwnd };
  }
  const direction = clicks > 0 ? 120 : -120;
  const count = Math.abs(Math.round(clicks));
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ScrollWindowApi {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, UIntPtr dwExtraInfo);
}
'@
$hwnd = [IntPtr]::new([Int64]'${safeHwnd}')
if (-not [ScrollWindowApi]::IsWindow($hwnd)) {
  Write-Output '{"ok":false,"error":"missing"}'
  return
}
$rect = New-Object ScrollWindowApi+RECT
[ScrollWindowApi]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
[ScrollWindowApi]::ShowWindowAsync($hwnd, 9) | Out-Null
Start-Sleep -Milliseconds 90
[ScrollWindowApi]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 100
$x = [int](($rect.Left + $rect.Right) / 2)
$y = [int](($rect.Top + $rect.Bottom) / 2)
[ScrollWindowApi]::SetCursorPos($x, $y) | Out-Null
Start-Sleep -Milliseconds 70
for ($i = 0; $i -lt ${count}; $i += 1) {
  [ScrollWindowApi]::mouse_event(0x0800, 0, 0, ${direction}, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 85
}
Write-Output '{"ok":true}'
`;
  await execPowerShell(script, 8000, true);
  await delay(450);
  return { ok: true, hwnd: safeHwnd, wheelClicks: clicks };
}

async function deepScanBoundWindow(hwnd, options = {}) {
  const config = getMonitorConfig();
  const safeHwnd = String(hwnd || "").trim();
  const binding = (config.windowBindings || [])
    .filter((item) => item.enabled !== false)
    .find((item) => String(item.hwnd || "") === safeHwnd);
  if (!binding) {
    throw new Error("这个窗口还没有固定到监控台");
  }
  const source = sourceForBinding(binding, config);
  const checkedAt = new Date().toISOString();
  const steps = Math.max(1, Math.min(10, Number(options.steps) || 5));
  const wheelClicks = Math.max(-12, Math.min(-1, Number(options.wheelClicks) || -4));
  const restore = options.restore !== false;
  const allUrls = [];
  const allCandidateUrls = [];
  const allText = [];
  const screens = [];
  let totalWheel = 0;

  try {
    await resizeMonitorWindow(safeHwnd);
  } catch {}

  for (let index = 0; index < steps; index += 1) {
    const snapshots = await getWechatSnapshots([binding.hwnd], config.readMode);
    const snapshot = snapshots.find((item) => String(item.hwnd || "") === safeHwnd);
    if (!snapshot) {
      break;
    }
    const analysis = await analyzeWechatSnapshot(snapshot);
    allUrls.push(...analysis.urls);
    allCandidateUrls.push(...analysis.candidateUrls);
    allText.push(analysis.text);
    screens.push({
      index: index + 1,
      urls: analysis.urls,
      candidateCount: analysis.candidateUrls.length,
      textLength: analysis.text.length,
      readMode: analysis.readMode,
      readSource: analysis.detectionSource,
      preview: monitorSample(analysis.text, 180)
    });
    if (index < steps - 1) {
      await scrollMonitorWindow(safeHwnd, wheelClicks);
      totalWheel += wheelClicks;
    }
  }

  if (restore && totalWheel) {
    await scrollMonitorWindow(safeHwnd, -totalWheel);
  }

  const urls = normalizeMonitorUrlList(allUrls);
  const candidateUrls = normalizeMonitorUrlList(allCandidateUrls);
  const text = uniqueCleanList(allText.map((item) => monitorSample(item, 1200)).filter(Boolean)).join("\n");
  const aggregateAnalysis = {
    candidateUrls,
    readMode: normalizeMonitorReadMode(config.readMode),
    originalTextLength: text.length,
    ocrTextLength: text.length,
    detectionSource: "深度扫描"
  };
  const baselineConsumed = consumeBaselineForBinding(binding, urls, checkedAt);
  const activeUrls = baselineConsumed ? [] : urlsAfterMonitorStart(binding, urls);
  const previousStat = monitorRuntime.bindingStats[binding.hwnd] || {};
  updateBindingStat(binding, source, {
    state: source ? "active" : "source-missing",
    lastDeepScanAt: checkedAt,
    lastDeepScanScreens: screens.length,
    lastDeepScanUrlCount: urls.length,
    lastManualReadAt: checkedAt,
    lastScanAt: checkedAt,
    ...statPatchFromWindowText(text, urls, checkedAt, previousStat, aggregateAnalysis),
    lastIgnoredLinkCount: baselineConsumed ? urls.length : Math.max(0, urls.length - activeUrls.length),
    startAfterUrl: binding.startAfterUrl || "",
    startAfterSetAt: binding.startAfterSetAt || "",
    lastError: source ? "" : "监控对象已停用或已删除",
    lastNewLinkCount: 0,
    lastNewLinks: []
  });

  const newLinks = [];
  if (config.syncQueue && source) {
    newLinks.push(...syncDetectedUrlsForBinding({
      binding,
      source,
      text,
      urls: activeUrls,
      candidateUrls,
      analysis: aggregateAnalysis,
      checkedAt,
      channel: "deep-scan"
    }));
  }

  return {
    ok: true,
    hwnd: safeHwnd,
    steps: screens.length,
    urls,
    candidateUrls,
    newLinks,
    screens,
    image: await captureWindowImage(binding.hwnd)
  };
}

async function readBoundWindow(hwnd) {
  const config = getMonitorConfig();
  const safeHwnd = String(hwnd || "").trim();
  const binding = (config.windowBindings || [])
    .filter((item) => item.enabled !== false)
    .find((item) => String(item.hwnd || "") === safeHwnd);
  if (!binding) {
    throw new Error("这个窗口还没有固定到监控台");
  }
  const source = sourceForBinding(binding, config);
  const checkedAt = new Date().toISOString();
  const snapshot = await getWechatSnapshotForHwnd(binding.hwnd, 3, config.readMode);
  if (!snapshot) {
    updateBindingStat(binding, source, {
      state: "missing",
      lastManualReadAt: checkedAt,
      lastError: "窗口未打开、已最小化或已关闭"
    });
    return {
      ok: false,
      hwnd: safeHwnd,
      error: "窗口未打开、已最小化或已关闭"
    };
  }

  const analysis = await analyzeWechatSnapshot(snapshot);
  const text = analysis.text;
  const urls = analysis.urls;
  const baselineConsumed = consumeBaselineForBinding(binding, urls, checkedAt);
  const activeUrls = baselineConsumed ? [] : urlsAfterMonitorStart(binding, urls);
  const previousStat = monitorRuntime.bindingStats[binding.hwnd] || {};
  updateBindingStat(binding, source, {
    state: source ? "active" : "source-missing",
    lastManualReadAt: checkedAt,
    lastScanAt: checkedAt,
    lastTitle: snapshot.title || "",
    ...statPatchFromWindowText(text, urls, checkedAt, previousStat, analysis),
    lastIgnoredLinkCount: baselineConsumed ? urls.length : Math.max(0, urls.length - activeUrls.length),
    startAfterUrl: binding.startAfterUrl || "",
    startAfterSetAt: binding.startAfterSetAt || "",
    lastError: source ? "" : "监控对象已停用或已删除",
    lastNewLinkCount: 0,
    lastNewLinks: []
  });
  const newLinks = [];
  if (config.syncQueue && source) {
    newLinks.push(...syncDetectedUrlsForBinding({
      binding,
      source,
      text,
      urls: activeUrls,
      candidateUrls: analysis.candidateUrls,
      analysis,
      checkedAt,
      channel: "manual-read"
    }));
  }

  return {
    ok: true,
    hwnd: safeHwnd,
    title: snapshot.title || "",
    textLength: text.length,
    originalTextLength: analysis.originalTextLength,
    ocrTextLength: analysis.ocrTextLength,
    readMode: analysis.readMode,
    readSource: analysis.detectionSource,
    localStatus: analysis.localStatus,
    localMessage: analysis.localMessage,
    localAccounts: analysis.localAccounts,
    preview: monitorSample(text, 220),
    urls,
    candidateUrls: analysis.candidateUrls,
    image: await captureWindowImage(binding.hwnd)
  };
}

function detectedKey(url, _sourceName, account) {
  return `${account || ""}|${normalizeUrl(url)}`;
}

function handleDetectedUrl({ url, source, channel, rawText, monitorSessionAt, includeExistingInSession }) {
  const config = getMonitorConfig();
  const sourceName = source && source.name || (channel === "clipboard" ? "剪贴板" : "微信窗口");
  const normalizedUrl = normalizeUrl(url);
  const accountName = "";
  const key = detectedKey(normalizedUrl, sourceName, accountName);
  const detectedAt = new Date().toISOString();

  const linkContext = contextForDetectedUrl(rawText, normalizedUrl);
  const contextText = linkContext || (rawText ? normalizeText(rawText).slice(0, 1000) : "");
  if (monitorRuntime.seenKeys.has(key)) {
    return null;
  }
  monitorRuntime.seenKeys.add(key);

  const sessionAt = monitorSessionAt || (config.autoFill ? detectedAt : "");
  const { item, created, sessionActivated } = createMonitorLinkRecord({
    url: normalizedUrl,
    sourceName,
    channel,
    expectedTrack: "",
    trackScore: 0,
    contextText,
    monitorSessionAt: sessionAt,
    includeExistingInSession
  });
  monitorRuntime.lastFoundAt = detectedAt;
  monitorLog(`发现表单：${sourceName}`);
  queueMonitorTrackConfirmation(item, { config });

  if (config.autoFill && (created || sessionActivated || channel === "wechat" || channel === "clipboard")) {
    const queued = queueMonitorAutoFillRecord(item, config);
    if (queued) {
      monitorLog(`已加入监控填写队列：${sourceName}`);
    }
  }

  return created || sessionActivated ? item : null;
}

async function monitorTick() {
  if (monitorBusy) {
    return;
  }
  const tickStartedAt = Date.now();
  monitorBusy = true;
  monitorRuntime.lastTickAt = new Date().toISOString();
  monitorRuntime.lastError = "";

  try {
    const config = getMonitorConfig();
    const tickAt = monitorRuntime.lastTickAt;
    if (config.detectClipboard && config.syncQueue) {
      const text = await getClipboardText();
      if (text && text !== monitorRuntime.lastClipboard) {
        monitorRuntime.lastClipboard = text;
        const source = findSourceForText(text, config, true);
        for (const url of await resolveFormUrls(text)) {
          handleDetectedUrl({ url, source, channel: "clipboard", rawText: text });
        }
      }
    }

    if (config.detectWechatWindow) {
      const activeBindings = (config.windowBindings || []).filter((binding) => binding.enabled !== false);
      const selectedBindings = selectBindingsForTick(activeBindings, config, tickAt);
      const sourceCache = new Map();
      for (const binding of selectedBindings) {
        const source = sourceForBinding(binding, config);
        sourceCache.set(binding.hwnd, source);
        updateBindingStat(binding, source, {
          state: "checking",
          lastError: source ? "" : "监控对象已停用或已删除"
        });
      }
      for (const binding of selectedBindings) {
        if (binding.virtualScreen === true) {
          try {
            await dockMonitorWindowToVirtualScreen(binding.hwnd, { persist: false });
          } catch (error) {
            updateBindingStat(binding, sourceCache.get(binding.hwnd) || sourceForBinding(binding, config), {
              lastVirtualScreenError: error.message
            });
          }
        }
      }
      const initialSnapshots = selectedBindings.length
        ? await getWechatSnapshots(selectedBindings.map((binding) => binding.hwnd), config.readMode)
        : [];
      const snapshotMap = new Map();
      for (const snapshot of initialSnapshots) {
        snapshotMap.set(String(snapshot.hwnd || ""), snapshot);
      }
      for (const binding of selectedBindings) {
        const hwndKey = String(binding.hwnd || "");
        const previousStat = monitorRuntime.bindingStats[binding.hwnd] || {};
        const snapshot = snapshotMap.get(hwndKey);
        if (!shouldRetryWechatSnapshot(snapshot, previousStat)) {
          continue;
        }
        const retrySnapshot = await getWechatSnapshotForHwnd(binding.hwnd, snapshot ? 2 : 3, config.readMode);
        if (retrySnapshot && scoreWechatSnapshot(retrySnapshot) >= scoreWechatSnapshot(snapshot)) {
          snapshotMap.set(hwndKey, retrySnapshot);
        }
      }
      const scannedHwnds = new Set();
      for (const binding of selectedBindings) {
        const snapshot = snapshotMap.get(String(binding.hwnd || ""));
        if (!snapshot) {
          continue;
        }
        scannedHwnds.add(String(binding.hwnd || ""));
        const source = sourceCache.get(binding.hwnd) || sourceForBinding(binding, config);
        const analysis = await analyzeWechatSnapshot(snapshot);
        const text = analysis.text;
        const previousStat = monitorRuntime.bindingStats[binding.hwnd] || {};
        const nextFingerprint = monitorFingerprint(text);
        const hasPendingLinks = Number(previousStat.lastPendingLinkCount || 0) > 0;
        const unchanged = Boolean(nextFingerprint && nextFingerprint === previousStat.lastFingerprint && !hasPendingLinks);
        const urls = analysis.urls;
        const effectiveAnalysis = analysis;
        const baselineConsumed = !unchanged && consumeBaselineForBinding(binding, urls, tickAt);
        const activeUrls = baselineConsumed ? [] : urlsAfterMonitorStart(binding, urls);
        updateBindingStat(binding, source, {
          state: source ? "active" : "source-missing",
          lastScanAt: tickAt,
          lastTitle: snapshot.title || "",
          ...statPatchFromWindowText(text, urls, tickAt, previousStat, effectiveAnalysis),
          lastIgnoredLinkCount: baselineConsumed ? urls.length : Math.max(0, urls.length - activeUrls.length),
          startAfterUrl: binding.startAfterUrl || "",
          startAfterSetAt: binding.startAfterSetAt || "",
          lastError: source ? "" : "监控对象已停用或已删除",
          lastNewLinkCount: 0,
          lastNewLinks: []
        });
        if (!activeUrls.length || !source) {
          continue;
        }
        if (unchanged || !config.syncQueue) {
          continue;
        }
        syncDetectedUrlsForBinding({
          binding,
          source,
          text,
          urls: activeUrls,
          candidateUrls: analysis.candidateUrls,
          analysis,
          checkedAt: tickAt,
          channel: "wechat"
        });
      }
      for (const binding of selectedBindings) {
        if (!scannedHwnds.has(String(binding.hwnd || ""))) {
          updateBindingStat(binding, sourceCache.get(binding.hwnd) || sourceForBinding(binding, config), {
            state: "missing",
            lastScanAt: tickAt,
            lastUrlCount: 0,
            lastError: "窗口未打开、已最小化或已关闭"
          });
        }
      }
    }
  } catch (error) {
    monitorRuntime.lastError = error.message;
    monitorLog(`检测异常：${error.message}`);
  } finally {
    monitorRuntime.lastScanDurationMs = Date.now() - tickStartedAt;
    monitorBusy = false;
  }
}

function startMonitor() {
  const config = writeMonitorConfig({ ...getMonitorConfig(), enabled: true });
  if (monitorTimer) {
    clearInterval(monitorTimer);
  }
  monitorRuntime.running = true;
  monitorLog("检测已开启");
  monitorTick().catch(() => {});
  monitorTimer = setInterval(() => {
    monitorTick().catch(() => {});
  }, config.intervalMs);
  return getMonitorState();
}

function stopMonitor() {
  writeMonitorConfig({ ...getMonitorConfig(), enabled: false });
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  monitorRuntime.running = false;
  monitorLog("检测已停止");
  return getMonitorState();
}

function updateMonitorConfig(config) {
  const previous = getMonitorConfig();
  let next = writeMonitorConfig(config);
  if (next.autoFill && !previous.autoFill) {
    monitorRuntime.autoFillStopRequested = false;
    monitorRuntime.autoFillQueue = [];
    resetMonitorAutoFillProgress({
      enabled: true,
      currentStatus: "idle",
      message: "监控填写模式已开启"
    });
    const startedAt = next.autoFillStartedAt || new Date().toISOString();
    const windowBindings = (next.windowBindings || []).map((binding) => {
      const stat = monitorRuntime.bindingStats[binding.hwnd] || {};
      const visibleLinks = normalizeMonitorUrlList(stat.lastLinks || []);
      if (binding.startAfterUrl) {
        monitorRuntime.baselineHwnds.delete(String(binding.hwnd || ""));
        return {
          ...binding,
          startAfterSetAt: binding.startAfterSetAt || startedAt
        };
      }
      if (!visibleLinks.length) {
        monitorRuntime.baselineHwnds.add(String(binding.hwnd || ""));
      }
      return {
        ...binding,
        startAfterUrl: "",
        startInclusive: false,
        startAfterSetAt: startedAt,
        ignoredUrls: uniqueCleanList([
          ...(binding.ignoredUrls || []),
          ...visibleLinks
        ].map(normalizeUrl)).filter((url) => qqFormIdFromUrl(url)).slice(-120)
      };
    });
    next = writeMonitorConfig({ ...next, autoFillStartedAt: startedAt, windowBindings });
    monitorRuntime.seenKeys.clear();
    next = activatePendingMonitorStartPoints(next, startedAt);
    monitorLog("已进入监控填写模式：当前可见链接作为基线，不会重复进入填表");
  }
  if (!next.autoFill && previous.autoFill) {
    monitorRuntime.baselineHwnds.clear();
    stopMonitorAutoFillQueue();
  }
  if (next.enabled) {
    startMonitor();
  } else if (monitorRuntime.running) {
    stopMonitor();
  }
  return getMonitorState();
}

async function routeApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/state") {
    const accounts = getAccounts();
    const answers = readJson(answersPath, {});
    sendJson(res, 200, {
      accounts,
      answerTypes: getAnswerTypes(accounts, answers),
      autoSubmit: answers.autoSubmit === true,
      loginStatus: readLoginStatus()
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/login-status") {
    sendJson(res, 200, readLoginStatus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/login-status/check") {
    try {
      const body = await readBody(req);
      const item = await checkLoginStatusForAccount(body.account);
      sendJson(res, 200, { item, loginStatus: readLoginStatus() });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/login-status/check-all") {
    try {
      sendJson(res, 200, await checkAllLoginStatus());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    try {
      const body = await readBody(req);
      const answers = readJson(answersPath, {});
      answers.autoSubmit = body.autoSubmit === true;
      writeJson(answersPath, answers);
      sendJson(res, 200, { autoSubmit: answers.autoSubmit });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/tracks") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, updateTrackLibrary(body.tracks || []));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/accounts") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, upsertAccount(body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/accounts/rename") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, renameAccount(body.oldName, body.newName));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/forms/detect-tracks") {
    try {
      const body = await readBody(req);
      const rawItems = Array.isArray(body.items) && body.items.length
        ? body.items
        : extractFormUrls(body.url).map((url) => ({ url }));
      sendJson(res, 200, await detectFormTracksForItems(rawItems, {
        accountNames: accountNamesFromBody(body)
      }));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/default-account") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, setDefaultAccount(body.name));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/monitor") {
    sendJson(res, 200, getMonitorState());
    return;
  }

  if (req.method === "GET" && pathname === "/api/monitor/events") {
    const queryLimit = Number(new URL(req.url, "http://127.0.0.1").searchParams.get("limit"));
    sendJson(res, 200, readMonitorEvents(queryLimit || 120));
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/events/clear") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, clearMonitorQueue(body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, updateMonitorConfig(body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/start") {
    sendJson(res, 200, startMonitor());
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/stop") {
    sendJson(res, 200, stopMonitor());
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/auto-fill/stop") {
    sendJson(res, 200, stopMonitorAutoFillQueue());
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/sync") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await setMonitorQueueSync(body.enabled === true));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/start-point") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, setMonitorStartPoint(body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/probe") {
    try {
      sendJson(res, 200, await runMonitorProbe());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/focus-window") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await focusWindow(body.hwnd));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/resize-window") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await resizeMonitorWindow(body.hwnd, body.width, body.height));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/dock-window") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await dockMonitorWindowToVirtualScreen(body.hwnd, body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/restore-window") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await restoreMonitorWindowToPrimaryScreen(body.hwnd, body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/recover-windows") {
    try {
      sendJson(res, 200, await recoverUnboundWechatWindowsToPrimaryScreen());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/test-window-sizes") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await testMonitorWindowSizes(body.hwnd));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/read-window") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await readBoundWindow(body.hwnd));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/deep-scan-window") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, await deepScanBoundWindow(body.hwnd, body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/pick-window") {
    try {
      sendJson(res, 200, await getWindowUnderCursor());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/foreground-window") {
    try {
      sendJson(res, 200, await getForegroundWechatWindow());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/monitor/simulate") {
    try {
      const body = await readBody(req);
      const config = getMonitorConfig();
      const sources = enabledSources(config);
      const source = sources.find((item) => item.id === body.sourceId) || sources[0] || null;
      if (!source) {
        sendJson(res, 400, { error: "先添加一个监控对象" });
        return;
      }
      const url = await confirmQqFormUrl(body.url || "https://docs.qq.com/form/page/DYtestMonitorDemo", { allowLikelyFallback: true });
      if (!url) {
        sendJson(res, 400, { error: "链接无法打开，未进入采集记录" });
        return;
      }
      const item = handleDetectedUrl({
        url,
        source,
        channel: "simulate",
        rawText: `${source.name} ${url}`
      });
      sendJson(res, 200, { item });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/history") {
    sendJson(res, 200, readHistory());
    return;
  }

  if (req.method === "POST" && pathname === "/api/history/export") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, exportHistoryExcel(body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/history/status") {
    const body = await readBody(req);
    const item = updateHistoryItem(body.id, { status: String(body.status || ""), message: String(body.message || "") });
    if (!item) {
      sendJson(res, 404, { error: "没有找到这条记录" });
      return;
    }
    sendJson(res, 200, item);
    return;
  }

  if (req.method === "POST" && pathname === "/api/history/delete") {
    const body = await readBody(req);
    sendJson(res, 200, deleteHistoryItems(body.ids));
    return;
  }

  if (req.method === "POST" && pathname === "/api/history/fill") {
    try {
      const body = await readBody(req);
      const item = getHistoryItem(body.id);
      if (!item) {
        sendJson(res, 404, { error: "没有找到这条记录" });
        return;
      }
      const readyItem = await ensureHistoryLinkReady(item);
      const job = startFillJob({
        accountName: readyItem.account,
        url: readyItem.url,
        douyinIndex: readyItem.douyinIndex,
        expectedTrack: readyItem.expectedTrack,
        historyId: readyItem.id
      });
      updateHistoryItem(readyItem.id, { status: "填写中", jobId: job.id, message: "" });
      sendJson(res, 200, { jobId: job.id, historyId: readyItem.id });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/history/fill-batch") {
    try {
      const body = await readBody(req);
      const accountNames = accountNamesFromBody(body);
      const answerSettings = readJson(answersPath, {});
      const canUseRepeatButton = body.dryRun || answerSettings.autoSubmit === true;
      const idSet = new Set((Array.isArray(body.ids) ? body.ids : []).map((id) => String(id || "")));
      const items = readHistory().items.filter((item) => {
        if (idSet.size && !idSet.has(String(item.id || ""))) {
          return false;
        }
        if (!idSet.size && accountNames.length && !accountNames.includes(item.account)) {
          return false;
        }
        return item.url && displayStatusForServer(item.status) === "待填写";
      }).slice(0, 80);
      const started = [];
      const errors = [];
      for (const item of items) {
        const startedBeforeItem = started.length;
        const itemErrors = [];
        const targetAccounts = accountNames.length ? accountNames : (item.account ? [item.account] : monitorFillAccountNames());
        for (const accountName of targetAccounts) {
          try {
            const account = getAccount(accountName);
            if (!account) {
              throw new Error(`没有找到账号：${accountName}`);
            }
            const confirmedUrl = await confirmQqFormUrl(item.url, { allowLikelyFallback: true });
            if (!confirmedUrl) {
              throw new Error("链接无法打开，已停止填写");
            }
            const enrichedItem = await enrichRecordTrackFromForm(
              { ...item, url: confirmedUrl },
              { accountNames: targetAccounts, formOnly: true }
            );
            const sameAccount = enrichedItem.account === account.name;
            const targetInfo = resolveFillTargets(account, {
              ...enrichedItem,
              douyinIndex: sameAccount ? enrichedItem.douyinIndex || "__auto__" : "__auto__"
            }, enrichedItem.contextText || enrichedItem.expectedTrack || "", { requireExpectedTrack: true });
            if (!targetInfo.targets.length) {
              errors.push(targetInfo.reason || `${account.name} 没有匹配的抖音号`);
              continue;
            }
            const preparedTargets = [];
            for (const target of targetInfo.targets) {
              const douyinIndex = String(target.index);
              validateFillRequest(account, douyinIndex, body.dryRun);
              const readyItem = sameAccount && String(enrichedItem.douyinIndex || "") === douyinIndex
                ? updateHistoryItem(enrichedItem.id, {
                  url: confirmedUrl,
                  expectedTrack: targetInfo.track || enrichedItem.expectedTrack,
                  trackScore: targetInfo.trackScore || enrichedItem.trackScore,
                  contextText: enrichedItem.contextText,
                  linkStatus: "已验证",
                  verifiedAt: new Date().toISOString()
                }) || { ...enrichedItem, url: confirmedUrl }
                : prepareFillHistory({
                  source: enrichedItem.source || "监控采集",
                  channel: enrichedItem.channel || "wechat",
                  url: confirmedUrl,
                  accountName: account.name,
                  douyinIndex,
                  expectedTrack: targetInfo.track || enrichedItem.expectedTrack,
                  trackScore: targetInfo.trackScore || enrichedItem.trackScore,
                  contextText: enrichedItem.contextText,
                  message: targetInfo.track ? `监控采集已加入填表队列 · 匹配赛道：${targetInfo.track}` : "监控采集已加入填表队列",
                  dedupe: true
              });
              if (readyItem.skipped) {
                errors.push(readyItem.reason);
                itemErrors.push(readyItem.reason);
                continue;
              }
              const historyItem = readyItem.item || readyItem;
              preparedTargets.push({ douyinIndex, historyId: historyItem.id });
            }

            if (!preparedTargets.length) {
              continue;
            }

            const targetGroups = canUseRepeatButton
              ? [preparedTargets]
              : preparedTargets.map((target) => [target]);
            for (const groupTargets of targetGroups) {
              const historyTargets = groupTargets.map((target) => ({
                historyId: target.historyId,
                douyinIndex: target.douyinIndex,
                expectedTrack: targetInfo.track || enrichedItem.expectedTrack
              }));
              const job = startFillJob({
                accountName: account.name,
                url: confirmedUrl,
                douyinIndex: groupTargets[0].douyinIndex,
                douyinIndexes: groupTargets.map((target) => target.douyinIndex),
                dryRun: body.dryRun,
                expectedTrack: targetInfo.track || enrichedItem.expectedTrack,
                historyId: historyTargets[0] && historyTargets[0].historyId || "",
                historyTargets,
                includeTrackSiblings: canUseRepeatButton
              });
              for (const groupTarget of groupTargets) {
                updateHistoryItem(groupTarget.historyId, { status: "填写中", jobId: job.id, message: "监控采集已加入填表队列" });
                started.push({ jobId: job.id, historyId: groupTarget.historyId, account: account.name });
              }
            }
          } catch (error) {
            errors.push(error.message);
            itemErrors.push(error.message);
            if (item.account === accountName) {
              updateHistoryItem(item.id, error.message.includes("链接无法打开")
                ? { status: "不可填写", linkStatus: "校验失败", message: error.message }
                : { status: "失败", message: error.message });
            } else if (!item.account && /链接无法打开|不可填写|暂停|停止|结束/.test(error.message)) {
              updateHistoryItem(item.id, {
                status: "不可填写",
                linkStatus: error.message.includes("链接无法打开") ? "校验失败" : item.linkStatus || "已验证",
                message: error.message
              });
            }
          }
        }
        if (!item.account && started.length > startedBeforeItem) {
          updateHistoryItem(item.id, {
            status: "已同步",
            message: `已分配到 ${started.length - startedBeforeItem} 个填表任务`
          });
        } else if (!item.account && itemErrors.length && itemErrors.every((message) => /已有这条链接记录/.test(message))) {
          updateHistoryItem(item.id, {
            status: "已填过",
            message: "这条链接对应的抖音号已有记录，已跳过"
          });
        }
      }
      if (!started.length) {
        sendJson(res, 400, { error: errors[0] || "没有可填写的监控采集链接" });
        return;
      }
      sendJson(res, 200, {
        jobId: started[0].jobId,
        historyId: started[0].historyId,
        jobIds: started.map((item) => item.jobId),
        historyIds: started.map((item) => item.historyId),
        count: started.length,
        errors
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/pick-path") {
    try {
      const body = await readBody(req);
      const selectedPath = await pickLocalPath(body);
      sendJson(res, 200, { path: selectedPath });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/open-path") {
    try {
      const body = await readBody(req);
      openLocalPath(body.path);
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/jianying/preview") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, previewBatch(body));
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/jianying/paths") {
    sendJson(res, 200, detectJianyingPaths());
    return;
  }

  if (req.method === "POST" && pathname === "/api/jianying/generate") {
    const body = await readBody(req);
    const job = runLocalJob("jianying", (log) => generateDrafts(body, log));
    sendJson(res, 200, { jobId: job.id });
    return;
  }

  if (req.method === "POST" && pathname === "/api/open-login") {
    const body = await readBody(req);
    const account = getAccount(body.account);
    if (!account) {
      sendJson(res, 404, { error: "没有找到这个账号" });
      return;
    }
    const job = runJob("login", fillArgsFor(account, ["--login-only"]));
    sendJson(res, 200, { jobId: job.id });
    return;
  }

  if (req.method === "POST" && pathname === "/api/fill") {
    const body = await readBody(req);
    const accountNames = accountNamesFromBody(body);
    const selectedAccounts = accountNames.map((name) => getAccount(name));
    const items = normalizeFillItems(body);
    const visible = body.visible === true;
    const forceAutoSubmit = body.forceAutoSubmit === true;
    const skipHistory = body.skipHistory === true;
    const answerSettings = readJson(answersPath, {});
    const canUseRepeatButton = body.dryRun || forceAutoSubmit || answerSettings.autoSubmit === true;
    if (!selectedAccounts.length || selectedAccounts.some((account) => !account)) {
      sendJson(res, 404, { error: "没有找到这个账号" });
      return;
    }
    if (!items.length) {
      sendJson(res, 400, { error: "请填写腾讯文档表单链接，可以一次粘贴多条" });
      return;
    }
    try {
      const started = [];
      const skipped = [];
      const confirmedItems = [];
      for (const item of items) {
        const confirmedUrl = await confirmQqFormUrl(item.url, { allowLikelyFallback: true });
        if (!confirmedUrl) {
          throw new Error(`链接无法打开：${item.url}`);
        }
        confirmedItems.push(await enrichRecordTrackFromForm(
          { ...item, url: confirmedUrl },
          { accountNames, formOnly: true }
        ));
      }

      for (const account of selectedAccounts) {
        for (const item of confirmedItems) {
          let targetInfo = resolveFillTargets(account, item, item.contextText || item.expectedTrack || "", {
            requireExpectedTrack: true,
            includeTrackSiblings: true
          });
          if (!targetInfo.targets.length && canUseRepeatButton && !targetInfo.track) {
            targetInfo = {
              track: "",
              trackScore: 0,
              targets: [{
                douyin: null,
                index: item.douyinIndex || "__auto__",
                tracks: []
              }],
              deferredTrackDetection: true
            };
          }
          if (!targetInfo.targets.length) {
            skipped.push({ account: account.name, url: item.url, reason: targetInfo.reason || "没有匹配的抖音号" });
            continue;
          }
          const preparedTargets = [];
          for (const target of targetInfo.targets) {
            const douyinIndex = String(target.index);
            validateFillRequest(account, douyinIndex, body.dryRun);
            const message = item.expectedTrack
              ? `匹配赛道：${targetInfo.track || item.expectedTrack}`
              : targetInfo.track ? `匹配赛道：${targetInfo.track}` : "";
            let historyId = "";
            if (!skipHistory) {
              const prepared = prepareFillHistory({
                source: body.dryRun || forceAutoSubmit ? "测试" : "手动",
                channel: "manual",
                url: item.url,
                accountName: account.name,
                douyinIndex,
                expectedTrack: targetInfo.track || item.expectedTrack,
                trackScore: targetInfo.trackScore || item.trackScore,
                message: body.dryRun || forceAutoSubmit ? message || "测试任务已启动" : message,
                contextText: item.contextText,
                dedupe: forceAutoSubmit ? false : true
              });
              if (prepared.skipped) {
                skipped.push({ account: account.name, url: item.url, reason: prepared.reason });
                continue;
              }
              historyId = prepared.item.id;
            }
            preparedTargets.push({ douyinIndex, historyId, message });
          }

          if (!preparedTargets.length) {
            continue;
          }

          const targetGroups = canUseRepeatButton
            ? [preparedTargets]
            : preparedTargets.map((target) => [target]);
          for (const groupTargets of targetGroups) {
            const historyTargets = groupTargets
              .filter((target) => target.historyId)
              .map((target) => ({
                historyId: target.historyId,
                douyinIndex: target.douyinIndex,
                expectedTrack: targetInfo.track || item.expectedTrack
              }));
            const job = startFillJob({
              accountName: account.name,
              url: item.url,
              douyinIndex: groupTargets[0].douyinIndex,
              douyinIndexes: groupTargets.map((target) => target.douyinIndex),
              dryRun: body.dryRun,
              expectedTrack: targetInfo.track || item.expectedTrack,
              visible,
              forceAutoSubmit,
              historyId: historyTargets[0] && historyTargets[0].historyId || "",
              historyTargets,
              includeTrackSiblings: canUseRepeatButton
            });
            for (const groupTarget of groupTargets) {
              if (groupTarget.historyId) {
                updateHistoryItem(groupTarget.historyId, {
                  status: "填写中",
                  jobId: job.id,
                  message: body.dryRun
                    ? "测试任务已启动"
                    : confirmedItems.length * selectedAccounts.length > 1 || targetInfo.targets.length > 1
                      ? `批量任务已加入队列${targetInfo.track ? ` · 匹配赛道：${targetInfo.track}` : ""}`
                      : ""
                });
              }
              started.push({
                jobId: job.id,
                historyId: groupTarget.historyId,
                account: account.name,
                test: body.dryRun || skipHistory
              });
            }
          }
        }
      }
      if (!started.length) {
        sendJson(res, 400, { error: skipped[0] && skipped[0].reason || (body.dryRun ? "没有可测试的填表任务" : "没有新的可填写链接"), skipped });
        return;
      }
      sendJson(res, 200, {
        jobId: started[0].jobId,
        historyId: started[0].historyId,
        jobIds: started.map((item) => item.jobId),
        historyIds: started.map((item) => item.historyId),
        count: started.length,
        skipped
      });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/jobs/cancel") {
    const body = await readBody(req);
    const kind = String(body.kind || "").trim();
    const requestedIds = body.all
      ? Array.from(jobs.values())
        .filter((job) => !["done", "failed", "cancelled", "skipped"].includes(job.status))
        .filter((job) => !kind || job.kind === kind)
        .map((job) => job.id)
      : Array.isArray(body.jobIds)
        ? body.jobIds
        : [body.jobId || body.id];
    const result = cancelJobsById(requestedIds, kind);
    if (!result.jobs.length && !result.ignored.length) {
      sendJson(res, 404, { error: "没有找到正在填写的任务", ...result });
      return;
    }
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && pathname === "/api/jobs") {
    const list = Array.from(jobs.values())
      .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
      .slice(0, 50);
    sendJson(res, 200, { jobs: list });
    return;
  }

  if (req.method === "POST" && pathname.startsWith("/api/jobs/") && pathname.endsWith("/cancel")) {
    const id = decodeURIComponent(pathname.slice("/api/jobs/".length, -"/cancel".length));
    const result = cancelJobsById([id], "");
    if (!result.jobs.length) {
      sendJson(res, 404, { error: "没有找到这个任务", ...result });
      return;
    }
    sendJson(res, 200, { job: result.jobs[0], ...result });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/jobs/")) {
    const id = decodeURIComponent(pathname.replace("/api/jobs/", ""));
    const job = jobs.get(id);
    if (!job) {
      sendJson(res, 404, { error: "没有找到这个任务" });
      return;
    }
    sendJson(res, 200, job);
    return;
  }

  sendJson(res, 404, { error: "接口不存在" });
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(uiDir, requested));
  if (!filePath.startsWith(uiDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    sendText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg"
  }[ext] || "application/octet-stream";
  sendText(res, 200, fs.readFileSync(filePath), type);
}

function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      routeApi(req, res, url.pathname).catch((error) => sendJson(res, 500, { error: error.message }));
      return;
    }
    serveStatic(req, res, url.pathname);
  });
}

function startServer(port = Number(process.env.PORT || 17880)) {
  ensureDataFiles();
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      console.log(`自动填表助手已启动：http://127.0.0.1:${actualPort}`);
      if (getMonitorConfig().enabled) {
        startMonitor();
      }
      resolve({ server, port: actualPort });
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(`控制台启动失败：${error.message}`);
    process.exit(1);
  });
}

module.exports = { startServer };
