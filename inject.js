/* Chạy cùng trang đổi quà: điền ô code, bấm Đổi, đọc phản hồi thật của trang. */
(function () {
  if (window.__dfCodeGarena) return;
  window.__dfCodeGarena = true;

  var CHANNEL = "dfcode-garena-v1";
  var pending = null;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  function isRedeemUrl(url) {
    var value = String(url || "");
    if (!value || value.length > 2000) return false;
    var path = value.split("?")[0];
    return /RedeemCDKey/i.test(path);
  }

  function bodyVerdict(body, code) {
    var text = "";
    if (typeof body === "string") text = body;
    else if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) text = body.toString();
    else if (typeof FormData !== "undefined" && body instanceof FormData) {
      try {
        var field = body.get("cdkey") || body.get("cdk") || "";
        text = typeof field === "string" ? "cdkey=" + field : "";
      } catch (e) {}
    } else if (body && typeof body === "object") {
      var named = body.cdkey || body.cdk || body.sCdkey || "";
      text = typeof named === "string" ? "cdkey=" + named : "";
    }
    if (!text) return "unknown";
    var found = text.match(/(?:cdkey|cdk|sCdkey)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{4,80})/i);
    if (found) return found[1] === code ? "ours" : "foreign";
    return "unknown";
  }

  function urlCode(url) {
    var found = String(url || "").match(/[?&](?:cdkey|cdk)=([^&#]+)/i);
    if (!found) return "";
    try { return decodeURIComponent(found[1]); } catch (e) { return found[1]; }
  }

  function pickRaw(parsed) {
    var out = {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    var code = parsed.code;
    if (code == null) code = parsed.ret;
    if (code == null) code = parsed.iRet;
    if (code == null) code = parsed.errCode;
    if (code == null) code = parsed.errcode;
    if (typeof code === "number" && isFinite(code)) out.code = code;
    else if (typeof code === "string" && /^-?\d{1,8}$/.test(code)) out.code = Number(code);
    var nested = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
    var msg = parsed.msg || parsed.message || parsed.sMsg || parsed.errMsg || parsed.desc || parsed.sMessage || nested.msg || nested.message || nested.sMsg || "";
    if (typeof msg !== "string") msg = "";
    msg = msg.replace(/\s+/g, " ").trim().slice(0, 500);
    if (msg) out.msg = msg;
    return out;
  }

  function parsePayload(text) {
    var raw = String(text || "").trim().slice(0, 4000);
    if (!raw || raw.charAt(0) === "<") return {};
    try {
      return pickRaw(JSON.parse(raw));
    } catch (e) {}
    var wrapped = raw.match(/^[^(]{0,80}\((\{[\s\S]{0,3500}\})\)\s*;?\s*$/);
    if (wrapped) {
      try {
        return pickRaw(JSON.parse(wrapped[1]));
      } catch (e2) {}
    }
    if (raw.charAt(0) === "{" || raw.length > 240) return {};
    return { msg: raw.replace(/\s+/g, " ").trim().slice(0, 240) };
  }

  function takeResponse(url, body, text, at) {
    if (!pending || !pending.armed || pending.raw) return;
    if (!isRedeemUrl(url)) return;
    if (at && at < pending.since) return;
    if (bodyVerdict(body, pending.code) === "foreign") return;
    var named = urlCode(url);
    if (named && named !== pending.code) return;
    var parsed = parsePayload(text);
    if (!parsed || (parsed.code == null && !parsed.msg)) return;
    pending.raw = parsed;
  }

  var originalOpen = XMLHttpRequest.prototype.open;
  var originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (isRedeemUrl(url)) {
      this.__dfUrl = String(url);
      this.__dfAt = Date.now();
    }
    return originalOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    if (xhr.__dfUrl) {
      var sentAt = xhr.__dfAt || Date.now();
      xhr.addEventListener("load", function () {
        try {
          takeResponse(xhr.__dfUrl, body, xhr.responseText, sentAt);
        } catch (e) {}
      });
    }
    return originalSend.apply(this, arguments);
  };

  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url ? input.url : "";
      var startedAt = Date.now();
      var body = init && init.body;
      var pendingResponse = originalFetch.apply(this, arguments);
      if (pending && pending.armed && startedAt >= pending.since && isRedeemUrl(url) && bodyVerdict(body, pending.code) !== "foreign") {
        pendingResponse.then(function (response) {
          try {
            response.clone().text().then(function (text) {
              takeResponse(url, body, text, startedAt);
            }).catch(function () {});
          } catch (e) {}
        }).catch(function () {});
      }
      return pendingResponse;
    };
  }

  function isShown(el) {
    if (!el) return false;
    var style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
  }

  function snapshotDialog() {
    var dia = document.querySelector("#diaTips");
    var tip = document.querySelector("#superTips");
    var diaText = dia ? (dia.innerText || "").replace(/\s+/g, " ").trim() : "";
    var tipText = tip ? (tip.innerText || "").replace(/\s+/g, " ").trim() : "";
    var diaOpen = isShown(dia);
    var tipShown = isShown(tip) && tipText.length > 0;
    return {
      diaText: diaText,
      tipText: tipText,
      diaOpen: diaOpen,
      tipShown: tipShown,
      text: ((diaOpen && diaText) || (tipShown && tipText) || "").slice(0, 500),
    };
  }

  function dialogChanged(before, now) {
    if (!now.text) return false;
    if (now.diaOpen && !before.diaOpen) return true;
    if (now.tipShown && now.tipText && now.tipText !== before.tipText) return true;
    if (now.diaOpen && now.diaText && now.diaText !== before.diaText) return true;
    return false;
  }

  function closeDialog() {
    var dia = document.querySelector("#diaTips");
    var btn = document.querySelector("#diaTips .btn-close");
    if (dia && btn && isShown(dia)) btn.click();
  }

  function setInput(input, code) {
    var descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
    if (descriptor && descriptor.set) descriptor.set.call(input, code);
    else input.value = code;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    try {
      if (window.jQuery) window.jQuery(input).val(code).trigger("input").trigger("change");
    } catch (e) {}
  }

  function findControls() {
    return {
      input: document.querySelector("input.exc-input, input.spr.exc-input, .exc-input"),
      button: document.querySelector("a.btn-exchange, .btn-exchange"),
    };
  }

  async function redeemOne(code) {
    var ui = findControls();
    if (!ui.input || !ui.button || ui.input.tagName !== "INPUT") {
      return {
        source: "ui",
        text: "Không thấy ô nhập hoặc nút Đổi. Hãy đăng nhập trên trang đổi quà.",
      };
    }
    closeDialog();
    await sleep(150);
    if (document.querySelector("iframe[src*='captcha'], iframe[src*='geetest'], .geetest_panel")) {
      return { source: "ui", text: "Trang đang yêu cầu xác minh. Dừng để không tiếp tục tự nhập." };
    }
    var before = snapshotDialog();
    pending = { code: code, raw: null, armed: false, since: 0 };
    setInput(ui.input, code);
    await sleep(400 + Math.floor(Math.random() * 500));
    pending.since = Date.now();
    pending.armed = true;
    ui.button.click();
    var started = Date.now();
    while (Date.now() - started < 15000) {
      if (pending && pending.raw) {
        var raw = pending.raw;
        var shown = snapshotDialog();
        if (shown.text) raw = Object.assign({}, raw, { screen: shown.text });
        pending = null;
        closeDialog();
        return { source: "api", raw: raw };
      }
      var now = snapshotDialog();
      if (dialogChanged(before, now)) {
        var extraStarted = Date.now();
        while (Date.now() - extraStarted < 800) {
          if (pending && pending.raw) {
            var late = pending.raw;
            var lateShown = snapshotDialog();
            if (lateShown.text) late = Object.assign({}, late, { screen: lateShown.text });
            pending = null;
            closeDialog();
            return { source: "api", raw: late };
          }
          await sleep(100);
        }
        pending = null;
        closeDialog();
        return { source: "dialog", text: now.text };
      }
      await sleep(120);
    }
    pending = null;
    return { source: "timeout" };
  }

  var busy = false;

  function publicResult(result) {
    if (!result || typeof result !== "object") return { source: "timeout" };
    if (result.source === "api") {
      var raw = result.raw && typeof result.raw === "object" ? result.raw : {};
      var clean = {};
      if (typeof raw.code === "number" && isFinite(raw.code)) clean.code = raw.code;
      if (typeof raw.msg === "string") clean.msg = raw.msg.slice(0, 500);
      if (typeof raw.screen === "string") clean.screen = raw.screen.slice(0, 500);
      return { source: "api", raw: clean };
    }
    if (result.source === "dialog" || result.source === "ui") {
      return { source: result.source, text: String(result.text || "").slice(0, 500) };
    }
    return { source: "timeout" };
  }

  function isSafeCode(code) {
    return /^[A-Za-z0-9_-]{4,80}$/.test(code);
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window || event.origin !== window.location.origin) return;
    var data = event.data;
    if (!data || data.channel !== CHANNEL || !data.id) return;
    if (data.kind === "ping") {
      window.postMessage({ channel: CHANNEL, kind: "pong", id: data.id }, window.location.origin);
      return;
    }
    if (data.kind !== "redeem" || busy) return;
    var code = String(data.code || "");
    if (!isSafeCode(code)) {
      window.postMessage(
        { channel: CHANNEL, kind: "result", id: data.id, code: code, result: publicResult({ source: "ui", text: "Code không đúng định dạng." }) },
        window.location.origin,
      );
      return;
    }
    busy = true;
    redeemOne(code).then(function (result) {
      busy = false;
      window.postMessage(
        { channel: CHANNEL, kind: "result", id: data.id, code: code, result: publicResult(result) },
        window.location.origin,
      );
    }).catch(function () {
      busy = false;
      pending = null;
      window.postMessage(
        { channel: CHANNEL, kind: "result", id: data.id, code: code, result: { source: "timeout" } },
        window.location.origin,
      );
    });
  });
})();
