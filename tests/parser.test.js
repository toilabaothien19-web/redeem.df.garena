/* Kiểm tra logic dùng chung. Chạy: node --test */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../parser.js");

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 10, 19, 14, 0, 0).getTime();

/* ---------- Đọc danh sách code ---------- */

test("mỗi dòng một code, bỏ dòng trống, comment và code trùng", () => {
  const a = P.analyzeCodes("DFABC123\n\n# ghi chú\n// cũ\nDFXYZ789\r\nDFABC123\n");
  assert.deepEqual(a.codes, ["DFABC123", "DFXYZ789"]);
  assert.equal(a.duplicates, 1);
  assert.equal(a.ignored, 0);
});

test("code đứng một mình trên dòng được nhận dù trông như chữ thường", () => {
  assert.deepEqual(P.parseCodes("TrickOrTreat\nAUGTUTO\nGIVEMETHAT\nP90FFF"), ["TrickOrTreat", "AUGTUTO", "GIVEMETHAT", "P90FFF"]);
});

test("nhãn trước dấu hai chấm bị bỏ, giá trị sau dấu hai chấm được giữ", () => {
  assert.deepEqual(P.parseCodes("Code: DFHELLO\nMã quà tặng: ABCD1234\nCode:WXYZ,QRST"), ["DFHELLO", "ABCD1234", "WXYZ", "QRST"]);
});

test("không gửi nhầm chữ mô tả thành code", () => {
  assert.deepEqual(P.parseCodes("DFABC - 100 brick"), ["DFABC"]);
  assert.deepEqual(P.parseCodes("Delta Force"), []);
  assert.deepEqual(P.parseCodes("Code mới hôm nay"), []);
  assert.deepEqual(P.parseCodes("DF123: 50 brick, DF456: 20 brick"), ["DF123", "DF456"]);
  assert.deepEqual(P.parseCodes("GIVEMETHAT (hết hạn 30/11)"), ["GIVEMETHAT"]);
});

test("dấu đầu dòng, số thứ tự, ngoặc kép và ký tự vô hình bị bỏ", () => {
  assert.deepEqual(P.parseCodes("1. DFONE111\n2) DFTWO222\n- DFTHREE3\n• DFFOUR44\n\"DFQUOTE5\"\nDF​ZERO66﻿"), [
    "DFONE111",
    "DFTWO222",
    "DFTHREE3",
    "DFFOUR44",
    "DFQUOTE5",
    "DFZERO66",
  ]);
});

test("nhiều code trên một dòng, ngăn bằng dấu phẩy, chấm phẩy, tab hoặc khoảng trắng", () => {
  assert.deepEqual(P.parseCodes("AAAA1,BBBB2; CCCC3\tDDDD4 | EEEE5"), ["AAAA1", "BBBB2", "CCCC3", "DDDD4", "EEEE5"]);
  assert.deepEqual(P.parseCodes("DFAAA111 DFBBB222 DFCCC333"), ["DFAAA111", "DFBBB222", "DFCCC333"]);
});

test("liên kết và comment cuối dòng bị bỏ", () => {
  assert.deepEqual(P.parseCodes("https://redeem.df.garena.sg/vi/cdkgarena.html\nDFLINK99 # đã dùng\nDFCMT88 // cũ"), ["DFLINK99", "DFCMT88"]);
});

test("dòng không nhận ra được đếm, danh sách bị cắt ở 1000 code", () => {
  const a = P.analyzeCodes("xin chào các bạn\nDFOK1234");
  assert.equal(a.ignored, 1);
  const many = Array.from({ length: 1005 }, (_, i) => "DFCODE" + i).join("\n");
  const b = P.analyzeCodes(many);
  assert.equal(b.codes.length, 1000);
  assert.equal(b.truncated, true);
});

test("ký tự lạ không thành code", () => {
  assert.deepEqual(P.parseCodes("abc\nDF<script>\nmã-tiếng-việt\nDF_OK-12"), ["DF_OK-12"]);
});

/* ---------- Nhịp nghỉ ---------- */

test("khoảng cách bị kẹp trong 5–60 giây", () => {
  assert.equal(P.clampGap(""), 15);
  assert.equal(P.clampGap("abc"), 15);
  assert.equal(P.clampGap(1), 5);
  assert.equal(P.clampGap(99), 60);
  assert.equal(P.clampGap("22.6"), 23);
});

test("nhịp nghỉ theo từng chế độ", () => {
  assert.deepEqual(P.pace({ protect: true, randomGap: true, gapSec: 5 }), { min: 20, max: 30 });
  assert.deepEqual(P.pace({ protect: false, randomGap: true }), { min: 10, max: 15 });
  assert.deepEqual(P.pace({ protect: false, gapSec: 42 }), { min: 42, max: 42 });
  assert.equal(P.pickGap({ protect: true }, () => 0), 20);
  assert.equal(P.pickGap({ protect: true }, () => 0.9999), 30);
  assert.equal(P.pickGap({ protect: true }, () => 1), 30);
});

test("nghỉ sau chuỗi lỗi nằm trong 30,0–60,0 giây và có một chữ số lẻ", () => {
  assert.equal(P.errorPause(() => 0), 30);
  assert.equal(P.errorPause(() => 0.9999), 60);
  assert.equal(P.errorPause(() => 1), 60);
  for (let i = 0; i < 200; i++) {
    const v = P.errorPause();
    assert.ok(v >= 30 && v <= 60);
    assert.equal(Math.round(v * 10), v * 10);
  }
  assert.equal(P.formatTenth(42.25), "42,3");
});

test("cài đặt mặc định là bật bảo vệ và bỏ qua code đã có trong log", () => {
  assert.deepEqual(P.normalizeSettings(undefined), { protect: true, randomGap: false, gapSec: 15, skipLogged: true });
});

/* ---------- Hạn mức ---------- */

test("bảo vệ: 30 code mỗi 60 phút, mở lại khi lượt cũ nhất hết hạn", () => {
  const attempts = Array.from({ length: 30 }, (_, i) => NOW - 50 * MIN + i * 1000);
  const q = P.quota(attempts, true, NOW);
  assert.equal(q.ok, false);
  assert.equal(q.scope, "hour");
  assert.equal(q.until, attempts[0] + HOUR);
});

test("vượt trần (vd. vừa bật lại bảo vệ) thì chờ đủ lượt hết hạn, không chỉ lượt cũ nhất", () => {
  const attempts = Array.from({ length: 40 }, (_, i) => NOW - 50 * MIN + i * MIN);
  const q = P.quota(attempts, true, NOW);
  assert.equal(q.ok, false);
  assert.equal(q.until, attempts[10] + HOUR);
});

test("bảo vệ: 60 code mỗi 24 giờ", () => {
  const attempts = Array.from({ length: 60 }, (_, i) => NOW - 20 * HOUR + i * MIN);
  const q = P.quota(attempts, true, NOW);
  assert.equal(q.ok, false);
  assert.equal(q.scope, "day");
  assert.equal(q.until, attempts[0] + DAY);
  assert.match(P.quotaReason(q, NOW), /60 code trong 24 giờ/);
});

test("tắt bảo vệ: 100 code mỗi 60 phút, 200 mỗi 24 giờ", () => {
  const attempts = Array.from({ length: 99 }, (_, i) => NOW - 30 * MIN + i);
  assert.equal(P.quota(attempts, false, NOW).ok, true);
  assert.equal(P.quota(attempts, false, NOW).left, 1);
  assert.equal(P.quota(attempts.concat([NOW - 1000]), false, NOW).ok, false);
});

test("mốc quá 24 giờ hoặc ở tương lai xa bị bỏ", () => {
  const list = P.cleanAttempts([NOW - DAY - 1, NOW - 5, NOW + HOUR, "x", NOW - 10], NOW);
  assert.deepEqual(list, [NOW - 10, NOW - 5]);
});

test("phải nghỉ 60 giây (bảo vệ) hoặc 20 giây giữa hai lần bấm Bắt đầu", () => {
  const g = P.gate([NOW - 15000], true, NOW);
  assert.equal(g.ok, false);
  assert.equal(g.scope, "cooldown");
  assert.equal(g.until, NOW - 15000 + 60000);
  assert.match(g.reason, /Cần nghỉ 45 giây/);
  assert.equal(P.gate([NOW - 21000], false, NOW).ok, true);
});

/* ---------- Kế hoạch ---------- */

test("kế hoạch bỏ code đã có trong log và cắt theo trần mỗi lần", () => {
  const codes = Array.from({ length: 40 }, (_, i) => "DFPLAN" + i);
  const log = [
    { code: "DFPLAN0", status: "ok" },
    { code: "DFPLAN1", status: "error" },
    { code: "DFPLAN2", status: "unknown" },
  ];
  const pl = P.plan({ codes, log, settings: { protect: true }, attempts: [], now: NOW });
  assert.equal(pl.ok, true);
  assert.equal(pl.skipped, 2);
  assert.equal(pl.fresh, 38);
  assert.equal(pl.queue.length, 30);
  assert.equal(pl.queue[0], "DFPLAN2");
});

test("kế hoạch cắt theo hạn mức còn lại", () => {
  const codes = Array.from({ length: 20 }, (_, i) => "DFLEFT" + i);
  const attempts = Array.from({ length: 25 }, (_, i) => NOW - 50 * MIN + i * 1000);
  const pl = P.plan({ codes, log: [], settings: { protect: true }, attempts, now: NOW });
  assert.equal(pl.queue.length, 5);
});

test("kế hoạch báo lý do khi không chạy được", () => {
  assert.equal(P.plan({ codes: [], now: NOW }).reason, "Chưa có code hợp lệ.");
  const done = P.plan({ codes: ["DFDONE1"], log: [{ code: "DFDONE1", status: "ok" }], now: NOW });
  assert.match(done.reason, /đã có trong log/);
  const again = P.plan({ codes: ["DFDONE1"], log: [{ code: "DFDONE1", status: "ok" }], settings: { skipLogged: false }, now: NOW });
  assert.equal(again.ok, true);
  const cool = P.plan({ codes: ["DFNEW1"], attempts: [NOW - 1000], now: NOW });
  assert.equal(cool.ok, false);
  assert.equal(cool.until, NOW - 1000 + 60000);
  assert.deepEqual(cool.queue, []);
});

test("ước tính thời gian", () => {
  const est = P.estimate(3, { protect: true }, 0);
  assert.deepEqual(est, { min: 2 * 20 + 9, max: 2 * 30 + 9 });
  assert.equal(P.estimate(0, {}, 0), null);
  assert.equal(P.formatDurationRange(49, 69), "49 giây – 1 phút");
  assert.equal(P.formatDurationRange(600, 900), "10–15 phút");
  assert.equal(P.formatDuration(3900), "1 giờ 5 phút");
  assert.match(P.describeEstimate(est, NOW), /^Mất khoảng 49 giây – 1 phút, xong lúc 14:00–14:01\.$/);
});

/* ---------- Đọc kết quả ---------- */

test("mã 0 là thành công, câu trên trang được ưu tiên hơn chữ ok của máy chủ", () => {
  const d = P.describeApi({ code: 0, msg: "ok", screen: "Successfully claimed! Please check your in-game mail." });
  assert.equal(d.status, "ok");
  assert.equal(d.detail, "Successfully claimed! Please check your in-game mail.");
});

test("mã khác 0 là lỗi, có kèm mã số", () => {
  const d = P.describeApi({ code: 1002, msg: "Mã quà tặng không hợp lệ" });
  assert.equal(d.status, "error");
  assert.equal(d.detail, "Mã quà tặng không hợp lệ | 1002");
});

test("câu trên màn hình và câu máy chủ không bị lặp", () => {
  const d = P.describeApi({
    code: 1003,
    msg: "Code đã được sử dụng | Mỗi tài khoản chỉ đổi một lần",
    screen: "Code đã được sử dụng",
  });
  assert.equal(d.detail, "Code đã được sử dụng | Mỗi tài khoản chỉ đổi một lần | 1003");
  assert.equal(P.describeApi({ code: 0, msg: "ok | success" }).detail, "0");
});

test("mã số và câu chữ mâu thuẫn thì chưa xác định", () => {
  assert.equal(P.describeApi({ code: 0, msg: "Đổi không thành công" }).status, "unknown");
  assert.equal(P.describeApi({ code: 5, msg: "Đổi thành công" }).status, "unknown");
  assert.equal(P.describeApi(null).status, "unknown");
});

test("câu hộp thoại: thành công, lỗi, rỗng", () => {
  assert.equal(P.describeDialog("Đổi thành công!").status, "ok");
  assert.equal(P.describeDialog("Code đã được sử dụng").status, "error");
  assert.equal(P.describeDialog("").status, "unknown");
  assert.equal(P.describeDialog("Đổi không thành công").status, "error");
  assert.equal(P.describeDialog("Không thành công, code đã hết hạn").status, "error");
  assert.equal(P.describeDialog("Redemption failed").status, "error");
  assert.equal(P.describeDialog("Not successful").status, "error");
  assert.equal(P.describeDialog("Successfully claimed! Please check your in-game mail.").status, "ok");
  assert.equal(P.describeDialog("Đổi thành công nhưng không hợp lệ").status, "unknown");
});

test("token, email, liên kết và dãy số dài bị ẩn", () => {
  const s = P.sanitizeText("token=abc123 mail a@b.com xem https://x.y/z số 1234567890 Bearer xyz");
  assert.doesNotMatch(s, /abc123|a@b\.com|https|1234567890|xyz/);
});

test("nhận ra câu báo rủi ro tài khoản", () => {
  assert.ok(P.isAccountRisk("Thao tác quá nhiều lần, vui lòng thử lại sau"));
  assert.ok(P.isAccountRisk("Too many requests"));
  assert.ok(!P.isAccountRisk("Code đã hết hạn"));
});

test("lỗi thao tác trang không bị tính là lỗi code", () => {
  const e = P.toEntry("DFUI1234", { source: "ui", text: "Không thấy ô nhập hoặc nút Đổi." }, NOW);
  assert.equal(e.status, "unknown");
  assert.match(e.detail, /chưa được gửi/);
  assert.equal(P.settledCodes([e]).has("DFUI1234"), false);
});

test("hết giờ chờ là chưa xác định", () => {
  const e = P.toEntry("DFTIME11", { source: "timeout" }, NOW);
  assert.equal(e.status, "unknown");
  assert.equal(e.detail, P.UNKNOWN_TEXT);
  assert.equal(P.toEntry("bad code", { source: "api", raw: { code: 0 } }, NOW), null);
});

/* ---------- Quyết định sau mỗi code ---------- */

function entry(status, detail) {
  return { code: "DFJUDGE1", status, detail: detail || "" };
}

test("dừng khi trang trả 403/429 hoặc hai lỗi 5xx liên tiếp", () => {
  assert.equal(P.judge(entry("error"), { source: "api", raw: { httpStatus: 429 } }, {}, {}).action, "stop");
  const ctx = {};
  assert.equal(P.judge(entry("error"), { source: "api", raw: { httpStatus: 502 } }, ctx, {}).action, "continue");
  assert.equal(P.judge(entry("error"), { source: "api", raw: { httpStatus: 503 } }, ctx, {}).action, "stop");
});

test("dừng khi chưa xác định, khi trang báo rủi ro, khi không thao tác được", () => {
  assert.equal(P.judge(entry("unknown"), { source: "timeout" }, {}, {}).action, "stop");
  assert.match(P.judge(entry("error", "Quá nhiều lần thử"), { source: "dialog" }, {}, {}).note, /bảo vệ tài khoản/);
  assert.equal(P.judge(entry("unknown", "Không thấy ô nhập"), { source: "ui" }, {}, {}).action, "stop");
});

test("bảo vệ: 5 lỗi liên tiếp thì nghỉ, thành công thì đếm lại", () => {
  const ctx = {};
  const r = { source: "dialog" };
  for (let i = 0; i < 4; i++) assert.equal(P.judge(entry("error"), r, ctx, { protect: true }).action, "continue");
  assert.equal(P.judge(entry("error"), r, ctx, { protect: true }).action, "pause");
  assert.equal(ctx.streak, 0);
  P.judge(entry("error"), r, ctx, { protect: true });
  P.judge(entry("ok"), r, ctx, { protect: true });
  assert.equal(ctx.streak, 0);
  const free = {};
  for (let i = 0; i < 6; i++) assert.equal(P.judge(entry("error"), r, free, { protect: false }).action, "continue");
});

/* ---------- File log ---------- */

const SAMPLE = [
  { id: "a", at: new Date(NOW).toISOString(), code: "DFOK0001", status: "ok", detail: "Đổi thành công!" },
  { id: "b", at: new Date(NOW + 1000).toISOString(), code: "DFBAD002", status: "error", detail: "Code đã hết hạn | 1002" },
  { id: "c", at: new Date(NOW + 2000).toISOString(), code: "DFWAIT03", status: "unknown", detail: P.UNKNOWN_TEXT },
  { id: "d", at: new Date(NOW + 3000).toISOString(), code: "DFBAD002", status: "ok", detail: "Đổi thành công!" },
];

test("xuất log: mỗi code một trạng thái tốt nhất ở phần trên, đủ từng lượt ở phần chi tiết", () => {
  const text = P.formatLog(SAMPLE, { exportedAt: new Date(NOW).toISOString(), version: "2.0.0", settings: { protect: true } });
  assert.match(text, /=== DÙNG ĐƯỢC \(2\) ===\nDFOK0001\nDFBAD002\n/);
  assert.match(text, /=== LỖI \(0\) ===\n\(không có\)/);
  assert.match(text, /Tổng: 4 lượt, 2 dùng được, 1 lỗi, 1 chưa rõ/);
  assert.match(text, /\[CHƯA\] 19\/11\/2026 14:00:02  DFWAIT03  —  /);
});

test("đọc lại đúng file vừa xuất, không mất dòng nào", () => {
  const text = P.formatLog(SAMPLE, { exportedAt: new Date(NOW).toISOString() });
  const back = P.parseLog(text);
  assert.equal(back.length, 4);
  assert.deepEqual(back.map((e) => e.code + ":" + e.status), ["DFOK0001:ok", "DFBAD002:error", "DFWAIT03:unknown", "DFBAD002:ok"]);
  assert.equal(back[1].detail, "Code đã hết hạn | 1002");
  assert.equal(back[0].atText, "19/11/2026 14:00:00");
});

test("gộp log nạp từ file không nhân đôi lượt đã có", () => {
  const text = P.formatLog(SAMPLE, {});
  const merged = P.mergeLogs(SAMPLE, P.parseLog(text));
  assert.equal(merged.length, 4);
  const twice = P.mergeLogs(merged, P.parseLog(text));
  assert.equal(twice.length, 4);
});

test("đọc được file log của bản 1.9.9, kể cả dòng thiếu giờ", () => {
  const old = [
    "DF Code Garena — nhật ký đổi code",
    "Xuất lúc: 14:00:00 19/11/2026",
    "Khoảng cách: 15 giây",
    "",
    "=== DÙNG ĐƯỢC (1) ===",
    "DFOLD001",
    "",
    "=== LỖI (2) ===",
    "DFOLD002\tCode không hợp lệ | 1001",
    "DFOLD003  Đã hết lượt",
    "",
    "=== CHI TIẾT ===",
    "[OK] 14:00:00 19/11/2026  DFOLD001  —  Đổi thành công",
    "[LỖI]   DFOLD002  —  Code không hợp lệ | 1001",
    "[CHƯA] 14:01:00 19/11/2026  DFOLD004  —  Chưa xác định. Kiểm tra thủ công.",
    "",
  ].join("\n");
  const back = P.parseLog(old);
  assert.deepEqual(back.map((e) => e.code + ":" + e.status), [
    "DFOLD001:ok",
    "DFOLD002:error",
    "DFOLD004:unknown",
    "DFOLD003:error",
  ]);
  assert.equal(back[1].atText, "");
  const skip = P.settledCodes(back);
  assert.ok(skip.has("DFOLD001") && skip.has("DFOLD002") && skip.has("DFOLD003"));
  assert.ok(!skip.has("DFOLD004"));
});

test("file không phải log thì không có dòng nào", () => {
  assert.deepEqual(P.parseLog("xin chào\nDFABC123\n"), []);
});

test("gộp log giữ tối đa số dòng cho phép, bỏ dòng cũ nhất", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ code: "DFCAP" + String(i).padStart(3, "0"), status: "ok", at: "" }));
  const merged = P.mergeLogs(many, [], 10);
  assert.equal(merged.length, 10);
  assert.equal(merged[0].code, "DFCAP020");
});

/* ---------- Trạng thái chạy và địa chỉ ---------- */

test("phiên đang chạy mà lâu không cập nhật thì coi như đã ngắt", () => {
  assert.equal(P.isRunActive({ phase: "running", updatedAt: NOW - 1000 }, NOW), true);
  assert.equal(P.isRunActive({ phase: "waiting", updatedAt: NOW - 10 * MIN }, NOW), false);
  assert.equal(P.isRunActive({ phase: "done", updatedAt: NOW }, NOW), false);
  assert.equal(P.isRunActive(null, NOW), false);
});

test("chỉ nhận đúng trang đổi code của Garena", () => {
  assert.ok(P.isRedeemUrl("https://redeem.df.garena.sg/vi/cdkgarena.html"));
  assert.ok(P.isRedeemUrl("https://redeem.df.garena.sg/cdkgarena.html?x=1"));
  assert.ok(!P.isRedeemUrl("http://redeem.df.garena.sg/vi/cdkgarena.html"));
  assert.ok(!P.isRedeemUrl("https://redeem.df.garena.sg.evil.com/vi/cdkgarena.html"));
  assert.ok(!P.isRedeemUrl("https://redeem.df.garena.sg/vi/other.html"));
  assert.ok(!P.isRedeemUrl("https://redeem.df.garena.sg/a/b/cdkgarena.html"));
  assert.ok(!P.isRedeemUrl("không phải url"));
});

test("ghi chú dừng luôn kết thúc bằng dấu câu", () => {
  const note = P.judge({ code: "DFRISK01", status: "error", detail: "Too many requests | 1100" }, { source: "api", raw: {} }, {}, {}).note;
  assert.match(note, /1100\.$/);
  assert.equal(P.sentence("Xong!"), "Xong!");
  assert.equal(P.sentence(""), "");
});
