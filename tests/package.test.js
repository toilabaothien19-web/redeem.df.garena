/* Kiểm tra gói tiện ích: demo-codes.js, SHA256SUMS, quyền và rà soát mã. Chạy: node --test */
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");

const ROOT = join(__dirname, "..");

test("tools/pack.mjs --check đạt", () => {
  const out = execFileSync(process.execPath, [join(ROOT, "tools", "pack.mjs"), "--check"], { encoding: "utf8" });
  assert.match(out, /^OK:/);
});

test("demo-codes.js nạp được và khớp demo-codes.txt", () => {
  const sandbox = { window: {} };
  vm.runInNewContext(readFileSync(join(ROOT, "demo-codes.js"), "utf8"), sandbox);
  const fromTxt = readFileSync(join(ROOT, "demo-codes.txt"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  assert.deepEqual([...sandbox.window.DFDemoCodes], fromTxt);
});

test("README ghi đúng phiên bản trong manifest.json", () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  const readme = readFileSync(join(ROOT, "README.md"), "utf8");
  assert.ok(readme.includes("**" + manifest.version + "**"));
});

test("file zip tạo ra luôn giống hệt nhau", async () => {
  const { makeZip } = await import(join(ROOT, "tools", "pack.mjs"));
  const entries = [{ name: "a/" }, { name: "a/x.txt", data: Buffer.from("xin chào") }];
  const one = makeZip(entries);
  const two = makeZip(entries);
  assert.ok(one.equals(two));
  assert.equal(one.readUInt32LE(0), 0x04034b50);
  assert.equal(one.readUInt32LE(one.length - 22), 0x06054b50);
});
