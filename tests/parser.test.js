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
  assert.deepEqual(P.parseCodes("1. DFONE111\n2) DFTWO222\n- DFTHREE3\n• DFFOUR44\n\"DFQUOTE5\"\nDF\u200BZERO66\uFEFF"), [
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
  // Code chưa từng có trong log nhập trước; code từng ghi chưa rõ (DFPLAN2) xếp cuối hàng.
  assert.equal(pl.queue[0], "DFPLAN3");
  assert.ok(!pl.queue.includes("DFPLAN2"));
  const short = P.plan({ codes: ["DFPLAN2", "DFPLAN3", "DFPLAN4"], log, settings: { protect: true }, attempts: [], now: NOW });
  assert.deepEqual(short.queue, ["DFPLAN3", "DFPLAN4", "DFPLAN2"]);
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
  const text = P.formatLog(SAMPLE, { exportedAt: new Date(NOW).toISOString(), version: "1.0.0", settings: { protect: true } });
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
  assert.equal(P.entryTime(back[0]), "19/11/2026 14:00:00");
  assert.equal(back[0].at, new Date(NOW).toISOString());
});

test("gộp log nạp từ file không nhân đôi lượt đã có", () => {
  const text = P.formatLog(SAMPLE, {});
  const merged = P.mergeLogs(SAMPLE, P.parseLog(text));
  assert.equal(merged.length, 4);
  const twice = P.mergeLogs(merged, P.parseLog(text));
  assert.equal(twice.length, 4);
});

test("đọc được file log của bản 0.5.0 beta (1.9.9 cũ), kể cả dòng thiếu giờ", () => {
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

/* ---------- Log: lỗi tạm thời, giới hạn, nạp và đối chiếu ---------- */

test("lỗi tạm thời ghi 'chưa rõ' để lần sau còn nhập lại; lỗi thật vẫn là 'lỗi'", () => {
  const cases = [
    [{ source: "api", raw: { code: 429, msg: "Too Many Requests", httpStatus: 429 } }, "unknown"],
    [{ source: "api", raw: { code: 503, msg: "Service Unavailable", httpStatus: 503 } }, "unknown"],
    [{ source: "api", raw: { httpStatus: 502 } }, "unknown"],
    [{ source: "dialog", text: "Network error, please try again" }, "unknown"],
    [{ source: "dialog", text: "Thao tác quá nhiều lần, vui lòng thử lại sau" }, "unknown"],
    [{ source: "api", raw: { code: 400068, msg: "The current cdkey has reached the redemption limit", screen: "error_hint_400068" } }, "error"],
    [{ source: "api", raw: { code: 400067, msg: "The current user has reached the redemption limit of cdkey group" } }, "error"],
    [{ source: "dialog", text: "Code không hợp lệ, vui lòng thử lại" }, "error"],
  ];
  for (const [result, want] of cases) {
    const e = P.toEntry("DFTEMP01", result, NOW);
    assert.equal(e.status, want, JSON.stringify(result));
    assert.equal(P.settledCodes([e]).has("DFTEMP01"), want === "error");
  }
  assert.equal(P.toEntry("DFTEMP02", { source: "api", raw: { httpStatus: 502 } }, NOW).detail, "Trang trả mã HTTP 502.");
});

test("một lỗi máy chủ lẻ thì nhập tiếp, hai lỗi liên tiếp thì dừng, 429 dừng ngay", () => {
  const ctx = {};
  const e1 = P.toEntry("DF5XX001", { source: "api", raw: { code: 500, msg: "Internal error", httpStatus: 500 } }, NOW);
  assert.equal(P.judge(e1, { source: "api", raw: { httpStatus: 500 } }, ctx, {}).action, "continue");
  const e2 = P.toEntry("DF5XX002", { source: "api", raw: { code: 500, msg: "Internal error", httpStatus: 500 } }, NOW);
  assert.equal(P.judge(e2, { source: "api", raw: { httpStatus: 500 } }, ctx, {}).action, "stop");
  const e3 = P.toEntry("DF429003", { source: "api", raw: { code: 429, msg: "Too Many Requests", httpStatus: 429 } }, NOW);
  assert.equal(P.judge(e3, { source: "api", raw: { httpStatus: 429 } }, {}, {}).action, "stop");
});

test("log cũ ghi lỗi tạm thời là 'lỗi' được đổi thành 'chưa rõ' khi nạp", () => {
  const text = [
    "=== LỖI (3) ===",
    "DFOLD429\tToo Many Requests | 429",
    "DFOLDRISK\tThao tác quá nhiều lần, vui lòng thử lại sau",
    "GARENADFNY2501E034\terror_hint_400068 | The current cdkey has reached the redemption limit",
  ].join("\n");
  const back = P.parseLog(text);
  assert.deepEqual(back.map((e) => e.code + ":" + e.status), ["DFOLD429:unknown", "DFOLDRISK:unknown", "GARENADFNY2501E034:error"]);
  const skip = P.settledCodes(back);
  assert.ok(!skip.has("DFOLD429") && !skip.has("DFOLDRISK") && skip.has("GARENADFNY2501E034"));
});

test("đọc được giờ của cả hai định dạng log", () => {
  const a = P.parseTimeText("19/11/2026 10:54:29");
  const b = P.parseTimeText("10:54:29 19/11/2026");
  assert.equal(a, new Date(2026, 10, 19, 10, 54, 29).toISOString());
  assert.equal(a, b);
  assert.equal(P.parseTimeText("—"), "");
  assert.equal(P.parseTimeText("32/13/2026 99:99:99"), "");
});

test("đọc đúng file log thật xuất từ bản 1.0.0", () => {
  const real = [
    "DF Code Garena — nhật ký đổi code", "Phiên bản: 1.0.0", "Xuất lúc: 19/11/2026 11:13:05",
    "Chế độ: Bảo vệ tài khoản, nghỉ ngẫu nhiên 20–30 giây", "Tổng: 4 lượt, 2 dùng được, 2 lỗi, 0 chưa rõ", "",
    "=== DÙNG ĐƯỢC (2) ===", "DFVNA4T8Z6P3", "ga_aurora", "",
    "=== LỖI (2) ===",
    "GARENADFCBT2503X9D1\tThe current cdkey has reached the redemption limit | 400068",
    "CRAZYPARTY1710\terror_hint_400067 | The current user has reached the redemption limit of cdkey group", "",
    "=== CHI TIẾT ===",
    "[OK] 19/11/2026 10:54:06  DFVNA4T8Z6P3  —  Đã nhận thành công! Vui lòng kiểm tra hộp thư trong game của bạn.",
    "[LỖI] 19/11/2026 10:55:24  GARENADFCBT2503X9D1  —  The current cdkey has reached the redemption limit | 400068",
    "[LỖI] 19/11/2026 10:57:24  CRAZYPARTY1710  —  error_hint_400067 | The current user has reached the redemption limit of cdkey group",
    "[OK] 19/11/2026 11:09:08  ga_aurora  —  Đã nhận thành công! Vui lòng kiểm tra hộp thư trong game của bạn.", "",
  ].join("\n");
  const back = P.parseLog(real);
  assert.deepEqual(back.map((e) => e.code + ":" + e.status), ["DFVNA4T8Z6P3:ok", "GARENADFCBT2503X9D1:error", "CRAZYPARTY1710:error", "ga_aurora:ok"]);
  assert.ok(back.every((e) => e.at));
  const pl = P.plan({ codes: ["DFVNA4T8Z6P3", "ga_aurora", "CRAZYPARTY1710", "DFNEW0001"], log: back, now: NOW });
  assert.equal(pl.skipped, 3);
  assert.deepEqual(pl.queue, ["DFNEW0001"]);
});

test("xuất log có phần CHƯA RÕ, đọc lại đúng", () => {
  const log = [
    { at: new Date(NOW).toISOString(), code: "DFWAIT01", status: "unknown", detail: P.UNKNOWN_TEXT },
    { at: new Date(NOW + 1).toISOString(), code: "DFBAD002", status: "error", detail: "Lỗi | 1002" },
  ];
  const text = P.formatLog(log, {});
  assert.match(text, /=== CHƯA RÕ \(1\) — sẽ nhập lại ở lần chạy sau ===\nDFWAIT01\t/);
  const onlySections = text.split("=== CHI TIẾT ===")[0];
  assert.deepEqual(P.parseLog(onlySections).map((e) => e.code + ":" + e.status), ["DFBAD002:error", "DFWAIT01:unknown"]);
});

test("log 5000 lượt xuất ra vẫn nạp lại được đủ", () => {
  const big = [];
  for (let i = 0; i < 5000; i++) {
    big.push({ at: new Date(NOW - (5000 - i) * 30000).toISOString(), code: "GARENADFNY" + String(i).padStart(4, "0") + "X", status: i % 4 ? "error" : "ok", detail: i % 4 ? "error_hint_400068 | The current cdkey has reached the redemption limit" : "Đã nhận thành công! Vui lòng kiểm tra hộp thư trong game của bạn." });
  }
  const text = P.formatLog(big, { version: "1.0.2" });
  assert.ok(Buffer.byteLength(text) < P.LIMITS.maxLogFileBytes, "file xuất phải nhỏ hơn giới hạn nạp");
  const back = P.parseLog(text);
  assert.equal(back.length, 5000);
  assert.equal(P.mergeLogs(big, back).length, 5000);
});

test("cắt log không làm mất thông tin bỏ qua code", () => {
  const log = [];
  log.push({ at: new Date(NOW - 9000).toISOString(), code: "DFKEEP01", status: "error", detail: "x" });
  log.push({ at: new Date(NOW - 8000).toISOString(), code: "DFDUP001", status: "error", detail: "lần 1" });
  log.push({ at: new Date(NOW - 7000).toISOString(), code: "DFWAIT01", status: "unknown", detail: "y" });
  log.push({ at: new Date(NOW - 6000).toISOString(), code: "DFDUP001", status: "error", detail: "lần 2" });
  log.push({ at: new Date(NOW - 5000).toISOString(), code: "DFNEW001", status: "ok", detail: "z" });
  const cut1 = P.capLog(log, 4);
  assert.deepEqual(cut1.map((e) => e.code + ":" + e.detail), ["DFKEEP01:x", "DFWAIT01:y", "DFDUP001:lần 2", "DFNEW001:z"]);
  const cut2 = P.capLog(log, 3);
  assert.deepEqual(cut2.map((e) => e.code), ["DFKEEP01", "DFDUP001", "DFNEW001"]);
  assert.ok(P.settledCodes(cut2).has("DFKEEP01"));
  const cut3 = P.capLog(log, 2);
  assert.deepEqual(cut3.map((e) => e.code), ["DFDUP001", "DFNEW001"]);
});

test("nạp file log cũ không đẩy mất lượt mới đang có", () => {
  const cur = [];
  for (let i = 0; i < 6; i++) cur.push({ at: new Date(NOW + i * 1000).toISOString(), code: "DFCUR00" + i, status: "ok", detail: "mới" });
  const old = [];
  for (let i = 0; i < 4; i++) old.push({ atText: "01/01/2026 10:00:0" + i, code: "DFIMP00" + i, status: "error", detail: "cũ" });
  const merged = P.mergeLogs(cur, old, 8);
  assert.equal(merged.length, 8);
  assert.equal(merged.filter((e) => e.code.startsWith("DFCUR")).length, 6);
  assert.deepEqual(merged.slice(0, 2).map((e) => e.code), ["DFIMP002", "DFIMP003"]);
  assert.equal(merged[merged.length - 1].code, "DFCUR005");
});

test("đối chiếu danh sách với log theo trạng thái tốt nhất của từng code", () => {
  const log = [
    { code: "DFA00001", status: "error" },
    { code: "DFA00001", status: "ok" },
    { code: "DFB00002", status: "error" },
    { code: "DFC00003", status: "unknown" },
  ];
  assert.deepEqual(P.overlap(["DFA00001", "DFB00002", "DFC00003", "DFD00004"], log), { ok: 1, error: 1, unknown: 1, fresh: 1 });
  const pl = P.plan({ codes: ["DFA00001", "DFB00002", "DFC00003", "DFD00004"], log, now: NOW });
  assert.equal(pl.skipped, 2);
  assert.deepEqual(pl.queue, ["DFD00004", "DFC00003"]);
});

test("đọc code dán từ mạng xã hội: emoji, dấu sao, ngoặc, dấu câu", () => {
  const cases = {
    "DFABC123🔥": ["DFABC123"],
    "🎁DFABC123": ["DFABC123"],
    "Nhập code (DFABC123) để nhận quà": ["DFABC123"],
    "「DFABC123」": ["DFABC123"],
    "DFABC123。": ["DFABC123"],
    "**DFABC123**": ["DFABC123"],
    "DFABC123 (5000)": ["DFABC123"],
    "DFABC123 [x2] (hết hạn 30/11)": ["DFABC123"],
    "Code #DFHASH12 nhé": ["DFHASH12"],
    "DFKEEP99 # ghi chú": ["DFKEEP99"],
    "#DFABC123": [],
    "Hello!": ["Hello"],
    "mã-tiếng-việt": [],
  };
  for (const [input, want] of Object.entries(cases)) assert.deepEqual(P.parseCodes(input), want, input);
});

test("dòng toàn dấu mở ngoặc không làm treo bộ đọc", () => {
  const t = Date.now();
  P.parseCodes("(".repeat(200000));
  P.parseCodes("{[(".repeat(66000));
  assert.ok(Date.now() - t < 1000);
});

test("sửa log lưu từ bản trước, chỉ báo thay đổi khi thật sự có", () => {
  const old = [
    { id: "a", at: new Date(NOW).toISOString(), code: "DFOLD001", status: "error", detail: "Too Many Requests | 429", serverCode: 429 },
    { id: "b", at: new Date(NOW + 1).toISOString(), code: "DFOLD002", status: "error", detail: "error_hint_400068 | The current cdkey has reached the redemption limit", serverCode: 400068 },
  ];
  const first = P.migrateLog(old);
  assert.equal(first.changed, true);
  assert.deepEqual(first.log.map((e) => e.status), ["unknown", "error"]);
  const second = P.migrateLog(first.log);
  assert.equal(second.changed, false);
  assert.equal(P.migrateLog([]).changed, false);
  assert.equal(P.migrateLog(undefined).changed, false);
});

/* ---------- Phát hiện ký tự sai ---------- */

test("không cắt mất chữ giống chữ Latin ở đầu hay cuối code rồi nhập nhầm code khác", () => {
  for (const text of ["АBC123", "DFABC12З", "ＤFABC123", "DFABC12Ⅲ"]) {
    const a = P.analyzeCodes(text);
    assert.deepEqual(a.codes, [], text);
    assert.equal(a.suspects.length, 1, text);
  }
});

test("phát hiện và sửa từng loại ký tự sai", () => {
  const cases = [
    ["DFАBC123", "DFABC123", true, "homoglyph"],
    ["GIVEMЕTHAT", "GIVEMETHAT", true, "homoglyph"],
    ["TrickOrTrеat", "TrickOrTreat", true, "homoglyph"],
    ["DFΑBC123", "DFABC123", true, "homoglyph"],
    ["DFⅡ2025", "DFII2025", true, "roman"],
    ["ＤＦＡＢＣ１２３", "DFABC123", true, "fullwidth"],
    ["\u{1D403}\u{1D405}\u{1D400}\u{1D401}\u{1D402}\u{1D7CF}\u{1D7D0}\u{1D7D1}", "DFABC123", true, "styled"],
    ["DF–ABC123", "DF-ABC123", true, "dash"],
    ["DFƯEAPON91", "DFWEAPON91", true, "accent"],
    ["DFĐABC123", "DFDDABC123", true, "accent"],
    ["DF.ABC123", "DFABC123", true, "special"],
    ["DF@ABC123", "DFABC123", true, "special"],
    ["DFФABC123", "DFABC123", false, "foreign"],
  ];
  for (const [text, fixed, fixable, kind] of cases) {
    const a = P.analyzeCodes(text);
    assert.deepEqual(a.codes, [], text);
    assert.equal(a.suspects.length, 1, text);
    const s = a.suspects[0];
    assert.equal(s.raw, text);
    assert.equal(s.fixed, fixed, text);
    assert.equal(s.fixable, fixable, text);
    assert.ok(s.issues.some((i) => i.kind === kind), text);
    assert.ok(P.describeSuspect(s).length > 10, text);
    assert.equal(s.line, 1);
  }
});

test("không báo nhầm câu tiếng Việt, giá tiền, ngày tháng, email, chữ Nga thật", () => {
  const text = [
    "Xin chào các bạn, code mới hôm nay đây!",
    "Giá 10.000đ, hạn 30/11/2026",
    "Không",
    "Liên hệ email@gmail.com",
    "Привет мир",
    "Phần thưởng: 100 brick + skin",
    "DFABC123 ❤\uFE0F",
    "1\uFE0F\u20E3 DFKEY456",
    "① DFNUM789",
  ].join("\n");
  const a = P.analyzeCodes(text);
  assert.deepEqual(a.suspects, []);
  assert.deepEqual(a.codes, ["DFABC123", "DFKEY456", "DFNUM789"]);
});

test("dòng có code sai không bị tính là dòng không nhận ra; code sai trùng chỉ báo một lần", () => {
  const a = P.analyzeCodes("DFАBC123\nDFАBC123\nxin chào\nDFOK1234");
  assert.deepEqual(a.codes, ["DFOK1234"]);
  assert.equal(a.suspects.length, 1);
  assert.equal(a.ignored, 1);
});

test("sửa tự động mọi code sửa được, giữ nguyên chữ không giống chữ Latin", () => {
  const text = "DFАBC123\nDFƯEAPON91\nＤＦ１２３４\nDFOK1234";
  const a = P.analyzeCodes(text);
  assert.equal(a.suspects.length, 3);
  const fixed = P.fixSuspects(text, a.suspects);
  assert.equal(fixed, "DFABC123\nDFWEAPON91\nDF1234\nDFOK1234");
  const b = P.analyzeCodes(fixed);
  assert.deepEqual(b.codes, ["DFABC123", "DFWEAPON91", "DF1234", "DFOK1234"]);
  assert.equal(b.suspects.length, 0);
  // Chữ không giống chữ Latin (Ф) thì không tự sửa
  const c = P.analyzeCodes("DFФABC123");
  assert.equal(c.suspects[0].fixable, false);
  assert.equal(P.fixSuspects("DFФABC123", c.suspects), "DFФABC123");
});

test("Demo Code không có code nào bị báo ký tự sai", () => {
  const fs = require("node:fs");
  const demo = fs.readFileSync(require("node:path").join(__dirname, "..", "demo-codes.txt"), "utf8");
  const a = P.analyzeCodes(demo);
  assert.deepEqual(a.suspects, []);
  assert.equal(a.codes.length, demo.split(/\r?\n/).filter((l) => l.trim()).length);
});

test("phát hiện ký tự sai vẫn nhanh với văn bản dài toàn chữ lạ", () => {
  const t = Date.now();
  P.analyzeCodes(("Привет DFАBC123 ＤＦ１２３ ").repeat(5000));
  assert.ok(Date.now() - t < 2000);
});

test("sửa tự động cả code có ký tự vô hình chen giữa", () => {
  const text = "DF\u0410\uFE0FBC\u200B123";
  const a = P.analyzeCodes(text);
  assert.equal(a.suspects.length, 1);
  const fixed = P.fixSuspects(text, a.suspects);
  assert.equal(fixed, "DFABC123");
  assert.deepEqual(P.analyzeCodes(fixed).codes, ["DFABC123"]);
});

test("Telex/VNI: so với code đã biết để sửa đúng, kể cả phím dấu gõ muộn", () => {
  const known = new Set(["WELCOMETODF", "DFLUISHERE", "TrickOrTreat", "HEDELTAFORCE3630", "GARENADFNY2501E034", "DFSL1983"]);
  const cases = [
    [String.fromCodePoint(0x1AF) + "ELCOMETODF", "WELCOMETODF"],
    ["DFLU" + String.fromCodePoint(0xCD) + "HERE", "DFLUISHERE"],
    ["Trick" + String.fromCodePoint(0x1ECE) + "Treat", "TrickOrTreat"],
    ["HEDELTAFORC" + String.fromCodePoint(0x1EBA) + "630", "HEDELTAFORCE3630"],
    ["G" + String.fromCodePoint(0x1EA2) + "EN" + String.fromCodePoint(0xC0) + "DNY2501E034", "GARENADFNY2501E034"],
    ["DFSL.1983", "DFSL1983"],
  ];
  for (const [typed, want] of cases) {
    const s = P.analyzeCodes(typed, { known }).suspects[0];
    assert.equal(s.fixed, want, typed);
    assert.equal(s.matched, true, typed);
    assert.equal(s.guess, false, typed);
  }
  const g = P.analyzeCodes("DFA" + String.fromCodePoint(0x110) + "ON77", { known }).suspects[0];
  assert.equal(g.fixed, "DFADDON77");
  assert.equal(g.guess, true);
});

test("không báo nhầm câu tiếng Việt, giá tiền, số có dấu phân cách khi bật sửa Telex", () => {
  const known = new Set(["DFWEAPON91", "DFSL1983"]);
  const noise = ["Không", "Chào các bạn", "Giá 10.000đ", "Hết hạn 30/11", "email@gmail.com", "Tết 2026", "1.000.000VNĐ", "50.000VND", "Phiên bản v1.2.3", "Thưởng 100 brick, 1,5 triệu", "HÔM NAY CÓ CODE MỚI"];
  for (const text of noise) assert.deepEqual(P.analyzeCodes(text, { known }).suspects, [], text);
});

/* ---------- Hai bản: Garena và quốc tế ---------- */

test("nhận đúng trang đổi code của từng bản", () => {
  assert.equal(P.siteOf("https://redeem.df.garena.sg/vi/cdkgarena.html"), "garena");
  assert.equal(P.siteOf("https://redeem.df.garena.sg/cdkgarena.html?x=1"), "garena");
  assert.equal(P.siteOf("https://www.playdeltaforce.com/vi/cdkredeem.html"), "intl");
  assert.equal(P.siteOf("https://www.playdeltaforce.com/en/cdkredeem.html#top"), "intl");
  assert.equal(P.siteOf("https://www.playdeltaforce.com/cdkredeem.html"), "intl");
  assert.equal(P.siteOf("http://www.playdeltaforce.com/en/cdkredeem.html"), "");
  assert.equal(P.siteOf("https://playdeltaforce.com/en/cdkredeem.html"), "");
  assert.equal(P.siteOf("https://www.playdeltaforce.com/en/index.html"), "");
  assert.equal(P.siteOf("https://www.playdeltaforce.com/en/cdkgarena.html"), "");
  assert.equal(P.siteOf("https://redeem.df.garena.sg/vi/cdkredeem.html"), "");
  assert.equal(P.siteOf("https://evil.example/www.playdeltaforce.com/en/cdkredeem.html"), "");
  assert.equal(P.siteOf("không phải url"), "");
  assert.ok(P.isRedeemUrl("https://www.playdeltaforce.com/vi/cdkredeem.html"));
  assert.equal(P.siteOf(P.SITES.garena.page), "garena");
  assert.equal(P.siteOf(P.SITES.intl.page), "intl");
  assert.equal(P.normSite("intl"), "intl");
  assert.equal(P.normSite(undefined), "garena");
  assert.equal(P.normSite("lạ"), "garena");
});

test("lượt log ghi bản; log cũ không ghi bản là của Garena", () => {
  const a = P.toEntry("DFINTL01", { source: "api", raw: { code: 0, msg: "ok" } }, new Date(NOW), "intl");
  assert.equal(a.site, "intl");
  const b = P.toEntry("DFGRNA01", { source: "api", raw: { code: 0, msg: "ok" } }, new Date(NOW));
  assert.equal(b.site, "garena");
  assert.equal(P.normalizeEntry({ code: "DFOLD001", status: "ok", at: new Date(NOW).toISOString() }).site, "garena");
  assert.equal(P.normalizeEntry({ code: "DFOLD001", status: "ok", site: "intl" }).site, "intl");
});

test("bỏ qua code đã có trong log chỉ tính trong cùng một bản", () => {
  const log = [
    { code: "DFSAME01", status: "error", at: new Date(NOW - HOUR).toISOString(), detail: "x" },
    { code: "DFSAME02", status: "ok", at: new Date(NOW - HOUR).toISOString(), detail: "x", site: "intl" },
  ];
  const codes = ["DFSAME01", "DFSAME02", "DFNEW001"];
  const g = P.plan({ codes: codes, log: log, settings: { protect: true }, attempts: [], now: NOW, site: "garena" });
  assert.deepEqual(g.queue, ["DFSAME02", "DFNEW001"]);
  const i = P.plan({ codes: codes, log: log, settings: { protect: true }, attempts: [], now: NOW, site: "intl" });
  assert.deepEqual(i.queue, ["DFSAME01", "DFNEW001"]);
  assert.deepEqual(P.overlap(codes, log, "garena"), { ok: 0, error: 1, unknown: 0, fresh: 2 });
  assert.deepEqual(P.overlap(codes, log, "intl"), { ok: 1, error: 0, unknown: 0, fresh: 2 });
  /* Không ghi bản: như trước, tính mọi lượt. */
  assert.deepEqual(P.overlap(codes, log), { ok: 1, error: 1, unknown: 0, fresh: 1 });
});

test("mã trang không coi là lỗi (601008, 503601) và hết phiên (300001) ghi chưa rõ ở cả hai bản", () => {
  for (const code of [601008, 503601, 300001]) {
    assert.equal(P.describeApi({ code: code, msg: "" }).status, "unknown");
    for (const site of ["garena", "intl"]) {
      const e = P.toEntry("DFSILENT1", { source: "api", raw: { code: code } }, new Date(NOW), site);
      assert.equal(e.status, "unknown");
      assert.equal(P.judge(e, { source: "api", raw: { code: code } }, {}, { protect: true }).action, "stop");
    }
  }
  assert.equal(P.describeApi({ code: 400068, msg: "CDK đã đạt giới hạn đổi." }).status, "error");
});

test("câu của trang quốc tế: thành công, lỗi, lỗi mạng (giới hạn tần suất)", () => {
  const ok = P.toEntry("DFINTL02", { source: "api", raw: { code: 0, msg: "ok", screen: "Đã nhận thành công! Vui lòng kiểm tra hộp thư trong game của bạn." } }, new Date(NOW), "intl");
  assert.equal(ok.status, "ok");
  const bad = P.toEntry("DFINTL03", { source: "api", raw: { code: 400054, screen: "CDKey đã nhập không hợp lệ. Vui lòng thử lại." } }, new Date(NOW), "intl");
  assert.equal(bad.status, "error");
  const raw = { code: 400086, msg: "frequency limit", screen: "Lỗi mạng, vui lòng thử lại sau" };
  const busy = P.toEntry("DFINTL04", { source: "api", raw: raw }, new Date(NOW), "intl");
  assert.equal(busy.status, "unknown");
  assert.equal(P.judge(busy, { source: "api", raw: raw }, {}, { protect: true }).action, "stop");
});

test("file log giữ bản của từng lượt khi xuất rồi nạp lại", () => {
  const list = [
    { id: "a", code: "DFBOTH01", status: "error", at: new Date(NOW - 3 * MIN).toISOString(), detail: "Lỗi G", site: "garena" },
    { id: "b", code: "DFBOTH01", status: "ok", at: new Date(NOW - 2 * MIN).toISOString(), detail: "Thành công", site: "intl" },
    { id: "c", code: "DFINTL05", status: "unknown", at: new Date(NOW - MIN).toISOString(), detail: "Lỗi mạng", site: "intl" },
  ];
  const text = P.formatLog(list, { exportedAt: new Date(NOW).toISOString() });
  assert.match(text, /=== QUỐC TẾ — DÙNG ĐƯỢC \(1\) ===\nDFBOTH01\n/);
  assert.match(text, /=== LỖI \(1\) ===\nDFBOTH01\t/);
  assert.match(text, /\[OK\] QT \S+ \S+\s+DFBOTH01/);
  const back = P.parseLog(text);
  assert.equal(back.length, 3);
  const key = (e) => e.site + "|" + e.code + "|" + e.status;
  assert.deepEqual(back.map(key).sort(), ["garena|DFBOTH01|error", "intl|DFBOTH01|ok", "intl|DFINTL05|unknown"]);
  const merged = P.mergeLogs(list, back);
  assert.equal(merged.length, 3);
  /* Chỉ có phần tóm tắt (CHI TIẾT bị cắt): vẫn biết code nào của bản nào. */
  const head = text.split("=== CHI TIẾT ===")[0];
  assert.deepEqual(P.parseLog(head).map(key).sort(), ["garena|DFBOTH01|error", "intl|DFBOTH01|ok", "intl|DFINTL05|unknown"]);
  /* Log chỉ có Garena: không có mục QUỐC TẾ, giống bản cũ. */
  assert.doesNotMatch(P.formatLog([list[0]], {}), /QUỐC TẾ|\bQT\b/);
});

/* ---------- Màu biểu tượng ---------- */

test("màu biểu tượng: xanh lá Garena, xanh dương quốc tế, đỏ khi phiên có code lỗi hoặc chưa rõ", () => {
  const now = NOW;
  const live = (extra) => Object.assign({ phase: "waiting", updatedAt: now, startedAt: now - MIN, site: "garena", tally: { ok: 0, error: 0, unknown: 0 } }, extra);
  assert.equal(P.iconLook(null, undefined, now), "garena");
  assert.equal(P.iconLook(null, "intl", now), "intl");
  assert.equal(P.iconLook({ phase: "idle" }, "intl", now), "intl");
  /* Đang chạy: theo bản của phiên, không theo bản đang chọn. */
  assert.equal(P.iconLook(live({ site: "intl" }), "garena", now), "intl");
  assert.equal(P.iconLook(live({ tally: { ok: 3, error: 0, unknown: 0 } }), "garena", now), "garena");
  /* Một code lỗi là đỏ ngay, kể cả khi đang chạy. */
  assert.equal(P.iconLook(live({ tally: { ok: 3, error: 1, unknown: 0 } }), "garena", now), "red");
  assert.equal(P.iconLook(live({ site: "intl", tally: { ok: 0, error: 0, unknown: 1 } }), "garena", now), "red");
  /* Xong mà không có vấn đề: giữ màu của bản. */
  const done = { phase: "done", updatedAt: now - HOUR, site: "garena", tally: { ok: 5, error: 0, unknown: 0 } };
  assert.equal(P.iconLook(done, "garena", now), "garena");
  /* Xong hoặc dừng mà có lỗi: vẫn đỏ, tới khi phiên mới bắt đầu. */
  const bad = { phase: "stopped", updatedAt: now - HOUR, site: "garena", tally: { ok: 5, error: 1, unknown: 0 } };
  assert.equal(P.iconLook(bad, "garena", now), "red");
  /* Đã chuyển sang bản kia: theo màu bản đó. */
  assert.equal(P.iconLook(bad, "intl", now), "intl");
  /* Phiên cũ không ghi bản là của Garena. */
  assert.equal(P.iconLook({ phase: "done", tally: { error: 2 } }, "garena", now), "red");
  assert.equal(P.iconLook({ phase: "done", tally: "hỏng" }, "garena", now), "garena");
  assert.deepEqual(P.iconPaths("garena"), { 16: "icons/icon16.png", 48: "icons/icon48.png", 128: "icons/icon128.png" });
  assert.deepEqual(P.iconPaths("intl")[16], "icons/icon16-intl.png");
  assert.deepEqual(P.iconPaths("red")[128], "icons/icon128-red.png");
  assert.deepEqual(P.iconPaths("lạ")[48], "icons/icon48.png");
  assert.equal(P.LOOKS.garena.accent, "#0ff796");
  assert.equal(P.LOOKS.intl.accent, "#0079d5");
  assert.equal(P.LOOKS.red.accent, "#f7413d");
});

test("file biểu tượng của mọi màu đều có và nằm trong gói", () => {
  const fs = require("fs");
  const path = require("path");
  const pack = fs.readFileSync(path.join(__dirname, "..", "tools", "pack.mjs"), "utf8");
  for (const look of Object.keys(P.LOOKS)) {
    for (const file of Object.values(P.iconPaths(look))) {
      assert.ok(fs.existsSync(path.join(__dirname, "..", file)), file);
      assert.ok(pack.includes('"' + file + '"'), "pack.mjs thiếu " + file);
    }
  }
});
