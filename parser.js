/* Bộ đọc danh sách code, khoảng nghỉ, và định dạng file log. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DFParse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function isCodeToken(value) {
    return /^[A-Za-z0-9_-]{4,80}$/.test(value);
  }

  function parseCodes(text) {
    var seen = Object.create(null);
    var out = [];
    var rawText = String(text || "").replace(/^\uFEFF/, "");
    if (rawText.length > 200000) rawText = rawText.slice(0, 200000);
    var lines = rawText.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === "#" || line.indexOf("//") === 0) continue;
      var colon = line.lastIndexOf(":");
      if (colon !== -1) line = line.slice(colon + 1).trim();
      if (!line) continue;
      var parts = line.split(/[,;|\t]+/);
      var tokens = [];
      for (var p = 0; p < parts.length; p++) {
        var bits = parts[p].split(/:\s*|\s{2,}/);
        for (var b = 0; b < bits.length; b++) tokens.push(bits[b]);
      }
      var cleaned = [];
      for (var t = 0; t < tokens.length; t++) {
        var token = tokens[t].trim().replace(/^["'`]+|["'`]+$/g, "");
        if (token) cleaned.push(token);
      }
      if (cleaned.length === 1 && /\s/.test(cleaned[0])) {
        var words = cleaned[0].split(/\s+/);
        var allCodes = true;
        for (var w = 0; w < words.length; w++) {
          if (!isCodeToken(words[w])) allCodes = false;
        }
        if (allCodes) cleaned = words;
        else {
          var last = words[words.length - 1];
          cleaned = isCodeToken(last) ? [last] : [];
        }
      }
      for (var c = 0; c < cleaned.length; c++) {
        var code = cleaned[c];
        if (!isCodeToken(code) || seen[code]) continue;
        seen[code] = true;
        out.push(code);
        if (out.length >= 1000) return out;
      }
    }
    return out;
  }

  function clampGap(value) {
    if (value === "" || value === null || typeof value === "undefined") return 15;
    var n = Math.round(Number(value));
    if (!isFinite(n)) return 15;
    if (n < 5) return 5;
    if (n > 60) return 60;
    return n;
  }

  function estimateWaitSeconds(count, gapSec) {
    var n = Number(count) || 0;
    if (n <= 1) return 0;
    return (n - 1) * clampGap(gapSec);
  }

  function isAccountRisk(text) {
    var value = squash(text);
    if (!value) return false;
    return /captcha|recaptcha|hcaptcha|geetest|too many requests|rate limit|try again later|too frequent|操作过于频繁|操作频繁|请求过于频繁|频繁|风控|验证码|封禁|冻结|账号异常|banned|suspended|account (?:ban|locked|restrict)|bị khóa|bi khoa|phong tỏa|phong toa|tài khoản bị|tai khoan bi|quá nhiều lần|qua nhieu lan|thử lại sau|thu lai sau|giới hạn truy cập|gioi han truy cap|xác minh|xac minh/i.test(value);
  }

  function randomGap() {
    return 10 + Math.floor(Math.random() * 6);
  }

  function protectPace(gapSec, random, protect) {
    if (protect) return { min: 20, max: 30 };
    if (random) return { min: 10, max: 15 };
    var fixed = clampGap(gapSec);
    return { min: fixed, max: fixed };
  }

  function formatClock(secondsFromNow, now) {
    var base = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    var date = new Date(base.getTime() + Math.max(0, Math.round(Number(secondsFromNow) || 0)) * 1000);
    var hh = String(date.getHours()).padStart(2, "0");
    var mm = String(date.getMinutes()).padStart(2, "0");
    var clock = hh + ":" + mm;
    if (date.getFullYear() === base.getFullYear() && date.getMonth() === base.getMonth() && date.getDate() === base.getDate()) {
      return clock;
    }
    var dd = String(date.getDate()).padStart(2, "0");
    var mo = String(date.getMonth() + 1).padStart(2, "0");
    return dd + "/" + mo + " " + clock;
  }

  function estimateFinish(count, gapSec, random, extraSeconds, now, protect) {
    var n = Math.max(0, Math.round(Number(count) || 0));
    var extra = Math.max(0, Math.round(Number(extraSeconds) || 0));
    var reply = 3;
    if (n <= 0 && extra <= 0) return { min: 0, max: 0, text: "Chưa có code để ước tính." };
    var waits = Math.max(0, n - 1);
    var pace = protectPace(gapSec, random, !!protect);
    var gapMin = pace.min;
    var gapMax = pace.max;
    var min = waits * gapMin + n * reply + extra;
    var max = waits * gapMax + n * reply + extra;
    var start = formatClock(min, now);
    var end = formatClock(max, now);
    var text = start === end
      ? "Ước tính xong lúc " + start + "."
      : "Ước tính xong lúc " + start + " – " + end + ".";
    return { min: min, max: max, text: text };
  }

  function firstNumber() {
    for (var i = 0; i < arguments.length; i++) {
      var value = arguments[i];
      if (value === undefined || value === null || value === "") continue;
      var n = Number(value);
      if (isFinite(n)) return n;
    }
    return null;
  }

  function squash(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sanitizeText(text, limit) {
    var cap = limit || 500;
    var value = squash(text).slice(0, cap * 2);
    if (!value) return "";
    value = value.replace(/https?:\/\/\S+/gi, "[đã ẩn liên kết]");
    value = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[đã ẩn email]");
    value = value.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[đã ẩn]");
    value = value.replace(/\bBearer\s+\S+/gi, "[đã ẩn]");
    value = value.replace(/\b(?:cookie|set-cookie|authorization|access_token|refresh_token|id_token|sessionid|passwd|password|openid|sso_key|token)\s*[:=]\s*\S+/gi, "[đã ẩn]");
    value = value.replace(/\b[a-f0-9]{32,}\b/gi, "[đã ẩn]");
    return squash(value).slice(0, cap);
  }

  function usableText(text) {
    var value = sanitizeText(text, 500);
    if (!value) return "";
    if (/^(?:\[đã ẩn(?: liên kết| email)?\]\s*)+$/.test(value)) return "";
    return value;
  }

  function pickApiFields(raw) {
    var out = { code: null, msg: "", screen: "" };
    if (!raw || typeof raw !== "object") return out;
    var serverCode = firstNumber(raw.code, raw.ret, raw.iRet, raw.errCode, raw.errcode);
    if (serverCode !== null && Math.abs(serverCode) < 100000000) out.code = serverCode;
    var nested = raw.data && typeof raw.data === "object" ? raw.data : {};
    out.msg = squash(
      raw.msg || raw.message || raw.sMsg || raw.errMsg || raw.desc || raw.sMessage || raw.error || raw.reason
      || nested.msg || nested.message || nested.sMsg || (typeof raw.data === "string" ? raw.data : ""),
    ).slice(0, 500);
    out.screen = squash(raw.screen || "").slice(0, 500);
    return out;
  }

  function describeApi(raw) {
    var picked = pickApiFields(raw);
    if (!raw || typeof raw !== "object") {
      return { ok: false, serverCode: null, detail: "" };
    }
    var serverCode = picked.code;
    var msg = usableText(picked.msg);
    var screen = usableText(picked.screen);
    var ok = serverCode === 0;
    var parts = [];
    if (screen) parts.push(screen);
    if (msg && msg !== screen && (!screen || screen.indexOf(msg) === -1)) {
      if (!(/^success$/i.test(msg) || /^ok$/i.test(msg)) || !screen) parts.push(msg);
    }
    var exact = parts.join(" | ");
    if (!exact && serverCode !== null) exact = String(serverCode);
    return { ok: ok, serverCode: serverCode, detail: exact };
  }

  function describeDialog(text) {
    var detail = usableText(text);
    var ok = /thành công|đổi thành công|success|兑换成功|兑换成功/i.test(detail);
    return { ok: ok, serverCode: null, detail: detail };
  }

  function formatTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return String(iso || "");
    try {
      return new Intl.DateTimeFormat("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }).format(date);
    } catch (e) {
      return date.toISOString();
    }
  }

  function formatLog(entries, meta) {
    var list = Array.isArray(entries) ? entries : [];
    var info = meta || {};
    var ok = [];
    var bad = [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].status === "ok") ok.push(list[i]);
      else if (list[i].status === "error") bad.push(list[i]);
    }
    var lines = [];
    lines.push("DF Code Garena — nhật ký đổi code");
    lines.push("Xuất lúc: " + formatTime(info.exportedAt || new Date().toISOString()));
    if (info.randomGap) lines.push("Khoảng cách: ngẫu nhiên 10–15 giây");
    else if (info.gapSec) lines.push("Khoảng cách: " + info.gapSec + " giây");
    lines.push("");
    lines.push("=== DÙNG ĐƯỢC (" + ok.length + ") ===");
    if (!ok.length) lines.push("(không có)");
    for (var a = 0; a < ok.length; a++) lines.push(ok[a].code);
    lines.push("");
    lines.push("=== LỖI (" + bad.length + ") ===");
    if (!bad.length) lines.push("(không có)");
    for (var b = 0; b < bad.length; b++) lines.push(bad[b].code + "\t" + sanitizeText(bad[b].detail, 500));
    lines.push("");
    lines.push("=== CHI TIẾT ===");
    if (!list.length) lines.push("(chưa có lượt nhập nào)");
    for (var n = 0; n < list.length; n++) {
      var entry = list[n];
      var tag = entry.status === "ok" ? "OK" : entry.status === "error" ? "LỖI" : String(entry.status || "").toUpperCase();
      lines.push("[" + tag + "] " + formatTime(entry.at) + "  " + entry.code + "  —  " + sanitizeText(entry.detail, 500));
    }
    lines.push("");
    return lines.join("\n");
  }

  function sectionOf(line) {
    if (/^===\s*(DÙNG ĐƯỢC|DUNG DUOC)/i.test(line)) return "ok";
    if (/^===\s*(LỖI|LOI)/i.test(line)) return "error";
    if (/^===\s*(CHI TIẾT|CHI TIET)/i.test(line)) return "detail";
    return "";
  }

  function parseLog(text) {
    var raw = String(text || "").replace(/^\uFEFF/, "");
    if (raw.length > 200000) raw = raw.slice(0, 200000);
    var lines = raw.split(/\r?\n/);
    var section = "";
    var fromDetail = [];
    var fromOk = [];
    var fromBad = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.length > 400 || line.charAt(0) === "#") continue;
      var next = sectionOf(line);
      if (next) {
        section = next;
        continue;
      }
      if (/^(DF Code|Xuất lúc|Xuat luc|Trang|Tài khoản|Tai khoan|Khoảng cách|Khoang cach)\b/i.test(line)) continue;
      if (line === "(không có)" || line === "(khong co)" || line === "(chưa có lượt nhập nào)") continue;
      if (section === "detail") {
        var match = line.match(/^\[(OK|LỖI|LOI|ERROR)\]\s+(.+?)\s{2,}([A-Za-z0-9_-]{4,80})\s+[—-]\s+(.+)$/i);
        if (!match) continue;
        var tag = match[1].toUpperCase();
        fromDetail.push({
          code: match[3],
          status: tag === "OK" ? "ok" : "error",
          detail: squash(match[4]),
          at: "",
        });
        continue;
      }
      if (section === "ok" && isCodeToken(line)) {
        fromOk.push({ code: line, status: "ok", detail: "Đã có trong log dùng được.", at: "" });
        continue;
      }
      if (section === "error") {
        var bits = line.indexOf("\t") === -1 ? line.split(/\s{2,}/) : line.split("\t");
        var code = bits[0].trim();
        if (!isCodeToken(code)) continue;
        fromBad.push({
          code: code,
          status: "error",
          detail: squash(bits.slice(1).join(" ")) || "Lỗi (từ log)",
          at: "",
        });
      }
    }
    var seen = Object.create(null);
    var out = [];
    function add(entry) {
      if (!entry || !isCodeToken(entry.code) || seen[entry.code]) return;
      seen[entry.code] = true;
      out.push({
        id: "",
        at: entry.at || "",
        code: entry.code,
        status: entry.status === "ok" ? "ok" : "error",
        detail: squash(entry.detail),
        serverCode: null,
      });
    }
    for (var d = 0; d < fromDetail.length; d++) add(fromDetail[d]);
    for (var a = 0; a < fromOk.length; a++) add(fromOk[a]);
    for (var b = 0; b < fromBad.length; b++) add(fromBad[b]);
    return out;
  }

  function mergeLogs(current, incoming) {
    var map = Object.create(null);
    var order = [];
    function put(entry) {
      if (!entry || !isCodeToken(entry.code)) return;
      var status = entry.status === "ok" ? "ok" : "error";
      if (!map[entry.code]) order.push(entry.code);
      map[entry.code] = {
        id: entry.id || "",
        at: entry.at || "",
        code: entry.code,
        status: status,
        detail: squash(entry.detail) || (status === "ok" ? "Đã có trong log dùng được." : "Lỗi (từ log)"),
        serverCode: entry.serverCode == null ? null : entry.serverCode,
      };
    }
    var lists = [current, incoming];
    for (var i = 0; i < lists.length; i++) {
      var list = Array.isArray(lists[i]) ? lists[i] : [];
      for (var j = 0; j < list.length; j++) put(list[j]);
    }
    var out = [];
    for (var k = 0; k < order.length; k++) out.push(map[order[k]]);
    return out;
  }

  return {
    parseCodes: parseCodes,
    clampGap: clampGap,
    randomGap: randomGap,
    protectPace: protectPace,
    isAccountRisk: isAccountRisk,
    estimateWaitSeconds: estimateWaitSeconds,
    estimateFinish: estimateFinish,
    formatClock: formatClock,
    describeApi: describeApi,
    describeDialog: describeDialog,
    sanitizeText: sanitizeText,
    pickApiFields: pickApiFields,
    formatLog: formatLog,
    parseLog: parseLog,
    mergeLogs: mergeLogs,
    formatTime: formatTime,
    isCodeToken: isCodeToken,
  };
});
