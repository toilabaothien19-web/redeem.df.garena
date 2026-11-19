/* DF Code Garena — service worker.
 * Chỉ hiện hoặc xóa số trên biểu tượng, và dọn phiên "đang chạy" bị bỏ dở khi trình duyệt tắt đột ngột.
 * Không có lệnh mạng nào ở đây; CSP của tiện ích cũng chặn kết nối (connect-src 'none'). */
importScripts("parser.js");

const P = self.DFParse;
const K = P.KEYS;
const TONES = { run: "#06784f", wait: "#a86b00" };

function fromExtension(sender) {
  return !!(sender && sender.id === chrome.runtime.id);
}

function fromRedeemTab(sender) {
  return fromExtension(sender) && !!sender.tab && P.isRedeemUrl(sender.tab.url || "");
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

/* Log lưu từ bản trước: lỗi tạm thời (429, 5xx, "thử lại sau"…) từng bị ghi là "lỗi" nên bị bỏ qua vĩnh viễn.
 * Đổi chúng thành "chưa rõ" và cắt log theo cách mới. Chỉ làm khi không có phiên đang chạy. */
async function migrateLog(log) {
  if (!Array.isArray(log) || !log.length) return;
  const fixed = P.capLog(log.map(P.normalizeEntry).filter(Boolean), P.LIMITS.logCap);
  const changed = fixed.length !== log.length || fixed.some(function (e, i) {
    return !log[i] || e.code !== log[i].code || e.status !== log[i].status || e.at !== (log[i].at || "");
  });
  if (changed) await chrome.storage.local.set({ [K.log]: fixed });
}

async function settle() {
  const data = await chrome.storage.local.get([K.run, K.log].concat(P.LEGACY_KEYS));
  const run = data[K.run];
  const legacy = P.LEGACY_KEYS.filter(function (key) { return key in data; });
  if (legacy.length) await chrome.storage.local.remove(legacy);
  if (P.isRunActive(run, Date.now())) return;
  clearBadge();
  await migrateLog(data[K.log]);
  if (run && (run.phase === "running" || run.phase === "waiting")) {
    await chrome.storage.local.set({
      [K.run]: Object.assign({}, run, {
        phase: "stopped",
        current: "",
        wait: null,
        updatedAt: Date.now(),
        note: "Phiên trước bị ngắt giữa chừng (trang hoặc trình duyệt đã đóng).",
      }),
    });
  }
}

settle();
chrome.runtime.onInstalled.addListener(settle);
chrome.runtime.onStartup.addListener(settle);

chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.kind !== "badge" || !fromExtension(sender)) return;
  const text = String(msg.text || "").replace(/[^\dA-Z]/gi, "").slice(0, 4);
  if (!text) {
    clearBadge();
    return;
  }
  if (!fromRedeemTab(sender)) return;
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: TONES[msg.tone] || TONES.run });
});
