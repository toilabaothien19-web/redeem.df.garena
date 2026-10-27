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

  var pagePort = null;
  var pageReady = false;
  var linking = null;
  var waiters = Object.create(null);

  function onPortMessage(event) {
    var data = event.data;
    if (!data || data.kind !== "result" || !data.id || !waiters[data.id]) return;
    waiters[data.id](data);
  }

  function ensurePort() {
    if (pageReady && pagePort) return Promise.resolve(true);
    if (linking) return linking;
    linking = new Promise(function (resolve) {
      var tries = 0;
      function attempt() {
        if (pageReady) {
          resolve(true);
          return;
        }
        var channel = new MessageChannel();
        var settled = false;
        channel.port1.onmessage = function (event) {
          if (event.data && event.data.kind === "ready" && !settled) {
            settled = true;
            pageReady = true;
            pagePort = channel.port1;
            pagePort.onmessage = onPortMessage;
            resolve(true);
            return;
          }
          onPortMessage(event);
        };
        window.postMessage({ channel: CHANNEL, kind: "hello" }, location.origin, [channel.port2]);
        setTimeout(function () {
          if (settled || pageReady) return;
          tries += 1;
          if (tries >= 20) resolve(false);
          else attempt();
        }, 100);
      }
      attempt();
    });
    return linking;
  }

  function callPage(kind, payload, timeoutMs) {
    var bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    var id = Array.prototype.map.call(bytes, function (n) { return n.toString(16).padStart(2, "0"); }).join("");
    return ensurePort().then(function (ready) {
      if (!ready || !pagePort || kind !== "redeem") return { source: "unknown" };
      return new Promise(function (resolve) {
        var timer = setTimeout(function () {
          delete waiters[id];
          resolve({ source: "unknown" });
        }, timeoutMs);
        waiters[id] = function (data) {
          if (payload && payload.code && data.code !== payload.code) return;
          clearTimeout(timer);
          delete waiters[id];
          resolve(cleanResult(data.result));
        };
        pagePort.postMessage(Object.assign({ kind: "redeem", id: id }, payload || {}));
      });
    });
  }

  function cleanResult(result) {
    if (!result || typeof result !== "object") return { source: "timeout" };
    if (result.source === "api") return { source: "api", raw: DFParse.pickApiFields(result.raw) };
    if (result.source === "dialog" || result.source === "ui") {
      return { source: result.source, text: DFParse.sanitizeText(result.text, 500) };
    }
    if (result.source === "timeout" || result.source === "unknown" || result.source === "pong") return { source: result.source === "pong" ? "unknown" : result.source };
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
    if (!result || result.source === "timeout" || result.source === "unknown") {
      status = "unknown";
      detail = "Chưa xác định. Kiểm tra thủ công.";
    } else if (result.source === "ui") {
      detail = result.text || "Không thao tác được trên trang.";
    } else if (result.source === "dialog") {
      var fromDialog = DFParse.describeDialog(result.text);
      status = fromDialog.status || (fromDialog.ok ? "ok" : "error");
      detail = fromDialog.detail || detail;
    } else if (result.source === "api") {
      var fromApi = DFParse.describeApi(result.raw);
      status = fromApi.status || (fromApi.ok ? "ok" : "error");
      detail = fromApi.detail || (status === "unknown" ? "Chưa xác định. Kiểm tra thủ công." : detail);
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
    next.updatedAt = Date.now();
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

  function resumePause() {
    var tenths = 300 + Math.floor(Math.random() * 301);
    return tenths / 10;
  }

  function formatTenth(seconds) {
    return (Math.round(Number(seconds) * 10) / 10).toFixed(1).replace(".", ",");
  }

  async function waitResume(seconds, runBase) {
    var ends = Date.now() + seconds * 1000;
    while (true) {
      if (stopFlag) return false;
      var remain = Math.max(0, (ends - Date.now()) / 1000);
      var shown = Math.round(remain * 10) / 10;
      await setRun(
        Object.assign({}, runBase, {
          phase: "waiting",
          waitLeft: shown,
          note: "5 lỗi liên tiếp. Tự nhập tiếp sau " + formatTenth(shown) + " giây.",
        }),
      );
      if (remain <= 0.05) return !stopFlag;
      await sleepPiece(Math.min(100, Math.max(40, remain * 1000)));
    }
  }

  async function loop(queue, gap, skipped, randomGap, protect) {
    var done = 0;
    var streak = 0;
    var httpStreak = 0;
    var endPhase = "done";
    var endNote = "Đã nhập xong " + queue.length + " code.";
    var batchCap = protect ? 30 : Math.min(queue.length, 100);
    try {
      await storageSet({
        "dfcode.meta": {
          gapSec: randomGap ? 0 : gap,
          randomGap: !!randomGap,
          protect: !!protect,
          startedAt: new Date().toISOString(),
        },
      });
      badge(String(queue.length), "#06784f");
      for (var i = 0; i < queue.length; i++) {
        if (stopFlag) {
          endPhase = "stopped";
          endNote = "Đã dừng. Còn " + (queue.length - done) + " code chưa nhập.";
          break;
        }
        if (done >= batchCap) {
          endPhase = "stopped";
          endNote = protect
            ? "Đã dừng sau 30 code để tránh nhập dồn. Cần nghỉ trước khi bấm Bắt đầu lại."
            : "Đã dừng sau 100 code. Bấm Bắt đầu để nhập tiếp phần còn lại.";
          break;
        }
        var storedAttempts = await storageGet(["dfcode.attempts"]);
        var attempts = Array.isArray(storedAttempts["dfcode.attempts"]) ? storedAttempts["dfcode.attempts"].slice() : [];
        var quota = DFParse.quotaDecision(attempts, protect);
        if (!quota.ok) {
          endPhase = "stopped";
          endNote = quota.scope === "day"
            ? "Đã đủ số code trong 24 giờ. Có thể chạy lại lúc " + DFParse.formatClock((quota.until - Date.now()) / 1000) + "."
            : "Đã đủ số code trong 60 phút. Có thể chạy lại lúc " + DFParse.formatClock((quota.until - Date.now()) / 1000) + ".";
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
        attempts.push(Date.now());
        var fresh = [];
        for (var a = 0; a < attempts.length; a++) {
          if (Date.now() - attempts[a] < 86400000) fresh.push(attempts[a]);
        }
        if (fresh.length > 500) fresh = fresh.slice(fresh.length - 500);
        await storageSet({ "dfcode.attempts": fresh });
        var result = await callPage("redeem", { code: code }, 20000);
        var entry = toEntry(code, result);
        if (entry) await appendLog(entry);
        done++;
        var said = (entry && entry.detail) || (result && result.text) || "";
        var http = result && result.raw && result.raw.httpStatus;
        if (http === 403 || http === 429) {
          endPhase = "stopped";
          endNote = "Đã dừng vì trang trả mã " + http + ". Kiểm tra thủ công trước khi nhập tiếp.";
          break;
        }
        if (http >= 500 && http < 600) httpStreak++;
        else httpStreak = 0;
        if (httpStreak >= 2) {
          endPhase = "stopped";
          endNote = "Đã dừng sau 2 lỗi máy chủ liên tiếp.";
          break;
        }
        if (entry && entry.status === "unknown") {
          endPhase = "stopped";
          endNote = "Đã dừng vì chưa xác định được kết quả của " + code + ". Kiểm tra thủ công. Code này không bị tính là lỗi.";
          break;
        }
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
          streak++;
          if (protect && streak >= 5 && i < queue.length - 1 && done < batchCap) {
            streak = 0;
            var continued = await waitResume(
              resumePause(),
              Object.assign({}, base, { index: done, current: "" }),
            );
            if (!continued) {
              endPhase = "stopped";
              endNote = "Đã dừng trong lúc nghỉ sau 5 lỗi. Còn " + (queue.length - done) + " code chưa nhập.";
              break;
            }
            continue;
          }
        } else {
          streak = 0;
        }
        if (i < queue.length - 1 && done < batchCap) {
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
    } catch (e) {
      endPhase = "stopped";
      endNote = "Đã dừng vì lỗi nội bộ. Phiên không còn bị kẹt.";
    } finally {
      try {
        await setRun({
          phase: endPhase,
          index: done,
          total: queue.length,
          current: "",
          waitLeft: 0,
          skipped: skipped,
          note: endNote,
        });
      } catch (e2) {}
      badge("");
      running = false;
      starting = false;
      stopFlag = false;
    }
  }

  async function prepareAndRun(msg) {
    if (running || starting) return { ok: false, reason: "Đang chạy rồi." };
    starting = true;
    try {
      if (!/^\/(?:[^/]+\/)?cdkgarena\.html$/i.test(location.pathname)) {
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
      var prior = await storageGet(["dfcode.run", "dfcode.attempts"]);
      var active = prior["dfcode.run"];
      if (active && (active.phase === "running" || active.phase === "waiting") && Date.now() - (active.updatedAt || 0) < 90000) {
        return { ok: false, reason: "Đang có phiên chạy ở tab hoặc cửa sổ khác." };
      }
      var attempts = Array.isArray(prior["dfcode.attempts"]) ? prior["dfcode.attempts"] : [];
      var lastAttempt = 0;
      for (var t = 0; t < attempts.length; t++) lastAttempt = Math.max(lastAttempt, Number(attempts[t]) || 0);
      var cooldown = protect ? 60000 : 20000;
      if (lastAttempt && Date.now() - lastAttempt < cooldown) {
        var until = lastAttempt + cooldown;
        var wait = Math.ceil((until - Date.now()) / 1000);
        await storageSet({ "dfcode.restUntil": until });
        return { ok: false, reason: "Cần nghỉ " + wait + " giây trước khi bấm Bắt đầu lại.", waitSec: wait, restUntil: until };
      }
      var quota = DFParse.quotaDecision(attempts, protect);
      if (!quota.ok) {
        return {
          ok: false,
          reason: quota.scope === "day"
            ? "Đã đủ số code trong 24 giờ. Có thể chạy lại lúc " + DFParse.formatClock((quota.until - Date.now()) / 1000) + "."
            : "Đã đủ số code trong 60 phút. Có thể chạy lại lúc " + DFParse.formatClock((quota.until - Date.now()) / 1000) + ".",
        };
      }
      if (queue.length > (protect ? 30 : 100)) queue = queue.slice(0, protect ? 30 : 100);
      var ready = await ensurePort();
      if (!ready) {
        return { ok: false, reason: "Trang chưa sẵn sàng. Tải lại trang đổi code (F5) rồi chạy lại." };
      }
      if (!isLoggedIn()) {
        return { ok: false, reason: "Chưa đăng nhập. Đăng nhập trên trang đổi quà rồi chạy lại." };
      }
      running = true;
      stopFlag = false;
      await setRun({
        phase: "running",
        index: 0,
        total: queue.length,
        current: "",
        waitLeft: 0,
        skipped: skipped,
        note: "Đang bắt đầu.",
      });
      loop(queue, gap, skipped, randomGap, protect).catch(function () {
        running = false;
        starting = false;
      });
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
