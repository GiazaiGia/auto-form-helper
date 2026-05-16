const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const XLSX = require("xlsx");

const PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MEDIA_EXTENSIONS = new Map([
  [".mp4", "video"],
  [".mov", "video"],
  [".m4v", "video"],
  [".avi", "video"],
  [".mkv", "video"],
  [".webm", "video"],
  [".wmv", "video"],
  [".jpg", "image"],
  [".jpeg", "image"],
  [".png", "image"],
  [".webp", "image"],
  [".gif", "image"],
  [".bmp", "image"],
  [".mp3", "audio"],
  [".wav", "audio"],
  [".m4a", "audio"],
  [".aac", "audio"],
  [".flac", "audio"],
  [".ogg", "audio"]
]);

function assertDirectory(dirPath, label) {
  if (!dirPath || !fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    throw new Error(`${label}不是有效文件夹`);
  }
}

function assertFile(filePath, label) {
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    throw new Error(`${label}不是有效文件`);
  }
}

function stripBom(text) {
  return String(text || "").replace(/^\uFEFF/, "");
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  const source = stripBom(text);

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (quoted) {
      if (char === "\"" && next === "\"") {
        value += "\"";
        index += 1;
      } else if (char === "\"") {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === "\"") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value.replace(/\r$/, ""));
  if (row.some((cell) => String(cell).trim() !== "")) {
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers = rows[0].map((header, index) => String(header || `列${index + 1}`).trim());
  return rows.slice(1)
    .map((cells) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header] = cells[index] === undefined ? "" : String(cells[index]);
      });
      return item;
    })
    .filter((item) => Object.values(item).some((cell) => String(cell).trim() !== ""));
}

function normalizeTaskRows(rows) {
  return rows
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const item = {};
      for (const [key, value] of Object.entries(row)) {
        const name = String(key || "").trim();
        if (!name) {
          continue;
        }
        item[name] = value === undefined || value === null ? "" : String(value);
      }
      return item;
    })
    .filter((item) => Object.keys(item).length);
}

function loadTasks(taskFile) {
  assertFile(taskFile, "任务单");
  const ext = path.extname(taskFile).toLowerCase();

  if (ext === ".csv" || ext === ".tsv") {
    const text = fs.readFileSync(taskFile, "utf8");
    return parseDelimited(text, ext === ".tsv" ? "\t" : ",");
  }

  if (ext === ".json") {
    const data = JSON.parse(fs.readFileSync(taskFile, "utf8"));
    if (Array.isArray(data)) {
      return normalizeTaskRows(data);
    }
    for (const key of ["rows", "tasks", "items", "data"]) {
      if (Array.isArray(data[key])) {
        return normalizeTaskRows(data[key]);
      }
    }
    throw new Error("JSON任务单需要是数组，或包含 rows/tasks/items/data 数组");
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.readFile(taskFile, { cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return [];
    }
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
      raw: false
    });
    return normalizeTaskRows(rows);
  }

  throw new Error("任务单目前支持 Excel、CSV、TSV、JSON");
}

function columnsFromRows(rows) {
  const columns = new Set();
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => columns.add(key));
  });
  return Array.from(columns);
}

function walkFiles(rootDir, accept) {
  const result = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (!accept || accept(fullPath)) {
        result.push(fullPath);
      }
    }
  }
  return result.sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
}

function copyDirectory(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(source, target);
    } else if (entry.isFile()) {
      fs.copyFileSync(source, target);
    }
  }
}

function extensionFromValue(value) {
  const clean = String(value || "").split("?")[0].split("#")[0].trim();
  return path.extname(clean).toLowerCase();
}

function mediaTypeForPath(filePath) {
  return MEDIA_EXTENSIONS.get(extensionFromValue(filePath)) || "";
}

function isMediaPath(value) {
  return Boolean(mediaTypeForPath(value));
}

function looksLikePathKey(key) {
  return /(path|file|uri|url|source|src)/i.test(String(key || ""));
}

function collectTemplateInfo(node, info, filePath, pointer = "", key = "") {
  if (typeof node === "string") {
    for (const match of node.matchAll(PLACEHOLDER_RE)) {
      info.placeholders.add(match[1].trim());
    }
    if (looksLikePathKey(key) && isMediaPath(node)) {
      info.mediaSlots.push({
        file: path.basename(filePath),
        key,
        value: node,
        type: mediaTypeForPath(node),
        pointer
      });
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => collectTemplateInfo(item, info, filePath, `${pointer}/${index}`, key));
    return;
  }

  if (node && typeof node === "object") {
    Object.entries(node).forEach(([childKey, value]) => {
      collectTemplateInfo(value, info, filePath, `${pointer}/${childKey}`, childKey);
    });
  }
}

function inspectTemplate(templateDir) {
  assertDirectory(templateDir, "模板草稿");
  const jsonFiles = walkFiles(templateDir, (filePath) => path.extname(filePath).toLowerCase() === ".json");
  const info = {
    templateDir,
    jsonFileCount: jsonFiles.length,
    placeholders: new Set(),
    mediaSlots: []
  };

  for (const filePath of jsonFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      collectTemplateInfo(data, info, filePath);
    } catch (error) {
      // Some draft-side cache files are not strict JSON. They are simply ignored.
    }
  }

  const uniqueMedia = new Map();
  for (const slot of info.mediaSlots) {
    const key = `${slot.type}|${slot.value}`;
    if (!uniqueMedia.has(key)) {
      uniqueMedia.set(key, slot);
    }
  }

  return {
    templateDir,
    jsonFileCount: info.jsonFileCount,
    placeholders: Array.from(info.placeholders).sort((a, b) => a.localeCompare(b, "zh-CN")),
    mediaSlotCount: uniqueMedia.size,
    mediaSlots: Array.from(uniqueMedia.values()).slice(0, 30)
  };
}

function safeFileName(value, fallback = "draft") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

function buildRowContext(row, index) {
  const number = index + 1;
  return {
    ...row,
    序号: String(number).padStart(3, "0"),
    编号: String(number),
    index: String(number)
  };
}

function replacePlaceholders(text, context, missing) {
  return String(text || "").replace(PLACEHOLDER_RE, (full, rawName) => {
    const name = String(rawName || "").trim();
    if (Object.prototype.hasOwnProperty.call(context, name)) {
      return context[name];
    }
    if (missing) {
      missing.add(name);
    }
    return full;
  });
}

function draftNameForRow(row, index, pattern) {
  const context = buildRowContext(row, index);
  const defaultName = row.标题 || row.title || row.名称 || row.name || `草稿${index + 1}`;
  const rawName = pattern ? replacePlaceholders(pattern, context) : `${context.序号}_${defaultName}`;
  return safeFileName(rawName, `草稿${index + 1}`);
}

function uniqueDir(baseDir) {
  if (!fs.existsSync(baseDir)) {
    return baseDir;
  }
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${baseDir}_${index}`;
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(`输出文件夹已存在太多同名草稿：${baseDir}`);
}

function formatPathLike(original, targetPath) {
  const resolved = path.resolve(targetPath);
  if (String(original).includes("\\") && !String(original).includes("/")) {
    return resolved;
  }
  return resolved.replace(/\\/g, "/");
}

function listMaterialFiles(materialDir, allowedTypes) {
  if (!materialDir || !fs.existsSync(materialDir) || !fs.statSync(materialDir).isDirectory()) {
    return [];
  }
  return walkFiles(materialDir, (filePath) => {
    const type = mediaTypeForPath(filePath);
    return type && allowedTypes.has(type);
  });
}

function pickMaterialFolder(row, draftName, options) {
  const root = String(options.materialRoot || "").trim();
  const column = String(options.materialColumn || "").trim();
  if (!root && !column) {
    return "";
  }

  if (column && row[column]) {
    const value = String(row[column]).trim();
    if (!value) {
      return "";
    }
    return path.isAbsolute(value) ? value : path.join(root || path.dirname(options.taskFile), value);
  }

  if (!root) {
    return "";
  }

  const direct = path.join(root, draftName);
  if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) {
    return direct;
  }
  return root;
}

function shouldReplaceMediaString(key, value, allowedTypes) {
  if (!looksLikePathKey(key)) {
    return false;
  }
  const type = mediaTypeForPath(value);
  return type && allowedTypes.has(type);
}

function replaceMediaPath(original, mediaState) {
  const normalized = String(original || "").replace(/\\/g, "/").toLowerCase();
  if (mediaState.assigned.has(normalized)) {
    return formatPathLike(original, mediaState.assigned.get(normalized));
  }
  if (mediaState.nextIndex >= mediaState.files.length) {
    mediaState.unmatched += 1;
    return original;
  }
  const nextFile = mediaState.files[mediaState.nextIndex];
  mediaState.nextIndex += 1;
  mediaState.assigned.set(normalized, nextFile);
  mediaState.replaced += 1;
  return formatPathLike(original, nextFile);
}

function transformJson(node, context, options, mediaState, missing, key = "") {
  if (typeof node === "string") {
    let next = replacePlaceholders(node, context, missing);
    if (options.replaceMaterials && shouldReplaceMediaString(key, next, options.allowedTypes)) {
      next = replaceMediaPath(next, mediaState);
    }
    return next;
  }

  if (Array.isArray(node)) {
    return node.map((item) => transformJson(item, context, options, mediaState, missing, key));
  }

  if (node && typeof node === "object") {
    const next = {};
    for (const [childKey, value] of Object.entries(node)) {
      next[childKey] = transformJson(value, context, options, mediaState, missing, childKey);
    }
    return next;
  }

  return node;
}

function newDraftId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID().toUpperCase();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const value = Math.random() * 16 | 0;
    return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
  }).toUpperCase();
}

function nowMicroseconds() {
  return Date.now() * 1000;
}

function patchDraftInfo(data, draftName, draftDir, fileName) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return data;
  }
  const next = { ...data };
  const lowerName = String(fileName || "").toLowerCase();

  for (const key of ["draft_name", "draftName", "name", "title"]) {
    if (Object.prototype.hasOwnProperty.call(next, key) && typeof next[key] === "string") {
      next[key] = draftName;
    }
  }

  if (Object.prototype.hasOwnProperty.call(next, "draft_fold_path")) {
    next.draft_fold_path = formatPathLike(next.draft_fold_path || "", draftDir);
  }
  if (Object.prototype.hasOwnProperty.call(next, "draft_root_path")) {
    next.draft_root_path = formatPathLike(next.draft_root_path || "", path.dirname(draftDir));
  }
  for (const key of ["draft_dir", "project_path"]) {
    if (Object.prototype.hasOwnProperty.call(next, key)) {
      next[key] = formatPathLike(next[key] || "", draftDir);
    }
  }

  if (lowerName === "draft_meta_info.json" && Object.prototype.hasOwnProperty.call(next, "draft_id")) {
    next.draft_id = newDraftId();
  }
  if (lowerName === "draft_content.json" && Object.prototype.hasOwnProperty.call(next, "id")) {
    next.id = newDraftId().toLowerCase();
  }

  const now = nowMicroseconds();
  for (const key of ["tm_draft_create", "tm_draft_modified", "create_time", "update_time"]) {
    if (Object.prototype.hasOwnProperty.call(next, key) && typeof next[key] === "number") {
      next[key] = now;
    }
  }

  return next;
}

function generateDrafts(rawOptions, log = () => {}) {
  const options = {
    templateDir: String(rawOptions.templateDir || "").trim(),
    taskFile: String(rawOptions.taskFile || "").trim(),
    outputDir: String(rawOptions.outputDir || "").trim(),
    materialRoot: String(rawOptions.materialRoot || "").trim(),
    materialColumn: String(rawOptions.materialColumn || "").trim(),
    namePattern: String(rawOptions.namePattern || "{{序号}}_{{标题}}").trim(),
    replaceMaterials: rawOptions.replaceMaterials !== false,
    allowedTypes: new Set(rawOptions.allowedTypes || ["video", "image"])
  };

  assertDirectory(options.templateDir, "模板草稿");
  assertFile(options.taskFile, "任务单");
  if (!options.outputDir) {
    throw new Error("请选择输出文件夹");
  }
  fs.mkdirSync(options.outputDir, { recursive: true });

  const rows = loadTasks(options.taskFile);
  if (!rows.length) {
    throw new Error("任务单里没有可生成的记录");
  }

  const jsonFiles = walkFiles(options.templateDir, (filePath) => path.extname(filePath).toLowerCase() === ".json");
  log(`读取到 ${rows.length} 条任务，模板里有 ${jsonFiles.length} 个草稿数据文件`);

  const results = [];
  rows.forEach((row, index) => {
    const draftName = draftNameForRow(row, index, options.namePattern);
    const draftDir = uniqueDir(path.join(options.outputDir, draftName));
    const context = buildRowContext(row, index);
    const materialDir = pickMaterialFolder(row, draftName, { ...options, taskFile: options.taskFile });
    const mediaFiles = listMaterialFiles(materialDir, options.allowedTypes);
    const mediaState = {
      files: mediaFiles,
      assigned: new Map(),
      nextIndex: 0,
      replaced: 0,
      unmatched: 0
    };
    const missing = new Set();

    copyDirectory(options.templateDir, draftDir);

    const copiedJsonFiles = walkFiles(draftDir, (filePath) => path.extname(filePath).toLowerCase() === ".json");
    for (const filePath of copiedJsonFiles) {
      let data;
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (error) {
        continue;
      }
      let next = transformJson(data, context, options, mediaState, missing);
      const baseName = path.basename(filePath).toLowerCase();
      if (["draft_info.json", "draft_meta_info.json", "draft_content.json"].includes(baseName)) {
        next = patchDraftInfo(next, draftName, draftDir, baseName);
      }
      fs.writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    }

    const result = {
      draftName,
      draftDir,
      materialDir,
      materialFileCount: mediaFiles.length,
      replacedMaterialCount: mediaState.replaced,
      missingPlaceholders: Array.from(missing)
    };
    results.push(result);

    const missingText = result.missingPlaceholders.length
      ? `；未匹配字段：${result.missingPlaceholders.join("、")}`
      : "";
    const materialText = options.replaceMaterials
      ? `；替换素材 ${result.replacedMaterialCount}/${result.materialFileCount}`
      : "";
    log(`已生成：${draftName}${materialText}${missingText}`);
  });

  return {
    count: results.length,
    outputDir: options.outputDir,
    results
  };
}

function previewBatch(options) {
  const rows = loadTasks(String(options.taskFile || "").trim());
  const template = inspectTemplate(String(options.templateDir || "").trim());
  return {
    rowCount: rows.length,
    columns: columnsFromRows(rows),
    firstRow: rows[0] || {},
    template
  };
}

module.exports = {
  generateDrafts,
  inspectTemplate,
  loadTasks,
  previewBatch
};
