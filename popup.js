/* DF Code Garena — popup.
 * Chỉ đọc/ghi chrome.storage.local và nhắn tin với tab đổi quà. Không có lệnh mạng;
 * CSP của trang này chặn mọi kết nối (connect-src 'none'). */
(function () {
  "use strict";

  const P = window.DFParse;
  const K = P.KEYS;
  const $ = function (id) { return document.getElementById(id); };
  const hasChrome = typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id);
  const VERSION = hasChrome ? chrome.runtime.getManifest().version : "";
  const VIEW_CAP = 300;

  const el = {};
  [
    "ver", "status", "statusBox", "statusAction", "codes", "count", "parseNote", "pick", "demo", "clearCodes", "file",
    "protect", "protectInfo", "freePace", "randomGap", "gapBlock", "gap", "gapValue", "skipLogged",
    "statTotal", "statFresh", "statQueue", "skipNote", "quota", "eta", "start", "stop", "progressBox", "barWrap", "bar", "runTally",
    "progress", "logCount", "fAll", "fOk", "fError", "fUnknown", "log", "logMore", "export", "importLog", "clearLog",
    "logFile", "ask", "askText", "askYes", "askNo",
  ].forEach(function (id) { el[id] = $(id); });

  const model = {
    log: [],
    run: null,
    attempts: [],
    meta: {},
    tab: { id: null, state: hasChrome ? "checking" : "preview", running: false },
    filter: "all",
    flash: null,
    starting: false,
    stopAt: 0,
    topId: "",
  };

  /* ---------- Tiện ích nhỏ ---------- */

  function put(node, value) {
    const text = String(value);
    if (node.textContent !== text) node.textContent = text;
  }

  function tone(node, name) {
    node.classList.remove("ok", "bad", "warn");
    if (name) node.classList.add(name);
  }

  function fold(node, open) {
    const closed = node.classList.contains("is-closed");
    if (open && closed) {
      node.classList.remove("is-closed");
      node.inert = false;
    } else if (!open && !closed) {
      node.classList.add("is-closed");
      node.inert = true;
    }
  }

  function tickStat(node, value) {
    const text = String(value);
    if (node.textContent === text) return;
    if (node.dataset.ready === "1") {
      node.classList.remove("tick");
      void node.offsetWidth;
      node.classList.add("tick");
    }
    node.textContent = text;
    node.dataset.ready = "1";
  }

  function flash(text, kind) {
    model.flash = { text: text, kind: kind || "", at: Date.now() };
    renderRun(Date.now());
  }

  function storageSet(values) {
    if (!hasChrome) return Promise.resolve();
    return new Promise(function (resolve) {
      chrome.storage.local.set(values, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    });
  }

  function send(tabId, message) {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(tabId, message, function (response) {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function ask(text, yesLabel) {
    return new Promise(function (resolve) {
      el.askText.textContent = text;
      el.askYes.textContent = yesLabel || "Đồng ý";
      function done(value) {
        el.askYes.removeEventListener("click", onYes);
        el.askNo.removeEventListener("click", onNo);
        el.ask.removeEventListener("cancel", onCancel);
        if (el.ask.open) el.ask.close();
        resolve(value);
      }
      function onYes() { done(true); }
      function onNo() { done(false); }
      function onCancel(event) {
        event.preventDefault();
        done(false);
      }
      el.askYes.addEventListener("click", onYes);
      el.askNo.addEventListener("click", onNo);
      el.ask.addEventListener("cancel", onCancel);
      el.ask.showModal();
      el.askNo.focus();
    });
  }

  function copyText(text, done) {
    function fallback() {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch (e) {}
      area.remove();
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function download(name, text) {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function stampName() {
    const d = new Date();
    const p = function (n) { return String(n).padStart(2, "0"); };
    return "df-code-log-" + d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate())
      + "_" + p(d.getHours()) + "-" + p(d.getMinutes()) + "-" + p(d.getSeconds()) + ".txt";
  }

  function readTextFile(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file, "utf-8");
    });
  }

  /* ---------- Trạng thái suy ra ---------- */

  function settings() {
    return P.normalizeSettings({
      protect: el.protect.checked,
      randomGap: el.randomGap.checked,
      gapSec: el.gap.value,
      skipLogged: el.skipLogged.checked,
    });
  }

  let analysisCache = { text: null, value: null };
  function analysis() {
    const text = el.codes.value;
    if (analysisCache.text !== text) analysisCache = { text: text, value: P.analyzeCodes(text) };
    return analysisCache.value;
  }

  let overlapCache = { log: null, codes: null, value: null };
  function overlapNow(codes) {
    if (overlapCache.log !== model.log || overlapCache.codes !== codes) {
      overlapCache = { log: model.log, codes: codes, value: P.overlap(codes, model.log) };
    }
    return overlapCache.value;
  }

  function describeOverlap(ov, skipLogged) {
    const done = ov.ok + ov.error;
    const parts = [];
    if (ov.ok) parts.push(ov.ok + " dùng được");
    if (ov.error) parts.push(ov.error + " lỗi");
    let text = "";
    if (done && skipLogged) text = "Bỏ qua " + done + " code đã có trong log: " + parts.join(", ") + ".";
    else if (done) text = "Đã tắt bỏ qua: " + done + " code đã có trong log (" + parts.join(", ") + ") sẽ được nhập lại.";
    if (ov.unknown) text += (text ? " " : "") + ov.unknown + " code từng ghi chưa rõ sẽ được nhập lại.";
    return text;
  }

  function runActive(now) {
    return P.isRunActive(model.run, now || Date.now());
  }

  /* ---------- Vẽ ---------- */

  function renderSettings() {
    const s = settings();
    const active = runActive();
    fold(el.freePace, !s.protect);
    fold(el.gapBlock, !s.protect && !s.randomGap);
    el.protectInfo.hidden = !s.protect;
    put(el.gapValue, s.gapSec + " giây");
    el.protect.disabled = active;
    el.randomGap.disabled = active;
    el.gap.disabled = active;
    el.skipLogged.disabled = active;
  }

  function setStatus(text, toneName, action) {
    put(el.status, text);
    el.statusBox.dataset.tone = toneName || "idle";
    if (action) {
      put(el.statusAction, action);
      el.statusAction.hidden = false;
    } else {
      el.statusAction.hidden = true;
    }
  }

  function renderStatus(now) {
    if (!hasChrome) {
      setStatus("Bản xem trước. Cài tiện ích rồi mở trang đổi code để dùng.", "idle");
      return;
    }
    if (runActive(now)) {
      setStatus(
        model.tab.running
          ? "Đang nhập code trên trang này. Đóng popup không làm dừng."
          : "Đang nhập code ở một tab đổi quà khác. Bấm Dừng nếu muốn dừng.",
        "run",
      );
      return;
    }
    switch (model.tab.state) {
      case "other":
        setStatus("Chỉ chạy trên trang đổi code Garena.", "warn", "Mở trang");
        break;
      case "reload":
        setStatus("Trang đổi code cần tải lại (F5) để tiện ích kết nối.", "warn", "Tải lại");
        break;
      case "loggedOut":
        setStatus("Trang đang mở nhưng chưa đăng nhập Garena.", "warn");
        break;
      case "ready":
        setStatus("Sẵn sàng trên trang đổi code.", "ready");
        break;
      default:
        setStatus("Đang kiểm tra trang…", "idle");
    }
  }

  function renderPlan(now) {
    const a = analysis();
    const s = settings();
    const active = runActive(now);
    const pl = P.plan({ codes: a.codes, log: model.log, settings: s, attempts: model.attempts, now: now });
    const room = Math.min(pl.fresh, pl.perRun, pl.quota.left);

    put(el.count, a.codes.length + " code");
    const notes = [];
    if (a.duplicates) notes.push("bỏ " + a.duplicates + " code trùng");
    if (a.ignored) notes.push(a.ignored + " dòng không nhận ra code");
    if (a.truncated) notes.push("chỉ lấy " + P.LIMITS.maxCodes + " code đầu");
    el.parseNote.hidden = !notes.length;
    put(el.parseNote, notes.length ? notes.join(", ").replace(/^./, function (c) { return c.toUpperCase(); }) + "." : "");

    tickStat(el.statTotal, a.codes.length);
    tickStat(el.statFresh, pl.fresh);
    put(el.skipNote, describeOverlap(overlapNow(a.codes), s.skipLogged));
    tickStat(el.statQueue, active ? Math.max(0, (model.run.total || 0) - (model.run.index || 0)) : room);

    const q = pl.quota;
    put(el.quota, "Hạn mức còn " + Math.max(0, q.capHour - q.usedHour) + "/" + q.capHour + " trong 60 phút · "
      + Math.max(0, q.capDay - q.usedDay) + "/" + q.capDay + " trong 24 giờ.");

    if (active) {
      const run = model.run;
      const left = Math.max(0, (run.total || 0) - (run.index || 0));
      const waitLeft = run.phase === "waiting" && run.wait ? Math.max(0, (run.wait.until - now) / 1000) : 0;
      const est = P.estimate(left, run.settings, waitLeft);
      put(el.eta, left ? "Còn " + left + " code. " + P.describeEstimate(est, now) : "");
      tone(el.eta, "");
    } else if (!a.codes.length) {
      put(el.eta, "Dán code hoặc mở file .txt để bắt đầu.");
      tone(el.eta, "");
    } else if (!pl.ok) {
      put(el.eta, pl.reason);
      tone(el.eta, "warn");
    } else {
      const est = P.estimate(pl.queue.length, s, 0);
      let text = "Lần này nhập " + pl.queue.length + " code. " + P.describeEstimate(est, now);
      if (pl.fresh > pl.queue.length) text += " Còn " + (pl.fresh - pl.queue.length) + " code cho lần sau.";
      put(el.eta, text);
      tone(el.eta, "");
    }

    const canStart = hasChrome && !active && !model.starting && model.tab.state === "ready" && pl.ok;
    el.start.disabled = !canStart;
    put(el.start, active ? "Đang chạy…" : model.starting ? "Đang bắt đầu…" : canStart ? "Bắt đầu · " + pl.queue.length + " code" : "Bắt đầu");
  }

  function renderRun(now) {
    const run = model.run;
    const active = runActive(now);
    el.stop.disabled = !hasChrome || !active || (model.stopAt && run && model.stopAt >= (run.startedAt || 0));

    const showRun = run && run.total && run.phase && run.phase !== "idle";
    el.progressBox.hidden = !showRun;
    if (showRun) {
      const stale = !active && (run.phase === "running" || run.phase === "waiting");
      el.progressBox.dataset.phase = stale ? "stopped" : run.phase;
      const index = Math.min(run.total, run.index || 0);
      el.bar.style.width = Math.round((index / run.total) * 100) + "%";
      el.barWrap.setAttribute("aria-valuemax", String(run.total));
      el.barWrap.setAttribute("aria-valuenow", String(index));
      const t = run.tally || {};
      const bits = [index + "/" + run.total + " code", (t.ok || 0) + " dùng được", (t.error || 0) + " lỗi"];
      if (t.unknown) bits.push(t.unknown + " chưa rõ");
      if (run.skipped) bits.push("bỏ qua " + run.skipped + " code đã có trong log");
      put(el.runTally, bits.join(" · "));
    }

    let line = "Chưa chạy.";
    let kind = "";
    if (run && run.phase && run.phase !== "idle") {
      if (active && run.phase === "waiting" && run.wait) {
        const left = Math.max(0, (run.wait.until - now) / 1000);
        line = run.wait.kind === "errors"
          ? "5 lỗi liên tiếp. Tự nhập tiếp sau " + P.formatTenth(left) + " giây."
          : "Nghỉ " + Math.ceil(left) + " giây trước code tiếp theo.";
      } else if (active) {
        line = run.note || "Đang chạy.";
      } else if (run.phase === "running" || run.phase === "waiting") {
        line = "Phiên trước bị ngắt giữa chừng (trang hoặc trình duyệt đã đóng).";
        kind = "warn";
      } else {
        line = run.note || "Đã dừng.";
        kind = run.phase === "done" ? "ok" : "warn";
      }
    }
    const f = model.flash;
    if (f && now - f.at < 8000 && (!run || !active || f.at > (run.updatedAt || 0))) {
      line = f.text;
      kind = f.kind;
    }
    put(el.progress, line);
    tone(el.progress, kind);
  }

  function makeEntry(e, fresh) {
    const status = e.status === "ok" || e.status === "unknown" ? e.status : "error";
    const li = document.createElement("li");
    li.className = status === "ok" ? "ok" : status === "unknown" ? "wait" : "bad";
    if (fresh) li.classList.add("fresh");

    const head = document.createElement("div");
    head.className = "head";
    const code = document.createElement("b");
    code.textContent = e.code;
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = status === "ok" ? "Dùng được" : status === "unknown" ? "Chưa rõ" : "Lỗi";
    head.append(code, tag);

    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = e.detail || "";

    const foot = document.createElement("div");
    foot.className = "foot-row";
    const time = document.createElement("time");
    time.textContent = P.entryTime(e) || "từ file log";
    if (e.at) time.dateTime = e.at;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "small";
    copy.textContent = status === "error" ? "Chép mã lỗi" : "Chép code";
    copy.addEventListener("click", function () {
      const text = status === "ok" ? e.code : e.code + "\t" + (e.detail || "");
      copyText(text, function () {
        copy.textContent = "Đã chép";
        setTimeout(function () { copy.textContent = status === "error" ? "Chép mã lỗi" : "Chép code"; }, 1200);
      });
    });
    foot.append(time, copy);

    li.append(head, detail, foot);
    return li;
  }

  function renderLog() {
    const counts = P.tally(model.log);
    put(el.fAll, counts.all);
    put(el.fOk, counts.ok);
    put(el.fError, counts.error);
    put(el.fUnknown, counts.unknown);
    put(el.logCount, counts.all ? counts.all + " lượt" : "");
    document.querySelectorAll(".chip").forEach(function (chip) {
      chip.setAttribute("aria-pressed", chip.dataset.filter === model.filter ? "true" : "false");
    });

    const newest = model.log.length ? model.log[model.log.length - 1] : null;
    const newestId = newest && newest.id ? newest.id : "";
    const changedTop = !!(model.topId && newestId && newestId !== model.topId);

    const frag = document.createDocumentFragment();
    let shown = 0;
    for (let i = model.log.length - 1; i >= 0 && shown < VIEW_CAP; i--) {
      const e = model.log[i];
      if (!e) continue;
      const status = e.status === "ok" || e.status === "unknown" ? e.status : "error";
      if (model.filter !== "all" && status !== model.filter) continue;
      frag.appendChild(makeEntry(e, changedTop && shown === 0 && e === newest));
      shown++;
    }
    el.log.textContent = "";
    el.log.appendChild(frag);
    el.log.dataset.filtered = model.filter === "all" ? "0" : "1";
    if (changedTop) el.log.scrollTo({ top: 0, behavior: "smooth" });
    model.topId = newestId;

    const matching = model.filter === "all" ? counts.all : counts[model.filter];
    el.logMore.hidden = matching <= VIEW_CAP;
    put(el.logMore, matching > VIEW_CAP ? "Đang hiện " + VIEW_CAP + "/" + matching + " dòng mới nhất. Xuất log để xem đủ." : "");
    renderLogButtons(Date.now());
  }

  function renderLogButtons(now) {
    const active = runActive(now);
    el.export.disabled = !model.log.length;
    el.clearLog.disabled = !model.log.length || active;
    el.importLog.disabled = active;
  }

  function renderDynamic() {
    const now = Date.now();
    renderLogButtons(now);
    renderSettings();
    renderStatus(now);
    renderPlan(now);
    renderRun(now);
  }

  function renderAll() {
    renderDynamic();
    renderLog();
  }

  /* ---------- Tab đổi quà ---------- */

  async function refreshTab() {
    if (!hasChrome) return;
    let tab = null;
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      tab = tabs && tabs[0];
    } catch (e) {
      tab = null;
    }
    /* Không có quyền đọc địa chỉ tab thì hỏi thẳng tab: chỉ trang đổi code mới có runner.js để trả lời. */
    const knownUrl = !!(tab && tab.url);
    if (!tab || !tab.id || (knownUrl && !P.isRedeemUrl(tab.url))) {
      model.tab = { id: null, state: "other", running: false };
    } else {
      const res = await send(tab.id, { kind: "probe" });
      if (res && res.ok) {
        model.tab = { id: tab.id, state: res.loggedIn ? "ready" : "loggedOut", running: !!res.running };
      } else if (!knownUrl) {
        model.tab = { id: null, state: "other", running: false };
      } else {
        model.tab = { id: tab.id, state: tab.status === "loading" ? "checking" : "reload", running: false };
      }
    }
    renderDynamic();
  }

  /* ---------- Lưu trữ ---------- */

  function persistSettings() {
    storageSet({
      [K.gap]: el.gap.value,
      [K.random]: el.randomGap.checked,
      [K.skipLogged]: el.skipLogged.checked,
      [K.protect]: el.protect.checked,
    });
  }

  function persistDraft() {
    storageSet({ [K.draft]: el.codes.value });
  }

  function setCodes(text) {
    el.codes.value = text;
    persistDraft();
    renderDynamic();
  }

  function apply(data) {
    if (typeof data[K.draft] === "string" && document.activeElement !== el.codes) el.codes.value = data[K.draft];
    if ((typeof data[K.gap] === "string" || typeof data[K.gap] === "number") && document.activeElement !== el.gap) {
      el.gap.value = String(P.clampGap(data[K.gap]));
    }
    if (typeof data[K.random] === "boolean") el.randomGap.checked = data[K.random];
    if (typeof data[K.skipLogged] === "boolean") el.skipLogged.checked = data[K.skipLogged];
    if (typeof data[K.protect] === "boolean") el.protect.checked = data[K.protect];
    if (K.attempts in data) model.attempts = Array.isArray(data[K.attempts]) ? data[K.attempts] : [];
    if (K.meta in data) model.meta = data[K.meta] && typeof data[K.meta] === "object" ? data[K.meta] : {};
    if (K.run in data) model.run = data[K.run] && typeof data[K.run] === "object" ? data[K.run] : null;
    if (K.log in data) {
      model.log = Array.isArray(data[K.log]) ? data[K.log].filter(function (e) { return e && P.isCodeToken(e.code); }) : [];
      renderLog();
    }
    renderDynamic();
  }

  /* ---------- Sự kiện ---------- */

  el.codes.addEventListener("input", function () {
    persistDraft();
    renderDynamic();
  });
  el.codes.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !el.start.disabled) {
      event.preventDefault();
      el.start.click();
    }
  });
  el.gap.addEventListener("input", function () {
    persistSettings();
    renderDynamic();
  });
  [el.protect, el.randomGap, el.skipLogged].forEach(function (node) {
    node.addEventListener("change", function () {
      persistSettings();
      renderDynamic();
    });
  });

  el.statusAction.addEventListener("click", function () {
    if (!hasChrome) return;
    if (model.tab.state === "other") {
      chrome.tabs.create({ url: P.REDEEM_PAGE });
      window.close();
    } else if (model.tab.state === "reload" && model.tab.id) {
      chrome.tabs.reload(model.tab.id);
      model.tab.state = "checking";
      renderDynamic();
    }
  });

  el.pick.addEventListener("click", function () { el.file.click(); });
  el.file.addEventListener("change", async function () {
    const file = el.file.files && el.file.files[0];
    el.file.value = "";
    if (!file) return;
    if (file.size > P.LIMITS.maxFileBytes) {
      flash("File quá lớn. Chỉ nhận file .txt dưới 200 KB.", "bad");
      return;
    }
    try {
      const text = await readTextFile(file);
      const before = analysis().codes.length;
      setCodes(el.codes.value.trim() ? el.codes.value.replace(/\s*$/, "") + "\n" + text : text);
      flash("Đã nạp " + file.name + ": thêm " + Math.max(0, analysis().codes.length - before) + " code.", "ok");
    } catch (e) {
      flash("Không đọc được file.", "bad");
    }
  });

  el.demo.addEventListener("click", async function () {
    const list = Array.isArray(window.DFDemoCodes) ? window.DFDemoCodes : [];
    if (!list.length) {
      flash("Không nạp được Demo Code.", "bad");
      return;
    }
    const replacing = el.codes.value.trim() !== "";
    const ok = await ask(
      "Demo Code là danh sách mẫu " + list.length + " code, có thể đã hết hạn. Mỗi code sai là một lần thử trên tài khoản của bạn."
        + (replacing ? " Danh sách đang có sẽ bị thay." : "") + " Nạp danh sách này?",
      "Nạp Demo Code",
    );
    if (!ok) return;
    setCodes(list.join("\n"));
    flash("Đã nạp " + list.length + " Demo Code.", "ok");
  });

  el.clearCodes.addEventListener("click", async function () {
    if (!el.codes.value.trim()) return;
    if (!(await ask("Xóa toàn bộ danh sách code trong ô? Log không bị xóa.", "Xóa danh sách"))) return;
    setCodes("");
    flash("Đã xóa danh sách code.");
  });

  document.querySelectorAll(".chip").forEach(function (chip) {
    chip.addEventListener("click", function () {
      model.filter = chip.dataset.filter || "all";
      model.topId = "";
      renderLog();
    });
  });

  el.start.addEventListener("click", async function () {
    if (!hasChrome || model.starting || model.tab.state !== "ready" || !model.tab.id) return;
    const a = analysis();
    const s = settings();
    const pl = P.plan({ codes: a.codes, log: model.log, settings: s, attempts: model.attempts, now: Date.now() });
    if (!pl.ok) {
      flash(pl.reason, "warn");
      return;
    }
    if (!s.protect) {
      const ok = await ask(
        "Đã tắt bảo vệ tài khoản. Lần này nhập tối đa " + pl.queue.length
          + " code, vẫn là nhập tự động trên tài khoản của bạn. Tiếp tục?",
        "Vẫn bắt đầu",
      );
      if (!ok) return;
    }
    model.starting = true;
    flash("Đang bắt đầu…");
    renderDynamic();
    const res = await send(model.tab.id, { kind: "start", codes: a.codes, settings: s });
    model.starting = false;
    if (!res || !res.ok) {
      flash((res && res.reason) || "Không gửi được lệnh. Tải lại trang đổi code (F5).", "bad");
      refreshTab();
      return;
    }
    flash(
      "Bắt đầu " + res.total + " code, " + P.describePace(s).replace(/^[^,]+, /, "") + "."
        + (res.skipped ? " Bỏ qua " + res.skipped + " code đã có trong log." : ""),
      "ok",
    );
    refreshTab();
  });

  el.stop.addEventListener("click", async function () {
    if (!hasChrome) return;
    model.stopAt = Date.now();
    el.stop.disabled = true;
    await storageSet({ [K.stop]: model.stopAt });
    if (model.tab.id && model.tab.running) send(model.tab.id, { kind: "stop" });
    flash("Sẽ dừng sau code đang nhập, hoặc ngay nếu đang nghỉ.");
  });

  el.export.addEventListener("click", function () {
    if (!model.log.length) return;
    const text = P.formatLog(model.log, {
      exportedAt: new Date().toISOString(),
      version: VERSION,
      settings: (model.meta && model.meta.settings) || settings(),
    });
    download(stampName(), text);
    flash("Đã xuất log. Đọc file trước khi chia sẻ.", "ok");
  });

  el.importLog.addEventListener("click", function () { el.logFile.click(); });
  el.logFile.addEventListener("change", async function () {
    const file = el.logFile.files && el.logFile.files[0];
    el.logFile.value = "";
    if (!file) return;
    if (runActive()) {
      flash("Dừng chạy trước khi nạp log.", "warn");
      return;
    }
    if (file.size > P.LIMITS.maxLogFileBytes) {
      flash("File quá lớn. Chỉ nhận file log dưới 2 MB.", "bad");
      return;
    }
    try {
      const incoming = P.parseLog(await readTextFile(file));
      if (!incoming.length) {
        flash("File không có log code. Cần file đã xuất từ tiện ích này.", "bad");
        return;
      }
      const keyOf = function (e) { return e.code + "|" + e.status + "|" + P.entryTime(e); };
      const known = new Set(model.log.map(P.normalizeEntry).filter(Boolean).map(keyOf));
      const added = new Set(incoming.map(keyOf).filter(function (k) { return !known.has(k); })).size;
      const merged = P.mergeLogs(model.log, incoming);
      await storageSet({ [K.log]: merged });
      if (!hasChrome) apply({ [K.log]: merged });
      const codes = analysis().codes;
      const ov = P.overlap(codes, merged);
      let text = "Đã đọc " + incoming.length + " lượt từ file, thêm " + added + " lượt mới.";
      if (codes.length) text += " Đối chiếu danh sách hiện tại: " + (ov.ok + ov.error) + " code đã có trong log, " + (ov.fresh + ov.unknown) + " code sẽ nhập.";
      flash(text, "ok");
    } catch (e) {
      flash("Không đọc được file log.", "bad");
    }
  });

  el.clearLog.addEventListener("click", async function () {
    if (!model.log.length) return;
    if (runActive()) {
      flash("Dừng chạy trước khi xóa log.", "warn");
      return;
    }
    const sure = await ask(
      "Xóa toàn bộ " + model.log.length + " lượt trong log? Sau khi xóa, các code này không còn được bỏ qua khi chạy lại."
        + " Hạn mức đã dùng vẫn được giữ. Muốn giữ lại thì bấm Hủy rồi Xuất log trước.",
      "Xóa log",
    );
    if (!sure) return;
    await storageSet({ [K.log]: [], [K.meta]: {}, [K.run]: { phase: "idle" } });
    if (hasChrome) {
      chrome.runtime.sendMessage({ kind: "badge", text: "" }, function () { void chrome.runtime.lastError; });
    } else {
      apply({ [K.log]: [], [K.run]: null });
    }
    flash("Đã xóa log.");
  });

  /* ---------- Khởi động ---------- */

  put(el.ver, VERSION ? "Phiên bản " + VERSION : "Bản xem trước");
  renderAll();

  setInterval(renderDynamic, 250);

  if (hasChrome) {
    chrome.storage.local.get(
      [K.draft, K.gap, K.random, K.skipLogged, K.protect, K.log, K.meta, K.run, K.attempts],
      function (data) {
        apply(data || {});
        renderLog();
        refreshTab();
      },
    );
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area !== "local") return;
      const patch = {};
      Object.keys(changes).forEach(function (key) { patch[key] = changes[key].newValue; });
      apply(patch);
    });
    setInterval(refreshTab, 2000);
  }
})();
