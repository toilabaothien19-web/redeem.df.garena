/* DF Code Garena — cầu nối chạy cùng trang đổi quà (MAIN world).
 *
 * Việc duy nhất: điền code vào ô, bấm nút Đổi của trang, rồi đọc phản hồi RedeemCDKey
 * của đúng lần bấm đó và câu trang hiện ra. Bọc fetch/XMLHttpRequest chỉ để ĐỌC phản hồi
 * mà chính trang Garena gửi. Không tạo request mới, không đọc cookie, không gửi gì đi nơi khác.
 * Kết quả chỉ đi qua MessagePort riêng với runner.js.
 */
(function () {
  "use strict";

  const CHANNEL = "dfcode-garena-v2";
  const CODE_RE = /^[A-Za-z0-9_-]{4,80}$/;
  const WAIT_MS = 15000;

  let port = null;
  let pending = null;
  let busy = false;

  function sleep(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }

  /* ---------- Nhận đúng phản hồi đổi code ---------- */

  function isRedeemRequest(url) {
    const value = String(url || "");
    if (!value || value.length > 2000) return false;
    return /RedeemCDKey/i.test(value.split("?")[0]);
  }

  function requestUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (typeof Request !== "undefined" && input instanceof Request) return input.url;
      if (typeof URL !== "undefined" && input instanceof URL) return input.href;
      return input == null ? "" : String(input);
    } catch (e) {
      return "";
    }
  }

  /* Request này gửi code nào: của mình ("ours"), của lượt khác ("foreign"), hay không rõ. */
  function bodyVerdict(body, code) {
    let text = "";
    try {
      if (typeof body === "string") text = body;
      else if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) text = body.toString();
      else if (typeof FormData !== "undefined" && body instanceof FormData) {
        const field = body.get("cdkey") || body.get("cdk") || "";
        text = typeof field === "string" ? "cdkey=" + field : "";
      } else if (body && typeof body === "object") {
        const named = body.cdkey || body.cdk || body.sCdkey || "";
        text = typeof named === "string" ? "cdkey=" + named : "";
      }
    } catch (e) {
      text = "";
    }
    if (!text) return "unknown";
    const found = text.match(/(?:cdkey|cdk|sCdkey)["']?\s*[:=]\s*["']?([A-Za-z0-9_-]{4,80})/i);
    if (found) return found[1] === code ? "ours" : "foreign";
    return "unknown";
  }

  function urlCode(url) {
    const found = String(url || "").match(/[?&](?:cdkey|cdk)=([^&#]+)/i);
    if (!found) return "";
    try {
      return decodeURIComponent(found[1]);
    } catch (e) {
      return found[1];
    }
  }

  function pushMsg(into, value) {
    if (typeof value !== "string") return;
    const text = value.replace(/\s+/g, " ").trim();
    if (!text || into.indexOf(text) !== -1) return;
    into.push(text);
  }

  function pickRaw(parsed) {
    const out = {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
    let code = parsed.code;
    if (code == null) code = parsed.ret;
    if (code == null) code = parsed.iRet;
    if (code == null) code = parsed.errCode;
    if (code == null) code = parsed.errcode;
    if (typeof code === "number" && isFinite(code)) out.code = code;
    else if (typeof code === "string" && /^-?\d{1,8}$/.test(code)) out.code = Number(code);
    const nested = parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data) ? parsed.data : {};
    const parts = [];
    [parsed, nested].forEach(function (obj) {
      ["msg", "message", "sMsg", "errMsg", "errmsg", "desc", "sMessage", "error", "reason",
        "error_hint", "errorHint", "hint", "sHint", "tip", "showMsg", "show_msg"].forEach(function (key) {
        pushMsg(parts, obj[key]);
      });
    });
    if (!parts.length && typeof parsed.data === "string") pushMsg(parts, parsed.data);
    if (parts.length) out.msg = parts.join(" | ").slice(0, 500);
    return out;
  }

  function parsePayload(text) {
    const raw = String(text || "").trim().slice(0, 4000);
    if (!raw || raw.charAt(0) === "<") return {};
    try {
      return pickRaw(JSON.parse(raw));
    } catch (e) {}
    const wrapped = raw.match(/^[^(]{0,80}\((\{[\s\S]{0,3500}\})\)\s*;?\s*$/);
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
    if (!isRedeemRequest(url)) return;
    if (at && at < pending.since) return;
    const verdict = bodyVerdict(body, pending.code);
    if (verdict === "foreign") return;
    const named = urlCode(url);
    if (named && named !== pending.code) return;
    if (verdict === "unknown" && pending.seen >= 2) {
      pending.ambiguous = true;
      return;
    }
    const parsed = parsePayload(text);
    if (!parsed || (parsed.code == null && !parsed.msg)) {
      if (pending.seen >= 2) pending.ambiguous = true;
      return;
    }
    if (typeof httpStatus === "number") parsed.httpStatus = httpStatus;
    pending.raw = parsed;
  }

  function noteRedeem(url, at) {
    if (!pending || !pending.armed || !isRedeemRequest(url)) return;
    if (at && at < pending.since) return;
    pending.seen += 1;
  }

  function xhrText(xhr) {
    try {
      const type = xhr.responseType;
      if (!type || type === "text") return xhr.responseText;
      if (type === "json") return xhr.response == null ? "" : JSON.stringify(xhr.response);
    } catch (e) {}
    return "";
  }

  const xhrUrls = new WeakMap();
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;

  XHR.open = function (method, url) {
    const value = requestUrl(url);
    if (isRedeemRequest(value)) xhrUrls.set(this, value);
    else xhrUrls.delete(this);
    return originalOpen.apply(this, arguments);
  };

  XHR.send = function (body) {
    const url = xhrUrls.get(this);
    if (url) {
      const xhr = this;
      const sentAt = Date.now();
      noteRedeem(url, sentAt);
      const onLoad = function () {
        xhr.removeEventListener("load", onLoad);
        try {
          takeResponse(url, body, xhrText(xhr), sentAt, xhr.status);
        } catch (e) {}
      };
      xhr.addEventListener("load", onLoad);
    }
    return originalSend.apply(this, arguments);
  };

  if (typeof window.fetch === "function") {
    const originalFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = requestUrl(input);
      const startedAt = Date.now();
      const body = init && init.body;
      const reply = originalFetch.apply(this, arguments);
      if (isRedeemRequest(url)) {
        noteRedeem(url, startedAt);
        if (pending && pending.armed && startedAt >= pending.since) {
          reply.then(function (response) {
            try {
              const status = response.status;
              response.clone().text().then(function (text) {
                takeResponse(url, body, text, startedAt, status);
              }, function () {});
            } catch (e) {}
          }, function () {});
        }
      }
      return reply;
    };
  }

  /* ---------- Hộp thoại trên trang ---------- */

  function isShown(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0;
  }

  function textOf(node) {
    return node ? (node.innerText || node.textContent || "").replace(/\s+/g, " ").trim() : "";
  }

  function snapshotDialog() {
    const dia = document.querySelector("#diaTips");
    const tip = document.querySelector("#superTips");
    const diaText = textOf(dia ? dia.querySelector("p") || dia : null);
    const tipText = textOf(tip);
    return {
      diaText: diaText,
      tipText: tipText,
      diaOpen: isShown(dia),
      tipShown: isShown(tip) && tipText.length > 0,
    };
  }

  /* Chỉ nhận câu mới xuất hiện sau lần bấm, không lấy lại câu của code trước. */
  function freshScreen(before) {
    const now = snapshotDialog();
    const changed = [];
    const same = [];
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

  function closeDialog() {
    const dia = document.querySelector("#diaTips");
    const btn = document.querySelector("#diaTips .btn-close");
    if (dia && btn && isShown(dia)) btn.click();
  }

  function finishRedeem(raw, screen) {
    pending = null;
    closeDialog();
    if (raw) {
      return { source: "api", raw: screen ? Object.assign({}, raw, { screen: screen }) : raw };
    }
    return { source: "dialog", text: screen || "" };
  }

  function setInput(input, code) {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
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
    const ui = findControls();
    if (!ui.input || !ui.button || ui.input.tagName !== "INPUT") {
      return { source: "ui", text: "Không thấy ô nhập hoặc nút Đổi. Hãy đăng nhập trên trang đổi quà." };
    }
    closeDialog();
    await sleep(150);
    if (document.querySelector("iframe[src*='captcha'], iframe[src*='geetest'], .geetest_panel")) {
      return { source: "ui", text: "Trang đang yêu cầu xác minh (captcha)." };
    }
    const before = snapshotDialog();
    pending = { code: code, raw: null, armed: false, since: 0, seen: 0, ambiguous: false };
    setInput(ui.input, code);
    await sleep(400 + Math.floor(Math.random() * 500));
    pending.since = Date.now();
    pending.armed = true;
    ui.button.click();
    const started = Date.now();
    let sawAt = 0;
    while (Date.now() - started < WAIT_MS) {
      if (pending && pending.ambiguous && !pending.raw) {
        pending = null;
        return { source: "unknown" };
      }
      const raw = pending && pending.raw;
      const view = freshScreen(before);
      const screen = view.changed;
      if ((raw || screen || view.same) && !sawAt) sawAt = Date.now();
      const waited = sawAt ? Date.now() - sawAt : 0;
      if (raw && screen) return finishRedeem(raw, screen);
      if (screen && waited >= 200) return finishRedeem(raw, screen);
      if ((raw || view.same) && waited >= 400) return finishRedeem(raw, screen || view.same);
      await sleep(40);
    }
    pending = null;
    return { source: "unknown" };
  }

  /* ---------- Kênh riêng với runner.js ---------- */

  function publicResult(result) {
    if (!result || typeof result !== "object") return { source: "timeout" };
    if (result.source === "api") {
      const raw = result.raw && typeof result.raw === "object" ? result.raw : {};
      const clean = {};
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

  function onCommand(event) {
    const data = event.data;
    if (!data || data.kind !== "redeem" || typeof data.id !== "string") return;
    const code = String(data.code || "");
    const id = data.id;
    function reply(result) {
      if (port) port.postMessage({ kind: "result", id: id, code: code, result: publicResult(result) });
    }
    if (!CODE_RE.test(code)) {
      reply({ source: "ui", text: "Code không đúng định dạng." });
      return;
    }
    if (busy) {
      reply({ source: "unknown" });
      return;
    }
    busy = true;
    redeemOne(code).then(function (result) {
      busy = false;
      reply(result);
    }, function () {
      busy = false;
      pending = null;
      reply({ source: "unknown" });
    });
  }

  /* Nhận đúng một lời chào đầu tiên kèm MessagePort, rồi chặn không cho listener khác trên trang thấy nó. */
  function onHello(event) {
    if (port || event.source !== window) return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.kind !== "hello" || !event.ports || !event.ports[0]) return;
    event.stopImmediatePropagation();
    window.removeEventListener("message", onHello, true);
    port = event.ports[0];
    port.onmessage = onCommand;
    port.postMessage({ kind: "ready" });
  }

  window.addEventListener("message", onHello, true);
})();
