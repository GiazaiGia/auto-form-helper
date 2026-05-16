const fs = require("fs");
const path = require("path");
const readline = require("readline");

let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error("没有找到浏览器自动化组件。请用 run-fill.cmd 启动，或先安装 Playwright。");
  process.exit(1);
}

const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.FORM_HELPER_DATA_DIR || rootDir;
const configPath = path.join(dataDir, "config", "answers.json");
const accountsPath = path.join(dataDir, "config", "accounts.json");
const outputDir = path.join(dataDir, "output");
const TRACK_MATCH_MIN_SCORE = 8;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compactText(value) {
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

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function isValidUrl(value) {
  return /^https?:\/\/docs\.qq\.com\/form\/page\//i.test(String(value || "").trim());
}

function fillEntryUrl(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(https?:\/\/docs\.qq\.com\/form\/page\/[A-Za-z0-9_-]+)/i);
  if (!match) {
    return text;
  }
  return `${match[1]}#/fill`;
}

function safeProfileName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}

function findEdgeExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function edgeUserDataDir() {
  return path.join(process.env.LOCALAPPDATA || "", "Microsoft", "Edge", "User Data");
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function abortError() {
  const error = new Error("用户已停止填表");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw abortError();
  }
}

async function abortableWait(page, ms, signal) {
  throwIfAborted(signal);
  if (!signal) {
    await page.waitForTimeout(ms);
    return;
  }
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    await Promise.race([page.waitForTimeout(ms), aborted]);
    throwIfAborted(signal);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}

function implicitKeywords(typeName) {
  const text = compactText(typeName);
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

function keywordsForType(typeName, config) {
  return uniqueCleanList([
    typeName,
    ...implicitKeywords(typeName),
    ...((config.typeKeywords && config.typeKeywords[typeName]) || [])
  ]);
}

function bigrams(value) {
  const text = compactText(value);
  const parts = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    parts.push(text.slice(index, index + 2));
  }
  return parts;
}

function scoreType(pageText, typeName, config) {
  const body = compactText(pageText);
  if (!body || !typeName) {
    return 0;
  }
  let score = 0;
  for (const keyword of keywordsForType(typeName, config)) {
    const key = compactText(keyword);
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

function trackListForDouyin(douyin) {
  if (!douyin) {
    return [];
  }
  return uniqueCleanList([
    ...(Array.isArray(douyin.tracks) ? douyin.tracks : []),
    douyin.contentType
  ]);
}

function knownTypes(config) {
  return uniqueCleanList([
    ...Object.keys(config.profiles || {}),
    ...Object.keys(config.typeKeywords || {}),
    config.defaultType
  ]);
}

function pickType(pageText, config, candidates = []) {
  const types = uniqueCleanList(candidates.length ? candidates : knownTypes(config));
  if (!types.length) {
    return { typeName: "", score: 0, source: "none" };
  }
  const ranked = types
    .map((typeName) => ({ typeName, score: scoreType(pageText, typeName, config) }))
    .sort((a, b) => b.score - a.score);
  if (ranked[0] && ranked[0].score >= TRACK_MATCH_MIN_SCORE) {
    return { ...ranked[0], source: "keywords" };
  }
  return { typeName: "", score: 0, source: "none" };
}

function trackMatches(expectedTrack, candidateTrack, config) {
  const expected = compactText(expectedTrack);
  const candidate = compactText(candidateTrack);
  if (!expected || !candidate) {
    return false;
  }
  return expected === candidate
    || scoreType(expectedTrack, candidateTrack, config) >= TRACK_MATCH_MIN_SCORE
    || scoreType(candidateTrack, expectedTrack, config) >= TRACK_MATCH_MIN_SCORE;
}

function buildAnswers(config, typeName) {
  const profile = (config.profiles && config.profiles[typeName]) || {};
  return {
    typeName,
    wechatNickname: config.wechatNickname || "",
    releaseLink: profile.releaseLink || "好",
    douyinName: profile.douyinName || "",
    douyinId: profile.douyinId || "",
    douyinGroupLevel: profile.douyinGroupLevel || "好",
    alipayAccount: profile.alipayAccount || "",
    alipayName: profile.alipayName || "",
    idCard: profile.idCard || "",
    phone: profile.phone || "",
    images: profile.images || {}
  };
}

function getAccountData(accountName) {
  if (!accountName) {
    return null;
  }
  const data = readJson(accountsPath);
  return (data.accounts || []).find((account) => account.name === accountName) || null;
}

function getSelectedDouyin(account, douyinIndex) {
  if (!account || douyinIndex === "") {
    return null;
  }
  const index = Number(douyinIndex);
  if (!Number.isInteger(index) || index < 0) {
    return null;
  }
  return (account.douyinAccounts || [])[index] || null;
}

function pickDouyinForPage(pageText, account, config) {
  const douyins = account && account.douyinAccounts || [];
  if (!douyins.length) {
    return { douyin: null, index: -1, pickedType: pickType(pageText, config) };
  }
  const ranked = douyins.map((douyin, index) => {
    const tracks = trackListForDouyin(douyin);
    const pickedType = pickType(pageText, config, tracks.length ? tracks : knownTypes(config));
    return { douyin, index, pickedType, tracks };
  }).sort((a, b) => b.pickedType.score - a.pickedType.score);
  if (ranked[0].pickedType.score >= TRACK_MATCH_MIN_SCORE) {
    return ranked[0];
  }
  return { douyin: null, index: -1, pickedType: { typeName: "", score: 0, source: "none" }, tracks: [] };
}

function pickDouyinForExpectedTrack(account, expectedTrack, config) {
  const douyins = account && account.douyinAccounts || [];
  for (let index = 0; index < douyins.length; index += 1) {
    const douyin = douyins[index];
    const tracks = trackListForDouyin(douyin);
    if (tracks.some((track) => trackMatches(expectedTrack, track, config))) {
      return {
        douyin,
        index,
        tracks,
        pickedType: { typeName: expectedTrack, score: 999, source: "provided" }
      };
    }
  }
  return { douyin: null, index: -1, pickedType: { typeName: "", score: 0, source: "none" }, tracks: [] };
}

function mergeAccountAnswers(answers, account, douyin) {
  const contact = (account && account.contact) || {};
  const accountImages = (account && account.images) || {};
  const fillDefaults = (account && account.fillDefaults) || {};
  const sharedScreenshot = accountImages.screenshot || accountImages.gradeScreenshot || accountImages.postScreenshot || "";
  const next = { ...answers };
  next.images = {
    ...(answers.images || {}),
    ...(sharedScreenshot ? {
      screenshot: sharedScreenshot,
      gradeScreenshot: sharedScreenshot,
      postScreenshot: sharedScreenshot
    } : {}),
    ...(accountImages.avatar ? { avatar: accountImages.avatar } : {})
  };
  next.releaseLink = fillDefaults.releaseLink || next.releaseLink || "好";
  next.douyinGroupLevel = fillDefaults.douyinGroupLevel || next.douyinGroupLevel || "好";

  if (douyin) {
    next.douyinName = douyin.nickname || next.douyinName;
    next.douyinId = douyin.douyinId || next.douyinId;
  }

  if (account) {
    next.alipayAccount = contact.alipayAccount || contact.phone || "";
    next.alipayName = contact.alipayName || contact.realName || "";
    next.phone = contact.phone || "";
    next.idCard = contact.idCard || "";
  }
  return next;
}

function answerForLabel(label, answers) {
  const text = normalizeText(label);
  const compact = compactText(text);

  if (includesAny(text, ["微信昵称", "微信名", "微信号"])) {
    return { key: "wechatNickname", value: answers.wechatNickname };
  }

  if (includesAny(text, ["抖音团购等级", "团购等级", "等级"]) && !includesAny(text, ["截图", "图片"])) {
    return { key: "douyinGroupLevel", value: answers.douyinGroupLevel };
  }

  if (includesAny(text, ["抖音ID", "抖音id", "抖音号", "抖音帐号", "抖音账号"])) {
    return { key: "douyinId", value: answers.douyinId };
  }

  if (includesAny(text, ["抖音昵称", "抖音名"])) {
    return { key: "douyinName", value: answers.douyinName };
  }

  if (includesAny(text, ["支付宝账号", "支付宝帐号"])) {
    return { key: "alipayAccount", value: answers.alipayAccount };
  }

  if (includesAny(text, ["支付宝姓名", "支付宝名字", "支付宝实名"])) {
    return { key: "alipayName", value: answers.alipayName };
  }

  if (/(身份证|证件号|身份号码)/.test(compact) && !/(不需要|无需|不用|不要|免填|不填|不用填|无需填写|非必填|不是必填)/.test(compact)) {
    return { key: "idCard", value: answers.idCard };
  }

  if (includesAny(text, ["支付宝手机号", "手机号", "手机号码", "联系电话", "电话"])) {
    return { key: "phone", value: answers.phone };
  }

  if (includesAny(text, ["发布链接", "作品链接", "视频链接", "链接"])) {
    return { key: "releaseLink", value: answers.releaseLink };
  }

  return null;
}

function imageKeyForLabel(label) {
  const text = normalizeText(label);
  const compact = compactText(text);
  if (includesAny(text, ["头像"])) {
    return "avatar";
  }
  if (
    includesAny(text, ["等级截图", "级别截图", "团购等级截图", "销售额截图", "新等级截图", "5级", "05级", "五级", "3级", "三级", "满3000", "满 3000"])
    || (/截图/.test(text) && /(等级|级别|销售额|近30天|近 30 天|近30日|近 30 日|满3000|满 3000)/.test(text))
    || (/截图/.test(compact) && /(等级|级别|销售额|近30天|近30日|满3000)/.test(compact))
  ) {
    return "screenshot";
  }
  if (includesAny(text, ["发布之后", "发布后", "视频截图"])) {
    return "screenshot";
  }
  if (/截图|图片|照片|提交图片|上传图片|选择图片|添加图片/.test(text)) {
    return "screenshot";
  }
  return "";
}

function imageForLabel(label, answers) {
  const images = answers.images || {};
  const key = imageKeyForLabel(label);
  if (key === "screenshot") {
    return images.screenshot || images.gradeScreenshot || images.postScreenshot || "";
  }
  return key ? images[key] || "" : "";
}

async function waitUntilEditable(page, log = console.log, signal = null, options = {}) {
  const startedAt = Date.now();
  let lastMessage = "";
  while (Date.now() - startedAt < 10 * 60 * 1000) {
    throwIfAborted(signal);
    const state = await page.evaluate(() => {
      const bodyText = document.body ? document.body.innerText || "" : "";
      const textareas = Array.from(document.querySelectorAll("textarea"));
      const editableCount = textareas.filter((item) => !item.disabled && !item.readOnly).length;
      const closedTerms = [
        "你已提交",
        "已提交1份",
        "已暂停收集",
        "暂停收集",
        "已达收集上限",
        "达到收集上限",
        "停止收集",
        "已停止收集",
        "已结束",
        "收集已结束"
      ];
      const closedReason = closedTerms.find((term) => bodyText.includes(term)) || "";
      return {
        loginRequired: bodyText.includes("登录腾讯文档") || bodyText.includes("登录后才能填写"),
        textareaCount: textareas.length,
        editableCount,
        closedReason,
        preview: bodyText.replace(/\s+/g, " ").trim().slice(0, 240)
      };
    });

    if (state.textareaCount > 0 && state.editableCount > 0) {
      return state;
    }

    if (state.closedReason) {
      throw new Error(`这个表单当前不可填写：${state.closedReason}`);
    }

    if (state.loginRequired) {
      if (options.background) {
        throw new Error("页面需要登录腾讯文档。请先在文档模板设定里打开登录窗口完成登录，再重新自动填表。");
      }
      const message = "页面需要登录腾讯文档。请在打开的浏览器窗口里完成登录，我会继续等待。";
      if (message !== lastMessage) {
        log(message);
        lastMessage = message;
      }
    } else {
      const message = state.textareaCount > 0
        ? "表单已打开，但当前输入框不可填写。可能是表单暂停、已满，或页面还没加载完。"
        : "正在等待表单加载...";
      if (message !== lastMessage) {
        log(message);
        if (state.preview) {
          log(`页面提示：${state.preview}`);
        }
        lastMessage = message;
      }
    }

    await abortableWait(page, 5000, signal);
  }

  throw new Error("等待登录或可填写状态超时。");
}

async function collectTextFields(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function fieldTextFor(element) {
      let current = element.parentElement;
      for (let depth = 0; current && depth < 8; depth += 1) {
        const text = clean(current.innerText || current.textContent || "");
        const hasQuestionWord = /微信|抖音|等级|支付宝|身份证|手机|电话|链接|姓名/.test(text);
        if (hasQuestionWord && text.length < 500) {
          return text;
        }
        current = current.parentElement;
      }
      return clean(element.placeholder || "");
    }

    return Array.from(document.querySelectorAll("textarea")).map((element, index) => ({
      index,
      label: fieldTextFor(element),
      disabled: element.disabled,
      readOnly: element.readOnly,
      value: element.value || ""
    }));
  });
}

async function fillTextFields(page, answers) {
  const fields = await collectTextFields(page);
  const filled = [];
  const skipped = [];

  for (const field of fields) {
    const match = answerForLabel(field.label, answers);
    if (!match || !match.value) {
      skipped.push({ index: field.index + 1, label: field.label || "未识别题目" });
      continue;
    }

    const locator = page.locator("textarea").nth(field.index);
    if (!(await locator.isEnabled().catch(() => false))) {
      skipped.push({ index: field.index + 1, label: field.label, reason: "不可填写" });
      continue;
    }

    await locator.fill(match.value);
    filled.push({
      index: field.index + 1,
      label: field.label,
      key: match.key,
      value: match.value
    });
  }

  return { filled, skipped };
}

async function collectUploadFields(page) {
  return page.evaluate(() => {
    function clean(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function fieldTextFor(element) {
      let current = element.parentElement;
      for (let depth = 0; current && depth < 8; depth += 1) {
        const text = clean(current.innerText || current.textContent || "");
        const hasQuestionWord = /截图|图片|头像|照片/.test(text);
        if (hasQuestionWord && text.length < 500) {
          return text;
        }
        current = current.parentElement;
      }
      return clean(element.innerText || "");
    }

    function uploadButtonText(element) {
      return clean(element.innerText || element.textContent || element.value || element.getAttribute("aria-label") || "");
    }

    function looksLikeUploadButton(element) {
      const text = uploadButtonText(element);
      const className = String(element.className || "");
      const tagName = String(element.tagName || "").toLowerCase();
      return className.includes("form-file-image-default")
        || tagName === "input" && String(element.type || "").toLowerCase() === "file"
        || /添加图片|提交图片|上传图片|选择图片|添加照片|上传照片/.test(text);
    }

    const seen = new Set();
    const buttons = [];
    for (const element of Array.from(document.querySelectorAll(".form-file-image-default, [role='button'], button, input[type='file']"))) {
      if (!looksLikeUploadButton(element)) {
        continue;
      }
      const label = fieldTextFor(element);
      const text = uploadButtonText(element);
      if (!/截图|图片|头像|照片|添加图片|提交图片|上传图片|选择图片|添加照片|上传照片/.test(`${label} ${text}`)) {
        continue;
      }
      if (seen.has(element)) {
        continue;
      }
      seen.add(element);
      buttons.push(element);
    }

    buttons.forEach((element, index) => {
      element.setAttribute("data-auto-upload-index", String(index));
    });

    return buttons.map((element, index) => ({
      index,
      selector: `[data-auto-upload-index="${index}"]`,
      label: fieldTextFor(element),
      buttonText: uploadButtonText(element),
      tagName: String(element.tagName || "").toLowerCase(),
      inputType: String(element.type || "").toLowerCase()
    }));
  });
}

async function uploadImages(page, answers, signal = null) {
  const uploads = await collectUploadFields(page);
  const uploaded = [];
  const skipped = [];

  for (const upload of uploads) {
    throwIfAborted(signal);
    const uploadText = [upload.label, upload.buttonText].filter(Boolean).join(" ");
    const imageKey = imageKeyForLabel(uploadText);
    const filePath = imageForLabel(uploadText, answers);
    const required = ["screenshot", "gradeScreenshot", "postScreenshot"].includes(imageKey);
    if (!filePath) {
      skipped.push({ index: upload.index + 1, label: upload.label || "图片题", reason: "配置里没有图片路径", required });
      continue;
    }

    const absolutePath = path.resolve(rootDir, filePath);
    if (!fs.existsSync(absolutePath)) {
      skipped.push({ index: upload.index + 1, label: upload.label, reason: `图片不存在: ${absolutePath}`, required });
      continue;
    }

    try {
      const uploadButton = page.locator(upload.selector).first();
      if (upload.tagName === "input" && upload.inputType === "file") {
        await uploadButton.setInputFiles(absolutePath);
      } else {
        const chooserPromise = page.waitForEvent("filechooser", { timeout: 6000 });
        await uploadButton.click({ timeout: 10000 });
        const chooser = await chooserPromise;
        await chooser.setFiles(absolutePath);
      }
      uploaded.push({ index: upload.index + 1, label: upload.label, file: absolutePath });
      await abortableWait(page, 2500, signal);
    } catch (error) {
      const inputFallback = page.locator("input[type='file']").nth(upload.index);
      if (await inputFallback.count().catch(() => 0)) {
        try {
          await inputFallback.setInputFiles(absolutePath);
          uploaded.push({ index: upload.index + 1, label: upload.label, file: absolutePath });
          await abortableWait(page, 2500, signal);
          continue;
        } catch (fallbackError) {
          skipped.push({ index: upload.index + 1, label: upload.label, reason: `上传失败: ${fallbackError.message}`, required });
          continue;
        }
      }
      skipped.push({ index: upload.index + 1, label: upload.label, reason: `上传失败: ${error.message}`, required });
    }
  }

  return { uploaded, skipped };
}

async function clickSubmitButton(page, log = console.log, signal = null) {
  throwIfAborted(signal);
  const buttons = page.locator("button, [role='button']").filter({ hasText: /^提交$/ });
  const count = await buttons.count().catch(() => 0);
  if (!count) {
    log("没有找到提交按钮，已停在提交前。");
    return false;
  }

  let clicked = false;
  for (let index = count - 1; index >= 0; index -= 1) {
    const button = buttons.nth(index);
    const visible = await button.isVisible().catch(() => false);
    const enabled = await button.isEnabled().catch(() => false);
    if (!visible || !enabled) {
      continue;
    }
    await button.click({ timeout: 10000 });
    clicked = true;
    break;
  }

  if (!clicked) {
    log("提交按钮当前不可点击，已停在提交前。");
    return false;
  }

  await abortableWait(page, 3000, signal);
  const bodyText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const stillHasSubmit = await page.locator("button, [role='button']").filter({ hasText: /^提交$/ }).count().catch(() => 0);
  const success = /提交成功|已提交|你已提交|感谢填写|提交完成|收集成功/.test(bodyText);
  if (success || !stillHasSubmit) {
    log(success ? "已自动提交，页面显示提交成功。" : "已自动提交。");
    return true;
  }

  log("已点击提交，但没有识别到成功提示，请在历史记录里检查截图。");
  return true;
}

async function maybeClickLogin(page) {
  const loginButton = page.getByText("登录腾讯文档", { exact: true });
  if ((await loginButton.count().catch(() => 0)) > 0) {
    await loginButton.click({ timeout: 5000 }).catch(() => {});
  }
}

async function detectTrackByOpeningForm(url, options = {}) {
  const config = readJson(configPath);
  const targetUrl = fillEntryUrl(String(url || "").trim());
  if (!isValidUrl(targetUrl)) {
    throw new Error("这不是腾讯文档表单链接。");
  }

  const browser = await chromium.launch({
    headless: options.visible !== true,
    args: ["--disable-blink-features=AutomationControlled"]
  });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 1200 },
    locale: "zh-CN"
  });
  const page = await context.newPage();

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(Math.max(1200, Number(options.waitMs || 3200)));
    const titleText = await page.title().catch(() => "");
    const bodyText = await page.locator("body").innerText({ timeout: 20000 }).catch(() => "");
    const pageText = uniqueCleanList([titleText, bodyText]).join(" ").slice(0, 4000);
    const detected = pickType(pageText, config);
    return {
      url: targetUrl,
      titleText,
      bodyText,
      pageText,
      typeName: detected.typeName || "",
      score: Number(detected.score || 0),
      source: detected.source || "none"
    };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

function isUsefulLoginCookie(cookie) {
  const name = String(cookie && cookie.name || "").toLowerCase();
  const value = String(cookie && cookie.value || "");
  if (!value || value === "0" || value.toLowerCase() === "deleted") {
    return false;
  }
  return /(uin|skey|sid|uid|ticket|token|login|qq|wx)/i.test(name);
}

async function checkTencentDocsLogin(page, context, log, signal = null) {
  log("正在检测腾讯文档登录状态...");
  await page.goto("https://docs.qq.com/desktop/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await abortableWait(page, 2200, signal);

  const pageState = await page.evaluate(() => {
    function clean(value) {
      return String(value || "").replace(/\s+/g, " ").trim();
    }

    function isVisible(element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity || 1) > 0
        && rect.width > 0
        && rect.height > 0;
    }

    const text = clean(document.body ? document.body.innerText || "" : "");
    const buttons = Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter(isVisible)
      .map((element) => clean(element.innerText || element.textContent || element.getAttribute("aria-label") || ""))
      .filter(Boolean);
    const loginPrompt = buttons.some((item) => /^(登录|登录\/注册|微信登录|QQ登录|手机号登录|扫码登录)$/.test(item))
      || /登录腾讯文档|登录后|扫码登录|微信登录|QQ登录|手机号登录|账号登录/.test(text);
    const workspaceSignal = /我的文档|最近使用|最近浏览|星标文档|与我共享|回收站|文档列表/.test(text)
      && /新建|导入|上传|所有者|更新时间|最近/.test(text);
    const accountMenuSignal = buttons.some((item) => /个人中心|账号设置|帐号设置|切换账号|退出登录/.test(item));
    const userSignal = Array.from(document.querySelectorAll("[class*='avatar'], [class*='user'], [class*='account'], img[alt*='头像']"))
      .some((element) => isVisible(element));

    return {
      url: location.href,
      title: document.title || "",
      preview: text.slice(0, 240),
      textLength: text.length,
      loginPrompt,
      workspaceSignal,
      accountMenuSignal,
      userSignal
    };
  });
  const cookies = await context.cookies([
    "https://docs.qq.com",
    "https://qq.com",
    "https://weixin.qq.com"
  ]).catch(() => []);
  const cookieSignals = cookies
    .filter(isUsefulLoginCookie)
    .map((cookie) => cookie.name)
    .filter((name, index, list) => list.indexOf(name) === index)
    .slice(0, 8);

  let status = "unknown";
  let loggedIn = false;
  let message = "暂时无法确认登录状态，请打开登录窗口确认一次";

  if (pageState.loginPrompt && !pageState.accountMenuSignal && !pageState.userSignal) {
    status = "not-logged-in";
    message = "未登录或登录已过期：页面出现登录入口";
  } else if (!pageState.loginPrompt && (pageState.workspaceSignal || pageState.accountMenuSignal)) {
    status = "logged-in";
    loggedIn = true;
    message = pageState.accountMenuSignal
      ? "已登录：页面出现账号入口"
      : "已登录：页面出现文档工作区";
  } else if (cookieSignals.length) {
    status = "unknown";
    message = "检测到登录痕迹，但页面没有明确显示已登录";
  }

  log(`检测结果：${message}`);
  return {
    loggedIn,
    status,
    message,
    checkedAt: new Date().toISOString(),
    pageTitle: pageState.title,
    pageUrl: pageState.url,
    preview: pageState.preview,
    signals: {
      loginPrompt: pageState.loginPrompt,
      workspaceSignal: pageState.workspaceSignal,
      accountMenuSignal: pageState.accountMenuSignal,
      userSignal: pageState.userSignal
    },
    cookieSignals
  };
}

async function runFromArgs(args = process.argv.slice(2), logger = console.log, options = {}) {
  const log = (message = "") => logger(String(message));
  const signal = options.signal || null;
  throwIfAborted(signal);
  ensureDir(outputDir);

  const config = readJson(configPath);
  const dryRun = args.includes("--dry-run");
  const loginOnly = args.includes("--login-only");
  const checkLogin = args.includes("--check-login");
  const background = args.includes("--background");
  const forceVisible = args.includes("--visible");
  const keepOpen = args.includes("--keep-open");
  const holdArg = args.find((arg) => arg.startsWith("--hold-ms="));
  const holdMs = holdArg ? Number(holdArg.split("=")[1]) || 0 : 0;
  const accountArg = args.find((arg) => arg.startsWith("--account="));
  const accountName = accountArg ? accountArg.split("=").slice(1).join("=").trim() : "";
  const douyinArg = args.find((arg) => arg.startsWith("--douyin-index="));
  const douyinIndex = douyinArg ? douyinArg.split("=").slice(1).join("=").trim() : "";
  const autoDouyin = args.includes("--auto-douyin");
  const expectedTrackArg = args.find((arg) => arg.startsWith("--expected-track="));
  const expectedTrack = expectedTrackArg ? expectedTrackArg.split("=").slice(1).join("=").trim() : "";
  const browserArg = args.find((arg) => arg.startsWith("--browser="));
  const browserName = (browserArg ? browserArg.split("=").slice(1).join("=").trim() : config.browser || "chromium").toLowerCase();
  const usingEdge = browserName === "edge" || browserName === "msedge";
  const edgeProfileArg = args.find((arg) => arg.startsWith("--edge-profile="));
  const edgeProfile = edgeProfileArg ? edgeProfileArg.split("=").slice(1).join("=").trim() : "";
  const profileArg = args.find((arg) => arg.startsWith("--profile-dir="));
  const profileDirName = profileArg
    ? profileArg.split("=").slice(1).join("=").trim()
    : accountName
      ? `${usingEdge ? ".qqdocs-edge-profile" : ".qqdocs-profile"}-${safeProfileName(accountName)}`
      : config.profileDir || ".qqdocs-profile";
  const shouldOpenVisible = forceVisible || loginOnly || (!checkLogin && !background && config.openVisibleBrowser !== false);
  const closeAfterFill = !keepOpen && (args.includes("--close-after-fill") || background || dryRun || holdMs > 0);
  let targetUrl = args.find((arg) => !arg.startsWith("--")) || "";
  if (!targetUrl && !loginOnly && !checkLogin) {
    targetUrl = await ask("请粘贴腾讯表单链接，然后回车：");
  }
  targetUrl = fillEntryUrl(targetUrl.trim());

  if (!loginOnly && !checkLogin && !isValidUrl(targetUrl)) {
    throw new Error("这不是腾讯文档表单链接。");
  }

  const profileDir = usingEdge && edgeProfile
    ? edgeUserDataDir()
    : path.resolve(dataDir, profileDirName);
  if (usingEdge && edgeProfile && !fs.existsSync(path.join(profileDir, edgeProfile))) {
    throw new Error(`没有找到 Edge 用户配置：${edgeProfile}`);
  }
  const launchOptions = {
    headless: !shouldOpenVisible,
    viewport: { width: 1360, height: 1200 },
    locale: "zh-CN",
    args: ["--disable-blink-features=AutomationControlled"]
  };

  if (usingEdge) {
    const edgePath = findEdgeExecutable();
    if (!edgePath) {
      throw new Error("没有找到 Microsoft Edge。");
    }
    launchOptions.executablePath = edgePath;
    if (edgeProfile) {
      launchOptions.args.push(`--profile-directory=${edgeProfile}`);
    }
  }

  let context;
  let onAbort;
  try {
    context = await chromium.launchPersistentContext(profileDir, launchOptions);
  } catch (error) {
    if (usingEdge && edgeProfile) {
      throw new Error(`Edge 用户配置正在被已打开的 Edge 占用。请先关闭所有 Edge 窗口，再重新运行。原始错误：${error.message.split("\n")[0]}`);
    }
    throw error;
  }
  if (signal) {
    onAbort = () => {
      if (context) {
        context.close().catch(() => {});
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    throwIfAborted(signal);
  }

  const page = context.pages()[0] || await context.newPage();
  try {
    log(`浏览器：${usingEdge ? "Microsoft Edge" : "Chromium"}`);
    if (edgeProfile) {
      log(`Edge 用户配置：${edgeProfile}`);
    }
    if (accountName) {
      log(`当前测试档案：${accountName}`);
    }

    if (checkLogin) {
      return await checkTencentDocsLogin(page, context, log, signal);
    }

    if (loginOnly) {
      log("正在打开腾讯文档登录窗口...");
      await page.goto("https://docs.qq.com/desktop/", { waitUntil: "domcontentloaded", timeout: 60000 });
      await abortableWait(page, 3000, signal);
      await maybeClickLogin(page);
      log("请在浏览器里完成登录。扫码、手机号、验证码都可以。登录完成后直接关闭浏览器窗口即可。");
      await abortableWait(page, 24 * 60 * 60 * 1000, signal).catch((error) => {
        if (signal && signal.aborted) {
          throw error;
        }
      });
      return;
    }

    log("正在打开表单...");
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (shouldOpenVisible && page.bringToFront) {
      await page.bringToFront().catch(() => {});
    }
    await abortableWait(page, 5000, signal);

    if (dryRun) {
      log("正在进行测试模式：验证字段识别、填值和图片上传，不提交。");
      await page.evaluate(() => {
        for (const textarea of document.querySelectorAll("textarea")) {
          textarea.disabled = false;
          textarea.readOnly = false;
          textarea.removeAttribute("disabled");
          textarea.removeAttribute("readonly");
        }
      });
    } else {
      await maybeClickLogin(page);
      await waitUntilEditable(page, log, signal, { background });
    }
    throwIfAborted(signal);

    const pageText = await page.locator("body").innerText({ timeout: 20000 });
    if (expectedTrack && scoreType(pageText, expectedTrack, config) < TRACK_MATCH_MIN_SCORE) {
      throw new Error(`已停止填写：无法在表单页面确认赛道「${expectedTrack}」`);
    }
    const account = getAccountData(accountName);
    const pickedDouyin = autoDouyin
      ? expectedTrack
        ? pickDouyinForExpectedTrack(account, expectedTrack, config)
        : pickDouyinForPage(pageText, account, config)
      : {
        douyin: getSelectedDouyin(account, douyinIndex),
        index: Number(douyinIndex),
        pickedType: null,
        tracks: []
      };
    const selectedDouyin = pickedDouyin.douyin;
    if (autoDouyin && !selectedDouyin) {
      throw new Error("没有找到可匹配的抖音号");
    }
    const selectedDouyinIndex = Number.isInteger(pickedDouyin.index) ? pickedDouyin.index : Number(douyinIndex);
    const candidateTracks = trackListForDouyin(selectedDouyin);
    const pickedType = expectedTrack && (!candidateTracks.length || candidateTracks.some((track) => trackMatches(expectedTrack, track, config)))
      ? { typeName: expectedTrack, score: 999, source: "provided" }
      : pickedDouyin.pickedType || pickType(pageText, config, candidateTracks);
    const typeName = pickedType.typeName;
    if (!typeName) {
      throw new Error("无法根据表单标题判断赛道，已停止填写");
    }
    const answers = mergeAccountAnswers(buildAnswers(config, typeName), account, selectedDouyin);
    log(`识别到赛道：${typeName}${pickedType.source === "keywords" ? `（匹配分 ${pickedType.score}）` : pickedType.source === "provided" ? "（表单标题）" : "（默认）"}`);
    if (selectedDouyin) {
      log(`使用抖音号：${selectedDouyin.nickname} / ${selectedDouyin.douyinId}${autoDouyin ? "（智能匹配）" : ""}`);
      if (candidateTracks.length > 1) {
        log(`可选赛道：${candidateTracks.join("、")}`);
      }
    }

    const textResult = await fillTextFields(page, answers);
    const imageResult = await uploadImages(page, answers, signal);
    throwIfAborted(signal);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = path.join(outputDir, `filled-${timestamp}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    log("");
    log("已填写的文本字段：");
    for (const item of textResult.filled) {
      log(`- ${item.index}. ${item.label} => ${item.value}`);
    }

    if (imageResult.uploaded.length) {
      log("");
      log("已上传的图片：");
      for (const item of imageResult.uploaded) {
        log(`- ${item.index}. ${item.label} => ${item.file}`);
      }
    }

    if (textResult.skipped.length || imageResult.skipped.length) {
      log("");
      log("跳过的字段：");
      for (const item of [...textResult.skipped, ...imageResult.skipped]) {
        log(`- ${item.index}. ${item.label}${item.reason ? `（${item.reason}）` : ""}`);
      }
    }

    log("");
    log(`已保存填写后截图：${screenshotPath}`);

    const blockingImageSkips = imageResult.skipped.filter((item) => item.required);
    if (blockingImageSkips.length) {
      throw new Error(`截图未上传：${blockingImageSkips.map((item) => item.reason || item.label || "上传失败").join("；")}`);
    }

    let submitted = false;
    if (config.autoSubmit && !dryRun) {
      submitted = await clickSubmitButton(page, log, signal);
    } else {
      log(dryRun
        ? "测试已停在提交前，不会自动提交。你可以检查文字和图片是否正确。"
        : background ? "已填写完成并保存截图，记录为待提交。" : "已停在提交前。确认无误后你可以手动提交。");
    }

    if (closeAfterFill) {
      const waitMs = background ? Math.min(Math.max(holdMs || 1000, 500), 3000) : holdMs || 2000;
      log(background ? "后台填表完成，浏览器会自动关闭。" : `测试完成，浏览器会停留 ${Math.round(waitMs / 1000)} 秒后关闭。`);
      await abortableWait(page, waitMs, signal).catch((error) => {
        if (signal && signal.aborted) {
          throw error;
        }
      });
    } else {
      log("浏览器会保持打开，方便你检查。关闭窗口即可结束。");
      await abortableWait(page, 24 * 60 * 60 * 1000, signal).catch((error) => {
        if (signal && signal.aborted) {
          throw error;
        }
      });
    }

    return {
      screenshotPath,
      submitted,
      typeName,
      douyinIndex: Number.isInteger(selectedDouyinIndex) ? selectedDouyinIndex : "",
      douyinLabel: selectedDouyin ? `${selectedDouyin.nickname || "未命名"} / ${selectedDouyin.douyinId || "无ID"} / ${typeName || "未分类"}` : "",
      filledCount: textResult.filled.length,
      skippedCount: textResult.skipped.length + imageResult.skipped.length
    };
  } finally {
    if (signal && onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
    await context.close().catch(() => {});
  }
}

if (require.main === module) {
  runFromArgs().catch((error) => {
    console.error("");
    console.error(`自动填表失败：${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runFromArgs,
  detectTrackByOpeningForm,
  _internal: {
    pickType,
    scoreType,
    trackListForDouyin
  }
};
