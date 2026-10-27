(function () {
  var $ = function (id) { return document.getElementById(id); };
  var codesEl = $("codes");
  var gapEl = $("gap");
  var fileEl = $("file");
  var countEl = $("count");
  var hintEl = $("gapHint");
  var gapValueEl = $("gapValue");
  var etaEl = $("eta");
  var randomEl = $("randomGap");
  var protectEl = $("protect");
  var haveEl = $("statHave");
  var okEl = $("statOk");
  var badEl = $("statBad");
  var statusEl = $("status");
  var progressEl = $("progress");
  var logEl = $("log");
  var startBtn = $("start");
  var stopBtn = $("stop");
  var exportBtn = $("export");
  var clearBtn = $("clearLog");
  var skipEl = $("skipOk");
  var tabId = null;
  var pollTimer = null;
  var logCache = [];
  var metaCache = {};
  var runActive = false;
  var restUntil = 0;
  var restTimer = null;
  var extension = typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;

  function setStatus(text, mode) {
    statusEl.textContent = text;
    statusEl.className = mode || "";
  }

  function fold(el, open) {
    if (!el) return;
    var closed = el.classList.contains("is-closed");
    if (open) {
      if (!closed) return;
      el.inert = false;
      el.classList.remove("is-closed");
      return;
    }
    if (closed) return;
    el.classList.add("is-closed");
    el.inert = true;
  }

  function placeHint(text, anchor) {
    if (runActive) return;
    if (anchor && hintEl.previousElementSibling !== anchor) anchor.after(hintEl);
    if (hintEl.textContent === text) return;
    hintEl.textContent = text;
  }

  function renderCount() {
    var codes = DFParse.parseCodes(codesEl.value);
    var gap = DFParse.clampGap(gapEl.value);
    var random = randomEl.checked;
    var gapBlock = $("gapBlock");
    var randomWrap = $("randomWrap");
    var protectLabel = $("protectLabel");
    var protect = !protectEl || protectEl.checked;
    if (protect) {
      fold(gapBlock, false);
      fold(randomWrap, false);
      placeHint("Mỗi code sau nghỉ ngẫu nhiên từ 20 đến 30 giây. Code đầu nhập ngay.", protectLabel);
    } else if (random) {
      fold(randomWrap, true);
      fold(gapBlock, false);
      placeHint("Mỗi code sau nghỉ một số giây bất kỳ từ 10 đến 15. Code đầu nhập ngay.", randomWrap);
    } else {
      fold(randomWrap, true);
      fold(gapBlock, true);
      if (gapValueEl) gapValueEl.textContent = gap + " giây";
      placeHint("Kéo từ 5 đến 60 giây. Code đầu nhập ngay, các code sau mới nghỉ.", gapBlock.querySelector(".fold-inner"));
    }
    haveEl.textContent = String(codes.length);
    countEl.textContent = codes.length + " code";
    if (!runActive) {
      var est = DFParse.estimateFinish(codes.length, gap, random, 0, undefined, protect);
      etaEl.textContent = est.text;
    }
    return codes;
  }

  function paintStats() {
    var ok = 0;
    var bad = 0;
    for (var i = 0; i < logCache.length; i++) {
      if (logCache[i].status === "ok") ok++;
      else if (logCache[i].status === "error") bad++;
    }
    tickStat(okEl, String(ok));
    tickStat(badEl, String(bad));
  }

  function tickStat(el, value) {
    if (el.dataset.ready === "1" && el.textContent !== value) {
      el.classList.remove("tick");
      void el.offsetWidth;
      el.classList.add("tick");
    }
    el.textContent = value;
    el.dataset.ready = "1";
  }

  function copyText(text) {
    function done() { progressEl.textContent = "Đã chép đúng mã lỗi."; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
      return;
    }
    fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    var area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    try { document.execCommand("copy"); } catch (e) {}
    area.remove();
    done();
  }

  function bindCopy(btn, entry) {
    btn.addEventListener("click", function () {
      copyText(entry.code + "\t" + (entry.detail || ""));
    });
  }

  function renderLog(entries) {
    logCache = Array.isArray(entries) ? entries : [];
    var previous = logEl.getAttribute("data-top") || "";
    logEl.textContent = "";
    var view = logCache.slice().reverse();
    for (var i = 0; i < view.length; i++) {
      var entry = view[i];
      var li = document.createElement("li");
      li.className = entry.status === "ok" ? "ok" : entry.status === "unknown" ? "wait" : "bad";
      if (i === 0 && previous && entry.id && entry.id !== previous) li.classList.add("fresh");
      var code = document.createElement("b");
      code.textContent = entry.code || "";
      var detail = document.createElement("span");
      detail.textContent = entry.detail || "";
      var time = document.createElement("time");
      time.textContent = DFParse.formatTime(entry.at);
      li.append(code, detail, time);
      if (entry.status === "error") {
        var copy = document.createElement("button");
        copy.type = "button";
        copy.className = "copy";
        copy.textContent = "Chép mã lỗi";
        bindCopy(copy, entry);
        li.appendChild(copy);
      }
      logEl.appendChild(li);
    }
    logEl.setAttribute("data-top", view.length && view[0].id ? view[0].id : "");
    if (previous && view.length && view[0].id && view[0].id !== previous) {
      logEl.scrollTo({ top: 0, behavior: "smooth" });
    }
    var has = logCache.length > 0;
    exportBtn.disabled = !has;
    clearBtn.disabled = runActive || !has;
    $("importLog").disabled = runActive;
    paintStats();
  }

  function renderRun(run) {
    var active = !!(run && (run.phase === "running" || run.phase === "waiting"));
    runActive = active;
    clearBtn.disabled = active || !logCache.length;
    $("importLog").disabled = active;
    if (!run || !run.phase || run.phase === "idle") {
      if (restLeft() > 0) {
        startBtn.disabled = true;
        return;
      }
      progressEl.textContent = "Chưa chạy.";
      renderCount();
      return;
    }
    var bits = [];
    if (run.total) bits.push((run.index || 0) + "/" + run.total);
    if (run.note) bits.push(run.note);
    var line = bits.join(" · ") || "Chưa chạy.";
    progressEl.textContent = line;
    stopBtn.disabled = !extension || !active;
    if (active) {
      startBtn.disabled = true;
      var remaining = Math.max(0, (run.total || 0) - (run.index || 0));
      var extra = run.phase === "waiting" ? run.waitLeft || 0 : 0;
      var est = DFParse.estimateFinish(remaining, DFParse.clampGap(gapEl.value), randomEl.checked, extra, undefined, protectEl.checked);
      etaEl.textContent = "Còn " + remaining + " code. " + est.text;
    } else {
      renderCount();
    }
  }

  function download(name, text) {
    var blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function stampName() {
    var parts = DFParse.formatTime(new Date().toISOString()).replace(/[/:]/g, "-").replace(/\s+/g, "_");
    return "df-code-log-" + parts + ".txt";
  }

  function send(id, message) {
    return new Promise(function (resolve) {
      try {
        chrome.tabs.sendMessage(id, message, function (response) {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(response || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  function isRedeemUrl(url) {
    try {
      var parsed = new URL(url);
      return parsed.hostname === "redeem.df.garena.sg" && /^\/(?:[^/]+\/)?cdkgarena\.html$/i.test(parsed.pathname);
    } catch (e) {
      return false;
    }
  }

  async function refreshTab() {
    if (!extension) return;
    var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    var tab = tabs && tabs[0];
    if (!tab || !tab.id || !isRedeemUrl(tab.url || "")) {
      tabId = null;
      setStatus("Chỉ chạy khi tab đổi code Garena đang mở.", "bad");
      startBtn.disabled = true;
      return;
    }
    tabId = tab.id;
    var response = await send(tab.id, { kind: "probe" });
    if (!response || !response.ok) {
      setStatus("Hãy tải lại trang đổi code (F5), rồi mở lại tiện ích.", "bad");
      startBtn.disabled = true;
      return;
    }
    if (response.running) {
      setStatus("Đang nhập code trên trang này.", "run");
      startBtn.disabled = true;
      stopBtn.disabled = false;
      return;
    }
    stopBtn.disabled = true;
    if (!response.loggedIn) {
      setStatus("Trang đang mở nhưng chưa đăng nhập.", "bad");
      startBtn.disabled = true;
      return;
    }
    setStatus("Sẵn sàng trên trang đổi code.", "ready");
    startBtn.disabled = restLeft() > 0;
  }

  function restLeft() {
    return Math.max(0, Math.ceil((restUntil - Date.now()) / 1000));
  }

  function paintRest() {
    var left = restLeft();
    if (left <= 0) {
      restUntil = 0;
      if (restTimer) {
        clearInterval(restTimer);
        restTimer = null;
      }
      progressEl.textContent = "Đã hết thời gian nghỉ. Có thể bấm Bắt đầu.";
      if (!runActive) startBtn.disabled = false;
      if (extension) chrome.storage.local.set({ "dfcode.restUntil": 0 });
      return;
    }
    progressEl.textContent = "Cần nghỉ " + left + " giây trước khi bấm Bắt đầu lại.";
    startBtn.disabled = true;
  }

  function showRest(until) {
    var next = Number(until) || 0;
    if (next <= Date.now()) return;
    restUntil = next;
    paintRest();
    if (!restTimer) restTimer = setInterval(paintRest, 250);
  }

  function persistDraft() {
    if (!extension) return;
    try {
      chrome.storage.local.set({
        "dfcode.draft": codesEl.value,
        "dfcode.gap": gapEl.value,
        "dfcode.random": randomEl.checked,
        "dfcode.skipLogged": skipEl.checked,
        "dfcode.protect": protectEl.checked,
      }, function () { void chrome.runtime.lastError; });
    } catch (e) {}
  }

  codesEl.addEventListener("input", function () {
    renderCount();
    persistDraft();
  });
  gapEl.addEventListener("input", function () {
    renderCount();
    persistDraft();
  });
  gapEl.addEventListener("blur", function () {
    gapEl.value = String(DFParse.clampGap(gapEl.value));
    renderCount();
    persistDraft();
  });
  skipEl.addEventListener("change", persistDraft);
  randomEl.addEventListener("change", function () {
    renderCount();
    persistDraft();
  });
  protectEl.addEventListener("change", function () {
    renderCount();
    persistDraft();
  });

  $("pick").addEventListener("click", function () { fileEl.click(); });
  $("demo").addEventListener("click", function () {
    var source = $("demoSource");
    var text = source ? source.textContent.replace(/^\s+|\s+$/g, "") : "";
    if (!text) {
      progressEl.textContent = "Không nạp được code demo.";
      return;
    }
    if (!window.confirm("Danh sách demo có thể đã hết hạn. Mỗi code sai là một lần thử trên tài khoản của bạn. Nạp danh sách này?")) return;
    if (codesEl.value.trim() && !window.confirm("Thay danh sách đang có bằng Demo Code?")) return;
    codesEl.value = text;
    renderCount();
    persistDraft();
    progressEl.textContent = "Đã nạp Demo Code.";
  });
  $("clearCodes").addEventListener("click", function () {
    if (!codesEl.value.trim()) return;
    if (!window.confirm("Xóa toàn bộ danh sách code đang có?")) return;
    codesEl.value = "";
    renderCount();
    persistDraft();
    progressEl.textContent = "Đã xóa toàn bộ danh sách code.";
  });
  fileEl.addEventListener("change", function () {
    var file = fileEl.files && fileEl.files[0];
    fileEl.value = "";
    if (!file) return;
    if (file.size > 200 * 1024) {
      progressEl.textContent = "File quá lớn. Chỉ nhận file .txt dưới 200KB.";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || "");
      codesEl.value = codesEl.value.trim() ? codesEl.value.replace(/\s*$/, "") + "\n" + text : text;
      renderCount();
      persistDraft();
      progressEl.textContent = "Đã nạp " + file.name + ".";
    };
    reader.readAsText(file, "utf-8");
  });

  $("importLog").addEventListener("click", function () { $("logFile").click(); });
  $("logFile").addEventListener("change", function () {
    if (runActive) {
      progressEl.textContent = "Dừng chạy trước khi nạp log.";
      $("logFile").value = "";
      return;
    }
    var file = $("logFile").files && $("logFile").files[0];
    $("logFile").value = "";
    if (!file) return;
    if (file.size > 200 * 1024) {
      progressEl.textContent = "File quá lớn. Chỉ nhận file .txt dưới 200KB.";
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var incoming = DFParse.parseLog(String(reader.result || ""));
      if (!incoming.length) {
        progressEl.textContent = "File không có log code. Cần file đã xuất từ tiện ích này.";
        return;
      }
      var merged = DFParse.mergeLogs(logCache, incoming);
      if (merged.length > 1000) merged = merged.slice(-1000);
      renderLog(merged);
      if (extension) chrome.storage.local.set({ "dfcode.log": merged });
      progressEl.textContent = "Đã nạp " + incoming.length + " dòng log. Lần chạy sau bỏ qua code đã nhập và code lỗi.";
    };
    reader.readAsText(file, "utf-8");
  });

  startBtn.addEventListener("click", async function () {
    if (!extension || !tabId) return;
    var codes = DFParse.parseCodes(codesEl.value);
    if (!codes.length) {
      progressEl.textContent = "Chưa có code hợp lệ.";
      return;
    }
    var random = randomEl.checked;
    var gap = random ? 0 : DFParse.clampGap(gapEl.value);
    if (!random) gapEl.value = String(gap);
    if (!protectEl.checked && !window.confirm("Đã tắt bảo vệ tài khoản. Lần này tối đa 100 code, vẫn là nhập tự động trên tài khoản của bạn. Tiếp tục?")) {
      return;
    }
    startBtn.disabled = true;
    progressEl.textContent = "Đang bắt đầu…";
    var payload = {
      kind: "start",
      codes: codes,
      gapSec: gap,
      randomGap: random,
      skipLogged: skipEl.checked,
      protect: protectEl.checked,
    };
    var response = await send(tabId, payload);
    if (!response || !response.ok) {
      if (response && response.restUntil) showRest(response.restUntil);
      else progressEl.textContent = (response && response.reason) || "Không gửi được lệnh. Tải lại trang đổi code.";
      refreshTab();
      return;
    }
    var pace = response.randomGap ? "nghỉ ngẫu nhiên 10–15 giây" : "nghỉ " + response.gapSec + " giây";
    var extra = response.skipped ? " Bỏ qua " + response.skipped + " code đã có trong log." : "";
    progressEl.textContent = "Bắt đầu " + response.total + " code, " + pace + "." + extra;
    setStatus("Đang chạy. Đóng popup không làm dừng.", "run");
    stopBtn.disabled = false;
  });

  stopBtn.addEventListener("click", async function () {
    if (!extension || !tabId) return;
    stopBtn.disabled = true;
    await send(tabId, { kind: "stop" });
    progressEl.textContent = "Sẽ dừng sau code hiện tại hoặc hết thời gian nghỉ.";
  });

  exportBtn.addEventListener("click", function () {
    if (!logCache.length) return;
    var text = DFParse.formatLog(logCache, {
      exportedAt: new Date().toISOString(),
      gapSec: metaCache.randomGap ? 0 : metaCache.gapSec || DFParse.clampGap(gapEl.value),
      randomGap: !!(metaCache.randomGap || randomEl.checked),
    });
    download(stampName(), text);
  });

  clearBtn.addEventListener("click", function () {
    if (runActive) {
      progressEl.textContent = "Dừng chạy trước khi xóa log.";
      return;
    }
    if (!logCache.length) return;
    if (!window.confirm("Xóa toàn bộ log trên tiện ích này?")) return;
    renderLog([]);
    metaCache = {};
    if (extension) {
      chrome.storage.local.set({ "dfcode.log": [], "dfcode.meta": {}, "dfcode.run": { phase: "idle" } });
      chrome.runtime.sendMessage({ kind: "badge", text: "" });
    }
    progressEl.textContent = "Đã xóa log.";
  });

  function applyStored(data) {
    if (typeof data["dfcode.draft"] === "string" && document.activeElement !== codesEl) {
      codesEl.value = data["dfcode.draft"];
    }
    if ((typeof data["dfcode.gap"] === "string" || typeof data["dfcode.gap"] === "number") && document.activeElement !== gapEl) {
      gapEl.value = String(DFParse.clampGap(data["dfcode.gap"]));
    }
    if (typeof data["dfcode.random"] === "boolean" && document.activeElement !== randomEl) {
      randomEl.checked = data["dfcode.random"];
    }
    if (typeof data["dfcode.skipLogged"] === "boolean") skipEl.checked = data["dfcode.skipLogged"];
    else if (typeof data["dfcode.skipOk"] === "boolean") skipEl.checked = data["dfcode.skipOk"];
    if (typeof data["dfcode.protect"] === "boolean" && document.activeElement !== protectEl) {
      protectEl.checked = data["dfcode.protect"];
    }
    if (Array.isArray(data["dfcode.log"])) renderLog(data["dfcode.log"]);
    if (data["dfcode.meta"]) {
      var meta = data["dfcode.meta"] || {};
      if (meta.account || meta.page) {
        meta = { gapSec: meta.gapSec };
        if (extension) chrome.storage.local.set({ "dfcode.meta": meta });
      }
      metaCache = meta;
    }
    if (data["dfcode.run"]) renderRun(data["dfcode.run"]);
    if (typeof data["dfcode.restUntil"] === "number") showRest(data["dfcode.restUntil"]);
    if (!runActive) renderCount();
  }

  renderCount();
  if (!extension) {
    setStatus("Bản xem trước. Cài tiện ích, mở trang đổi code, rồi bấm Bắt đầu ở đó.", "");
    startBtn.disabled = true;
    stopBtn.disabled = true;
    return;
  }

  chrome.storage.local.get(
    ["dfcode.draft", "dfcode.gap", "dfcode.random", "dfcode.skipLogged", "dfcode.skipOk", "dfcode.protect", "dfcode.log", "dfcode.meta", "dfcode.run", "dfcode.restUntil"],
    function (data) {
      applyStored(data || {});
      if (!data || !Array.isArray(data["dfcode.log"])) renderLog([]);
      var run = data && data["dfcode.run"];
      var active = run && (run.phase === "running" || run.phase === "waiting");
      if (!active) chrome.runtime.sendMessage({ kind: "badge", text: "" });
    },
  );
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    var patch = {};
    Object.keys(changes).forEach(function (key) {
      patch[key] = changes[key].newValue;
    });
    applyStored(patch);
  });
  refreshTab();
  pollTimer = setInterval(refreshTab, 2000);
  window.addEventListener("unload", function () {
    clearInterval(pollTimer);
    if (restTimer) clearInterval(restTimer);
  });
})();
