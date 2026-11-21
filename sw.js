/* DF Code Garena — service worker.
 * Chỉ đổi màu biểu tượng, hiện hoặc xóa số trên biểu tượng, và dọn phiên "đang chạy" bị bỏ dở khi trình duyệt tắt đột ngột.
 * Không có lệnh mạng nào ở đây; CSP của tiện ích cũng chặn kết nối (connect-src 'none'). */
importScripts("parser.js");

const P = self.DFParse;
const K = P.KEYS;

function fromExtension(sender) {
  return !!(sender && sender.id === chrome.runtime.id);
}

function fromRedeemTab(sender) {
  return fromExtension(sender) && !!sender.tab && P.isRedeemUrl(sender.tab.url || "");
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

/* Màu biểu tượng: xanh lá (bản Garena), xanh dương (bản quốc tế), đỏ (phiên gần nhất có code lỗi hoặc chưa rõ).
 * Tính lại mỗi khi phiên chạy hoặc bản đang chọn đổi. */
let painted = "";
async function paint() {
  const data = await chrome.storage.local.get([K.run, K.edition]);
  const look = P.iconLook(data[K.run], data[K.edition], Date.now());
  if (look !== painted) {
    try {
      await chrome.action.setIcon({ path: P.iconPaths(look) });
      painted = look;
    } catch (e) {}
  }
  return look;
}

/* Log lưu từ bản trước: lỗi tạm thời (429, 5xx, "thử lại sau"…) từng bị ghi là "lỗi" nên bị bỏ qua vĩnh viễn.
 * Đổi chúng thành "chưa rõ" và cắt log theo cách mới. Chỉ làm khi không có phiên đang chạy. */
async function migrateLog(log) {
  const result = P.migrateLog(log);
  if (result.changed) await chrome.storage.local.set({ [K.log]: result.log });
}

async function settle() {
  const data = await chrome.storage.local.get([K.run, K.log].concat(P.LEGACY_KEYS));
  const run = data[K.run];
  const legacy = P.LEGACY_KEYS.filter(function (key) { return key in data; });
  if (legacy.length) await chrome.storage.local.remove(legacy);
  if (P.isRunActive(run, Date.now())) {
    await paint();
    return;
  }
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
  await paint();
}

settle();
chrome.runtime.onInstalled.addListener(settle);
chrome.runtime.onStartup.addListener(settle);

/* Lệnh mới nhất thắng: lệnh xóa số đến trong lúc lệnh trước còn đọc màu thì lệnh trước không hiện lại số. */
let badgeSeq = 0;

chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.kind !== "badge" || !fromExtension(sender)) return;
  const text = String(msg.text || "").replace(/[^\dA-Z]/gi, "").slice(0, 4);
  const seq = ++badgeSeq;
  if (!text) {
    clearBadge();
    paint();
    return;
  }
  if (!fromRedeemTab(sender)) return;
  /* Số code còn lại, nền cùng màu biểu tượng: màu đậm khi đang nhập, sắc nhạt khi đang nghỉ. */
  paint().then(function (look) {
    if (seq !== badgeSeq) return;
    const c = P.LOOKS[look] || P.LOOKS.garena;
    const wait = msg.tone === "wait";
    chrome.action.setBadgeBackgroundColor({ color: wait ? c.light : c.accent });
    chrome.action.setBadgeTextColor({ color: wait ? "#000000" : c.text });
    chrome.action.setBadgeText({ text: text });
  }, function () {
    if (seq === badgeSeq) chrome.action.setBadgeText({ text: text });
  });
});

chrome.storage.onChanged.addListener(function (changes, area) {
  if (area !== "local") return;
  if (changes[K.run] || changes[K.edition]) paint();
});
