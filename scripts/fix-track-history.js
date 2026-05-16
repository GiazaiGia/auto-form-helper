const fs = require("fs");
const path = require("path");

const dataDir = path.join(process.env.APPDATA, "wechat-order-form-helper", "data");
const historyPath = path.join(dataDir, "history.json");
const accountsPath = path.join(dataDir, "config", "accounts.json");
const answersPath = path.join(dataDir, "config", "answers.json");
const backupPath = path.join(dataDir, `history.backup-track-fix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const TRACK_MATCH_MIN_SCORE = 8;

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function compact(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[\s"'“”‘’《》【】（）()，,。.;；：:_\-/|]+/g, "");
}

function unique(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const text = String(value || "").trim();
    if (text && !seen.has(text)) {
      seen.add(text);
      result.push(text);
    }
  }
  return result;
}

function normalizeUrl(value) {
  const match = String(value || "").match(/(?:https?:\/\/)?docs\.qq\.com\/form\/page\/([A-Za-z0-9_-]+)/i);
  return match ? `https://docs.qq.com/form/page/${match[1]}` : String(value || "").trim();
}

function tracksForDouyin(douyin) {
  return unique([
    ...(Array.isArray(douyin && douyin.tracks) ? douyin.tracks : []),
    douyin && douyin.contentType
  ]);
}

function implicitKeywords(track) {
  const text = compact(track);
  if (/冰雪|frozen/.test(text)) {
    return ["冰雪奇缘", "冰雪", "冰雪女王", "雪女王", "艾莎", "安娜", "frozen", "letitgo"];
  }
  if (/奥特/.test(text)) {
    return ["奥特曼", "奥特", "迪迦", "赛罗", "泰罗", "怪兽", "光之巨人", "宇宙英雄", "特摄"];
  }
  if (/西游/.test(text)) {
    return ["西游记", "西游", "西海记", "大王叫我来巡山", "巡山", "悟空", "孙悟空", "齐天", "齐天大圣", "大圣", "金箍棒", "唐僧", "八戒", "猪八戒", "沙僧"];
  }
  if (/汪汪|pawpatrol/.test(text)) {
    return ["汪汪队", "汪汪", "阿奇", "毛毛", "天天", "灰灰", "小砾", "路马", "莱德", "pawpatrol"];
  }
  if (/红楼/.test(text)) {
    return ["红楼梦", "红楼", "宝玉", "黛玉", "林黛玉", "贾宝玉", "宝钗", "薛宝钗", "大观园"];
  }
  return [];
}

function bigrams(value) {
  const text = compact(value);
  const result = [];
  for (let index = 0; index < text.length - 1; index += 1) {
    result.push(text.slice(index, index + 2));
  }
  return result;
}

function scoreTrack(text, track, answers) {
  const body = compact(text);
  if (!body || !track) {
    return 0;
  }
  const custom = answers.typeKeywords && answers.typeKeywords[track] || [];
  let score = 0;
  for (const keyword of unique([track, ...implicitKeywords(track), ...custom])) {
    const key = compact(keyword);
    if (!key) {
      continue;
    }
    if (body.includes(key)) {
      score += key.length === 1 ? 3 : 8 + key.length;
      continue;
    }
    const parts = bigrams(key);
    if (parts.length) {
      const matched = parts.filter((part) => body.includes(part)).length;
      const ratio = matched / parts.length;
      if (ratio >= 0.65) {
        score += Math.round(ratio * Math.min(8, key.length));
      }
    }
  }
  return score;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_all, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_all, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match ? match[2] : "";
}

function extractMeta(html) {
  const parts = [];
  const title = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) {
    parts.push(title[1]);
  }
  for (const match of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (attr(tag, "property") || attr(tag, "name")).toLowerCase();
    if (["og:title", "og:description", "description", "keywords"].includes(key)) {
      parts.push(attr(tag, "content"));
    }
  }
  return unique(parts.map(decodeHtml)).join(" ");
}

async function fetchTitle(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: controller.signal,
      redirect: "follow"
    });
    return extractMeta(await response.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

function guessTrack(text, tracks, answers) {
  const ranked = tracks
    .map((track) => ({ track, score: scoreTrack(text, track, answers) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0] && ranked[0].score >= TRACK_MATCH_MIN_SCORE ? ranked[0] : { track: "", score: 0 };
}

async function main() {
  const history = readJson(historyPath, { items: [] });
  const accounts = readJson(accountsPath, { accounts: [] });
  const answers = readJson(answersPath, {});
  const tracks = unique([
    ...(Array.isArray(answers.tracks) ? answers.tracks : []),
    ...Object.keys(answers.typeKeywords || {}),
    ...(accounts.accounts || []).flatMap((account) => (account.douyinAccounts || []).flatMap(tracksForDouyin))
  ]);

  fs.copyFileSync(historyPath, backupPath);

  const urls = unique(
    history.items
      .filter((item) => item && item.url && item.channel !== "manual")
      .map((item) => normalizeUrl(item.url))
  ).slice(0, 260);
  const titleByUrl = new Map();
  for (let index = 0; index < urls.length; index += 5) {
    const batch = urls.slice(index, index + 5);
    const titles = await Promise.all(batch.map(fetchTitle));
    batch.forEach((url, titleIndex) => titleByUrl.set(url, titles[titleIndex] || ""));
  }

  let corrected = 0;
  let invalidated = 0;
  for (const item of history.items) {
    if (!item || !item.url || item.channel === "manual") {
      continue;
    }
    const title = titleByUrl.get(normalizeUrl(item.url)) || "";
    const guessed = guessTrack(title, tracks, answers);
    if (!guessed.track) {
      continue;
    }
    const oldTrack = String(item.expectedTrack || "").trim();
    if (!oldTrack) {
      item.expectedTrack = guessed.track;
      item.trackScore = guessed.score;
      item.message = `已根据表单标题识别赛道：${guessed.track}`;
      corrected += 1;
      continue;
    }
    if (oldTrack !== guessed.track) {
      item.expectedTrack = guessed.track;
      item.trackScore = guessed.score;
      item.message = `旧赛道误判记录已作废；表单标题识别为：${guessed.track}`;
      item.jobId = "";
      if (item.account) {
        item.status = "不可填写";
        item.douyinLabel = "旧赛道误判记录";
        invalidated += 1;
      } else {
        item.status = "待填写";
        corrected += 1;
      }
    }
  }

  writeJson(historyPath, history);
  console.log(JSON.stringify({ backupPath, checkedUrls: urls.length, corrected, invalidated }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
