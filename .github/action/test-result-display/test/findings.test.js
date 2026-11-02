// Minimal tests for path/url/input/summary hardening,
// plus sensitive-content redaction (redactSensitive) regression coverage.
// Run with: node test/findings.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const Module = require("module");

// Redirect @actions/core to local stub (deps not installed in this env).
const coreStubPath = path.join(__dirname, "core-stub.js");
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, ...rest) {
  if (request === "@actions/core") return coreStubPath;
  return origResolveFilename.call(this, request, parent, isMain, ...rest);
};

const {
  escapeMarkdownTable,
  redactSensitive,
  sanitizeState,
  sanitizeSourceTask,
  validateResultUrl,
  validateJsonFilePath,
  capSummarySize,
  generateMarkdownTable,
  hasHttpResultUrl,
  parseTestResults,
  MASKED_URL_DISPLAY,
  MAX_SUMMARY_BYTES,
  MAX_INPUT_BYTES,
} = require("../index.js");

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("ok - " + name);
  } catch (err) {
    failed++;
    console.error("not ok - " + name);
    console.error("  " + err.message);
  }
}

// --- & escaping in escapeMarkdownTable ---
test("escapes & before < > entity replacement (neutralizes &lt;script&gt;)", () => {
  assert.strictEqual(escapeMarkdownTable("&lt;script&gt;"), "&amp;lt;script&amp;gt;");
});

test("escapes literal & in cell text", () => {
  assert.strictEqual(escapeMarkdownTable("a&b"), "a&amp;b");
});

test("still escapes Markdown syntax chars (pipe)", () => {
  assert.strictEqual(escapeMarkdownTable("a|b"), "a\\|b");
});

test("still escapes < and > as HTML entities", () => {
  assert.strictEqual(escapeMarkdownTable("<b>"), "&lt;b&gt;");
});

test("empty text returns empty string", () => {
  assert.strictEqual(escapeMarkdownTable(""), "");
  assert.strictEqual(escapeMarkdownTable(null), "");
});

// --- resultDownloadUrl OBS bucket allow-list ---
test("allows valid HuaweiCloud OBS bucket https URL", () => {
  const url = "https://mybucket.obs.cn-north-4.myhuaweicloud.com/path/file.json";
  const safe = validateResultUrl(url);
  assert.ok(safe, "expected non-empty safe URL");
  assert.strictEqual(safe, url);
});

test("masks non-OBS https host", () => {
  assert.strictEqual(validateResultUrl("https://example.com/x"), "");
});

test("masks http even if host looks like OBS", () => {
  const url = "http://mybucket.obs.cn-north-4.myhuaweicloud.com/x";
  assert.strictEqual(validateResultUrl(url), "");
});

test("masks javascript: protocol", () => {
  assert.strictEqual(validateResultUrl("javascript:alert(1)"), "");
});

test("masks private/internal IP host", () => {
  assert.strictEqual(validateResultUrl("http://192.168.1.1/secret"), "");
});

test("masks invalid URL string", () => {
  assert.strictEqual(validateResultUrl("not a url"), "");
});

test("returns empty for empty input", () => {
  assert.strictEqual(validateResultUrl(""), "");
});

// --- encodeURI leaves () and # unescaped, breaking Markdown links ---
test("percent-encodes parentheses in OBS URL path", () => {
  const url = "https://mybucket.obs.cn-north-4.myhuaweicloud.com/reports/(2026-09-20)/result.json";
  const safe = validateResultUrl(url);
  assert.ok(safe.includes("%28"), "expected ( encoded as %28");
  assert.ok(safe.includes("%29"), "expected ) encoded as %29");
  assert.ok(!safe.includes("("), "raw ( must not appear in rendered URL");
  assert.ok(!safe.includes(")"), "raw ) must not appear in rendered URL");
});

test("percent-encodes fragment hash in OBS URL", () => {
  const url = "https://mybucket.obs.cn-north-4.myhuaweicloud.com/report.json#section";
  const safe = validateResultUrl(url);
  assert.ok(safe.includes("%23"), "expected # encoded as %23");
  assert.ok(!safe.includes("#"), "raw # must not appear in rendered URL");
});

test("leaves normal OBS URL unencoded when no specials present", () => {
  const url = "https://mybucket.obs.cn-north-4.myhuaweicloud.com/path/file.json";
  assert.strictEqual(validateResultUrl(url), url);
});

test("generateMarkdownTable renders download link with encoded parens", () => {
  const results = [
    {
      number: "TC-7",
      state: "passed",
      duration: "1.0",
      resultUrl: "https://mybucket.obs.cn-north-4.myhuaweicloud.com/reports/(2026-09-20)/result.json",
      sourceTask: "taskP",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(!md.includes("(2026-09-20)"), "raw parens must not appear in rendered link");
  assert.ok(md.includes("%28"), "expected encoded open paren in rendered link");
  assert.ok(md.includes("%29"), "expected encoded close paren in rendered link");
});

test("credential-carrying OBS URL is stripped and paren-encoded together", () => {
  const url = "https://AK:SK@mybucket.obs.cn-north-4.myhuaweicloud.com/(a)/report.json";
  const safe = validateResultUrl(url);
  assert.ok(!safe.includes("AK"), "credentials must be stripped");
  assert.ok(!safe.includes("SK"), "credentials must be stripped");
  assert.ok(safe.includes("%28"), "parens must still be encoded");
});

test("strips OBS signed URL credential query params before rendering", () => {
  const url =
    "https://mybucket.obs.cn-north-4.myhuaweicloud.com/path/report.json" +
    "?AccessKeyId=AKIA123&Signature=SIG456%2Fabc&SecurityToken=TOKEN99&Expires=20300101&report=1";
  const safe = validateResultUrl(url);
  assert.ok(safe, "expected non-empty safe URL");
  assert.ok(!safe.includes("AKIA123"), "AccessKeyId must be stripped");
  assert.ok(!safe.includes("SIG456"), "Signature must be stripped");
  assert.ok(!safe.includes("TOKEN99"), "SecurityToken must be stripped");
  assert.ok(!safe.includes("20300101"), "Expires must be stripped");
  assert.ok(!safe.includes("%2Fabc"), "Signature value must be stripped");
  assert.ok(safe.includes("report=1"), "non-sensitive params must be preserved");
});

test("strips credential query params case-insensitively (incl. AWS v4 X-Amz-*)", () => {
  const url =
    "https://mybucket.obs.cn-north-4.myhuaweicloud.com/f.json" +
    "?accesskeyid=AK2&Signature=S2&X-Amz-Algorithm=AWS4-HMAC-SHA256&x-amz-signature=abc123";
  const safe = validateResultUrl(url);
  assert.ok(!safe.includes("AK2"), "lowercase accesskeyid must be stripped");
  assert.ok(!safe.includes("S2&"), "Signature must be stripped");
  assert.ok(!safe.includes("AWS4-HMAC-SHA256"), "X-Amz-Algorithm must be stripped");
  assert.ok(!safe.includes("x-amz-signature"), "x-amz-signature must be stripped");
  assert.ok(!safe.includes("abc123"), "x-amz-signature value must be stripped");
});

test("preserves OBS URL with only non-sensitive query params", () => {
  const url = "https://mybucket.obs.cn-north-4.myhuaweicloud.com/path/f.json?report=1&suite=smoke";
  assert.strictEqual(validateResultUrl(url), url);
});

// --- summary size cap ---
test("small content passes through unchanged", () => {
  assert.strictEqual(capSummarySize("hello"), "hello");
});

test("large content is truncated to <= MAX_SUMMARY_BYTES", () => {
  const big = "a".repeat(MAX_SUMMARY_BYTES + 4096);
  const capped = capSummarySize(big);
  assert.ok(
    Buffer.byteLength(capped, "utf8") <= MAX_SUMMARY_BYTES,
    "capped size " + Buffer.byteLength(capped, "utf8") + " > " + MAX_SUMMARY_BYTES
  );
});

test("truncated content includes truncation notice", () => {
  const big = "b".repeat(MAX_SUMMARY_BYTES + 1024);
  const capped = capSummarySize(big);
  assert.ok(capped.includes("摘要已截断"), "expected truncation notice");
});

// --- Integration: generateMarkdownTable wires the fixes together ---
test("generateMarkdownTable renders OBS link for allowed host", () => {
  const results = [
    {
      number: "TC-1",
      state: "passed",
      duration: "1.0",
      resultUrl: "https://mybucket.obs.cn-north-4.myhuaweicloud.com/path/file.json",
      sourceTask: "taskA",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(md.includes("[下载](https://mybucket.obs"), "expected OBS download link");
  assert.ok(!md.includes(MASKED_URL_DISPLAY), "should not mask allowed URL");
});

test("generateMarkdownTable masks non-OBS URL", () => {
  const results = [
    {
      number: "TC-2",
      state: "failed",
      duration: "2.0",
      resultUrl: "https://evil.example.com/payload",
      sourceTask: "taskB",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(md.includes(MASKED_URL_DISPLAY), "expected masked placeholder");
  assert.ok(!md.includes("evil.example.com"), "must not leak non-allowed host");
});

test("generateMarkdownTable neutralizes &lt;script&gt; in cell value", () => {
  const results = [
    {
      number: "&lt;script&gt;alert(1)&lt;/script&gt;",
      state: "passed",
      duration: "1.0",
      resultUrl: "",
      sourceTask: "taskC",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(md.includes("&amp;lt;script&amp;gt;"), "expected neutralized & entities");
  assert.ok(!md.includes("[下载]"), "empty URL should be N/A not a link");
});

// --- 用例结果 column only when resultDownloadUrl starts with http:// or https:// ---
test("generateMarkdownTable hides 用例结果 column when resultUrl is a local path", () => {
  const results = [
    {
      number: "TC-L1",
      state: "passed",
      duration: "1.0",
      resultUrl: "/tmp/local-report.html",
      sourceTask: "taskL",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(!md.includes("用例结果"), "用例结果 column must be hidden for non-http URL");
  assert.ok(md.includes("| 来源任务 | 用例名称 | 执行结果 | 耗时 |"), "base columns must remain");
  assert.ok(!md.includes("/tmp/local-report.html"), "local path must not leak into the table");
});

test("generateMarkdownTable hides 用例结果 column when resultUrl is empty", () => {
  const results = [{ number: "TC-E1", state: "failed", duration: "2.0", resultUrl: "", sourceTask: "taskE" }];
  const md = generateMarkdownTable(results, false);
  assert.ok(!md.includes("用例结果"), "用例结果 column must be hidden when no URL is present");
  assert.ok(!md.includes("N/A"), "hidden column leaves no N/A cells");
});

test("generateMarkdownTable keeps 用例结果 column when any resultUrl starts with http(s)", () => {
  const results = [
    { number: "TC-M1", state: "passed", duration: "1.0", resultUrl: "", sourceTask: "taskM" },
    {
      number: "TC-M2",
      state: "passed",
      duration: "1.0",
      resultUrl: "https://mybucket.obs.cn-north-4.myhuaweicloud.com/r.json",
      sourceTask: "taskM",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(md.includes("用例结果"), "用例结果 column must be kept when an http(s) URL exists");
  assert.ok(md.includes("[下载](https://mybucket.obs"), "expected download link");
});

test("generateMarkdownTable keeps retry column when 用例结果 column is hidden", () => {
  const results = [
    { number: "TC-R1", state: "passed", duration: "1.0", resultUrl: "", sourceTask: "taskR", isRetry: true },
  ];
  const md = generateMarkdownTable(results, true);
  assert.ok(!md.includes("用例结果"), "用例结果 column must be hidden");
  assert.ok(md.includes("| 来源任务 | 用例名称 | 执行结果 | 耗时 | 重试结果 |"), "retry column must remain");
  assert.ok(md.includes("| 是 |"), "retry cell must be rendered");
});

test("hasHttpResultUrl matches only http(s) prefixes", () => {
  assert.strictEqual(hasHttpResultUrl([]), false);
  assert.strictEqual(hasHttpResultUrl([{ resultUrl: "" }]), false);
  assert.strictEqual(hasHttpResultUrl([{ resultUrl: "ftp://bucket/x.json" }]), false);
  assert.strictEqual(hasHttpResultUrl([{ resultUrl: "file:///tmp/x.json" }]), false);
  assert.strictEqual(hasHttpResultUrl([{ resultUrl: "  https://mybucket.obs.cn-north-4.myhuaweicloud.com/x" }]), true);
  assert.strictEqual(hasHttpResultUrl([{ resultUrl: "HTTP://example.com/x" }]), true);
});

// --- reject symbolic links at whitelist path ---
// Covers the gap left by realpathSync: a symlink whose target is also within the
// whitelist would pass the post-realpath check. lstatSync rejects the link itself.
test("validateJsonFilePath rejects symlink at whitelist path (target within whitelist)", () => {
  const realFile = path.join("/tmp", "symlink-real-" + process.pid + ".json");
  const linkFile = path.join("/tmp", "symlink-link-" + process.pid + ".json");
  fs.writeFileSync(realFile, JSON.stringify({ testCasesResult: [] }));
  try {
    fs.symlinkSync(realFile, linkFile);
    let threw = false;
    try {
      validateJsonFilePath(linkFile);
    } catch (err) {
      threw = true;
      assert.ok(/symbolic link/i.test(err.message), "expected symlink rejection, got: " + err.message);
    }
    assert.ok(threw, "expected validateJsonFilePath to reject symlink");
  } finally {
    try {
      fs.unlinkSync(linkFile);
    } catch (e) {}
    try {
      fs.unlinkSync(realFile);
    } catch (e) {}
  }
});

test("validateJsonFilePath accepts regular whitelisted file", () => {
  const realFile = path.join("/tmp", "whitelist-plain-" + process.pid + ".json");
  fs.writeFileSync(realFile, JSON.stringify({ testCasesResult: [] }));
  try {
    const resolved = validateJsonFilePath(realFile);
    assert.ok(resolved, "expected resolved path for regular file");
  } finally {
    try {
      fs.unlinkSync(realFile);
    } catch (e) {}
  }
});

// --- parseTestResults reads via bound fd (regression) ---
// The TOCTOU race itself is not deterministically unit-testable; this test ensures the
// open+read-from-fd refactor did not break the normal happy path.
test("parseTestResults reads regular JSON file via fd-bound path (regression)", () => {
  const realFile = path.join("/tmp", "fd-bound-parse-" + process.pid + ".json");
  fs.writeFileSync(
    realFile,
    JSON.stringify({
      testCasesResult: [{ number: "TC-1", state: "passed", beginTime: 0, endTime: 1000, resultDownloadUrl: "" }],
    })
  );
  try {
    const results = parseTestResults(realFile, "taskX", false);
    assert.ok(Array.isArray(results), "expected results array");
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].number, "TC-1");
    assert.strictEqual(results[0].state, "passed");
    assert.strictEqual(results[0].duration, "1.0");
  } finally {
    try {
      fs.unlinkSync(realFile);
    } catch (e) {}
  }
});

// --- reject oversized input before readFileSync allocates memory ---
test("parseTestResults rejects input file larger than MAX_INPUT_BYTES", () => {
  const bigFile = path.join("/tmp", "oversize-big-" + process.pid + ".json");
  fs.writeFileSync(bigFile, Buffer.alloc(MAX_INPUT_BYTES + 1, " "));
  try {
    let threw = false;
    try {
      // Must pass the path whitelist first; /tmp is whitelisted.
      parseTestResults(bigFile, "taskBig", false);
    } catch (err) {
      threw = true;
      assert.ok(/too large/i.test(err.message), "expected size rejection, got: " + err.message);
    }
    assert.ok(threw, "expected parseTestResults to reject oversized file");
  } finally {
    try {
      fs.unlinkSync(bigFile);
    } catch (e) {}
  }
});

test("parseTestResults accepts input file at or below MAX_INPUT_BYTES", () => {
  const smallFile = path.join("/tmp", "oversize-small-" + process.pid + ".json");
  fs.writeFileSync(
    smallFile,
    JSON.stringify({
      testCasesResult: [{ number: "TC-1", state: "passed", beginTime: 0, endTime: 100, resultDownloadUrl: "" }],
    })
  );
  try {
    const results = parseTestResults(smallFile, "taskSmall", false);
    assert.ok(Array.isArray(results), "expected results array");
    assert.strictEqual(results.length, 1);
  } finally {
    try {
      fs.unlinkSync(smallFile);
    } catch (e) {}
  }
});

// --- redactSensitive masks sensitive fragments (paths, IPs) ---
test("redacts /home/ paths into [path]", () => {
  assert.strictEqual(redactSensitive(escapeMarkdownTable("/home/admin/secrets.json")), "[path]");
});

test("redacts IPv4 addresses into [ip], preserving trailing port", () => {
  assert.strictEqual(redactSensitive(escapeMarkdownTable("10.0.0.5:8080")), "[ip]:8080");
});

test("keeps non-sensitive /tmp/ paths untouched", () => {
  assert.strictEqual(redactSensitive(escapeMarkdownTable("/tmp/result.json")), "/tmp/result.json");
});

test("keeps Chinese test-case names untouched", () => {
  assert.strictEqual(redactSensitive(escapeMarkdownTable("用例-001")), "用例-001");
});

test("keeps Markdown escaping intact when redacting", () => {
  // < > must still become entities after redaction passes over the escaped text
  assert.strictEqual(redactSensitive(escapeMarkdownTable("TC_<[x]>")), "TC\\_&lt;\\[x\\]&gt;");
});

test("returns empty string for null/undefined input", () => {
  assert.strictEqual(redactSensitive(null), "");
  assert.strictEqual(redactSensitive(undefined), "");
  assert.strictEqual(redactSensitive(""), "");
});

// --- extended redaction patterns (Windows/UNC/system paths, tokens) ---
test("redacts Windows absolute paths (C:\\) into [path]", () => {
  assert.strictEqual(redactSensitive("C:\\Users\\admin\\secret.txt"), "[path]");
  assert.strictEqual(redactSensitive("D:/data/results.json"), "[path]");
});

test("redacts non-/home Unix absolute paths (/var/ /opt/ /data/) into [path]", () => {
  assert.strictEqual(redactSensitive("/var/log/app.log"), "[path]");
  assert.strictEqual(redactSensitive("/opt/service/config.ini"), "[path]");
  assert.strictEqual(redactSensitive("/data/secrets.json"), "[path]");
});

test("redacts UNC network share paths into [path]", () => {
  assert.strictEqual(redactSensitive("\\\\server\\share\\file"), "[path]");
});

test("redacts credential query tokens into [credential]", () => {
  const redacted = redactSensitive("?AccessKeyId=AK&Signature=Sig1&SecurityToken=T123&Expires=9999");
  assert.strictEqual(redacted, "?[credential]&[credential]&[credential]&[credential]");
});

test("keeps non-sensitive assignments and query params untouched", () => {
  assert.strictEqual(redactSensitive("?report=1&suite=smoke"), "?report=1&suite=smoke");
  assert.strictEqual(redactSensitive("name=value"), "name=value");
});

test("redacts then escapes keeps Markdown syntax protected", () => {
  // Raw plaintext -> redact -> escape: [path] placeholder is escaped by the table escapers
  assert.strictEqual(escapeMarkdownTable(redactSensitive("/var/log/x")), "\\[path\\]");
  assert.strictEqual(escapeMarkdownTable(redactSensitive("C:\\Users\\a\\b")), "\\[path\\]");
});

test("generateMarkdownTable redacts sensitive path in sourceTask cell", () => {
  const results = [
    {
      number: "TC-R1",
      state: "failed",
      duration: "1.0",
      resultUrl: "",
      sourceTask: "/home/admin/secrets.json",
    },
  ];
  const md = generateMarkdownTable(results, false);
  // Placeholder is escaped by escapeMarkdownTable ([ -> \[, ] -> \]) as expected
  assert.ok(md.includes("\\[path\\]"), "expected redacted [path] placeholder");
  assert.ok(!md.includes("secrets.json"), "must not leak sensitive file name");
  assert.ok(!md.includes("/home/admin"), "must not leak home directory path");
});

test("generateMarkdownTable redacts IP address in number cell", () => {
  const results = [
    {
      number: "10.0.0.5:8080",
      state: "passed",
      duration: "1.0",
      resultUrl: "",
      sourceTask: "taskR",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(md.includes("\\[ip\\]"), "expected redacted [ip] placeholder");
  assert.ok(!md.includes("10.0.0.5"), "must not leak IP address");
});

test("generateMarkdownTable redacts Windows path in sourceTask cell (redact-before-escape)", () => {
  const results = [
    {
      number: "TC-W1",
      state: "failed",
      duration: "1.0",
      resultUrl: "",
      sourceTask: "C:\\Users\\admin\\secret.db",
    },
  ];
  const md = generateMarkdownTable(results, false);
  // Placeholder is escaped by escapeMarkdownTable ([ -> \[, ] -> \]) as expected
  assert.ok(md.includes("\\[path\\]"), "expected redacted [path] placeholder");
  assert.ok(!md.includes("Users"), "must not leak Windows username path");
  assert.ok(!md.includes("secret.db"), "must not leak sensitive file name");
});

test("generateMarkdownTable redacts signed-URL tokens in number cell", () => {
  const results = [
    {
      number: "AccessKeyId=AK&Signature=Sig9",
      state: "failed",
      duration: "1.0",
      resultUrl: "",
      sourceTask: "taskK",
    },
  ];
  const md = generateMarkdownTable(results, false);
  // Placeholder is escaped by escapeMarkdownTable ([ -> \[, ] -> \]) as expected
  assert.ok(md.includes("\\[credential\\]"), "expected redacted [credential] placeholder");
  assert.ok(!md.includes("AccessKeyId=AK"), "must not leak AccessKeyId token");
  assert.ok(!md.includes("Sig9"), "must not leak Signature token");
});

// --- state enum validation (only "passed" counts; others flagged) ---
test("sanitizeState keeps known enum values", () => {
  assert.strictEqual(sanitizeState("passed"), "passed");
  assert.strictEqual(sanitizeState("failed"), "failed");
  assert.strictEqual(sanitizeState("skipped"), "skipped");
  assert.strictEqual(sanitizeState("error"), "error");
  assert.strictEqual(sanitizeState("unknown"), "unknown");
});

test("sanitizeState normalizes missing/empty state to unknown", () => {
  assert.strictEqual(sanitizeState(null), "unknown");
  assert.strictEqual(sanitizeState(undefined), "unknown");
  assert.strictEqual(sanitizeState(""), "unknown");
});

test("sanitizeState flags fabricated/case-variant states as unknown (never passed)", () => {
  assert.strictEqual(sanitizeState("PASSED"), "unknown");
  assert.strictEqual(sanitizeState("pass"), "unknown");
  assert.strictEqual(sanitizeState("SUCCESS"), "unknown");
  assert.strictEqual(sanitizeState("true"), "unknown");
});

test("sanitizeSourceTask keeps ASCII alphanumeric and hyphen only (FIND-06)", () => {
  // baseline: pure identifier unchanged
  assert.strictEqual(sanitizeSourceTask("taskA"), "taskA");
  assert.strictEqual(sanitizeSourceTask("TC-1"), "TC-1");
  assert.strictEqual(sanitizeSourceTask("smoke-test-42"), "smoke-test-42");
  // underscore is NOT in the allowlist [A-Za-z0-9-] -> stripped
  assert.strictEqual(sanitizeSourceTask("task_name"), "taskname");
  // path separators, dots, colons, spaces -> stripped
  assert.strictEqual(sanitizeSourceTask("/home/admin/secret"), "homeadminsecret");
  assert.strictEqual(sanitizeSourceTask("C:\\Users\\admin\\secret.db"), "CUsersadminsecretdb");
  assert.strictEqual(sanitizeSourceTask("Smoke Task"), "SmokeTask");
  // Unicode (CJK, Japanese, emoji, separators) -> stripped (closes FIND-06 + FIND-01)
  assert.strictEqual(sanitizeSourceTask("接口测试-user"), "-user");
  assert.strictEqual(sanitizeSourceTask("タロウ-secret"), "-secret");
  assert.strictEqual(sanitizeSourceTask("task\u2028# fake"), "taskfake");
  assert.strictEqual(sanitizeSourceTask("task\u2029| ✅ |"), "task");
  // null/undefined/number -> safe empty or stringified-then-stripped
  assert.strictEqual(sanitizeSourceTask(null), "");
  assert.strictEqual(sanitizeSourceTask(undefined), "");
  assert.strictEqual(sanitizeSourceTask(42), "42");
});

test("parseTestResults normalizes fabricated states; passedOnly keeps only exact passed", () => {
  const file = path.join("/tmp", "state-enum-" + process.pid + ".json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      testCasesResult: [
        { number: "TC-A", state: "passed", beginTime: 0, endTime: 1000 },
        { number: "TC-B", state: "PASSED", beginTime: 0, endTime: 1000 },
        { number: "TC-C", state: "pass", beginTime: 0, endTime: 1000 },
        { number: "TC-D", state: "failed", beginTime: 0, endTime: 1000 },
      ],
    })
  );
  try {
    const all = parseTestResults(file, "taskS", false);
    assert.deepStrictEqual(
      all.map((r) => r.state),
      ["passed", "unknown", "unknown", "failed"],
      "fabricated states must be normalized to unknown, never passed"
    );
    const passedOnly = parseTestResults(file, "taskS", true);
    assert.deepStrictEqual(
      passedOnly.map((r) => r.number),
      ["TC-A"],
      "passedOnly filter must keep only exact passed cases"
    );
  } finally {
    try {
      fs.unlinkSync(file);
    } catch (e) {}
  }
});

test("generateMarkdownTable renders unknown/not-passed states distinctly", () => {
  const results = [
    { number: "TC-1", state: "passed", duration: "1.0", resultUrl: "", sourceTask: "t" },
    { number: "TC-2", state: "unknown", duration: "1.0", resultUrl: "", sourceTask: "t" },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(md.includes("**passed** ✅"), "passed badge expected");
  assert.ok(md.includes("**unknown** ❌"), "unknown state must render as not passed");
});

// --- CR/LF normalization prevents table row injection ---
test("escapeMarkdownTable normalizes CR/LF to spaces (no new rows)", () => {
  assert.strictEqual(escapeMarkdownTable("A\nB"), "A B");
  assert.strictEqual(escapeMarkdownTable("A\r\nB"), "A B");
  assert.strictEqual(escapeMarkdownTable("A\rB"), "A B");
  assert.strictEqual(escapeMarkdownTable("A\n\n\nB"), "A B");
  assert.ok(!escapeMarkdownTable("A\n\rB").includes("\n"), "no LF may survive escaping");
  assert.ok(!escapeMarkdownTable("A\n\rB").includes("\r"), "no CR may survive escaping");
});

test("escapeMarkdownTable normalizes Unicode line/paragraph separators (FIND-01)", () => {
  // U+2028 Line Separator, U+2029 Paragraph Separator
  assert.strictEqual(escapeMarkdownTable("A\u2028B"), "A B");
  assert.strictEqual(escapeMarkdownTable("A\u2029B"), "A B");
  // U+0085 Next Line, U+000C Form Feed, U+0000 Null
  assert.strictEqual(escapeMarkdownTable("A\u0085B"), "A B");
  assert.strictEqual(escapeMarkdownTable("A\fB"), "A B");
  assert.strictEqual(escapeMarkdownTable("A\u0000B"), "A B");
  // mixed ASCII + Unicode runs collapse to single space
  assert.strictEqual(escapeMarkdownTable("A\n\u2028\r\u2029B"), "A B");
  // injected separators must not survive as raw chars
  assert.ok(!escapeMarkdownTable("X\u2028# fake heading").includes("\u2028"), "U+2028 must not survive escaping");
  assert.ok(!escapeMarkdownTable("X\u2029# fake heading").includes("\u2029"), "U+2029 must not survive escaping");
});

test("generateMarkdownTable neutralizes Unicode separator table-row injection (FIND-01)", () => {
  const results = [
    {
      number: "TC-UNI",
      state: "passed",
      duration: "1.0",
      resultUrl: "",
      sourceTask: "SmokeTask\u2028# fake heading\u2029| injected | ✅ |",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(!md.includes("\u2028"), "U+2028 must not appear in rendered table");
  assert.ok(!md.includes("\u2029"), "U+2029 must not appear in rendered table");
  assert.ok(!md.split("\n").some((line) => /^# fake heading/.test(line)), "injected heading must not start a new line");
  // 1 result, no retry column, no truncation -> 6 content lines + trailing newline
  assert.strictEqual(md.split("\n").length, 7);
});

test("generateMarkdownTable neutralizes CRLF table-row injection in cells", () => {
  const results = [
    {
      number: "TC-INJ",
      state: "passed",
      duration: "1.0",
      resultUrl: "",
      sourceTask: "SmokeTask:\n# fake heading\n| 伪造行 | passed | ✅ |",
    },
  ];
  const md = generateMarkdownTable(results, false);
  assert.ok(!md.includes("\n# fake heading"), "injected heading must not start a new line");
  assert.ok(!md.includes("\n| 伪造行 |"), "injected table row must not open a new line");
  assert.ok(md.includes("SmokeTask: \\# fake heading"), "injected content must collapse into one cell, # escaped");
  // 1 result, no retry column, no truncation -> 6 content lines + trailing newline
  assert.strictEqual(md.split("\n").length, 7);
  // Every line must be a structural element of the hand-built table (no foreign block line)
  const allowedStart = /^(\| |:|\*\*|##|\*已截断|$)/;
  assert.ok(
    md.split("\n").every((line) => allowedStart.test(line)),
    "no injected block-level line may appear"
  );
});

test("SENSITIVE_PATTERNS has only non-capturing-global-safe entries", () => {
  // Each pattern must be a { re, repl } object; repl must be a string
  const { SENSITIVE_PATTERNS } = require("../index.js");
  assert.ok(Array.isArray(SENSITIVE_PATTERNS) && SENSITIVE_PATTERNS.length > 0);
  for (const p of SENSITIVE_PATTERNS) {
    assert.ok(p.re instanceof RegExp, "pattern.re must be a RegExp");
    assert.strictEqual(typeof p.repl, "string", "pattern.repl must be a string");
  }
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
