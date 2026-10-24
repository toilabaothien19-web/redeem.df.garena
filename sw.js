function fromExtension(sender) {
  return !!(sender && sender.id === chrome.runtime.id);
}

function fromRedeemTab(sender) {
  return fromExtension(sender) && !!sender.tab
    && /^https:\/\/redeem\.df\.garena\.sg\/(?:[^/]+\/)?cdkgarena\.html/i.test(sender.tab.url || "");
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

function clearBadgeIfIdle() {
  chrome.storage.local.get("dfcode.run", function (data) {
    var run = data && data["dfcode.run"];
    var active = run && (run.phase === "running" || run.phase === "waiting");
    if (!active) clearBadge();
  });
}

clearBadgeIfIdle();
chrome.runtime.onInstalled.addListener(clearBadgeIfIdle);
chrome.runtime.onStartup.addListener(clearBadgeIfIdle);

chrome.runtime.onMessage.addListener(function (msg, sender) {
  if (!msg || msg.kind !== "badge" || !fromExtension(sender)) return;
  var text = String(msg.text || "").replace(/[^\dA-Z]/gi, "").slice(0, 4);
  if (!text) {
    clearBadge();
    return;
  }
  if (!fromRedeemTab(sender)) return;
  var color = /^#[0-9a-fA-F]{6}$/.test(msg.color || "") ? msg.color : "#06784f";
  chrome.action.setBadgeText({ text: text });
  chrome.action.setBadgeBackgroundColor({ color: color });
});
