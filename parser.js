/* DF Code Garena — logic dùng chung.
 *
 * Đọc danh sách code, tính nhịp nghỉ và hạn mức, đọc kết quả trang trả về, ghi và đọc file log.
 * File này không đụng tới DOM, mạng hay chrome.*. Popup, trang đổi code, service worker
 * và bộ test Node đều nạp đúng một bản này.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.DFParse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------- Hằng số ---------- */

  const REDEEM_HOST = "redeem.df.garena.sg";
  const REDEEM_PAGE = "https://redeem.df.garena.sg/vi/cdkgarena.html";
  const REDEEM_PATH = /^\/(?:[^/]+\/)?cdkgarena\.html$/i;

  const KEYS = Object.freeze({
    draft: "dfcode.draft",
    gap: "dfcode.gap",
    random: "dfcode.random",
    skipLogged: "dfcode.skipLogged",
    protect: "dfcode.protect",
    log: "dfcode.log",
    meta: "dfcode.meta",
    run: "dfcode.run",
    attempts: "dfcode.attempts",
    stop: "dfcode.stop",
  });
  /* Khóa của bản cũ, xóa khi gặp. */
  const LEGACY_KEYS = Object.freeze(["dfcode.restUntil", "dfcode.skipOk"]);

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  const LIMITS = Object.freeze({
    maxCodes: 1000,
    maxText: 200000,
    maxFileBytes: 200 * 1024,
    /* File log xuất ra có thể lớn (5000 lượt ~ 1 MB), nên file log được nhận lớn hơn file danh sách code. */
    maxLogFileBytes: 2 * 1024 * 1024,
    maxLogText: 2200000,
    logCap: 5000,
    detailCap: 500,
    /* Phiên "đang chạy" không cập nhật quá lâu thì coi như đã chết (tab đóng, trình duyệt tắt). */
    staleMs: 150 * SECOND,
    heartbeatMs: 10 * SECOND,
    /* Thời gian ước lượng trang trả lời mỗi code, chỉ dùng để ước tính. */
    replySec: 3,
    pageTimeoutMs: 20 * SECOND,
  });

  const PROFILES = Object.freeze({
    /* Bảo vệ tài khoản: bật mặc định. */
    safe: Object.freeze({
      protect: true,
      perRun: 30,
      perHour: 30,
      perDay: 60,
      cooldownMs: 60 * SECOND,
      gapMin: 20,
      gapMax: 30,
      errorStreak: 5,
      pauseMin: 30,
      pauseMax: 60,
    }),
    /* Tắt bảo vệ: người dùng tự chọn nhịp, trần cao hơn và có hỏi lại. */
    free: Object.freeze({
      protect: false,
      perRun: 100,
      perHour: 100,
      perDay: 200,
      cooldownMs: 20 * SECOND,
      randomMin: 10,
      randomMax: 15,
      gapMin: 5,
      gapMax: 60,
    }),
  });
  const GAP_DEFAULT = 15;

  const UNKNOWN_TEXT = "Chưa xác định. Kiểm tra thủ công.";

  /* ---------- Chữ ---------- */

  function squash(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  function sanitizeText(text, limit) {
    const cap = limit || LIMITS.detailCap;
    let value = squash(text).slice(0, cap * 2);
    if (!value) return "";
    value = value.replace(/https?:\/\/\S+/gi, "[đã ẩn liên kết]");
    value = value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[đã ẩn email]");
    value = value.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[đã ẩn]");
    value = value.replace(/\bBearer\s+\S+/gi, "[đã ẩn]");
    value = value.replace(
      /\b(?:cookie|set-cookie|authorization|access_token|refresh_token|id_token|sessionid|passwd|password|openid|sso_key|token)\s*[:=]\s*\S+/gi,
      "[đã ẩn]",
    );
    value = value.replace(/\b[a-f0-9]{32,}\b/gi, "[đã ẩn]");
    value = value.replace(/\d{8,}/g, "[đã ẩn số]");
    return squash(value).slice(0, cap);
  }

  /* Thêm dấu chấm cuối câu nếu chưa có, để nối câu sau không bị dính. */
  function sentence(text) {
    const value = squash(text);
    if (!value) return "";
    return /[.!?…]$/.test(value) ? value : value + ".";
  }

  function usableText(text) {
    const value = sanitizeText(text);
    if (!value) return "";
    if (/^(?:\[đã ẩn(?: liên kết| email)?\]\s*)+$/.test(value)) return "";
    return value;
  }

  /* ---------- Đọc danh sách code ---------- */

  const CODE_RE = /^[A-Za-z0-9_-]{4,80}$/;

  function isCodeToken(value) {
    return typeof value === "string" && CODE_RE.test(value);
  }

  /* Dùng cho dòng có nhiều chữ: chỉ nhận chữ trông rõ là code, để không gửi nhầm
   * "brick", "Delta", "Force"… thành một lần thử trên tài khoản. */
  function looksLikeCode(word) {
    if (!isCodeToken(word) || word.length < 5) return false;
    if (/^[\d_-]+$/.test(word)) return false;
    if (/\d/.test(word)) return true;
    if (/^df/i.test(word)) return true;
    if (/^[A-Z_-]+$/.test(word)) return word.length >= 8;
    return /[a-z]/.test(word) && /[A-Z]/.test(word.slice(1));
  }

  /* Cắt ở hai đầu mỗi từ những ký tự không phải chữ hay số: ngoặc kép, dấu câu, dấu sao, emoji, số mũ, số khoanh tròn…
   * ("DFABC123🔥", "**DFABC123**", "①DFABC123"). Chữ và số của bảng chữ khác (Kirin, Hy Lạp, toàn chiều rộng, số La Mã)
   * KHÔNG bị cắt: cắt đi sẽ biến "АBC123" (A Kirin) thành một code khác là "BC123". Chúng được kiểm ở dưới. */
  const EDGE_JUNK = /^[^\p{L}\p{Nd}\p{Nl}\p{M}_-]+|[^\p{L}\p{Nd}\p{Nl}\p{M}_-]+$/gu;

  /* ---------- Phát hiện ký tự sai trong code ---------- */

  /* Chữ của bảng chữ khác trông giống hệt chữ Latin (dán từ mạng hay gặp). */
  const HOMOGLYPHS = {
    "А": "A", "В": "B", "Е": "E", "К": "K", "М": "M", "Н": "H", "О": "O",
    "Р": "P", "С": "C", "Т": "T", "У": "Y", "Х": "X", "Ѕ": "S", "І": "I",
    "Ј": "J", "З": "3", "а": "a", "е": "e", "о": "o", "р": "p", "с": "c",
    "у": "y", "х": "x", "ѕ": "s", "і": "i", "ј": "j", "ԁ": "d", "ԛ": "q",
    "ԝ": "w", "һ": "h", "Α": "A", "Β": "B", "Ε": "E", "Ζ": "Z", "Η": "H",
    "Ι": "I", "Κ": "K", "Μ": "M", "Ν": "N", "Ο": "O", "Ρ": "P", "Τ": "T",
    "Υ": "Y", "Χ": "X", "ο": "o", "ν": "v", "ı": "i",
  };
  const DASHES = /^[‐-―−⁃﹘﹣]$/;

  function scriptOf(ch) {
    const c = ch.codePointAt(0);
    if (c >= 0x0400 && c <= 0x052F) return "chữ Kirin (Nga)";
    if (c >= 0x0370 && c <= 0x03FF) return "chữ Hy Lạp";
    return "chữ của bảng chữ khác";
  }

  /* Dấu thanh tiếng Việt và phím tạo ra nó: Telex (s f r x j), VNI (1 2 3 4 5). */
  const TONE_TELEX = { "\u0301": "s", "\u0300": "f", "\u0309": "r", "\u0303": "x", "\u0323": "j" };
  const TONE_VNI = { "\u0301": "1", "\u0300": "2", "\u0309": "3", "\u0303": "4", "\u0323": "5" };
  const COMBINING = /[\u0300-\u036F]/g;

  function baseLetter(ch) {
    if (ch === "đ") return "d";
    if (ch === "Đ") return "D";
    const base = ch.normalize("NFD").replace(COMBINING, "");
    return /^[A-Za-z]$/.test(base) ? base : "";
  }

  /* Các phím có thể đã gõ ra một chữ có dấu khi bộ gõ tiếng Việt đang bật, cách hay gặp nhất đứng đầu.
   * Telex: "w" ra "ư", "uw" ra "ư", "aa" ra "â", "dd" ra "đ", "as" ra "á"… VNI: "u7" ra "ư", "e3" ra "ẻ"…
   * upper: các chữ khác trong code viết hoa nên phím dấu cũng viết hoa. vniFirst: ngay sau là chữ số. */
  function retypeAccent(ch, upper, vniFirst) {
    const k = function (x) { return upper ? x.toUpperCase() : x; };
    if (ch === "đ" || ch === "Đ") {
      const d = ch === "Đ" ? "D" : "d";
      const pairs = [{ body: d + k("d"), tone: "" }, { body: d + "9", tone: "" }];
      return vniFirst ? pairs.reverse() : pairs;
    }
    const nfd = ch.normalize("NFD");
    const base = nfd.charAt(0);
    if (!/^[A-Za-z]$/.test(base)) return [];
    const marks = nfd.slice(1);
    let mod = "";
    let modV = "";
    let bare = "";
    if (marks.indexOf("\u0302") !== -1) {
      mod = k(base.toLowerCase());
      modV = "6";
    } else if (marks.indexOf("\u0306") !== -1) {
      mod = k("w");
      modV = "8";
    } else if (marks.indexOf("\u031B") !== -1) {
      mod = k("w");
      modV = "7";
      if (/u/i.test(base)) bare = base === "U" ? "W" : "w";
    }
    let tone = "";
    let toneV = "";
    for (let i = 0; i < marks.length; i++) {
      if (TONE_TELEX[marks[i]]) {
        tone = k(TONE_TELEX[marks[i]]);
        toneV = TONE_VNI[marks[i]];
      }
    }
    const telex = bare ? [{ body: bare, tone: tone }, { body: base + mod, tone: tone }] : [{ body: base + mod, tone: tone }];
    const vni = [{ body: base + modV, tone: toneV }];
    return vniFirst ? vni.concat(telex) : telex.concat(vni);
  }

  /* Xét từng ký tự không thuộc code trong một từ: loại lỗi, chữ thay thế, và có sửa tự động được không. */
  function inspectWord(word) {
    const chars = Array.from(word);
    const ascii = chars.filter(function (c) { return /^[A-Za-z]$/.test(c); });
    const uppers = ascii.filter(function (c) { return c === c.toUpperCase(); }).length;
    const mostlyUpper = uppers * 2 > ascii.length;
    let fixed = "";
    let fixable = true;
    const issues = [];
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      if (/^[A-Za-z0-9_-]$/.test(ch)) {
        fixed += ch;
        continue;
      }
      let to = HOMOGLYPHS[ch] || "";
      let kind = to ? "homoglyph" : "";
      let options = null;
      if (!kind && DASHES.test(ch)) {
        to = "-";
        kind = "dash";
      }
      if (!kind && !/\p{No}/u.test(ch)) {
        const n = ch.normalize("NFKC");
        if (n !== ch && /^[A-Za-z0-9_-]+$/.test(n)) {
          const c = ch.codePointAt(0);
          to = n;
          kind = c >= 0x2160 && c <= 0x2188 ? "roman" : c >= 0xFF00 && c <= 0xFFEF ? "fullwidth" : "styled";
        }
      }
      if (!kind && baseLetter(ch)) {
        /* Phím dấu viết hoa khi chính chữ đó viết hoa và code chủ yếu viết hoa ("DFLUÍHERE" → "IS");
         * "TrickỎTreat" → "Or". Biến thể khác hoa/thường vẫn được thử khi so với code đã biết. */
        const upperKey = ch !== ch.toLowerCase() && mostlyUpper;
        const vniFirst = /^[0-9]$/.test(chars[i + 1] || "");
        options = retypeAccent(ch, upperKey, vniFirst).concat(retypeAccent(ch, !upperKey, vniFirst));
        options = options.filter(function (x, n) {
          return options.findIndex(function (y) { return y.body === x.body && y.tone === x.tone; }) === n;
        });
        to = options.length ? options[0].body + options[0].tone : baseLetter(ch);
        kind = "accent";
      }
      /* Code thật chỉ có chữ, số và "_": dấu câu, ký hiệu giữa code (". @ / ·"…) bỏ đi được. */
      if (!kind && /[\p{P}\p{S}]/u.test(ch)) kind = "special";
      /* Chữ hay số của bảng chữ khác mà không giống chữ Latin: không đoán được, phải sửa tay. */
      if (!kind) {
        kind = "foreign";
        fixable = false;
      }
      fixed += to;
      const issue = { ch: ch, kind: kind, to: to, at: i };
      if (options) issue.options = options;
      issues.push(issue);
    }
    return { fixed: fixed, fixable: fixable, issues: issues, chars: chars, asciiLetters: ascii.length };
  }

  /* Mọi cách viết lại một từ có chữ có dấu (tối đa 256), để so với code đã biết. Với mỗi chữ có dấu, thử từng cách
   * gõ (Telex, VNI, hoa/thường) và từng vị trí phím dấu thanh: ngay sau chữ đó, hoặc muộn hơn tối đa 4 chữ cái trong
   * cùng cụm, vì Telex vẫn đặt dấu lên nguyên âm trước đó ("GARENADF" gõ ra "GẢENÀD": phím F nằm sau chữ D). */
  function retypeCandidates(r) {
    const accents = r.issues.filter(function (x) { return x.options && x.options.length; });
    if (!accents.length) return [{ text: r.fixed, prior: 0 }];
    const byAt = new Map();
    r.issues.forEach(function (x) { byAt.set(x.at, x); });
    const choices = accents.map(function (x) {
      let room = 0;
      for (let i = x.at + 1; i < r.chars.length && room < 4 && /^[A-Za-z]$/.test(r.chars[i]); i++) room++;
      const list = [];
      x.options.forEach(function (o) {
        const last = o.tone ? room : 0;
        const vni = /[0-9]/.test(o.body + o.tone);
        for (let k = 0; k <= last; k++) {
          const prior = Math.log(vni ? 0.1 : 0.9) + (k === 0 ? Math.log(0.6) : Math.log(0.4 / last));
          list.push({ body: o.body, tone: o.tone, after: k, prior: prior });
        }
      });
      return list;
    });
    const out = [];
    const pick = new Array(accents.length).fill(0);
    while (out.length < 256) {
      const chosen = new Map();
      accents.forEach(function (x, a) { chosen.set(x.at, choices[a][pick[a]]); });
      let text = "";
      let waiting = [];
      for (let i = 0; i < r.chars.length; i++) {
        const issue = byAt.get(i);
        const c = chosen.get(i);
        text += c ? c.body : issue ? issue.to : r.chars[i];
        if (!c && /^[A-Za-z]$/.test(r.chars[i])) {
          waiting = waiting.map(function (w) { return { tone: w.tone, left: w.left - 1 }; });
        }
        if (c && c.tone) waiting.push({ tone: c.tone, left: c.after });
        waiting = waiting.filter(function (w) {
          if (w.left > 0) return true;
          text += w.tone;
          return false;
        });
      }
      waiting.forEach(function (w) { text += w.tone; });
      let prior = 0;
      chosen.forEach(function (c) { prior += c.prior; });
      if (!out.some(function (o) { return o.text === text; })) out.push({ text: text, prior: prior });
      let a = accents.length - 1;
      while (a >= 0 && ++pick[a] >= choices[a].length) pick[a--] = 0;
      if (a < 0) break;
    }
    return out;
  }

  /* Khi không khớp code đã biết nào, chọn cách viết lại giống code thật nhất: học từ các code đã biết xem cặp ký tự nào
   * hay đi liền nhau (vd "DF" rất hay gặp, "FD" thì hiếm). Mô hình được nhớ theo từng tập code. */
  const bigramCache = new WeakMap();
  function bigramModel(known) {
    if (!known || typeof known !== "object") return null;
    if (bigramCache.has(known)) return bigramCache.get(known);
    const pairs = new Map();
    const singles = new Map();
    let codes = 0;
    known.forEach(function (code) {
      if (!isCodeToken(code)) return;
      codes++;
      const t = "^" + code.toLowerCase() + "$";
      for (let i = 0; i + 1 < t.length; i++) {
        const ab = t.charAt(i) + t.charAt(i + 1);
        pairs.set(ab, (pairs.get(ab) || 0) + 1);
        singles.set(t.charAt(i), (singles.get(t.charAt(i)) || 0) + 1);
      }
    });
    const model = codes >= 20 ? { pairs: pairs, singles: singles } : null;
    bigramCache.set(known, model);
    return model;
  }

  function bigramScore(model, text) {
    const t = "^" + text.toLowerCase() + "$";
    let score = 0;
    for (let i = 0; i + 1 < t.length; i++) {
      const ab = t.charAt(i) + t.charAt(i + 1);
      score += Math.log(((model.pairs.get(ab) || 0) + 0.5) / ((model.singles.get(t.charAt(i)) || 0) + 20));
    }
    return score;
  }

  function letterCount(text) {
    const m = text.match(/[A-Za-z]/g);
    return m ? m.length : 0;
  }

  /* Một từ không phải code hợp lệ có phải là code bị gõ hoặc dán sai ký tự không.
   * strict: dòng có nhiều chữ. known: các code đã biết (Demo Code, log, code hợp lệ khác) để chọn cách sửa đúng. */
  function suspectOf(word, strict, known) {
    if (isCodeToken(word)) return null;
    const r = inspectWord(word);
    if (!r.issues.length) return null;
    let fixed = r.fixed;
    let matched = false;
    if (known && known.size) {
      const candidates = retypeCandidates(r);
      for (let i = 0; i < candidates.length; i++) {
        if (known.has(candidates[i].text)) {
          fixed = candidates[i].text;
          matched = true;
          break;
        }
      }
      const model = !matched && candidates.length > 1 ? bigramModel(known) : null;
      if (model) {
        let best = -Infinity;
        candidates.forEach(function (c) {
          if (!isCodeToken(c.text)) return;
          const score = bigramScore(model, c.text) + c.prior;
          if (score > best) {
            best = score;
            fixed = c.text;
          }
        });
      }
    }
    if (!isCodeToken(fixed) || letterCount(fixed) < 2) return null;
    const textLike = r.issues.some(function (x) { return /^(?:accent|special|foreign)$/.test(x.kind); });
    if (textLike && !matched) {
      /* Chữ tiếng Việt, giá tiền, số có dấu phân cách ("Hết", "10.000đ", "1,5") không phải code gõ sai. */
      if (r.asciiLetters < 2) return null;
      const betweenDigits = r.issues.some(function (x) {
        return x.kind === "special" && /^[0-9]$/.test(r.chars[x.at - 1] || "") && /^[0-9]$/.test(r.chars[x.at + 1] || "");
      });
      if (betweenDigits) return null;
    }
    /* Ký tự trông giống hệt chữ Latin ở dòng chỉ có một từ thì gần như chắc là code. Chữ có dấu, ký tự đặc biệt
     * thì phải khớp code đã biết hoặc trông rõ là code, để không báo nhầm chữ tiếng Việt bình thường. */
    const lookalikeOnly = r.issues.every(function (x) { return /^(?:homoglyph|roman|fullwidth|styled|dash)$/.test(x.kind); });
    /* Xét "giống code" trên chữ gốc đã bỏ dấu, không trên bản đoán: cách gõ VNI chèn chữ số ("BIỆT" → "BIE65T")
     * sẽ làm chữ tiếng Việt in hoa trông như code. */
    let plain = "";
    for (let i = 0; i < r.chars.length; i++) {
      const issue = r.issues.find(function (x) { return x.at === i; });
      plain += !issue ? r.chars[i] : issue.kind === "accent" ? baseLetter(r.chars[i]) : issue.to;
    }
    const likely = matched || (lookalikeOnly && !strict ? fixed.length >= 4 : looksLikeCode(lookalikeOnly ? fixed : plain));
    if (!likely) return null;
    const guess = !matched && r.issues.some(function (x) { return x.kind === "accent" && x.options && x.options.length > 1; });
    return { raw: word, fixed: fixed, fixable: r.fixable, matched: matched, guess: guess, issues: r.issues };
  }

  const ISSUE_TEXT = {
    homoglyph: function (i) { return scriptOf(i.ch) + " “" + i.ch + "” trông giống “" + i.to + "” nhưng khác ký tự"; },
    roman: function (i) { return "số La Mã “" + i.ch + "”, cần gõ bằng chữ “" + i.to + "”"; },
    fullwidth: function (i) { return "ký tự toàn chiều rộng “" + i.ch + "”, cần là “" + i.to + "”"; },
    styled: function (i) { return "chữ kiểu “" + i.ch + "” (in đậm/nghiêng đặc biệt), cần là “" + i.to + "”"; },
    dash: function (i) { return "gạch ngang dài “" + i.ch + "”, cần là gạch nối “-”"; },
    accent: function (i) { return "chữ có dấu “" + i.ch + "” do bộ gõ tiếng Việt (Telex/VNI) tự đổi khi gõ, gõ lại là “" + i.to + "”"; },
    special: function (i) { return "ký tự “" + i.ch + "” không có trong code, bỏ đi"; },
    foreign: function (i) { return "chữ “" + i.ch + "” không có trong code, cần sửa tay"; },
  };

  function describeIssue(issue) {
    const f = ISSUE_TEXT[issue && issue.kind];
    return f ? f(issue) : "";
  }

  const GROUP_TEXT = {
    homoglyph: "chữ của bảng chữ khác (Kirin, Hy Lạp…) trông giống chữ Latin nhưng khác ký tự",
    roman: "số La Mã, cần gõ bằng chữ cái thường",
    fullwidth: "ký tự toàn chiều rộng, cần là chữ và số thường",
    styled: "chữ kiểu in đậm/nghiêng đặc biệt, cần là chữ thường",
    dash: "gạch ngang dài, cần là gạch nối “-”",
    accent: "chữ có dấu do bộ gõ tiếng Việt (Telex/VNI) tự đổi khi gõ",
    special: "ký tự không có trong code, bỏ đi",
    foreign: "chữ không có trong code, cần sửa tay",
  };

  /* Mô tả gọn một code có ký tự sai: gộp theo loại lỗi, mỗi loại kể tối đa 4 ký tự. */
  function describeSuspect(sus) {
    const groups = new Map();
    const issues = sus && Array.isArray(sus.issues) ? sus.issues : [];
    for (let i = 0; i < issues.length; i++) {
      const kind = issues[i].kind;
      if (!groups.has(kind)) groups.set(kind, []);
      const list = groups.get(kind);
      if (!list.some(function (x) { return x.ch === issues[i].ch; })) list.push(issues[i]);
    }
    const parts = [];
    groups.forEach(function (list, kind) {
      if (list.length === 1) {
        parts.push(describeIssue(list[0]));
        return;
      }
      const chars = list.slice(0, 4).map(function (x) { return "“" + x.ch + "”"; }).join(", ") + (list.length > 4 ? "…" : "");
      parts.push((GROUP_TEXT[kind] || "ký tự lạ") + " (" + chars + ")");
    });
    return parts.join("; ");
  }

  function codesInSegment(segment, strict, sink) {
    const out = [];
    const parts = segment.split(/[,;|\t，；、]+|\s+[-–—]+\s+/);
    for (let p = 0; p < parts.length; p++) {
      const words = parts[p].trim().split(/\s+/);
      const clean = [];
      for (let w = 0; w < words.length; w++) {
        const word = words[w].replace(EDGE_JUNK, "");
        if (word) clean.push(word);
      }
      if (!clean.length) continue;
      const single = !strict && clean.length === 1;
      for (let c = 0; c < clean.length; c++) {
        const word = clean[c];
        if (single ? isCodeToken(word) : looksLikeCode(word)) {
          out.push(word);
        } else if (sink && /[^A-Za-z0-9_-]/.test(word)) {
          sink.push({ word: word, strict: !single });
        }
      }
    }
    return out;
  }

  function codesInLine(line, sink) {
    /* Phần trong ngoặc thường là ghi chú ("(100 brick)", "(hết hạn 30/11)") nhưng cũng có khi là code ("(DFABC123)"):
     * đọc riêng theo luật chặt. Giới hạn 120 ký tự để dòng toàn dấu mở ngoặc không làm treo popup. */
    const notes = [];
    const text = line
      .replace(/https?:\/\/\S+/gi, " ")
      .replace(/\s#(?=\s|$).*$|\s\/\/.*$/, "")
      .replace(/^(?:[-*•+>]+|\d{1,3}[.)])\s+/, "")
      .replace(/[([{（【]([^([{（【)\]}）】]{0,120})[)\]}）】]/g, function (m, inner) {
        notes.push(inner);
        return " ";
      });
    /* "Code: ABC" → phần sau dấu hai chấm là giá trị. Phần trước chỉ nhận chữ rõ là code. */
    const segments = text.split(/[:：]/);
    const out = [];
    for (let i = 0; i < segments.length; i++) {
      const found = codesInSegment(segments[i], i < segments.length - 1, sink);
      for (let f = 0; f < found.length; f++) out.push(found[f]);
    }
    for (let n = 0; n < notes.length; n++) {
      const found = codesInSegment(notes[n], true, sink);
      for (let f = 0; f < found.length; f++) out.push(found[f]);
    }
    return out;
  }

  /* Ký tự vô hình: khoảng trắng rỗng, nối chữ, chọn kiểu emoji, khung phím số. */
  const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF\uFE00-\uFE0F\u20E3]/g;

  /* Trả về code theo đúng thứ tự, bỏ trùng, kèm số dòng không nhận ra và các code có ký tự sai (không được nhập).
   * options.known: code đã biết (Demo Code, log) để chọn đúng cách sửa chữ có dấu. Code hợp lệ trong chính danh sách
   * cũng được dùng, nên phải đọc hết danh sách rồi mới xét các từ nghi ngờ. */
  function analyzeCodes(text, options) {
    let raw = String(text == null ? "" : text);
    if (raw.length > LIMITS.maxText) raw = raw.slice(0, LIMITS.maxText);
    raw = raw.replace(INVISIBLE, "");
    const seen = new Set();
    const codes = [];
    const pending = [];
    const emptyLines = [];
    let duplicates = 0;
    let truncated = false;
    const lines = raw.split(/\r\n|\r|\n/);
    for (let i = 0; i < lines.length && !truncated; i++) {
      const line = lines[i].trim();
      if (!line || line.charAt(0) === "#" || line.indexOf("//") === 0) continue;
      const sink = [];
      const found = codesInLine(line, sink);
      for (let s = 0; s < sink.length; s++) pending.push({ word: sink[s].word, strict: sink[s].strict, line: i + 1 });
      if (!found.length) {
        emptyLines.push(i + 1);
        continue;
      }
      for (let f = 0; f < found.length; f++) {
        const code = found[f];
        if (seen.has(code)) {
          duplicates++;
          continue;
        }
        if (codes.length >= LIMITS.maxCodes) {
          truncated = true;
          break;
        }
        seen.add(code);
        codes.push(code);
      }
    }
    const known = new Set(codes);
    const extra = options && options.known;
    if (extra && typeof extra.forEach === "function") extra.forEach(function (c) { if (isCodeToken(c)) known.add(c); });
    const suspects = [];
    const verdict = new Map();
    const suspectLines = new Set();
    for (let p = 0; p < pending.length; p++) {
      const item = pending[p];
      if (!verdict.has(item.word)) {
        const sus = suspectOf(item.word, item.strict, known);
        verdict.set(item.word, !!sus);
        if (sus) {
          sus.line = item.line;
          suspects.push(sus);
        }
      }
      /* Dòng nào có code sai (kể cả code sai lặp lại) thì không tính là dòng không nhận ra. */
      if (verdict.get(item.word)) suspectLines.add(item.line);
    }
    const ignored = emptyLines.filter(function (n) { return !suspectLines.has(n); }).length;
    return { codes: codes, duplicates: duplicates, ignored: ignored, truncated: truncated, suspects: suspects };
  }

  /* Thay các code sửa tự động được (ký tự trông giống hệt chữ Latin) trong văn bản bằng bản đã sửa. */
  function fixSuspects(text, suspects) {
    /* Bộ đọc tìm code trên văn bản đã bỏ ký tự vô hình, nên phải bỏ chúng ở đây trước khi thay. */
    let out = String(text == null ? "" : text).replace(INVISIBLE, "");
    const list = (Array.isArray(suspects) ? suspects : []).filter(function (s) { return s && s.fixable && s.raw && s.fixed; });
    list.sort(function (a, b) { return b.raw.length - a.raw.length; });
    for (let i = 0; i < list.length; i++) out = out.split(list[i].raw).join(list[i].fixed);
    return out;
  }

  function parseCodes(text) {
    return analyzeCodes(text).codes;
  }

  /* ---------- Cài đặt và nhịp nghỉ ---------- */

  function clampGap(value) {
    if (value === "" || value == null) return GAP_DEFAULT;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return GAP_DEFAULT;
    return Math.min(PROFILES.free.gapMax, Math.max(PROFILES.free.gapMin, n));
  }

  function normalizeSettings(input) {
    const s = input && typeof input === "object" ? input : {};
    return {
      protect: s.protect !== false,
      randomGap: s.randomGap === true,
      gapSec: clampGap(s.gapSec),
      skipLogged: s.skipLogged !== false,
    };
  }

  function profileFor(protect) {
    return protect === false ? PROFILES.free : PROFILES.safe;
  }

  function pace(settings) {
    const s = normalizeSettings(settings);
    if (s.protect) return { min: PROFILES.safe.gapMin, max: PROFILES.safe.gapMax };
    if (s.randomGap) return { min: PROFILES.free.randomMin, max: PROFILES.free.randomMax };
    return { min: s.gapSec, max: s.gapSec };
  }

  function pickGap(settings, rand) {
    const r = typeof rand === "function" ? rand : Math.random;
    const p = pace(settings);
    return Math.min(p.max, p.min + Math.floor(r() * (p.max - p.min + 1)));
  }

  /* Nghỉ sau 5 lỗi liên tiếp: 30,0 đến 60,0 giây, có một chữ số lẻ. */
  function errorPause(rand) {
    const r = typeof rand === "function" ? rand : Math.random;
    const lo = PROFILES.safe.pauseMin * 10;
    const hi = PROFILES.safe.pauseMax * 10;
    return Math.min(hi, lo + Math.floor(r() * (hi - lo + 1))) / 10;
  }

  function describePace(settings) {
    const s = normalizeSettings(settings);
    if (s.protect) return "Bảo vệ tài khoản, nghỉ ngẫu nhiên 20–30 giây";
    if (s.randomGap) return "Tắt bảo vệ, nghỉ ngẫu nhiên 10–15 giây";
    return "Tắt bảo vệ, nghỉ " + s.gapSec + " giây";
  }

  /* ---------- Thời gian ---------- */

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function toDate(now) {
    if (now instanceof Date && !isNaN(now.getTime())) return now;
    const n = typeof now === "number" || typeof now === "string" ? Number(now) : NaN;
    return Number.isFinite(n) && n > 0 ? new Date(n) : new Date();
  }

  function formatClock(secondsFromNow, now) {
    const base = toDate(now);
    const date = new Date(base.getTime() + Math.max(0, Math.round(Number(secondsFromNow) || 0)) * SECOND);
    const clock = pad(date.getHours()) + ":" + pad(date.getMinutes());
    const sameDay = date.getFullYear() === base.getFullYear()
      && date.getMonth() === base.getMonth()
      && date.getDate() === base.getDate();
    return sameDay ? clock : pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + " " + clock;
  }

  function formatTime(iso) {
    if (!iso) return "";
    if (typeof iso !== "string" && typeof iso !== "number" && !(iso instanceof Date)) return "";
    const date = new Date(iso);
    if (isNaN(date.getTime())) return squash(iso).slice(0, 40);
    return pad(date.getDate()) + "/" + pad(date.getMonth() + 1) + "/" + date.getFullYear()
      + " " + pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
  }

  function formatDuration(seconds) {
    const s = Math.max(0, Math.round(Number(seconds) || 0));
    if (s < 60) return s + " giây";
    const m = Math.round(s / 60);
    if (m < 60) return m + " phút";
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? h + " giờ " + r + " phút" : h + " giờ";
  }

  function formatDurationRange(min, max) {
    const a = formatDuration(min);
    const b = formatDuration(max);
    if (a === b) return a;
    const ma = a.match(/^(\d+) (giây|phút)$/);
    const mb = b.match(/^(\d+) (giây|phút)$/);
    if (ma && mb && ma[2] === mb[2]) return ma[1] + "–" + mb[1] + " " + ma[2];
    return a + " – " + b;
  }

  function formatTenth(seconds) {
    return Math.max(0, Math.round(Number(seconds) * 10) / 10).toFixed(1).replace(".", ",");
  }

  /* ---------- Hạn mức ---------- */

  function cleanAttempts(list, now) {
    const t = typeof now === "number" ? now : Date.now();
    const out = [];
    const src = Array.isArray(list) ? list : [];
    for (let i = 0; i < src.length; i++) {
      const at = Number(src[i]);
      /* Bỏ mốc quá 24 giờ và mốc "tương lai" do đồng hồ máy bị chỉnh lùi. */
      if (Number.isFinite(at) && at > 0 && t - at < DAY && at - t < 5 * MINUTE) out.push(at);
    }
    out.sort(function (a, b) { return a - b; });
    if (out.length > 500) return out.slice(out.length - 500);
    return out;
  }

  function quota(attempts, protect, now) {
    const t = typeof now === "number" ? now : Date.now();
    const p = profileFor(protect);
    const day = cleanAttempts(attempts, t);
    const hour = day.filter(function (at) { return t - at < HOUR; });
    const res = {
      ok: true,
      scope: "",
      until: 0,
      usedHour: hour.length,
      usedDay: day.length,
      capHour: p.perHour,
      capDay: p.perDay,
      left: Math.max(0, Math.min(p.perHour - hour.length, p.perDay - day.length)),
      last: day.length ? day[day.length - 1] : 0,
    };
    /* Mở lại khi đủ số lượt cũ hết hạn để còn ít nhất một chỗ trống. */
    if (hour.length >= p.perHour) {
      res.ok = false;
      res.scope = "hour";
      res.until = hour[hour.length - p.perHour] + HOUR;
    }
    if (day.length >= p.perDay) {
      const until = day[day.length - p.perDay] + DAY;
      if (res.ok || until > res.until) {
        res.ok = false;
        res.scope = "day";
        res.until = until;
      }
    }
    return res;
  }

  function quotaReason(q, now) {
    if (!q || q.ok) return "";
    const t = typeof now === "number" ? now : Date.now();
    const at = formatClock((q.until - t) / SECOND, t);
    if (q.scope === "day") return "Đã đủ " + q.capDay + " code trong 24 giờ. Có thể chạy lại lúc " + at + ".";
    return "Đã đủ " + q.capHour + " code trong 60 phút. Có thể chạy lại lúc " + at + ".";
  }

  /* Điều kiện để bấm Bắt đầu: còn hạn mức và đã nghỉ đủ sau lần nhập trước. */
  function gate(attempts, protect, now) {
    const t = typeof now === "number" ? now : Date.now();
    const q = quota(attempts, protect, t);
    if (!q.ok) return Object.assign(q, { reason: quotaReason(q, t) });
    const until = q.last ? q.last + profileFor(protect).cooldownMs : 0;
    if (until > t) {
      return Object.assign(q, {
        ok: false,
        scope: "cooldown",
        until: until,
        reason: "Cần nghỉ " + Math.ceil((until - t) / SECOND) + " giây trước khi bấm Bắt đầu lại.",
      });
    }
    return Object.assign(q, { reason: "" });
  }

  /* ---------- Kế hoạch một lần bấm Bắt đầu ---------- */

  function settledCodes(log) {
    const done = new Set();
    const list = Array.isArray(log) ? log : [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e && (e.status === "ok" || e.status === "error") && isCodeToken(e.code)) done.add(e.code);
    }
    return done;
  }

  function plan(input) {
    const opts = input || {};
    const now = typeof opts.now === "number" ? opts.now : Date.now();
    const codes = Array.isArray(opts.codes) ? opts.codes : [];
    const s = normalizeSettings(opts.settings);
    const p = profileFor(s.protect);
    const done = s.skipLogged ? settledCodes(opts.log) : new Set();
    /* Code chưa từng có trong log nhập trước; code đã có (vd từng ghi chưa rõ) xếp xuống cuối,
     * để một code cứ gặp lỗi tạm thời không chặn các code mới ở mỗi lần chạy. */
    const seen = new Set();
    const logList = Array.isArray(opts.log) ? opts.log : [];
    for (let i = 0; i < logList.length; i++) if (logList[i] && isCodeToken(logList[i].code)) seen.add(logList[i].code);
    const pending = codes.filter(function (c) { return !done.has(c); });
    const fresh = pending.filter(function (c) { return !seen.has(c); }).concat(pending.filter(function (c) { return seen.has(c); }));
    const g = gate(opts.attempts, s.protect, now);
    const room = Math.max(0, Math.min(p.perRun, g.left));
    const queue = fresh.slice(0, room);
    let reason = "";
    if (!codes.length) reason = "Chưa có code hợp lệ.";
    else if (!fresh.length) reason = "Các code này đã có trong log (đã nhập hoặc lỗi). Bỏ chọn “Bỏ qua code đã có trong log” nếu muốn nhập lại.";
    else if (!g.ok) reason = g.reason;
    return {
      ok: !reason,
      reason: reason,
      until: g.ok ? 0 : g.until,
      queue: reason ? [] : queue,
      total: codes.length,
      fresh: fresh.length,
      skipped: codes.length - fresh.length,
      perRun: p.perRun,
      quota: g,
      settings: s,
    };
  }

  function estimate(count, settings, extraSec) {
    const n = Math.max(0, Math.round(Number(count) || 0));
    const extra = Math.max(0, Number(extraSec) || 0);
    if (!n && !extra) return null;
    const p = pace(settings);
    const waits = Math.max(0, n - 1);
    return {
      min: waits * p.min + n * LIMITS.replySec + extra,
      max: waits * p.max + n * LIMITS.replySec + extra,
    };
  }

  function describeEstimate(est, now) {
    if (!est) return "";
    const a = formatClock(est.min, now);
    const b = formatClock(est.max, now);
    return "Mất khoảng " + formatDurationRange(est.min, est.max) + ", xong lúc " + (a === b ? a : a + "–" + b) + ".";
  }

  /* ---------- Kết quả trang trả về ---------- */

  function firstNumber() {
    for (let i = 0; i < arguments.length; i++) {
      const value = arguments[i];
      if (value === undefined || value === null || value === "") continue;
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  function pickApiFields(raw) {
    const out = { code: null, msg: "", screen: "" };
    if (!raw || typeof raw !== "object") return out;
    const serverCode = firstNumber(raw.code, raw.ret, raw.iRet, raw.errCode, raw.errcode);
    if (serverCode !== null && Math.abs(serverCode) < 100000000) out.code = serverCode;
    const http = firstNumber(raw.httpStatus);
    if (http !== null && http >= 100 && http < 600) out.httpStatus = http;
    const nested = raw.data && typeof raw.data === "object" ? raw.data : {};
    out.msg = squash(
      raw.msg || raw.message || raw.sMsg || raw.errMsg || raw.desc || raw.sMessage || raw.error || raw.reason
        || nested.msg || nested.message || nested.sMsg || (typeof raw.data === "string" ? raw.data : ""),
    ).slice(0, LIMITS.detailCap);
    out.screen = squash(raw.screen || "").slice(0, LIMITS.detailCap);
    return out;
  }

  function looksFailed(text) {
    return /không thành công|khong thanh cong|chưa thành công|chua thanh cong|thất bại|that bai|失败|invalid|không hợp lệ|khong hop le|not successful|unsuccessful|\bfail(?:ed|ure|s)?\b|\berror\b|\blỗi\b|\bloi\b/i.test(text || "");
  }

  /* Câu phủ định ("không thành công", "not successful") không tính là thành công. */
  function looksOk(text) {
    return /(?<!(?:không|khong|chưa|chua) )thành công|redeemed successfully|redemption successful|(?<!not )(?<![a-z])success(?:ful|fully)?(?![a-z])|兑换成功/i.test(text || "");
  }

  function isAccountRisk(text) {
    const value = squash(text);
    if (!value) return false;
    return /captcha|recaptcha|hcaptcha|geetest|too many requests|rate limit|try again later|too frequent|操作过于频繁|操作频繁|请求过于频繁|频繁|风控|验证码|封禁|冻结|账号异常|banned|suspended|account (?:ban|locked|restrict)|bị khóa|bi khoa|phong tỏa|phong toa|tài khoản bị|tai khoan bi|quá nhiều lần|qua nhieu lan|thử lại sau|thu lai sau|giới hạn truy cập|gioi han truy cap|xác minh|xac minh/i.test(value);
  }

  /* Lỗi tạm thời: máy chủ chưa xét code (quá tải, giới hạn tần suất, lỗi mạng, cần xác minh…).
   * Code gặp lỗi kiểu này ghi "chưa rõ" để lần sau còn nhập lại, không bị bỏ qua vĩnh viễn. */
  function isTransientHttp(http) {
    const n = Number(http) || 0;
    return n === 403 || n === 408 || n === 425 || n === 429 || (n >= 500 && n < 600);
  }

  const TRANSIENT_TEXT = /lỗi mạng|loi mang|mất kết nối|mat ket noi|network error|network is|timed? ?out|hết thời gian chờ|het thoi gian cho|hệ thống bận|he thong ban|system (?:is )?busy|server (?:error|busy)|service unavailable|bad gateway|gateway time/i;
  /* Mã HTTP lỗi tạm thời nằm cuối câu log, vd "Too Many Requests | 429" (mã của Garena có 6 chữ số). */
  const TRANSIENT_CODE_SUFFIX = /\| (?:403|408|425|429|5\d\d)$/;

  function looksTransient(text) {
    const value = squash(text);
    if (!value) return false;
    return isAccountRisk(value) || TRANSIENT_TEXT.test(value) || TRANSIENT_CODE_SUFFIX.test(value);
  }

  /* Mã số và câu chữ mâu thuẫn nhau thì ghi "chưa xác định", không đoán. */
  function describeApi(raw) {
    if (!raw || typeof raw !== "object") return { ok: false, status: "unknown", serverCode: null, detail: "", httpStatus: 0 };
    const picked = pickApiFields(raw);
    const serverCode = picked.code;
    const msg = usableText(picked.msg);
    const screen = usableText(picked.screen);
    const parts = [];
    if (screen) parts.push(screen);
    /* Thêm câu máy chủ, bỏ phần đã có trên màn hình và chữ "ok" xác nhận. */
    const pieces = msg ? msg.split(" | ") : [];
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i].trim();
      if (!piece || /^(?:ok|success|successful|successfully)$/i.test(piece)) continue;
      if (parts.some(function (p) { return p.indexOf(piece) !== -1; })) continue;
      parts.push(piece);
    }
    let exact = parts.join(" | ");
    if (serverCode !== null && serverCode !== 0 && exact.indexOf(String(serverCode)) === -1) {
      exact = exact ? exact + " | " + serverCode : String(serverCode);
    }
    if (!exact && serverCode !== null) exact = String(serverCode);
    const failed = looksFailed(exact);
    const success = looksOk(exact);
    let status = "unknown";
    if (serverCode === 0 && failed) status = "unknown";
    else if (serverCode === 0) status = "ok";
    else if (serverCode !== null && success) status = "unknown";
    else if (serverCode !== null) status = "error";
    else if (success && !failed) status = "ok";
    else if (failed) status = "error";
    return { ok: status === "ok", status: status, serverCode: serverCode, detail: exact, httpStatus: picked.httpStatus || 0 };
  }

  function describeDialog(text) {
    const detail = usableText(text);
    const failed = looksFailed(detail);
    const success = looksOk(detail);
    let status = "error";
    if (!detail || (failed && success)) status = "unknown";
    else if (success && !failed) status = "ok";
    return { ok: status === "ok", status: status, serverCode: null, detail: detail };
  }

  function randomId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Đổi kết quả thô từ trang thành một dòng log. */
  function toEntry(code, result, now) {
    if (!isCodeToken(code)) return null;
    const r = result && typeof result === "object" ? result : {};
    let status = "unknown";
    let detail = "";
    let serverCode = null;
    if (r.source === "api") {
      const d = describeApi(r.raw);
      status = d.status;
      detail = d.detail;
      serverCode = d.serverCode;
    } else if (r.source === "dialog") {
      const d = describeDialog(r.text);
      status = d.status;
      detail = d.detail;
    } else if (r.source === "ui") {
      /* Không bấm được nút Đổi: code chưa được gửi, không tính là lỗi để lần sau còn nhập. */
      status = "unknown";
      detail = (sanitizeText(r.text) || "Không thao tác được trên trang.") + " Code này chưa được gửi.";
    }
    const http = r.source === "api" && r.raw ? Number(r.raw.httpStatus) || 0 : 0;
    if (status === "error" && (isTransientHttp(http) || looksTransient(detail))) status = "unknown";
    if (!detail && isTransientHttp(http)) detail = "Trang trả mã HTTP " + http + ".";
    if (!detail) detail = status === "unknown" ? UNKNOWN_TEXT : status === "ok" ? "Thành công." : "Không rõ câu lỗi.";
    return {
      id: randomId(),
      at: toDate(now).toISOString(),
      code: code,
      status: status,
      detail: sanitizeText(detail),
      serverCode: serverCode,
    };
  }

  /* Quyết định sau mỗi code: nhập tiếp, nghỉ sau chuỗi lỗi, hay dừng hẳn. ctx giữ bộ đếm giữa các code. */
  function judge(entry, result, ctx, settings) {
    const c = ctx || {};
    const s = normalizeSettings(settings);
    const http = (result && result.raw && Number(result.raw.httpStatus)) || 0;
    const said = (entry && entry.detail) || "";
    const code = (entry && entry.code) || "";
    if (http === 403 || http === 429) {
      return { action: "stop", note: "Đã dừng vì trang trả mã " + http + ". Kiểm tra thủ công trước khi nhập tiếp." };
    }
    c.http5xx = http >= 500 && http < 600 ? (c.http5xx || 0) + 1 : 0;
    if (c.http5xx >= 2) return { action: "stop", note: "Đã dừng sau 2 lỗi máy chủ liên tiếp." };
    if (result && result.source === "ui") {
      return { action: "stop", note: "Đã dừng. " + sentence(said || "Không thao tác được trên trang") };
    }
    if (isAccountRisk(said)) {
      return { action: "stop", note: "Đã dừng để bảo vệ tài khoản. Trang báo: " + sentence(said.slice(0, 180)) };
    }
    /* Một lỗi máy chủ (5xx) lẻ: code ghi "chưa rõ", nhập tiếp code sau. Hai lỗi liên tiếp thì đã dừng ở trên. */
    if (c.http5xx === 1) return { action: "continue" };
    if (!entry || entry.status === "unknown") {
      return {
        action: "stop",
        note: "Đã dừng vì chưa xác định được kết quả của " + code + ". Kiểm tra thủ công. Code này không bị tính là lỗi.",
      };
    }
    if (entry.status === "error") {
      c.streak = (c.streak || 0) + 1;
      if (s.protect && c.streak >= PROFILES.safe.errorStreak) {
        c.streak = 0;
        return { action: "pause" };
      }
    } else {
      c.streak = 0;
    }
    return { action: "continue" };
  }

  /* ---------- Log ---------- */

  function normStatus(status) {
    return status === "ok" || status === "unknown" ? status : "error";
  }

  /* Đọc giờ ghi trong file log: "19/11/2026 14:05:06" (từ 1.0.0) hoặc "14:05:06 19/11/2026" (0.5.0 beta). */
  function parseTimeText(text) {
    const value = squash(text);
    let p = null;
    let m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),? (\d{1,2}):(\d{2}):(\d{2})$/);
    if (m) p = { y: +m[3], mo: +m[2], d: +m[1], h: +m[4], mi: +m[5], s: +m[6] };
    m = !p && value.match(/^(\d{1,2}):(\d{2}):(\d{2}),? (\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) p = { y: +m[6], mo: +m[5], d: +m[4], h: +m[1], mi: +m[2], s: +m[3] };
    if (!p || p.h > 23 || p.mi > 59 || p.s > 59) return "";
    const date = new Date(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    /* Date tự "tràn" ngày sai (32/13 thành tháng sau), nên kiểm lại từng phần. */
    if (date.getFullYear() !== p.y || date.getMonth() !== p.mo - 1 || date.getDate() !== p.d) return "";
    return date.toISOString();
  }

  function normalizeEntry(e) {
    if (!e || typeof e !== "object" || !isCodeToken(e.code)) return null;
    let status = normStatus(e.status);
    const detail = squash(e.detail).slice(0, LIMITS.detailCap);
    /* Log cũ có thể ghi lỗi tạm thời là "lỗi": đổi thành "chưa rõ" để code đó còn được nhập lại. */
    if (status === "error" && looksTransient(detail)) status = "unknown";
    const atText = typeof e.atText === "string" ? squash(e.atText).slice(0, 40) : "";
    let at = typeof e.at === "string" ? squash(e.at).slice(0, 40) : "";
    if (!at && atText) at = parseTimeText(atText);
    return {
      id: typeof e.id === "string" ? e.id.slice(0, 40) : "",
      at: at,
      atText: at ? "" : atText,
      code: e.code,
      status: status,
      detail: detail || (status === "ok" ? "Dùng được (từ log)." : status === "unknown" ? UNKNOWN_TEXT : "Lỗi (từ log)."),
      serverCode: typeof e.serverCode === "number" && Number.isFinite(e.serverCode) ? e.serverCode : null,
    };
  }

  function timeValue(e) {
    const t = e && e.at ? Date.parse(e.at) : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  }

  /* Giữ log trong giới hạn mà không làm mất thông tin bỏ qua code:
   * bỏ trước các lượt cũ đã có lượt khác thay thế, rồi tới lượt "chưa rõ", cuối cùng mới tới lượt cũ nhất. */
  function capLog(entries, cap) {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const limit = cap || LIMITS.logCap;
    if (list.length <= limit) return list;
    const best = bestByCode(list);
    const drop = new Set();
    let excess = list.length - limit;
    const passes = [
      function (e) { return best.get(e.code) !== e; },
      function (e) { return normStatus(e.status) === "unknown"; },
      function () { return true; },
    ];
    for (let p = 0; p < passes.length && excess > 0; p++) {
      for (let i = 0; i < list.length && excess > 0; i++) {
        if (drop.has(i) || !passes[p](list[i])) continue;
        drop.add(i);
        excess--;
      }
    }
    return list.filter(function (e, i) { return !drop.has(i); });
  }

  function entryTime(e) {
    return (e && (e.at ? formatTime(e.at) : e.atText)) || "";
  }

  function tally(log) {
    const out = { all: 0, ok: 0, error: 0, unknown: 0 };
    const list = Array.isArray(log) ? log : [];
    for (let i = 0; i < list.length; i++) {
      if (!list[i]) continue;
      out.all++;
      out[normStatus(list[i].status)]++;
    }
    return out;
  }

  /* Mỗi code một trạng thái tốt nhất: dùng được > lỗi > chưa rõ. Lượt mới hơn thắng nếu cùng hạng. */
  function bestByCode(log) {
    const rank = { ok: 3, error: 2, unknown: 1 };
    const map = new Map();
    const list = Array.isArray(log) ? log : [];
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !isCodeToken(e.code)) continue;
      const prev = map.get(e.code);
      if (!prev || rank[normStatus(e.status)] >= rank[normStatus(prev.status)]) map.set(e.code, e);
    }
    return map;
  }

  /* Đối chiếu danh sách code với log: mỗi code theo trạng thái tốt nhất trong log, hoặc chưa có. */
  function overlap(codes, log) {
    const best = bestByCode(log);
    const out = { ok: 0, error: 0, unknown: 0, fresh: 0 };
    const list = Array.isArray(codes) ? codes : [];
    for (let i = 0; i < list.length; i++) {
      const e = best.get(list[i]);
      if (!e) out.fresh++;
      else out[normStatus(e.status)]++;
    }
    return out;
  }

  function formatLog(entries, meta) {
    const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
    const info = meta || {};
    const best = bestByCode(list);
    const ok = [];
    const bad = [];
    const wait = [];
    best.forEach(function (e) {
      const st = normStatus(e.status);
      if (st === "ok") ok.push(e);
      else if (st === "error") bad.push(e);
      else wait.push(e);
    });
    const count = tally(list);
    const lines = [];
    lines.push("DF Code Garena — nhật ký đổi code");
    if (info.version) lines.push("Phiên bản: " + info.version);
    lines.push("Xuất lúc: " + formatTime(info.exportedAt || new Date().toISOString()));
    if (info.settings) lines.push("Chế độ: " + describePace(info.settings));
    lines.push("Tổng: " + count.all + " lượt, " + count.ok + " dùng được, " + count.error + " lỗi, " + count.unknown + " chưa rõ");
    lines.push("");
    lines.push("=== DÙNG ĐƯỢC (" + ok.length + ") ===");
    if (!ok.length) lines.push("(không có)");
    for (let a = 0; a < ok.length; a++) lines.push(ok[a].code);
    lines.push("");
    lines.push("=== LỖI (" + bad.length + ") ===");
    if (!bad.length) lines.push("(không có)");
    for (let b = 0; b < bad.length; b++) lines.push(bad[b].code + "\t" + sanitizeText(bad[b].detail));
    lines.push("");
    lines.push("=== CHƯA RÕ (" + wait.length + ") — sẽ nhập lại ở lần chạy sau ===");
    if (!wait.length) lines.push("(không có)");
    for (let w = 0; w < wait.length; w++) lines.push(wait[w].code + "\t" + sanitizeText(wait[w].detail));
    lines.push("");
    lines.push("=== CHI TIẾT ===");
    if (!list.length) lines.push("(chưa có lượt nhập nào)");
    for (let n = 0; n < list.length; n++) {
      const e = list[n];
      const status = normStatus(e.status);
      const tag = status === "ok" ? "OK" : status === "unknown" ? "CHƯA" : "LỖI";
      lines.push("[" + tag + "] " + (entryTime(e) || "—") + "  " + e.code + "  —  " + sanitizeText(e.detail));
    }
    lines.push("");
    return lines.join("\n");
  }

  function sectionOf(line) {
    if (/^===\s*(?:DÙNG ĐƯỢC|DUNG DUOC)/i.test(line)) return "ok";
    if (/^===\s*(?:LỖI|LOI)/i.test(line)) return "error";
    if (/^===\s*(?:CHI TIẾT|CHI TIET)/i.test(line)) return "detail";
    if (/^===\s*(?:CHƯA RÕ|CHUA RO)/i.test(line)) return "unknown";
    if (/^===/.test(line)) return "other";
    return "";
  }

  const DETAIL_RE = /^\[(OK|LỖI|LOI|ERROR|CHƯA|CHUA)\]\s*(.*?)\s{2,}([A-Za-z0-9_-]{4,80})\s+[—-](?:\s+(.*))?$/i;

  /* Đọc file log đã xuất (bản 1.0.0 trở lên và bản 0.5.0 beta, tức 1.9.9 cũ). Phần CHI TIẾT giữ đủ từng lượt; code chỉ có ở phần trên được thêm sau. */
  function parseLog(text) {
    let raw = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    if (raw.length > LIMITS.maxLogText) raw = raw.slice(0, LIMITS.maxLogText);
    const lines = raw.split(/\r\n|\r|\n/);
    let section = "";
    const fromDetail = [];
    const fromSections = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.length > 700 || line.charAt(0) === "#") continue;
      const next = sectionOf(line);
      if (next) {
        section = next;
        continue;
      }
      if (/^\((?:không có|khong co|chưa có lượt nhập nào|chua co luot nhap nao)\)$/i.test(line)) continue;
      if (section === "detail") {
        const m = line.match(DETAIL_RE);
        if (!m) continue;
        const tag = m[1].toUpperCase();
        const time = m[2].trim();
        fromDetail.push({
          atText: time === "—" || time === "-" ? "" : time,
          code: m[3],
          status: tag === "OK" ? "ok" : tag === "CHƯA" || tag === "CHUA" ? "unknown" : "error",
          detail: m[4] || "",
        });
      } else if (section === "ok") {
        if (isCodeToken(line)) fromSections.push({ code: line, status: "ok", detail: "Dùng được (từ log)." });
      } else if (section === "error" || section === "unknown") {
        const bits = line.indexOf("\t") === -1 ? line.split(/\s{2,}/) : line.split("\t");
        const code = bits[0].trim();
        if (isCodeToken(code)) fromSections.push({ code: code, status: section, detail: bits.slice(1).join(" ") });
      }
    }
    const out = [];
    const known = new Set();
    for (let d = 0; d < fromDetail.length; d++) {
      const e = normalizeEntry(fromDetail[d]);
      if (!e) continue;
      known.add(e.code + "|" + e.status);
      out.push(e);
    }
    for (let s = 0; s < fromSections.length; s++) {
      const e = normalizeEntry(fromSections[s]);
      if (!e || known.has(e.code + "|" + e.status)) continue;
      known.add(e.code + "|" + e.status);
      out.push(e);
    }
    return out;
  }

  /* Gộp log đang có với log nạp từ file. Không thêm lại lượt đã có (cùng code, trạng thái và giờ).
   * Sắp lại theo giờ để lượt cũ trong file không đẩy mất lượt mới đang có khi log chạm giới hạn. */
  function mergeLogs(current, incoming, cap) {
    const out = [];
    const keys = new Set();
    const lists = [current, incoming];
    for (let l = 0; l < lists.length; l++) {
      const list = Array.isArray(lists[l]) ? lists[l] : [];
      for (let i = 0; i < list.length; i++) {
        const e = normalizeEntry(list[i]);
        if (!e) continue;
        const key = e.code + "|" + e.status + "|" + entryTime(e);
        if (keys.has(key)) continue;
        keys.add(key);
        out.push(e);
      }
    }
    const order = out.map(function (e, i) { return { e: e, i: i, t: timeValue(e) }; });
    order.sort(function (a, b) { return a.t === b.t ? a.i - b.i : a.t < b.t ? -1 : 1; });
    return capLog(order.map(function (o) { return o.e; }), cap);
  }

  /* Sửa log lưu từ bản trước: lỗi tạm thời từng ghi "lỗi" đổi thành "chưa rõ", giờ dạng chữ thành mốc thời gian,
   * cắt theo cách mới. Trả về log mới và có thay đổi hay không (để chỉ ghi lại khi cần). */
  function migrateLog(log) {
    if (!Array.isArray(log) || !log.length) return { log: Array.isArray(log) ? log : [], changed: false };
    const fixed = capLog(log.map(normalizeEntry).filter(Boolean), LIMITS.logCap);
    const changed = fixed.length !== log.length || fixed.some(function (e, i) {
      const old = log[i];
      return !old || e.code !== old.code || e.status !== old.status || e.at !== (old.at || "");
    });
    return { log: changed ? fixed : log, changed: changed };
  }

  /* ---------- Trạng thái chạy ---------- */

  function isRunActive(run, now) {
    if (!run || typeof run !== "object") return false;
    if (run.phase !== "running" && run.phase !== "waiting") return false;
    const t = typeof now === "number" ? now : Date.now();
    return t - (Number(run.updatedAt) || 0) < LIMITS.staleMs;
  }

  function isRedeemUrl(url) {
    try {
      const u = new URL(String(url || ""));
      return u.protocol === "https:" && u.hostname === REDEEM_HOST && REDEEM_PATH.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  return Object.freeze({
    REDEEM_HOST: REDEEM_HOST,
    REDEEM_PAGE: REDEEM_PAGE,
    REDEEM_PATH: REDEEM_PATH,
    KEYS: KEYS,
    LEGACY_KEYS: LEGACY_KEYS,
    LIMITS: LIMITS,
    PROFILES: PROFILES,
    GAP_DEFAULT: GAP_DEFAULT,
    UNKNOWN_TEXT: UNKNOWN_TEXT,
    squash: squash,
    sentence: sentence,
    isTransientHttp: isTransientHttp,
    looksTransient: looksTransient,
    parseTimeText: parseTimeText,
    capLog: capLog,
    migrateLog: migrateLog,
    sanitizeText: sanitizeText,
    isCodeToken: isCodeToken,
    looksLikeCode: looksLikeCode,
    inspectWord: inspectWord,
    describeIssue: describeIssue,
    describeSuspect: describeSuspect,
    fixSuspects: fixSuspects,
    analyzeCodes: analyzeCodes,
    parseCodes: parseCodes,
    clampGap: clampGap,
    normalizeSettings: normalizeSettings,
    profileFor: profileFor,
    pace: pace,
    pickGap: pickGap,
    errorPause: errorPause,
    describePace: describePace,
    formatClock: formatClock,
    formatTime: formatTime,
    formatDuration: formatDuration,
    formatDurationRange: formatDurationRange,
    formatTenth: formatTenth,
    cleanAttempts: cleanAttempts,
    quota: quota,
    quotaReason: quotaReason,
    gate: gate,
    settledCodes: settledCodes,
    plan: plan,
    estimate: estimate,
    describeEstimate: describeEstimate,
    pickApiFields: pickApiFields,
    isAccountRisk: isAccountRisk,
    describeApi: describeApi,
    describeDialog: describeDialog,
    toEntry: toEntry,
    judge: judge,
    normalizeEntry: normalizeEntry,
    entryTime: entryTime,
    tally: tally,
    bestByCode: bestByCode,
    overlap: overlap,
    formatLog: formatLog,
    parseLog: parseLog,
    mergeLogs: mergeLogs,
    isRunActive: isRunActive,
    isRedeemUrl: isRedeemUrl,
  });
});
