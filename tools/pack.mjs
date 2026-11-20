#!/usr/bin/env node
/* Đóng gói DF Code Garena. Không cần cài thêm gì, chỉ cần Node 18 trở lên.
 *
 *   node tools/pack.mjs           Đồng bộ demo-codes.js, ghi SHA256SUMS, rà soát mã, tạo dist/df-code-garena-<phiên bản>.zip
 *   node tools/pack.mjs --check   Chỉ kiểm tra: báo lỗi nếu demo-codes.js hay SHA256SUMS chưa khớp, hoặc rà soát không qua
 *
 * File zip không nén và có giờ cố định, nên cùng mã nguồn luôn ra cùng một hash.
 * Ai cũng có thể tự chạy lệnh này rồi so hash với file trên trang Releases.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const FOLDER = "df-code-garena";

/* Các file tiện ích thật sự chạy. SHA256SUMS khóa đúng danh sách này. */
export const RUNTIME = [
  "manifest.json",
  "sw.js",
  "inject.js",
  "parser.js",
  "runner.js",
  "popup.js",
  "popup.html",
  "popup.css",
  "demo-codes.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];
const EXTRA_IN_ZIP = ["SHA256SUMS", "HUONG-DAN.txt"];

const ALLOWED_URLS = [
  /^https:\/\/redeem\.df\.garena\.sg\/(?:\*\/)?cdkgarena\.html\*?$/,
  /^https:\/\/redeem\.df\.garena\.sg\/vi\/cdkgarena\.html$/,
  /^https:\/\/github\.com\/toilabaothien19-web\/redeem\.df\.garena$/,
];

/* Mẫu không được xuất hiện trong mã tiện ích, và nơi duy nhất được phép (nếu có). */
const FORBIDDEN = [
  { re: /document\.cookie/, why: "đọc cookie" },
  { re: /chrome\.cookies/, why: "quyền cookies" },
  { re: /sendBeacon/, why: "gửi dữ liệu ngầm" },
  { re: /\bWebSocket\b/, why: "kết nối WebSocket" },
  { re: /\bEventSource\b/, why: "kết nối EventSource" },
  { re: /\beval\s*\(/, why: "eval" },
  { re: /new\s+Function\s*\(/, why: "new Function" },
  { re: /gtag|google-analytics|googletagmanager|facebook\.net|hotjar|sentry/i, why: "trình theo dõi" },
  { re: /\bimportScripts\s*\(/, why: "nạp script", allow: ["sw.js"] },
  { re: /XMLHttpRequest/, why: "bọc XHR", allow: ["inject.js"] },
  { re: /\bfetch\b/, why: "bọc fetch", allow: ["inject.js"] },
  { re: /\.innerHTML\s*=|insertAdjacentHTML|document\.write/, why: "chèn HTML" },
  /* Ký tự vô hình hoặc đảo chiều chữ có thể giấu mã khỏi mắt người đọc. Trong mã phải viết dạng \uXXXX. */
  { re: /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\uFE00-\uFE0F]/, why: "ký tự vô hình hoặc đảo chiều chữ" },
];

const read = (rel) => readFileSync(join(ROOT, rel));
const readText = (rel) => readFileSync(join(ROOT, rel), "utf8");
const readOptional = (rel) => (existsSync(join(ROOT, rel)) ? readText(rel) : "");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const problems = [];
const fail = (msg) => problems.push(msg);

/* ---------- Demo Code ---------- */

export function demoSource(text) {
  const codes = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((line, i) => {
    const code = line.trim();
    if (!code || code.startsWith("#")) return;
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(code)) fail(`demo-codes.txt dòng ${i + 1}: "${code}" không phải code hợp lệ`);
    else if (seen.has(code)) fail(`demo-codes.txt dòng ${i + 1}: "${code}" bị trùng`);
    else {
      seen.add(code);
      codes.push(code);
    }
  });
  return (
    "/* Demo Code — danh sách mẫu, có thể đã hết hạn. Mỗi code sai là một lần thử trên tài khoản.\n" +
    " * File này được tạo từ demo-codes.txt bằng lệnh: node tools/pack.mjs. Đừng sửa tay. */\n" +
    "window.DFDemoCodes = Object.freeze([\n" +
    codes.map((c) => `  "${c}",\n`).join("") +
    "]);\n"
  );
}

/* ---------- Rà soát ---------- */

function audit() {
  const manifest = JSON.parse(readText("manifest.json"));
  const perms = [...(manifest.permissions || [])].sort().join(",");
  if (perms !== "activeTab,storage") fail(`manifest: quyền phải đúng storage + activeTab, đang là ${perms}`);
  for (const key of ["host_permissions", "optional_permissions", "optional_host_permissions", "externally_connectable", "web_accessible_resources"]) {
    if (manifest[key]) fail(`manifest: không được có ${key}`);
  }
  const csp = (manifest.content_security_policy || {}).extension_pages || "";
  if (!/connect-src 'none'/.test(csp)) fail("manifest: CSP phải có connect-src 'none'");
  for (const cs of manifest.content_scripts || []) {
    for (const m of cs.matches || []) {
      if (!/^https:\/\/redeem\.df\.garena\.sg\//.test(m) || !/cdkgarena\.html\*$/.test(m)) fail(`manifest: content script khớp trang lạ ${m}`);
    }
    if (cs.all_frames) fail("manifest: content script không được chạy trong mọi frame");
    for (const f of cs.js || []) if (!existsSync(join(ROOT, f))) fail(`manifest: thiếu file ${f}`);
  }
  const html = readText("popup.html");
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^[a-z]+:/i.test(m[1])) fail(`popup.html: tài nguyên ngoài ${m[1]}`);
    else if (!existsSync(join(ROOT, m[1]))) fail(`popup.html: thiếu file ${m[1]}`);
    else if (/\.js$/.test(m[1]) && !RUNTIME.includes(m[1])) fail(`popup.html: ${m[1]} chưa có trong SHA256SUMS`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) fail("popup.html: không được có script viết trực tiếp trong trang");

  for (const rel of RUNTIME) {
    if (!/\.(?:js|html|json|css)$/.test(rel)) continue;
    const text = readText(rel);
    for (const rule of FORBIDDEN) {
      if (rule.re.test(text) && !(rule.allow || []).includes(rel)) fail(`${rel}: có ${rule.why} (${rule.re})`);
    }
    for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>]+/g)) {
      const url = m[0].replace(/[.,;]+$/, "");
      if (!ALLOWED_URLS.some((re) => re.test(url))) fail(`${rel}: địa chỉ lạ ${url}`);
    }
  }
  return manifest;
}

function checkVersion(version) {
  const readme = readOptional("README.md");
  if (!readme.includes(`**${version}**`)) fail(`README.md: chưa ghi phiên bản **${version}**`);
  if (!readme.includes(`df-code-garena-${version}.zip`)) fail(`README.md: chưa ghi tên file df-code-garena-${version}.zip`);
  const changelog = readOptional("CHANGELOG.md");
  if (!new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m").test(changelog)) fail(`CHANGELOG.md: thiếu mục ## ${version}`);
}

function changelogSection(version) {
  const text = readOptional("CHANGELOG.md");
  const start = text.search(new RegExp(`^## ${version.replace(/\./g, "\\.")}\\b`, "m"));
  if (start === -1) return "";
  const rest = text.slice(start);
  const next = rest.slice(3).search(/^## /m);
  return (next === -1 ? rest : rest.slice(0, next + 3)).trim();
}

/* ---------- Zip không nén, có thể tái tạo ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* 2026-01-01 00:00:00 theo định dạng giờ DOS. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const isDir = name.endsWith("/");
    const body = isDir ? Buffer.alloc(0) : data;
    const nameBuf = Buffer.from(name, "utf8");
    const crc = isDir ? 0 : crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(isDir ? 20 : 10, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(isDir ? 20 : 10, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(body.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((((isDir ? 0o040755 : 0o100644) << 16) | (isDir ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, end]);
}

/* ---------- Chạy ---------- */

function main() {
  const demo = demoSource(readText("demo-codes.txt"));
  const demoCurrent = readOptional("demo-codes.js");
  if (demoCurrent !== demo) {
    if (CHECK) fail("demo-codes.js chưa khớp demo-codes.txt. Chạy: node tools/pack.mjs");
    else writeFileSync(join(ROOT, "demo-codes.js"), demo);
  }

  const manifest = audit();
  const version = manifest.version;
  checkVersion(version);

  const sums = RUNTIME.map((rel) => `${sha256(read(rel))}  ${rel}\n`).join("");
  const sumsCurrent = readOptional("SHA256SUMS");
  if (sumsCurrent !== sums) {
    if (CHECK) fail("SHA256SUMS chưa khớp mã hiện tại. Chạy: node tools/pack.mjs");
    else writeFileSync(join(ROOT, "SHA256SUMS"), sums);
  }

  if (problems.length) {
    console.error("Chưa đạt:\n" + problems.map((p) => "  - " + p).join("\n"));
    process.exit(1);
  }
  if (CHECK) {
    console.log(`OK: phiên bản ${version}, ${RUNTIME.length} file tiện ích, demo-codes.js và SHA256SUMS khớp, rà soát đạt.`);
    return;
  }

  const files = [...RUNTIME, ...EXTRA_IN_ZIP].sort();
  const entries = [{ name: `${FOLDER}/` }, { name: `${FOLDER}/icons/` }];
  for (const rel of files) entries.push({ name: `${FOLDER}/${rel}`, data: read(rel) });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const zip = makeZip(entries);
  const zipName = `${FOLDER}-${version}.zip`;
  const dist = join(ROOT, "dist");
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, zipName), zip);
  const zipHash = sha256(zip);
  writeFileSync(join(dist, `${zipName}.sha256`), `${zipHash}  ${zipName}\n`);
  writeFileSync(
    join(dist, "RELEASE.md"),
    [
      changelogSection(version),
      "",
      "### Đối chiếu",
      "",
      "SHA-256 của file zip:",
      "",
      "```",
      `${zipHash}  ${zipName}`,
      "```",
      "",
      "SHA256SUMS bên trong thư mục `df-code-garena`:",
      "",
      "```",
      sums.trim(),
      "```",
      "",
      "Tự tạo lại file zip từ mã nguồn ở đúng tag này: `node tools/pack.mjs`. Hash phải giống hệt.",
      "",
    ].join("\n"),
  );
  console.log(`Đã tạo dist/${zipName} (${zip.length} byte)\nSHA-256: ${zipHash}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
