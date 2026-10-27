/* Chạy cùng trang đổi quà: điền ô code, bấm Đổi, đọc phản hồi thật của trang. */
(function () {
  var CHANNEL = "dfcode-garena-v1";
  var pending = null;
  var port = null;

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

  function pushMsg(into, value) {
    if (typeof value !== "string") return;
    var text = value.replace(/\s+/g, " ").trim();
    if (!text || into.indexOf(text) !== -1) return;
    into.push(text);
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
    var parts = [];
    [parsed, nested].forEach(function (obj) {
      pushMsg(parts, obj.msg);
      pushMsg(parts, obj.message);
      pushMsg(parts, obj.sMsg);
      pushMsg(parts, obj.errMsg);
      pushMsg(parts, obj.errmsg);
      pushMsg(parts, obj.desc);
      pushMsg(parts, obj.sMessage);
      pushMsg(parts, obj.error);
      pushMsg(parts, obj.reason);
      pushMsg(parts, obj.error_hint);
      pushMsg(parts, obj.errorHint);
      pushMsg(parts, obj.hint);
      pushMsg(parts, obj.sHint);
      pushMsg(parts, obj.tip);
      pushMsg(parts, obj.showMsg);
      pushMsg(parts, obj.show_msg);
    });
    if (!parts.length && typeof parsed.data === "string") pushMsg(parts, parsed.data);
    if (parts.length) out.msg = parts.join(" | ").slice(0, 500);
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

  function takeResponse(url, body, text, at, httpStatus) {
    if (!pending || !pending.armed || pending.raw) return;
    if (!isRedeemUrl(url)) return;
    if (at && at < pending.since) return;
    var verdict = bodyVerdict(body, pending.code);
    if (verdict === "foreign") return;
    var named = urlCode(url);
    if (named && named !== pending.code) return;
    if (verdict === "unknown" && (pending.seen || 0) >= 2) {
      pending.ambiguous = true;
      return;
    }
    var parsed = parsePayload(text);
    if (!parsed || (parsed.code == null && !parsed.msg)) {
      if ((pending.seen || 0) >= 2) pending.ambiguous = true;
      return;
    }
    if (typeof httpStatus === "number") parsed.httpStatus = httpStatus;
    pending.raw = parsed;
  }

  function noteRedeem(url, at) {
    if (!pending || !pending.armed || !isRedeemUrl(url)) return;
    if (at && at < pending.since) return;
    pending.seen = (pending.seen || 0) + 1;
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
          takeResponse(xhr.__dfUrl, body, xhr.responseText, sentAt, xhr.status);
        } catch (e) {}
      });
    }
    if (xhr.__dfUrl) noteRedeem(xhr.__dfUrl, sentAt);
    return originalSend.apply(this, arguments);
  };

  if (typeof window.fetch === "function") {
    var originalFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url ? input.url : "";
      var startedAt = Date.now();
      var body = init && init.body;
      var pendingResponse = originalFetch.apply(this, arguments);
      if (isRedeemUrl(url)) noteRedeem(url, startedAt);
      if (pending && pending.armed && startedAt >= pending.since && isRedeemUrl(url)) {
        pendingResponse.then(function (response) {
          try {
            var status = response.status;
            response.clone().text().then(function (text) {
              takeResponse(url, body, text, startedAt, status);
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
    var diaNode = dia ? dia.querySelector("p") || dia : null;
    var diaText = diaNode ? (diaNode.innerText || diaNode.textContent || "").replace(/\s+/g, " ").trim() : "";
    var tipText = tip ? (tip.innerText || tip.textContent || "").replace(/\s+/g, " ").trim() : "";
    var diaOpen = isShown(dia);
    var tipShown = isShown(tip) && tipText.length > 0;
    var parts = [];
    if (diaOpen && diaText) parts.push(diaText);
    if (tipShown && tipText && parts.indexOf(tipText) === -1) parts.push(tipText);
    return {
      diaText: diaText,
      tipText: tipText,
      diaOpen: diaOpen,
      tipShown: tipShown,
      text: parts.join(" | ").slice(0, 500),
    };
  }

  function freshScreen(before) {
    var now = snapshotDialog();
    var changed = [];
    var same = [];
    function take(text, was, opened) {
      if (!text) return;
      if (text !== was) {
        if (changed.indexOf(text) === -1) changed.push(text);
      } else if (opened && same.indexOf(text) === -1 && changed.indexOf(text) === -1) {
        same.push(text);
      }
    }
    if (now.diaOpen) take(now.diaText, before.diaText, !before.diaOpen);
    if (now.tipShown) take(now.tipText, before.tipText, !before.tipShown);
    return {
      changed: changed.join(" | ").slice(0, 500),
      same: same.join(" | ").slice(0, 500),
    };
  }

  function finishRedeem(raw, screen) {
    pending = null;
    closeDialog();
    if (raw) {
      if (screen) raw = Object.assign({}, raw, { screen: screen });
      return { source: "api", raw: raw };
    }
    return { source: "dialog", text: screen || "" };
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
    pending = { code: code, raw: null, armed: false, since: 0, seen: 0, ambiguous: false };
    setInput(ui.input, code);
    await sleep(400 + Math.floor(Math.random() * 500));
    pending.since = Date.now();
    pending.armed = true;
    ui.button.click();
    var started = Date.now();
    var sawAt = 0;
    while (Date.now() - started < 15000) {
      if (pending && pending.ambiguous && !pending.raw) {
        pending = null;
        return { source: "unknown" };
      }
      var raw = pending && pending.raw;
      var view = freshScreen(before);
      var screen = view.changed;
      if ((raw || screen || view.same) && !sawAt) sawAt = Date.now();
      var waited = sawAt ? Date.now() - sawAt : 0;
      if (raw && screen) return finishRedeem(raw, screen);
      if (screen && waited >= 200) return finishRedeem(raw, screen);
      if ((raw || view.same) && waited >= 400) return finishRedeem(raw, screen || view.same);
      await sleep(40);
    }
    pending = null;
    return { source: "unknown" };
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
      if (typeof raw.httpStatus === "number") clean.httpStatus = raw.httpStatus;
      return { source: "api", raw: clean };
    }
    if (result.source === "dialog" || result.source === "ui") {
      return { source: result.source, text: String(result.text || "").slice(0, 500) };
    }
    if (result.source === "unknown") return { source: "unknown" };
    return { source: "timeout" };
  }

  function isSafeCode(code) {
    return /^[A-Za-z0-9_-]{4,80}$/.test(code);
  }

  function reply(message) {
    if (port) port.postMessage(message);
  }

  function handleCommand(event) {
    var data = event.data;
    if (!data || data.kind !== "redeem" || busy) return;
    var code = String(data.code || "");
    if (!isSafeCode(code)) {
      reply({ kind: "result", id: data.id, code: code, result: publicResult({ source: "ui", text: "Code không đúng định dạng." }) });
      return;
    }
    busy = true;
    redeemOne(code).then(function (result) {
      busy = false;
      reply({ kind: "result", id: data.id, code: code, result: publicResult(result) });
    }).catch(function () {
      busy = false;
      pending = null;
      reply({ kind: "result", id: data.id, code: code, result: { source: "unknown" } });
    });
  }

  function onHello(event) {
    if (port) return;
    if (event.source !== window || !event.data || event.data.channel !== CHANNEL || event.data.kind !== "hello") return;
    if (!event.ports || !event.ports[0]) return;
    window.removeEventListener("message", onHello, true);
    port = event.ports[0];
    port.onmessage = handleCommand;
    port.postMessage({ kind: "ready" });
  }

  window.addEventListener("message", onHello, true);
})();

