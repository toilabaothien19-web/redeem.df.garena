/* DF Code Garena — điều phối trên tab đổi quà (thế giới tách biệt của tiện ích).
 *
 * Nhận lệnh Bắt đầu từ popup, nhập từng code qua inject.js, ghi log và trạng thái vào
 * chrome.storage.local. Popup đóng vẫn chạy tiếp. Không có lệnh mạng nào trong file này.
 */
(function () {
  "use strict";
  if (window.__dfCodeRunner) return;
  window.__dfCodeRunner = true;
  if (window.top !== window) return;

  const P = globalThis.DFParse;
  const K = P.KEYS;
  const CHANNEL = "dfcode-garena-v2";
  const VERSION = chrome.runtime.getManifest().version;
  /* Lượt log ghi bản "garena" để không lẫn với lượt bản quốc tế nạp từ file log của bản 1.1.0. */
  const SITE = "garena";

  const state = {
    running: false,
    starting: false,
    stopping: false,
    owner: "",
    startedAt: 0,
    run: null,
    wake: null,
  };

  /* ---------- Lưu trữ ---------- */

  function get(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (data) {
        void chrome.runtime.lastError;
        resolve(data || {});
      });
    });
  }

  function set(values) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(values, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  async function setRun(run) {
    const next = Object.assign({}, run, { owner: state.owner, updatedAt: Date.now() });
    if (next.note) next.note = String(next.note).slice(0, 300);
    if (next.current && !P.isCodeToken(next.current)) next.current = "";
    state.run = next;
    await set({ [K.run]: next });
  }

  async function stillOwner() {
    const data = await get([K.run]);
    const run = data[K.run];
    return !!(run && run.owner === state.owner);
  }

  async function appendLog(entry) {
    if (!entry) return;
    const data = await get([K.log]);
    const log = Array.isArray(data[K.log]) ? data[K.log].slice() : [];
    log.push(entry);
    /* Đầy thì bỏ lượt cũ đã có lượt khác thay thế trước, để không mất thông tin bỏ qua code. */
    await set({ [K.log]: P.capLog(log, P.LIMITS.logCap) });
  }

  function badge(text, tone) {
    try {
      chrome.runtime.sendMessage({ kind: "badge", text: String(text || ""), tone: tone || "run" }, function () {
        void chrome.runtime.lastError;
      });
    } catch (e) {}
  }

  /* ---------- Trang ---------- */

  function shown(el) {
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden";
  }

  function isLoggedIn() {
    const loggedOut = document.querySelector("#unlogin");
    if (loggedOut && shown(loggedOut)) return false;
    const loggedIn = document.querySelector("#logined");
    if (!loggedIn || !shown(loggedIn)) return false;
    const after = document.querySelector(".state-after");
    if (after && !shown(after)) return false;
    return !!document.querySelector("input.exc-input, .exc-input");
  }

  /* ---------- Kênh riêng với inject.js ----------
   * Bắt tay ngay lúc tải trang, trước khi script của trang chạy, nên script khác trên trang không xin được kênh
   * để ra lệnh nhập code. Kết quả từ trang vẫn coi là dữ liệu không tin cậy: chỉ được làm sạch rồi ghi thành chữ. */

  let pagePort = null;
  let linking = null;
  const waiters = new Map();

  function onPortMessage(event) {
    const data = event.data;
    if (!data || data.kind !== "result" || typeof data.id !== "string") return;
    const waiter = waiters.get(data.id);
    if (waiter) waiter(data);
  }

  function ensurePort() {
    if (pagePort) return Promise.resolve(true);
    if (linking) return linking;
    linking = new Promise(function (resolve) {
      let tries = 0;
      const spare = [];
      function attempt() {
        if (pagePort) return;
        const channel = new MessageChannel();
        spare.push(channel.port1);
        channel.port1.onmessage = function (event) {
          if (pagePort || !event.data || event.data.kind !== "ready") return;
          pagePort = channel.port1;
          pagePort.onmessage = onPortMessage;
          for (let i = 0; i < spare.length; i++) if (spare[i] !== pagePort) spare[i].close();
          resolve(true);
        };
        window.postMessage({ channel: CHANNEL, kind: "hello" }, location.origin, [channel.port2]);
        setTimeout(function () {
          if (pagePort) return;
          tries += 1;
          if (tries >= 20) {
            linking = null;
            resolve(false);
          } else {
            attempt();
          }
        }, 100);
      }
      attempt();
    });
    return linking;
  }

  function randomHex(bytes) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return Array.prototype.map.call(buf, function (n) { return n.toString(16).padStart(2, "0"); }).join("");
  }

  function cleanResult(result) {
    if (!result || typeof result !== "object") return { source: "timeout" };
    if (result.source === "api") return { source: "api", raw: P.pickApiFields(result.raw) };
    if (result.source === "dialog" || result.source === "ui") {
      return { source: result.source, text: P.sanitizeText(result.text) };
    }
    return { source: result.source === "timeout" ? "timeout" : "unknown" };
  }

  function callPage(code) {
    return ensurePort().then(function (ready) {
      if (!ready || !pagePort) return { source: "ui", text: "Trang chưa sẵn sàng. Tải lại trang đổi code (F5)." };
      const id = randomHex(12);
      return new Promise(function (resolve) {
        const timer = setTimeout(function () {
          waiters.delete(id);
          resolve({ source: "timeout" });
        }, P.LIMITS.pageTimeoutMs);
        waiters.set(id, function (data) {
          if (data.code !== code) return;
          clearTimeout(timer);
          waiters.delete(id);
          resolve(cleanResult(data.result));
        });
        pagePort.postMessage({ kind: "redeem", id: id, code: code });
      });
    });
  }

  /* ---------- Nghỉ ---------- */

  function nap(ms) {
    return new Promise(function (resolve) {
      const timer = setTimeout(done, Math.max(0, ms));
      function done() {
        clearTimeout(timer);
        if (state.wake === done) state.wake = null;
        resolve();
      }
      state.wake = done;
    });
  }

  /* Ghi một lần mốc kết thúc để popup tự đếm ngược; chỉ nhắc lại mỗi 10 giây để báo phiên còn sống. */
  async function rest(seconds, kind, base) {
    const until = Date.now() + Math.max(0, Number(seconds) || 0) * 1000;
    const note = kind === "errors"
      ? "5 lỗi liên tiếp. Tự nhập tiếp sau " + P.formatTenth(seconds) + " giây."
      : "Nghỉ " + Math.round(seconds) + " giây trước code tiếp theo.";
    await setRun(Object.assign({}, base, { phase: "waiting", wait: { kind: kind, until: until, seconds: seconds }, note: note }));
    badge(base.total - base.index, "wait");
    while (!state.stopping) {
      const left = until - Date.now();
      if (left <= 0) break;
      await nap(Math.min(left, P.LIMITS.heartbeatMs));
      if (!state.stopping && until - Date.now() > 0) await setRun(state.run);
    }
    return !state.stopping;
  }

  /* ---------- Vòng nhập ---------- */

  async function loop(queue, settings, skipped) {
    const ctx = { streak: 0, http5xx: 0 };
    const tally = { ok: 0, error: 0, unknown: 0 };
    let done = 0;
    let lost = false;
    let end = { phase: "done", note: "Đã nhập xong " + queue.length + " code." };

    function base(extra) {
      return Object.assign({
        phase: "running",
        startedAt: state.startedAt,
        total: queue.length,
        index: done,
        skipped: skipped,
        settings: settings,
        tally: Object.assign({}, tally),
        current: "",
        wait: null,
        note: "",
        site: SITE,
      }, extra || {});
    }

    function stoppedNote(prefix) {
      const left = queue.length - done;
      return (prefix || "Đã dừng.") + (left > 0 ? " Còn " + left + " code chưa nhập." : "");
    }

    try {
      for (let i = 0; i < queue.length; i++) {
        if (state.stopping) {
          end = { phase: "stopped", note: stoppedNote() };
          break;
        }
        if (!(await stillOwner())) {
          lost = true;
          break;
        }
        if (!isLoggedIn()) {
          end = { phase: "stopped", note: stoppedNote("Đã dừng vì trang không còn đăng nhập.") };
          break;
        }
        const stored = await get([K.attempts]);
        const attempts = P.cleanAttempts(stored[K.attempts], Date.now());
        const q = P.quota(attempts, settings.protect, Date.now());
        if (!q.ok) {
          end = { phase: "stopped", note: P.quotaReason(q, Date.now()) };
          break;
        }

        const code = queue[i];
        await setRun(base({ current: code, note: "Đang nhập " + code + " (" + (i + 1) + "/" + queue.length + ")." }));
        badge(queue.length - i, "run");
        const stamp = Date.now();
        attempts.push(stamp);
        await set({ [K.attempts]: attempts });

        const result = await callPage(code);
        if (result.source === "ui") {
          /* Code chưa được gửi: trả lại lượt đã tính vào hạn mức. */
          const again = await get([K.attempts]);
          const list = P.cleanAttempts(again[K.attempts], Date.now());
          const at = list.lastIndexOf(stamp);
          if (at !== -1) list.splice(at, 1);
          await set({ [K.attempts]: list });
        }
        const entry = P.toEntry(code, result, new Date(), SITE);
        await appendLog(entry);
        done++;
        if (entry) tally[entry.status]++;

        const verdict = P.judge(entry, result, ctx, settings);
        if (verdict.action === "stop") {
          end = { phase: "stopped", note: stoppedNote(P.sentence(verdict.note)) };
          break;
        }
        if (i === queue.length - 1) break;

        if (verdict.action === "pause") {
          if (!(await rest(P.errorPause(), "errors", base()))) {
            end = { phase: "stopped", note: stoppedNote("Đã dừng trong lúc nghỉ sau 5 lỗi.") };
            break;
          }
          continue;
        }
        if (!(await rest(P.pickGap(settings), "gap", base()))) {
          end = { phase: "stopped", note: stoppedNote() };
          break;
        }
      }
    } catch (e) {
      end = { phase: "stopped", note: "Đã dừng vì lỗi nội bộ. Phiên không bị kẹt. Nếu lặp lại, tải lại trang đổi code." };
    } finally {
      if (!lost) {
        try {
          await setRun(base({ phase: end.phase, note: end.note }));
        } catch (e) {}
      }
      badge("");
      state.running = false;
      state.stopping = false;
      state.wake = null;
    }
  }

  async function start(msg) {
    if (state.running || state.starting) return { ok: false, reason: "Đang chạy rồi." };
    state.starting = true;
    try {
      if (!P.isRedeemUrl(location.href)) return { ok: false, reason: "Không phải trang đổi code." };
      const list = Array.isArray(msg.codes) ? msg.codes.slice(0, P.LIMITS.maxCodes) : [];
      const text = list.map(function (c) { return String(c == null ? "" : c).slice(0, 200); }).join("\n");
      const codes = P.analyzeCodes(text).codes;
      const settings = P.normalizeSettings(msg.settings);
      const now = Date.now();
      const data = await get([K.log, K.run, K.attempts]);
      if (P.isRunActive(data[K.run], now)) return { ok: false, reason: "Đang có phiên chạy ở tab hoặc cửa sổ khác." };
      const plan = P.plan({ codes: codes, log: data[K.log], settings: settings, attempts: data[K.attempts], now: now, site: SITE });
      if (!plan.ok) return { ok: false, reason: plan.reason, until: plan.until };
      if (!(await ensurePort())) {
        return { ok: false, reason: "Trang chưa sẵn sàng. Tải lại trang đổi code (F5) rồi thử lại." };
      }
      if (!isLoggedIn()) return { ok: false, reason: "Chưa đăng nhập. Đăng nhập trên trang đổi quà rồi thử lại." };

      state.owner = randomHex(8);
      state.startedAt = Date.now();
      state.stopping = false;
      state.running = true;
      await setRun({
        phase: "running",
        startedAt: state.startedAt,
        total: plan.queue.length,
        index: 0,
        skipped: plan.skipped,
        settings: settings,
        tally: { ok: 0, error: 0, unknown: 0 },
        current: "",
        wait: null,
        note: "Đang bắt đầu.",
        site: SITE,
      });
      await set({ [K.meta]: { version: VERSION, site: SITE, settings: settings, startedAt: new Date(state.startedAt).toISOString() } });
      loop(plan.queue, settings, plan.skipped).catch(function () {
        state.running = false;
      });
      return { ok: true, total: plan.queue.length, skipped: plan.skipped, fresh: plan.fresh, settings: settings };
    } finally {
      state.starting = false;
    }
  }

  function requestStop() {
    if (!state.running) return;
    state.stopping = true;
    if (state.wake) state.wake();
  }

  /* ---------- Lệnh từ popup ---------- */

  function fromPopup(sender) {
    return !!(sender && sender.id === chrome.runtime.id && !sender.tab);
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!fromPopup(sender) || !msg || typeof msg.kind !== "string") return;
    if (msg.kind === "probe") {
      sendResponse({ ok: true, loggedIn: isLoggedIn(), running: state.running, version: VERSION });
      return;
    }
    if (msg.kind === "stop") {
      requestStop();
      sendResponse({ ok: true });
      return;
    }
    if (msg.kind === "start") {
      start(msg).then(sendResponse, function () {
        sendResponse({ ok: false, reason: "Không bắt đầu được. Tải lại trang đổi code rồi thử lại." });
      });
      return true;
    }
  });

  /* Popup ở bất kỳ tab nào cũng dừng được: nó ghi mốc thời gian vào khóa dfcode.stop. */
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local" || !changes[K.stop]) return;
    const at = Number(changes[K.stop].newValue) || 0;
    if (state.running && at >= state.startedAt) requestStop();
  });

  window.addEventListener("pagehide", function () {
    if (!state.running) return;
    state.stopping = true;
    const run = Object.assign({}, state.run || {}, {
      owner: state.owner,
      phase: "stopped",
      current: "",
      wait: null,
      updatedAt: Date.now(),
      note: "Trang bị đóng hoặc tải lại khi đang chạy.",
    });
    try {
      chrome.storage.local.set({ [K.run]: run });
    } catch (e) {}
    badge("");
  });

  ensurePort();
})();
