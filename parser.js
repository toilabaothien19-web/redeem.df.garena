/* DF Code Garena — logic dùng chung.
 *
 * Đọc danh sách code, tính nhịp nghỉ và hạn mức, đọc kết quả trang trả về, ghi và đọc file log.
 * File này không đụng tới DOM, mạng hay chrome.*. Popup, trang đổi code, service worker
 * và bộ test Node đều nạp đúng một bản này.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DFParse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- Hằng số ---------- */

  const REDEEM_HOST = "redeem.df.garena.sg";
  const REDEEM_PAGE = "https://redeem.df.garena.sg/vi/cdkgarena.html";
  const REDEEM_PATH = /^\/(?:[^/]+\/)?cdkgarena\.html$/i;

  const KEYS = Object.freeze({
    draft: "dfcode.draft",
    gap: "dfcode.gap",
    random: "dfcode.random",
    skipLogged: "dfcode.skipLogged",
    protect: "dfcode.protect",
    log: "dfcode.log",
    meta: "dfcode.meta",
    run: "dfcode.run",
    attempts: "dfcode.attempts",
    stop: "dfcode.stop",
  });
  /* Khóa của bản cũ, xóa khi gặp. */
  const LEGACY_KEYS = Object.freeze(["dfcode.restUntil", "dfcode.skipOk"]);

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const LIMITS = Object.freeze({
    maxCodes: 1000,
    maxText: 200000,
    maxFileBytes: 200 * 1024,
    logCap: 2000,
    detailCap: 500,
    /* Phiên "đang chạy" không cập nhật quá lâu thì coi như đã chết (tab đóng, trình duyệt tắt). */
    staleMs: 150 * SECOND,
    heartbeatMs: 10 * SECOND,
    /* Thời gian ước lượng trang trả lời mỗi code, chỉ dùng để ước tính. */
    replySec: 3,
    pageTimeoutMs: 20 * SECOND,
  });

  const PROFILES = Object.freeze({
    /* Bảo vệ tài khoản: bật mặc định. */
    safe: Object.freeze({
      protect: true,
      perRun: 30,
      perHour: 30,
      perDay: 60,
      cooldownMs: 60 * SECOND,
      gapMin: 20,
      gapMax: 30,
      errorStreak: 5,
      pauseMin: 30,
      pauseMax: 60,
    }),
    /* Tắt bảo vệ: người dùng tự chọn nhịp, trần cao hơn và có hỏi lại. */
    free: Object.freeze({
      protect: false,
      perRun: 100,
      perHour: 100,
      perDay: 200,
      cooldownMs: 20 * SECOND,
      randomMin: 10,
      randomMax: 15,
      gapMin: 5,
      gapMax: 60,
    }),
  });
  const GAP_DEFAULT = 15;

  const UNKNOWN_TEXT = "Chưa xác định. Kiểm tra thủ công.";

  /* ---------- Chữ ---------- */

  function squash(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  function sanitizeText(text, limit) {
    const cap = limit || LIMITS.detailCap;
    let value = squash(text).slice(0, cap * 2);
    if (!value) return "";
    value = value.replace(/https?:\/\/\S+/gi, "[đã ẩn liên kết]");
    value = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[đã ẩn email]");
    value = value.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[đã ẩn]");
    value = value.replace(/\bBearer\s+\S+/gi, "[đã ẩn]");
    value = value.replace(
      /\b(?:cookie|set-cookie|authorization|access_token|refresh_token|id_token|sessionid|passwd|password|openid|sso_key|token)\s*[:=]\s*\S+/gi,
      "[đã ẩn]",
    );
    value = value.replace(/\b[a-f0-9]{32,}\b/gi, "[đã ẩn]");
    value = value.replace(/\d{8,}/g, "[đã ẩn số]");
    return squash(value).slice(0, cap);
  }

  /* Thêm dấu chấm cuối câu nếu chưa có, để nối câu sau không bị dính. */
  function sentence(text) {
    const value = squash(text);
    if (!value) return "";
    return /[.!?…]$/.test(value) ? value : value + ".";
  }

  function usableText(text) {
    const value = sanitizeText(text);
    if (!value) return "";
    if (/^(?:\[đã ẩn(?: liên kết| email)?\]\s*)+$/.test(value)) return "";
    return value;
  }

  /* ---------- Đọc danh sách code ---------- */

  const CODE_RE = /^[A-Za-z0-9_-]{4,80}$/;

  function isCodeToken(value) {
    return typeof value === "string" && CODE_RE.test(value);
  }

  /* Dùng cho dòng có nhiều chữ: chỉ nhận chữ trông rõ là code, để không gửi nhầm
   * "brick", "Delta", "Force"… thành một lần thử trên tài khoản. */
  function looksLikeCode(word) {
    if (!isCodeToken(word) || word.length < 5) return false;
    if (/^[\d_-]+$/.test(word)) return false;
    if (/\d/.test(word)) return true;
    if (/^df/i.test(word)) return true;
    if (/^[A-Z_-]+$/.test(word)) return word.length >= 8;
    return /[a-z]/.test(word) && /[A-Z]/.test(word.slice(1));
  }

  const WRAP_QUOTES = /^["'`“”‘’«»]+|["'`“”‘’«».!?…]+$/g;

  function codesInSegment(segment, strict) {
    const out = [];
    const parts = segment.split(/[,;|\t，；、]+|\s+[-–—]+\s+/);
    for (let p = 0; p < parts.length; p++) {
      const words = parts[p].trim().split(/\s+/);
      const clean = [];
      for (let w = 0; w < words.length; w++) {
        const word = words[w].replace(WRAP_QUOTES, "");
        if (word) clean.push(word);
      }
      if (!clean.length) continue;
      if (!strict && clean.length === 1) {
        if (isCodeToken(clean[0])) out.push(clean[0]);
        continue;
      }
      for (let c = 0; c < clean.length; c++) {
        if (looksLikeCode(clean[c])) out.push(clean[c]);
      }
    }
    return out;
  }

  function codesInLine(line) {
    const text = line
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s(?:#|\/\/).*$/, "")
      .replace(/^(?:[-*•+>]+|\d{1,3}[.)])\s+/, "")
      .replace(/[([{（【][^)\]}）】]*[)\]}）】]/g, " ");
    /* "Code: ABC" → phần sau dấu hai chấm là giá trị. Phần trước chỉ nhận chữ rõ là code. */
    const segments = text.split(/[:：]/);
    const out = [];
    for (let i = 0; i < segments.length; i++) {
      const found = codesInSegment(segments[i], i < segments.length - 1);
      for (let f = 0; f < found.length; f++) out.push(found[f]);
    }
    return out;
  }

  /* Trả về code theo đúng thứ tự, bỏ trùng, kèm số dòng không nhận ra. */
  function analyzeCodes(text) {
    let raw = String(text == null ? "" : text);
    if (raw.length > LIMITS.maxText) raw = raw.slice(0, LIMITS.maxText);
    raw = raw.replace(/[​-‍⁠﻿]/g, "");
    const seen = new Set();
    const codes = [];
    let duplicates = 0;
    let ignored = 0;
    let truncated = false;
    const lines = raw.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length && !truncated; i++) {
      const line = lines[i].trim();
      if (!line || line.charAt(0) === "#" || line.indexOf("//") === 0) continue;
      const found = codesInLine(line);
      if (!found.length) {
        ignored++;
        continue;
      }
      for (let f = 0; f < found.length; f++) {
        const code = found[f];
        if (seen.has(code)) {
          duplicates++;
          continue;
        }
        if (codes.length >= LIMITS.maxCodes) {
          truncated = true;
          break;
        }
        seen.add(code);
        codes.push(code);
      }
    }
    return { codes: codes, duplicates: duplicates, ignored: ignored, truncated: truncated };
  }

  function parseCodes(text) {
    return analyzeCodes(text).codes;
  }

  /* ---------- Cài đặt và nhịp nghỉ ---------- */

  function clampGap(value) {
    if (value === "" || value == null) return GAP_DEFAULT;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return GAP_DEFAULT;
    return Math.min(PROFILES.free.gapMax, Math.max(PROFILES.free.gapMin, n));
  }

  function normalizeSettings(input) {
    const s = input && typeof input === "object" ? input : {};
    return {
      protect: s.protect !== false,
      randomGap: s.randomGap === true,
      gapSec: clampGap(s.gapSec),
      skipLogged: s.skipLogged !== false,
    };
  }

  function profileFor(protect) {
    return protect === false ? PROFILES.free : PROFILES.safe;
  }

  function pace(settings) {
    const s = normalizeSettings(settings);
    if (s.protect) return { min: PROFILES.safe.gapMin, max: PROFILES.safe.gapMax };
    if (s.randomGap) return { min: PROFILES.free.randomMin, max: PROFILES.free.randomMax };
    return { min: s.gapSec, max: s.gapSec };
  }

  function pickGap(settings, rand) {
    const r = typeof rand === "function" ? rand : Math.random;
    const p = pace(settings);
    return Math.min(p.max, p.min + Math.floor(r() * (p.max - p.min + 1)));
  }

  /* Nghỉ sau 5 lỗi liên tiếp: 30,0 đến 60,0 giây, có một chữ số lẻ. */
  function errorPause(rand) {
    const r = typeof rand === "function" ? rand : Math.random;
    const lo = PROFILES.safe.pauseMin * 10;
    const hi = PROFILES.safe.pauseMax * 10;
    return Math.min(hi, lo + Math.floor(r() * (hi - lo + 1))) / 10;
  }

  function describePace(settings) {
    const s = normalizeSettings(settings);
    if (s.protect) return "Bảo vệ tài khoản, nghỉ ngẫu nhiên 20–30 giây";
    if (s.randomGap) return "Tắt bảo vệ, nghỉ ngẫu nhiên 10–15 giây";
    return "Tắt bảo vệ, nghỉ " + s.gapSec + " giây";
  }

  /* ---------- Thời gian ---------- */

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toDate(now) {
    if (now instanceof Date && !isNaN(now.getTime())) return now;
    const n = Number(now);
    return Number.isFinite(n) && n > 0 ? new Date(n) : new Date();
  }

  function formatClock(secondsFromNow, now) {
    const base = toDate(now);
    const date = new Date(base.getTime() + Math.max(0, Math.round(Number(secondsFromNow) || 0)) * SECOND);
    const clock = pad(date.getHours()) + ":" + pad(date.getMinutes());
    const sameDay = date.getFullYear() === base.getFullYear()
      && date.getMonth() === base.getMonth()
      && date.getDate() === base.getDate();
    return sameDay ? clock : pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + " " + clock;
  }

  function formatTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso);
    return pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + "/" + date.getFullYear()
      + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s < 60) return s + " giây";
    const m = Math.round(s / 60);
    if (m < 60) return m + " phút";
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? h + " giờ " + r + " phút" : h + " giờ";
  }

  function formatDurationRange(min, max) {
    const a = formatDuration(min);
    const b = formatDuration(max);
    if (a === b) return a;
    const ma = a.match(/^(\d+) (giây|phút)$/);
    const mb = b.match(/^(\d+) (giây|phút)$/);
    if (ma && mb && ma[2] === mb[2]) return ma[1] + "–" + mb[1] + " " + ma[2];
    return a + " – " + b;
  }

  function formatTenth(seconds) {
    return Math.max(0, Math.round(Number(seconds) * 10) / 10).toFixed(1).replace(".", ",");
  }

  /* ---------- Hạn mức ---------- */

  function cleanAttempts(list, now) {
    const t = typeof now === "number" ? now : Date.now();
    const out = [];
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const at = Number(src[i]);
      /* Bỏ mốc quá 24 giờ và mốc "tương lai" do đồng hồ máy bị chỉnh lùi. */
      if (Number.isFinite(at) && at > 0 && t - at < DAY && at - t < 5 * MINUTE) out.push(at);
    }
    out.sort(function (a, b) { return a - b; });
    if (out.length > 500) return out.slice(out.length - 500);
    return out;
  }

  function quota(attempts, protect, now) {
    const t = typeof now === "number" ? now : Date.now();
    const p = profileFor(protect);
    const day = cleanAttempts(attempts, t);
    const hour = day.filter(function (at) { return t - at < HOUR; });
    const res = {
      ok: true,
      scope: "",
      until: 0,
      usedHour: hour.length,
      usedDay: day.length,
      capHour: p.perHour,
      capDay: p.perDay,
      left: Math.max(0, Math.min(p.perHour - hour.length, p.perDay - day.length)),
      last: day.length ? day[day.length - 1] : 0,
    };
    /* Mở lại khi đủ số lượt cũ hết hạn để còn ít nhất một chỗ trống. */
    if (hour.length >= p.perHour) {
      res.ok = false;
      res.scope = "hour";
      res.until = hour[hour.length - p.perHour] + HOUR;
    }
    if (day.length >= p.perDay) {
      const until = day[day.length - p.perDay] + DAY;
      if (res.ok || until > res.until) {
        res.ok = false;
        res.scope = "day";
        res.until = until;
      }
    }
    return res;
  }

  function quotaReason(q, now) {
    if (!q || q.ok) return "";
    const t = typeof now === "number" ? now : Date.now();
    const at = formatClock((q.until - t) / SECOND, t);
    if (q.scope === "day") return "Đã đủ " + q.capDay + " code trong 24 giờ. Có thể chạy lại lúc " + at + ".";
    return "Đã đủ " + q.capHour + " code trong 60 phút. Có thể chạy lại lúc " + at + ".";
  }

  /* Điều kiện để bấm Bắt đầu: còn hạn mức và đã nghỉ đủ sau lần nhập trước. */
  function gate(attempts, protect, now) {
    const t = typeof now === "number" ? now : Date.now();
    const q = quota(attempts, protect, t);
    if (!q.ok) return Object.assign(q, { reason: quotaReason(q, t) });
    const until = q.last ? q.last + profileFor(protect).cooldownMs : 0;
    if (until > t) {
      return Object.assign(q, {
        ok: false,
        scope: "cooldown",
        until: until,
        reason: "Cần nghỉ " + Math.ceil((until - t) / SECOND) + " giây trước khi bấm Bắt đầu lại.",
      });
    }
    return Object.assign(q, { reason: "" });
  }

  /* ---------- Kế hoạch một lần bấm Bắt đầu ---------- */

  function settledCodes(log) {
    const done = new Set();
    const list = Array.isArray(log) ? log : [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && (e.status === "ok" || e.status === "error") && isCodeToken(e.code)) done.add(e.code);
    }
    return done;
  }

  function plan(input) {
    const opts = input || {};
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    const codes = Array.isArray(opts.codes) ? opts.codes : [];
    const s = normalizeSettings(opts.settings);
    const p = profileFor(s.protect);
    const done = s.skipLogged ? settledCodes(opts.log) : new Set();
    const fresh = codes.filter(function (c) { return !done.has(c); });
    const g = gate(opts.attempts, s.protect, now);
    const room = Math.max(0, Math.min(p.perRun, g.left));
    const queue = fresh.slice(0, room);
    let reason = "";
    if (!codes.length) reason = "Chưa có code hợp lệ.";
    else if (!fresh.length) reason = "Các code này đã có trong log (đã nhập hoặc lỗi). Bỏ chọn “Bỏ qua code đã có trong log” nếu muốn nhập lại.";
    else if (!g.ok) reason = g.reason;
    return {
      ok: !reason,
      reason: reason,
      until: g.ok ? 0 : g.until,
      queue: reason ? [] : queue,
      total: codes.length,
      fresh: fresh.length,
      skipped: codes.length - fresh.length,
      perRun: p.perRun,
      quota: g,
      settings: s,
    };
  }

  function estimate(count, settings, extraSec) {
    const n = Math.max(0, Math.round(Number(count) || 0));
    const extra = Math.max(0, Number(extraSec) || 0);
    if (!n && !extra) return null;
    const p = pace(settings);
    const waits = Math.max(0, n - 1);
    return {
      min: waits * p.min + n * LIMITS.replySec + extra,
      max: waits * p.max + n * LIMITS.replySec + extra,
    };
  }

  function describeEstimate(est, now) {
    if (!est) return "";
    const a = formatClock(est.min, now);
    const b = formatClock(est.max, now);
    return "Mất khoảng " + formatDurationRange(est.min, est.max) + ", xong lúc " + (a === b ? a : a + "–" + b) + ".";
  }

  /* ---------- Kết quả trang trả về ---------- */

  function firstNumber() {
    for (let i = 0; i < arguments.length; i++) {
      const value = arguments[i];
      if (value === undefined || value === null || value === "") continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function pickApiFields(raw) {
    const out = { code: null, msg: "", screen: "" };
    if (!raw || typeof raw !== "object") return out;
    const serverCode = firstNumber(raw.code, raw.ret, raw.iRet, raw.errCode, raw.errcode);
    if (serverCode !== null && Math.abs(serverCode) < 100000000) out.code = serverCode;
    const http = firstNumber(raw.httpStatus);
    if (http !== null && http >= 100 && http < 600) out.httpStatus = http;
    const nested = raw.data && typeof raw.data === "object" ? raw.data : {};
    out.msg = squash(
      raw.msg || raw.message || raw.sMsg || raw.errMsg || raw.desc || raw.sMessage || raw.error || raw.reason
        || nested.msg || nested.message || nested.sMsg || (typeof raw.data === "string" ? raw.data : ""),
    ).slice(0, LIMITS.detailCap);
    out.screen = squash(raw.screen || "").slice(0, LIMITS.detailCap);
    return out;
  }

  function looksFailed(text) {
    return /không thành công|khong thanh cong|chưa thành công|chua thanh cong|thất bại|that bai|失败|invalid|không hợp lệ|khong hop le|not successful|unsuccessful|\bfail(?:ed|ure|s)?\b|\berror\b|\blỗi\b|\bloi\b/i.test(text || "");
  }

  /* Câu phủ định ("không thành công", "not successful") không tính là thành công. */
  function looksOk(text) {
    return /(?<!(?:không|khong|chưa|chua) )thành công|redeemed successfully|redemption successful|(?<!not )(?<![a-z])success(?:ful|fully)?(?![a-z])|兑换成功/i.test(text || "");
  }

  function isAccountRisk(text) {
    const value = squash(text);
    if (!value) return false;
    return /captcha|recaptcha|hcaptcha|geetest|too many requests|rate limit|try again later|too frequent|操作过于频繁|操作频繁|请求过于频繁|频繁|风控|验证码|封禁|冻结|账号异常|banned|suspended|account (?:ban|locked|restrict)|bị khóa|bi khoa|phong tỏa|phong toa|tài khoản bị|tai khoan bi|quá nhiều lần|qua nhieu lan|thử lại sau|thu lai sau|giới hạn truy cập|gioi han truy cap|xác minh|xac minh/i.test(value);
  }

  /* Mã số và câu chữ mâu thuẫn nhau thì ghi "chưa xác định", không đoán. */
  function describeApi(raw) {
    if (!raw || typeof raw !== "object") return { ok: false, status: "unknown", serverCode: null, detail: "", httpStatus: 0 };
    const picked = pickApiFields(raw);
    const serverCode = picked.code;
    const msg = usableText(picked.msg);
    const screen = usableText(picked.screen);
    const parts = [];
    if (screen) parts.push(screen);
    /* Thêm câu máy chủ, bỏ phần đã có trên màn hình và chữ "ok" xác nhận. */
    const pieces = msg ? msg.split(" | ") : [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i].trim();
      if (!piece || /^(?:ok|success|successful|successfully)$/i.test(piece)) continue;
      if (parts.some(function (p) { return p.indexOf(piece) !== -1; })) continue;
      parts.push(piece);
    }
    let exact = parts.join(" | ");
    if (serverCode !== null && serverCode !== 0 && exact.indexOf(String(serverCode)) === -1) {
      exact = exact ? exact + " | " + serverCode : String(serverCode);
    }
    if (!exact && serverCode !== null) exact = String(serverCode);
    const failed = looksFailed(exact);
    const success = looksOk(exact);
    let status = "unknown";
    if (serverCode === 0 && failed) status = "unknown";
    else if (serverCode === 0) status = "ok";
    else if (serverCode !== null && success) status = "unknown";
    else if (serverCode !== null) status = "error";
    else if (success && !failed) status = "ok";
    else if (failed) status = "error";
    return { ok: status === "ok", status: status, serverCode: serverCode, detail: exact, httpStatus: picked.httpStatus || 0 };
  }

  function describeDialog(text) {
    const detail = usableText(text);
    const failed = looksFailed(detail);
    const success = looksOk(detail);
    let status = "error";
    if (!detail || (failed && success)) status = "unknown";
    else if (success && !failed) status = "ok";
    return { ok: status === "ok", status: status, serverCode: null, detail: detail };
  }

  function randomId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Đổi kết quả thô từ trang thành một dòng log. */
  function toEntry(code, result, now) {
    if (!isCodeToken(code)) return null;
    const r = result && typeof result === "object" ? result : {};
    let status = "unknown";
    let detail = "";
    let serverCode = null;
    if (r.source === "api") {
      const d = describeApi(r.raw);
      status = d.status;
      detail = d.detail;
      serverCode = d.serverCode;
    } else if (r.source === "dialog") {
      const d = describeDialog(r.text);
      status = d.status;
      detail = d.detail;
    } else if (r.source === "ui") {
      /* Không bấm được nút Đổi: code chưa được gửi, không tính là lỗi để lần sau còn nhập. */
      status = "unknown";
      detail = (sanitizeText(r.text) || "Không thao tác được trên trang.") + " Code này chưa được gửi.";
    }
    if (!detail) detail = status === "unknown" ? UNKNOWN_TEXT : status === "ok" ? "Thành công." : "Không rõ câu lỗi.";
    return {
      id: randomId(),
      at: toDate(now).toISOString(),
      code: code,
      status: status,
      detail: sanitizeText(detail),
      serverCode: serverCode,
    };
  }

  /* Quyết định sau mỗi code: nhập tiếp, nghỉ sau chuỗi lỗi, hay dừng hẳn. ctx giữ bộ đếm giữa các code. */
  function judge(entry, result, ctx, settings) {
    const c = ctx || {};
    const s = normalizeSettings(settings);
    const http = (result && result.raw && Number(result.raw.httpStatus)) || 0;
    const said = (entry && entry.detail) || "";
    const code = (entry && entry.code) || "";
    if (http === 403 || http === 429) {
      return { action: "stop", note: "Đã dừng vì trang trả mã " + http + ". Kiểm tra thủ công trước khi nhập tiếp." };
    }
    c.http5xx = http >= 500 && http < 600 ? (c.http5xx || 0) + 1 : 0;
    if (c.http5xx >= 2) return { action: "stop", note: "Đã dừng sau 2 lỗi máy chủ liên tiếp." };
    if (result && result.source === "ui") {
      return { action: "stop", note: "Đã dừng. " + sentence(said || "Không thao tác được trên trang") };
    }
    if (isAccountRisk(said)) {
      return { action: "stop", note: "Đã dừng để bảo vệ tài khoản. Trang báo: " + sentence(said.slice(0, 180)) };
    }
    if (!entry || entry.status === "unknown") {
      return {
        action: "stop",
        note: "Đã dừng vì chưa xác định được kết quả của " + code + ". Kiểm tra thủ công. Code này không bị tính là lỗi.",
      };
    }
    if (entry.status === "error") {
      c.streak = (c.streak || 0) + 1;
      if (s.protect && c.streak >= PROFILES.safe.errorStreak) {
        c.streak = 0;
        return { action: "pause" };
      }
    } else {
      c.streak = 0;
    }
    return { action: "continue" };
  }

  /* ---------- Log ---------- */

  function normStatus(status) {
    return status === "ok" || status === "unknown" ? status : "error";
  }

  function normalizeEntry(e) {
    if (!e || typeof e !== "object" || !isCodeToken(e.code)) return null;
    const status = normStatus(e.status);
    return {
      id: typeof e.id === "string" ? e.id.slice(0, 40) : "",
      at: typeof e.at === "string" ? e.at.slice(0, 40) : "",
      atText: typeof e.atText === "string" ? e.atText.slice(0, 40) : "",
      code: e.code,
      status: status,
      detail: squash(e.detail).slice(0, LIMITS.detailCap)
        || (status === "ok" ? "Dùng được (từ log)." : status === "unknown" ? UNKNOWN_TEXT : "Lỗi (từ log)."),
      serverCode: typeof e.serverCode === "number" && Number.isFinite(e.serverCode) ? e.serverCode : null,
    };
  }

  function entryTime(e) {
    return (e && (e.at ? formatTime(e.at) : e.atText)) || "";
  }

  function tally(log) {
    const out = { all: 0, ok: 0, error: 0, unknown: 0 };
    const list = Array.isArray(log) ? log : [];
    for (let i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      out.all++;
      out[normStatus(list[i].status)]++;
    }
    return out;
  }

  /* Mỗi code một trạng thái tốt nhất: dùng được > lỗi > chưa rõ. Lượt mới hơn thắng nếu cùng hạng. */
  function bestByCode(log) {
    const rank = { ok: 3, error: 2, unknown: 1 };
    const map = new Map();
    const list = Array.isArray(log) ? log : [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !isCodeToken(e.code)) continue;
      const prev = map.get(e.code);
      if (!prev || rank[normStatus(e.status)] >= rank[normStatus(prev.status)]) map.set(e.code, e);
    }
    return map;
  }

  function formatLog(entries, meta) {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const info = meta || {};
    const best = bestByCode(list);
    const ok = [];
    const bad = [];
    best.forEach(function (e) {
      if (normStatus(e.status) === "ok") ok.push(e);
      else if (normStatus(e.status) === "error") bad.push(e);
    });
    const count = tally(list);
    const lines = [];
    lines.push("DF Code Garena — nhật ký đổi code");
    if (info.version) lines.push("Phiên bản: " + info.version);
    lines.push("Xuất lúc: " + formatTime(info.exportedAt || new Date().toISOString()));
    if (info.settings) lines.push("Chế độ: " + describePace(info.settings));
    lines.push("Tổng: " + count.all + " lượt, " + count.ok + " dùng được, " + count.error + " lỗi, " + count.unknown + " chưa rõ");
    lines.push("");
    lines.push("=== DÙNG ĐƯỢC (" + ok.length + ") ===");
    if (!ok.length) lines.push("(không có)");
    for (let a = 0; a < ok.length; a++) lines.push(ok[a].code);
    lines.push("");
    lines.push("=== LỖI (" + bad.length + ") ===");
    if (!bad.length) lines.push("(không có)");
    for (let b = 0; b < bad.length; b++) lines.push(bad[b].code + "\t" + sanitizeText(bad[b].detail));
    lines.push("");
    lines.push("=== CHI TIẾT ===");
    if (!list.length) lines.push("(chưa có lượt nhập nào)");
    for (let n = 0; n < list.length; n++) {
      const e = list[n];
      const status = normStatus(e.status);
      const tag = status === "ok" ? "OK" : status === "unknown" ? "CHƯA" : "LỖI";
      lines.push("[" + tag + "] " + (entryTime(e) || "—") + "  " + e.code + "  —  " + sanitizeText(e.detail));
    }
    lines.push("");
    return lines.join("\n");
  }

  function sectionOf(line) {
    if (/^===\s*(?:DÙNG ĐƯỢC|DUNG DUOC)/i.test(line)) return "ok";
    if (/^===\s*(?:LỖI|LOI)/i.test(line)) return "error";
    if (/^===\s*(?:CHI TIẾT|CHI TIET)/i.test(line)) return "detail";
    if (/^===/.test(line)) return "other";
    return "";
  }

  const DETAIL_RE = /^\[(OK|LỖI|LOI|ERROR|CHƯA|CHUA)\]\s*(.*?)\s{2,}([A-Za-z0-9_-]{4,80})\s+[—-](?:\s+(.*))?$/i;

  /* Đọc file log đã xuất (bản 1.0.0 trở lên và bản 0.5.0 beta, tức 1.9.9 cũ). Phần CHI TIẾT giữ đủ từng lượt; code chỉ có ở phần trên được thêm sau. */
  function parseLog(text) {
    let raw = String(text == null ? "" : text).replace(/^﻿/, "");
    if (raw.length > LIMITS.maxText) raw = raw.slice(0, LIMITS.maxText);
    const lines = raw.split(/\r\n|\r|\n/);
    let section = "";
    const fromDetail = [];
    const fromSections = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.length > 700 || line.charAt(0) === "#") continue;
      const next = sectionOf(line);
      if (next) {
        section = next;
        continue;
      }
      if (/^\((?:không có|khong co|chưa có lượt nhập nào|chua co luot nhap nao)\)$/i.test(line)) continue;
      if (section === "detail") {
        const m = line.match(DETAIL_RE);
        if (!m) continue;
        const tag = m[1].toUpperCase();
        const time = m[2].trim();
        fromDetail.push({
          atText: time === "—" || time === "-" ? "" : time,
          code: m[3],
          status: tag === "OK" ? "ok" : tag === "CHƯA" || tag === "CHUA" ? "unknown" : "error",
          detail: m[4] || "",
        });
      } else if (section === "ok") {
        if (isCodeToken(line)) fromSections.push({ code: line, status: "ok", detail: "Dùng được (từ log)." });
      } else if (section === "error") {
        const bits = line.indexOf("\t") === -1 ? line.split(/\s{2,}/) : line.split("\t");
        const code = bits[0].trim();
        if (isCodeToken(code)) fromSections.push({ code: code, status: "error", detail: bits.slice(1).join(" ") || "Lỗi (từ log)." });
      }
    }
    const out = [];
    const known = new Set();
    for (let d = 0; d < fromDetail.length; d++) {
      const e = normalizeEntry(fromDetail[d]);
      if (!e) continue;
      known.add(e.code + "|" + e.status);
      out.push(e);
    }
    for (let s = 0; s < fromSections.length; s++) {
      const e = normalizeEntry(fromSections[s]);
      if (!e || known.has(e.code + "|" + e.status)) continue;
      known.add(e.code + "|" + e.status);
      out.push(e);
    }
    return out;
  }

  /* Gộp log đang có với log nạp từ file. Không thêm lại lượt đã có (cùng code, trạng thái và giờ). */
  function mergeLogs(current, incoming, cap) {
    const limit = cap || LIMITS.logCap;
    const out = [];
    const keys = new Set();
    const lists = [current, incoming];
    for (let l = 0; l < lists.length; l++) {
      const list = Array.isArray(lists[l]) ? lists[l] : [];
      for (let i = 0; i < list.length; i++) {
        const e = normalizeEntry(list[i]);
        if (!e) continue;
        const key = e.code + "|" + e.status + "|" + entryTime(e);
        if (keys.has(key)) continue;
        keys.add(key);
        out.push(e);
      }
    }
    return out.length > limit ? out.slice(out.length - limit) : out;
  }

  /* ---------- Trạng thái chạy ---------- */

  function isRunActive(run, now) {
    if (!run || typeof run !== "object") return false;
    if (run.phase !== "running" && run.phase !== "waiting") return false;
    const t = typeof now === "number" ? now : Date.now();
    return t - (Number(run.updatedAt) || 0) < LIMITS.staleMs;
  }

  function isRedeemUrl(url) {
    try {
      const u = new URL(String(url || ""));
      return u.protocol === "https:" && u.hostname === REDEEM_HOST && REDEEM_PATH.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  return Object.freeze({
    REDEEM_HOST: REDEEM_HOST,
    REDEEM_PAGE: REDEEM_PAGE,
    REDEEM_PATH: REDEEM_PATH,
    KEYS: KEYS,
    LEGACY_KEYS: LEGACY_KEYS,
    LIMITS: LIMITS,
    PROFILES: PROFILES,
    GAP_DEFAULT: GAP_DEFAULT,
    UNKNOWN_TEXT: UNKNOWN_TEXT,
    squash: squash,
    sentence: sentence,
    sanitizeText: sanitizeText,
    isCodeToken: isCodeToken,
    looksLikeCode: looksLikeCode,
    analyzeCodes: analyzeCodes,
    parseCodes: parseCodes,
    clampGap: clampGap,
    normalizeSettings: normalizeSettings,
    profileFor: profileFor,
    pace: pace,
    pickGap: pickGap,
    errorPause: errorPause,
    describePace: describePace,
    formatClock: formatClock,
    formatTime: formatTime,
    formatDuration: formatDuration,
    formatDurationRange: formatDurationRange,
    formatTenth: formatTenth,
    cleanAttempts: cleanAttempts,
    quota: quota,
    quotaReason: quotaReason,
    gate: gate,
    settledCodes: settledCodes,
    plan: plan,
    estimate: estimate,
    describeEstimate: describeEstimate,
    pickApiFields: pickApiFields,
    isAccountRisk: isAccountRisk,
    describeApi: describeApi,
    describeDialog: describeDialog,
    toEntry: toEntry,
    judge: judge,
    normalizeEntry: normalizeEntry,
    entryTime: entryTime,
    tally: tally,
    bestByCode: bestByCode,
    formatLog: formatLog,
    parseLog: parseLog,
    mergeLogs: mergeLogs,
    isRunActive: isRunActive,
    isRedeemUrl: isRedeemUrl,
  });
});
