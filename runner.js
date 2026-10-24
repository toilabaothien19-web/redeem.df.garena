/* Điều phối từng code trên đúng tab đổi quà. Popup đóng vẫn chạy tiếp. */
(function () {
  if (window.__dfCodeRunner) return;
  window.__dfCodeRunner = true;

  var CHANNEL = "dfcode-garena-v1";
  var running = false;
  var starting = false;
  var stopFlag = false;

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function storageSet(values) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(values, resolve);
    });
  }

  function shown(el) {
    if (!el) return false;
    return getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
  }

  function isLoggedIn() {
    var loggedOut = document.querySelector("#unlogin");
    if (loggedOut && shown(loggedOut)) return false;
    var loggedIn = document.querySelector("#logined");
    if (!loggedIn || !shown(loggedIn)) return false;
    var after = document.querySelector(".state-after");
    if (after && !shown(after)) return false;
    return !!document.querySelector("input.exc-input, .exc-input");
  }

  function probe() {
    return {
      ok: true,
      loggedIn: isLoggedIn(),
      running: running,
    };
  }

  function badge(text, color) {
    try {
      chrome.runtime.sendMessage({ kind: "badge", text: text || "", color: color || "" }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  function callPage(kind, payload, timeoutMs) {
    var bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    var id = Array.prototype.map.call(bytes, function (n) { return n.toString(16).padStart(2, "0"); }).join("");
    return new Promise(function (resolve) {
      var timer = setTimeout(function () {
        window.removeEventListener("message", onMessage);
        resolve({ source: "timeout" });
      }, timeoutMs);
      function onMessage(event) {
        if (event.source !== window || event.origin !== location.origin) return;
        var data = event.data;
        if (!data || data.channel !== CHANNEL || data.id !== id) return;
        if (kind === "ping" && data.kind === "pong") {
          finish({ source: "pong" });
          return;
        }
        if (data.kind === "result") {
          if (payload && payload.code && data.code !== payload.code) return;
          finish(cleanResult(data.result));
        }
      }
      function finish(result) {
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        resolve(result);
      }
      window.addEventListener("message", onMessage);
      window.postMessage(
        Object.assign({ channel: CHANNEL, kind: kind, id: id }, payload || {}),
        location.origin,
      );
    });
  }

  function cleanResult(result) {
    if (!result || typeof result !== "object") return { source: "timeout" };
    if (result.source === "api") return { source: "api", raw: DFParse.pickApiFields(result.raw) };
    if (result.source === "dialog" || result.source === "ui") {
      return { source: result.source, text: DFParse.sanitizeText(result.text, 500) };
    }
    if (result.source === "timeout" || result.source === "pong") return { source: result.source };
    return { source: "timeout" };
  }

  function cleanCodes(list) {
    var parsed = DFParse.parseCodes(Array.isArray(list) ? list.join("\n") : "");
    return parsed;
  }

  function toEntry(code, result) {
    var status = "error";
    var detail = "Không rõ kết quả.";
    var serverCode = null;
    if (!result || result.source === "timeout") {
      detail = "Hết thời gian chờ phản hồi (15 giây).";
    } else if (result.source === "ui") {
      detail = result.text || "Không thao tác được trên trang.";
    } else if (result.source === "dialog") {
      var fromDialog = DFParse.describeDialog(result.text);
      status = fromDialog.ok ? "ok" : "error";
      detail = fromDialog.detail;
    } else if (result.source === "api") {
      var fromApi = DFParse.describeApi(result.raw);
      status = fromApi.ok ? "ok" : "error";
      detail = fromApi.detail;
      serverCode = fromApi.serverCode;
    }
    detail = DFParse.sanitizeText(detail, 500);
    if (!DFParse.isCodeToken(code)) return null;
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: new Date().toISOString(),
      code: code,
      status: status,
      detail: detail,
      serverCode: serverCode,
    };
  }

  async function appendLog(entry) {
    var data = await storageGet(["dfcode.log"]);
    var log = Array.isArray(data["dfcode.log"]) ? data["dfcode.log"].slice() : [];
    log.push(entry);
    while (log.length > 1000) log.shift();
    await storageSet({ "dfcode.log": log });
  }

  async function setRun(run) {
    var next = run || {};
    if (next.note) next.note = String(next.note).slice(0, 240);
    if (next.current && !DFParse.isCodeToken(next.current)) next.current = "";
    await storageSet({ "dfcode.run": next });
  }

  function sleepPiece(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  async function waitGap(seconds, runBase) {
    var left = Math.round(Number(seconds) || 0);
    if (left < 5) left = 5;
    if (left > 70) left = 70;
    while (left > 0) {
      if (stopFlag) return false;
      await setRun(
        Object.assign({}, runBase, {
          phase: "waiting",
          waitLeft: left,
          note: "Nghỉ " + left + " giây trước code tiếp theo.",
        }),
      );
      var slice = Math.min(1, left);
      await sleepPiece(slice * 1000);
      left -= slice;
    }
    return !stopFlag;
  }

  async function loop(queue, gap, skipped, randomGap, protect) {
    await storageSet({
      "dfcode.meta": {
        gapSec: randomGap ? 0 : gap,
        randomGap: !!randomGap,
        protect: !!protect,
        startedAt: new Date().toISOString(),
      },
    });
    badge(String(queue.length), "#06784f");
    var done = 0;
    var batchErrors = 0;
    var streak = 0;
    var endPhase = "done";
    var endNote = "Đã nhập xong " + queue.length + " code.";
    var batchCap = protect ? 30 : queue.length;
    try {
      for (var i = 0; i < queue.length; i++) {
        if (stopFlag) {
          endPhase = "stopped";
          endNote = "Đã dừng. Còn " + (queue.length - done) + " code chưa nhập.";
          break;
        }
        if (protect && done >= batchCap) {
          endPhase = "stopped";
          endNote = "Đã dừng sau 30 code để tránh nhập dồn. Bấm Bắt đầu để nhập tiếp phần còn lại.";
          break;
        }
        var code = queue[i];
        var base = {
          index: i,
          total: queue.length,
          current: code,
          waitLeft: 0,
          skipped: skipped,
        };
        await setRun(
          Object.assign({}, base, {
            phase: "running",
            note: "Đang nhập " + code + " (" + (i + 1) + "/" + queue.length + ").",
          }),
        );
        badge(String(queue.length - i), "#06784f");
        var result = await callPage("redeem", { code: code }, 20000);
        var entry = toEntry(code, result);
        if (entry) await appendLog(entry);
        done++;
        var said = (entry && entry.detail) || (result && result.text) || "";
        if (DFParse.isAccountRisk(said)) {
          endPhase = "stopped";
          endNote = "Đã dừng để bảo vệ tài khoản. Trang báo: " + String(said).slice(0, 180);
          break;
        }
        if (result && result.source === "ui") {
          endPhase = "stopped";
          endNote = entry ? entry.detail : "Không thao tác được trên trang.";
          break;
        }
        if (entry && entry.status === "error") {
          batchErrors++;
          streak++;
          if (protect && streak >= 5) {
            endPhase = "stopped";
            endNote = "Đã dừng sau 5 lỗi liên tiếp để tránh bị tính là nhập tự động.";
            break;
          }
        } else {
          streak = 0;
        }
        if (i < queue.length - 1 && !(protect && done >= batchCap)) {
          var pace = DFParse.protectPace(gap, randomGap, protect);
          var nextGap = pace.min + Math.floor(Math.random() * (pace.max - pace.min + 1));
          var continued = await waitGap(
            nextGap,
            Object.assign({}, base, { index: done, current: "" }),
          );
          if (!continued) {
            endPhase = "stopped";
            endNote = "Đã dừng. Còn " + (queue.length - done) + " code chưa nhập.";
            break;
          }
        }
      }
      await setRun({
        phase: endPhase,
        index: done,
        total: queue.length,
        current: "",
        waitLeft: 0,
        skipped: skipped,
        note: endNote,
      });
      badge("");
    } finally {
      running = false;
      starting = false;
      stopFlag = false;
    }
  }

  async function prepareAndRun(msg) {
    if (running || starting) return { ok: false, reason: "Đang chạy rồi." };
    starting = true;
    try {
      if (!/cdkgarena\.html/i.test(location.pathname)) {
        return { ok: false, reason: "Không phải trang đổi code." };
      }
      var source = Array.isArray(msg.codes) ? msg.codes.slice(0, 1000) : [];
      var clipped = [];
      for (var n = 0; n < source.length; n++) clipped.push(String(source[n] || "").slice(0, 200));
      var codes = cleanCodes(clipped);
      if (!codes.length) return { ok: false, reason: "Không có code hợp lệ." };
      var randomGap = !!msg.randomGap;
      var protect = msg.protect !== false;
      var gap = randomGap ? 0 : DFParse.clampGap(msg.gapSec);
      var queue = codes;
      var skipped = 0;
      if (msg.skipLogged !== false) {
        var stored = await storageGet(["dfcode.log"]);
        var previous = Array.isArray(stored["dfcode.log"]) ? stored["dfcode.log"] : [];
        var used = Object.create(null);
        for (var i = 0; i < previous.length; i++) {
          if (previous[i].status === "ok" || previous[i].status === "error") used[previous[i].code] = true;
        }
        queue = [];
        for (var c = 0; c < codes.length; c++) {
          if (used[codes[c]]) skipped++;
          else queue.push(codes[c]);
        }
      }
      if (!queue.length) {
        return {
          ok: false,
          reason: "Các code này đã có trong log (đã nhập hoặc lỗi). Bỏ chọn bộ lọc log nếu muốn nhập lại.",
        };
      }
      var pong = await callPage("ping", {}, 800);
      if (!pong || pong.source !== "pong") {
        return { ok: false, reason: "Trang chưa sẵn sàng. Tải lại trang đổi code (F5) rồi chạy lại." };
      }
      if (!isLoggedIn()) {
        return { ok: false, reason: "Chưa đăng nhập. Đăng nhập trên trang đổi quà rồi chạy lại." };
      }
      running = true;
      stopFlag = false;
      loop(queue, gap, skipped, randomGap, protect);
      return { ok: true, total: queue.length, skipped: skipped, gapSec: gap, randomGap: randomGap, protect: protect };
    } finally {
      if (!running) starting = false;
    }
  }

  function fromPopup(sender) {
    return !!(sender && sender.id === chrome.runtime.id && !sender.tab);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!fromPopup(sender) || !msg || typeof msg.kind !== "string") return;
    if (window.top !== window) return;
    if (msg.kind === "probe") {
      sendResponse(probe());
      return true;
    }
    if (msg.kind === "stop") {
      stopFlag = true;
      sendResponse({ ok: true });
      return true;
    }
    if (msg.kind === "start") {
      prepareAndRun(msg).then(sendResponse);
      return true;
    }
  });

  window.addEventListener("pagehide", function () {
    if (!running) return;
    stopFlag = true;
    chrome.storage.local.set({
      "dfcode.run": {
        phase: "stopped",
        index: 0,
        total: 0,
        current: "",
        waitLeft: 0,
        note: "Trang bị đóng hoặc tải lại khi đang chạy.",
      },
    });
    badge("");
  });
})();
