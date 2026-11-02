const core = require("@actions/core");
const fs = require("fs");
const path = require("path");

/**
 * Line-break class covering ASCII CR/LF plus Unicode line/paragraph
 * separators that some Markdown renderers interpret as newlines:
 * U+2028 (Line Separator), U+2029 (Paragraph Separator),
 * U+0085 (Next Line), U+000C (Form Feed), U+0000 (Null).
 * Shared by escapeMarkdownTable and stripCellLineBreaks.
 */
const LINE_BREAK_RE = /[\r\n\u2028\u2029\u0085\f\u0000]+/g;

/**
 * Escape special characters for Markdown table cells.
 * Prevents Markdown injection by escaping syntax characters.
 * @param {string} text - Text to escape
 * @returns {string} - Escaped text
 */
function escapeMarkdownTable(text) {
  if (!text) return "";

  // Escape Markdown special characters in order of specificity
  // CR/LF must be normalized before any structural rule: a raw newline inside a
  // cell would break the line-based table and re-open Markdown parsing context.
  // Multi-line runs collapse into a single space.
  // & must be escaped first to neutralize attacker-supplied HTML entities
  // before < and > are turned into &lt;/&gt;
  // Backslash must be escaped before other Markdown chars to avoid double-escaping
  return text
    .replace(LINE_BREAK_RE, " ") // ASCII CR/LF + Unicode line/paragraph separators (must be first, before any syntax escaping)
    .replace(/&/g, "&amp;") // Ampersand - HTML entity start (must be first, before < > entity replacement)
    .replace(/\\/g, "\\\\") // Backslash (must be before other Markdown escapes)
    .replace(/\|/g, "\\|") // Pipe - table column break
    .replace(/\*/g, "\\*") // Asterisk - bold/italic
    .replace(/_/g, "\\_") // Underscore - bold/italic
    .replace(/`/g, "\\`") // Backtick - inline code
    .replace(/#/g, "\\#") // Hash - heading
    .replace(/</g, "&lt;") // Less than - HTML tag (use entity)
    .replace(/>/g, "&gt;") // Greater than - HTML tag (use entity)
    .replace(/\[/g, "\\[") // Left bracket - link
    .replace(/\]/g, "\\]") // Right bracket - link
    .replace(/~/g, "\\~"); // Tilde - strikethrough
}

/**
 * Table-level defense: guarantee a rendered row carries no raw line breaks.
 * Table rows are joined with "\n", so any stray newline in a cell would open a
 * new physical line inside the summary. escapeMarkdownTable already normalizes
 * ASCII CR/LF and Unicode line/paragraph separators in cell content; this is
 * the belt-and-braces pass applied right before each row is appended.
 * @param {string} row - Rendered table row (with cells already escaped)
 * @returns {string} - Row with line-break runs collapsed to a single space
 */
function stripCellLineBreaks(row) {
  return String(row).replace(LINE_BREAK_RE, " ");
}

/**
 * Redact known-sensitive content patterns from rendered text.
 * Applied BEFORE escapeMarkdownTable so patterns match plaintext: escaping
 * first doubles backslashes (breaking Windows/UNC path patterns) and distorts
 * the regex-relevant shape of sensitive fragments (e.g. `#` -> `\#`).
 * @param {string} text - Text to redact
 * @returns {string} - Text with sensitive fragments masked
 */
// Ordered: more specific patterns first (paths before generic tokens)
const SENSITIVE_PATTERNS = [
  // Windows absolute paths (C:\Users\..., D:/data/...)
  { re: /\b[A-Za-z]:[\\/][^\s\u4e00-\u9fa5]+/g, repl: "[path]" },
  // UNC network share paths (\\server\share\file)
  { re: /\\\\[^\s\u4e00-\u9fa5]+/g, repl: "[path]" },
  // Common Unix absolute paths beyond /home (/var, /opt, /usr, /data, ...)
  { re: /\/(?:home|var|opt|usr|data|etc|srv|mnt|media)\/[^\s\u4e00-\u9fa5]+/g, repl: "[path]" },
  // IPv4 addresses
  { re: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, repl: "[ip]" },
  // Credential/token query parameters (defense-in-depth; signed-URL params are
  // stripped earlier by stripSensitiveQueryParams in validateResultUrl)
  {
    re: /\b(?:AccessKeyId|AWSAccessKeyId|Signature|SecurityToken|Expires)\s*=\s*[^&\s\u4e00-\u9fa5]+/gi,
    repl: "[credential]",
  },
];

function redactSensitive(text) {
  if (!text) return "";
  return SENSITIVE_PATTERNS.reduce((t, p) => t.replace(p.re, p.repl), text);
}

/**
 * Validate JSON file path security and format.
 * Performs security checks for path traversal, extension, and absolute path whitelist.
 * Note: Empty path and file existence checks are handled in run() before this function.
 * @param {string} jsonFilePath - Path to the JSON file
 * @returns {string} - Validated file path
 * @throws {Error} If path violates security rules or has invalid extension
 */
function validateJsonFilePath(jsonFilePath) {
  // Whitelist prefix check helper (applied to both absolute and relative inputs).
  // Narrow the workspace prefix to the CI workspace itself: resolve cwd to its
  // canonical path once so the prefix matches what realpathSync produces for files inside
  // the workspace, avoiding false rejection when the workspace is a symlink and keeping
  // other users' home directories (e.g. /home/admin) out of scope.
  const WORKSPACE_REAL = fs.realpathSync(process.cwd());
  const ALLOWED_PREFIXES = [WORKSPACE_REAL + "/", "/tmp/"];
  const isWithinWhitelist = (targetPath) => ALLOWED_PREFIXES.some((prefix) => targetPath.startsWith(prefix));

  const trimmedPath = jsonFilePath.trim();

  // Reject paths containing path traversal sequences
  // Defense-in-depth: realpathSync below also normalizes these, but fast-fail here gives a clear signal
  if (trimmedPath.includes("..")) {
    throw new Error("Path rejected: traversal sequences are not allowed");
  }

  // Validate file extension
  const ext = path.extname(trimmedPath).toLowerCase();
  if (ext !== ".json") {
    throw new Error("Path rejected: only .json files are allowed");
  }

  // Resolve to absolute path (unifies absolute and relative input handling)
  // Relative paths now also go through the whitelist instead of being returned directly
  const resolvedPath = path.resolve(process.cwd(), trimmedPath);

  if (!isWithinWhitelist(resolvedPath)) {
    throw new Error("Path rejected: outside whitelist");
  }

  // Reject symbolic links at the whitelist path.
  // lstatSync does not follow symlinks, so isSymbolicLink() detects a link planted at
  // this path even when its target is also within the whitelist (cross-boundary leak that
  // realpathSync + whitelist would not catch, since the resolved target still passes).
  let linkStat;
  try {
    linkStat = fs.lstatSync(resolvedPath);
  } catch (err) {
    throw new Error("Path rejected: unable to stat path");
  }
  if (linkStat.isSymbolicLink()) {
    throw new Error("Path rejected: symbolic links are not allowed");
  }

  // Resolve symlinks to canonical path and re-verify whitelist
  // Prevents symlink bypass (e.g. /home/legit.json -> /etc/shadow)
  let realPath;
  try {
    realPath = fs.realpathSync(resolvedPath);
  } catch (err) {
    throw new Error("Path rejected: unable to resolve real path");
  }
  if (!isWithinWhitelist(realPath)) {
    throw new Error("Path rejected: outside whitelist (post-realpath)");
  }

  return realPath;
}

/**
 * Validates the step summary file path for security.
 * Mirrors validateJsonFilePath checks: rejects path traversal, symbolic links,
 * and paths outside the workspace/tmp whitelist. The summary file must already
 * exist; it is not created by this action.
 * @param {string} summaryFilePath - Raw path from GITHUB_STEP_SUMMARY env var
 * @returns {string} - Validated file path
 * @throws {Error} If path violates security rules
 */
function validateSummaryFilePath(summaryFilePath) {
  const WORKSPACE_REAL = fs.realpathSync(process.cwd());
  const ALLOWED_PREFIXES = [WORKSPACE_REAL + "/", "/tmp/"];
  // GitHub Actions places $GITHUB_STEP_SUMMARY under $RUNNER_TEMP (e.g.
  // /home/runner/_temp/<job>_summary.md), which is neither the workspace nor /tmp.
  // Allow the CI-provided runner temp dir so the summary can be written.
  const runnerTemp = process.env.RUNNER_TEMP;
  if (runnerTemp) {
    ALLOWED_PREFIXES.push(path.resolve(runnerTemp) + "/");
  }
  const isWithinWhitelist = (targetPath) => ALLOWED_PREFIXES.some((prefix) => targetPath.startsWith(prefix));

  const trimmedPath = summaryFilePath.trim();

  // Reject paths containing path traversal sequences
  if (trimmedPath.includes("..")) {
    throw new Error("Summary path rejected: traversal sequences are not allowed");
  }

  // Resolve to absolute path (unifies absolute and relative input handling)
  const resolvedPath = path.resolve(process.cwd(), trimmedPath);

  if (!isWithinWhitelist(resolvedPath)) {
    throw new Error("Summary path rejected: outside whitelist");
  }

  // The summary file must already exist (created by the CI runtime).
  // Reject if missing — this action does not create the file.
  let linkStat;
  try {
    linkStat = fs.lstatSync(resolvedPath);
  } catch (err) {
    throw new Error("Summary path rejected: file does not exist");
  }

  if (linkStat.isSymbolicLink()) {
    throw new Error("Summary path rejected: symbolic links are not allowed");
  }

  let realPath;
  try {
    realPath = fs.realpathSync(resolvedPath);
  } catch (err) {
    throw new Error("Summary path rejected: unable to resolve real path");
  }
  if (!isWithinWhitelist(realPath)) {
    throw new Error("Summary path rejected: outside whitelist (post-realpath)");
  }

  return realPath;
}

// Legal test-state enum. Values outside this set are treated as fabricated or
// malformed: normalized to "unknown" and counted as not-passed, never a pass.
const KNOWN_TEST_STATES = ["passed", "failed", "skipped", "error", "unknown"];

/**
 * Normalize a raw test-case state to the KNOWN_TEST_STATES enum.
 * Only the exact value "passed" ever counts as passed; unknown/case-variant
 * values (PASSED, pass, SUCCESS, ...) are flagged with a warning and normalized
 * to "unknown" so a forged/volatile state cannot blend in as a pass anywhere
 * downstream (passedOnly filter, statistics, table rendering).
 * @param {*} rawState - Raw state value from input JSON
 * @returns {string} - Sanitized state within KNOWN_TEST_STATES
 */
function sanitizeState(rawState) {
  const value = rawState == null ? "unknown" : String(rawState);
  if (KNOWN_TEST_STATES.includes(value)) return value;
  core.warning(`Unknown test state "${value}" flagged as suspicious; counted as not passed`);
  return "unknown";
}

/**
 * Strip sourceTask to ASCII alphanumeric, hyphen, and CJK characters.
 * Allowed whitelist: [A-Za-z0-9-] plus CJK basic block U+4E00-U+9FFF and
 * Extension A U+3400-U+4DBF, so Chinese CI step names (ciEnv.step_name)
 * survive sanitization and display in the summary table.
 * Any character outside this whitelist (whitespace, path separators / and \,
 * Markdown specials, fullwidth ASCII U+FF00-U+FFEF, CJK compatibility
 * U+F900-U+FAFF, zero-width U+2000-U+200F, line/paragraph separators
 * U+2028-U+2029) is removed. This closes the Unicode bypass of
 * SENSITIVE_PATTERNS and Unicode line/paragraph separator injection at
 * the input boundary; the CJK ranges contain none of these dangerous chars.
 * @param {string} raw - Raw source task value from upstream config
 * @returns {string} - Sanitized source task within the whitelist
 */
function sanitizeSourceTask(raw) {
  return String(raw == null ? "" : raw).replace(/[^A-Za-z0-9-\u4e00-\u9fff\u3400-\u4dbf]/g, "");
}

/**
 * Parse test case execution results from JSON file
 * @param {string} jsonFilePath - Path to the JSON file
 * @param {string} sourceTask - Source task name (optional)
 * @param {boolean} passedOnly - Only include passed test cases (optional)
 * @returns {object[]} - Parsed test results
 */
function parseTestResults(jsonFilePath, sourceTask = "", passedOnly = false) {
  const safeTask = sanitizeSourceTask(sourceTask);
  const resolvedPath = validateJsonFilePath(jsonFilePath);
  core.info(`parseTestResults called: file=${resolvedPath}, sourceTask=${safeTask}, passedOnly=${passedOnly}`);

  // Open the file once and read from the bound fd.
  // Binding the read to the fd (instead of re-resolving the path with readFileSync)
  // closes the TOCTOU window between the lstat/realpath probe above and the actual
  // read: once openSync returns, the fd is pinned to one inode and cannot be swapped,
  // even if an attacker replaces the file at the path between probe and read.
  // Reject oversized input before reading into memory.
  const fd = fs.openSync(resolvedPath, "r");
  let fileContent;
  try {
    const { size } = fs.fstatSync(fd);
    if (size > MAX_INPUT_BYTES) {
      throw new Error(`File too large: ${size} bytes exceeds ${MAX_INPUT_BYTES} byte limit`);
    }
    fileContent = fs.readFileSync(fd, "utf8");
  } finally {
    fs.closeSync(fd);
  }
  let jsonData;

  try {
    jsonData = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse JSON file ${resolvedPath}: ${error.message}`);
  }

  if (!jsonData.testCasesResult || !Array.isArray(jsonData.testCasesResult)) {
    throw new Error(`Invalid JSON structure in ${resolvedPath}: missing testCasesResult array`);
  }

  let testCases = jsonData.testCasesResult;
  core.info(`Total test cases in file: ${testCases.length}`);
  if (passedOnly) {
    core.info(`Filtering for passed cases only`);
    testCases = testCases.filter((testCase) => testCase.state === "passed");
    core.info(`Passed test cases after filtering: ${testCases.length}`);
  }

  const results = testCases.map((testCase) => {
    const beginTime = testCase.beginTime || 0;
    const endTime = testCase.endTime || 0;
    const durationSeconds = (endTime - beginTime) / 1000.0;

    return {
      number: testCase.number || "N/A",
      state: sanitizeState(testCase.state),
      duration: durationSeconds.toFixed(1),
      resultUrl: testCase.resultDownloadUrl || "",
      sourceTask: safeTask,
    };
  });

  core.info(`parseTestResults returning ${results.length} results`);
  return results;
}

// Allow-list for resultDownloadUrl hosts.
// Only HuaweiCloud OBS bucket download hosts are rendered as clickable links;
// any other host (internal, private, or attacker-controlled) is masked.
// Pattern: https://{bucket-name}.obs.{region}.myhuaweicloud.com
const OBS_HOST_PATTERN = /^[a-z0-9][a-z0-9-]*\.obs\.[a-z0-9-]+\.myhuaweicloud\.com$/i;
const MASKED_URL_DISPLAY = "[下载链接已脱敏]";

// Query parameter names carrying OBS signing/credential material (AccessKeyId,
// Signature, SecurityToken, Expires, AWS v4 X-Amz-* signature set, ...).
// Stripped from any allowed result URL before rendering so they never reach the
// step summary; non-sensitive params (report=1, suite=smoke) are preserved.
const SENSITIVE_QUERY_KEYS = [
  "accesskeyid",
  "awsaccesskeyid",
  "signature",
  "securitytoken",
  "expires",
  "x-amz-algorithm",
  "x-amz-credential",
  "x-amz-date",
  "x-amz-expires",
  "x-amz-signedheaders",
  "x-amz-signature",
  "x-amz-security-token",
];

/**
 * Remove signing/credential query parameters from an OBS URL in place.
 * @param {URL} url - Parsed URL to sanitize
 * @returns {URL} - The same URL object with sensitive query params removed
 */
function stripSensitiveQueryParams(url) {
  const params = new URLSearchParams(url.search);
  let removed = false;
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_QUERY_KEYS.includes(key.toLowerCase())) {
      params.delete(key);
      removed = true;
    }
  }
  if (removed) url.search = params.toString();
  return url;
}

// Reject oversized input before readFileSync allocates memory.
// readFileSync reads the whole file into the V8 heap in one shot; without this
// cap a huge input would OOM the runner before MAX_ROWS / MAX_SUMMARY_BYTES
// (which limit output, not input) ever apply. 3 MB is ample for test-result JSON.
const MAX_INPUT_BYTES = 3 * 1024 * 1024; // 3 MB

/**
 * Validate a result URL against the OBS bucket allow-list.
 * @staticmethod
 * @param {string} rawUrl - Raw URL from JSON
 * @returns {string} - Safe absolute URL string to render, or empty string if not allowed
 */
function validateResultUrl(rawUrl) {
  if (!rawUrl) return "";
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (e) {
    core.warning("URL masked: invalid URL (not a valid absolute URL)");
    return "";
  }
  // Require https + OBS bucket host pattern
  if (parsedUrl.protocol === "https:" && OBS_HOST_PATTERN.test(parsedUrl.hostname)) {
    // Strip embedded credentials before rendering
    parsedUrl.username = "";
    parsedUrl.password = "";
    // Strip OBS signing/Auth query params (AccessKeyId/Signature/SecurityToken/...)
    stripSensitiveQueryParams(parsedUrl);
    // encodeURI intentionally leaves () and # unescaped, which would break the
    // Markdown link syntax [下载](url) — percent-encode them after
    return encodeURI(parsedUrl.href).replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/#/g, "%23");
  }
  core.warning("URL masked: host does not match OBS bucket allow-list");
  return "";
}

// A resultDownloadUrl only renders as a download link when it starts with the
// http:// or https:// scheme; local paths or bare identifiers have no link.
const HTTP_URL_PREFIX_RE = /^https?:\/\//i;

/**
 * Detect whether any result carries an http(s) resultDownloadUrl.
 * The 用例结果 column is meaningless (and would only show N/A/脱敏占位) when all
 * resultDownloadUrl values are non-http (e.g. local file paths), so it is hidden.
 * @param {object[]} testResults - Array of test results
 * @returns {boolean} - True if at least one resultUrl starts with http:// or https://
 */
function hasHttpResultUrl(testResults) {
  return testResults.some((r) => typeof r.resultUrl === "string" && HTTP_URL_PREFIX_RE.test(r.resultUrl.trim()));
}

/**
 * Generate Markdown table from test results
 * @param {object[]} testResults - Array of test results
 * @param {boolean} showRetryColumn - Whether to show retry result column
 * @returns {string} - Markdown formatted table
 */
function generateMarkdownTable(testResults, showRetryColumn = false) {
  core.info(`generateMarkdownTable called with ${testResults.length} results, showRetryColumn=${showRetryColumn}`);
  let markdown = "";

  // Hard-coded title to prevent Markdown injection
  markdown += `## 测试结果汇总\n\n`;

  // Add statistics summary
  const total = testResults.length;
  const passed = testResults.filter((r) => r.state === "passed").length;
  markdown += `**用例总数: ${total}, 通过用例: ${passed}, 未通过用例: ${total - passed}**\n`;

  // The 用例结果 column is only rendered when the input JSON carries http(s)
  // resultDownloadUrl values; otherwise (e.g. local file paths) it is omitted.
  const showResultColumn = hasHttpResultUrl(testResults);

  const columns = ["来源任务", "用例名称", "执行结果", "耗时"];
  if (showResultColumn) columns.push("用例结果");
  if (showRetryColumn) columns.push("重试结果");
  markdown += `| ${columns.join(" | ")} |\n`;
  markdown += `| ${columns.map(() => ":---").join(" | ")} |\n`;

  // Sort test results: non-passed cases first, then passed cases
  // Prevents hiding skipped/unknown cases among passed ones (sort order)
  const sortedResults = [...testResults].sort((a, b) => {
    const isPassedA = a.state === "passed";
    const isPassedB = b.state === "passed";
    if (!isPassedA && isPassedB) return -1;
    if (isPassedA && !isPassedB) return 1;
    return 0;
  });

  // Cap rendered rows to prevent unbounded memory growth
  const MAX_ROWS = 1000;
  const displayResults = sortedResults.slice(0, MAX_ROWS);
  const truncatedCount = sortedResults.length - displayResults.length;

  displayResults.forEach((result) => {
    const stateEmoji = result.state === "passed" ? "✅" : "❌";
    const stateDisplay = `**${escapeMarkdownTable(result.state)}** ${stateEmoji}`;
    // Security: Only OBS bucket allow-listed URLs render as links; others masked.
    // Skipped entirely when the 用例结果 column is not rendered.
    let urlDisplay = "N/A";
    if (showResultColumn && result.resultUrl) {
      const safeUrl = validateResultUrl(result.resultUrl);
      urlDisplay = safeUrl ? `[下载](${safeUrl})` : MASKED_URL_DISPLAY;
    }
    // Redact sensitive fragments (paths, IPs, credentials) BEFORE escaping so
    // patterns match plaintext; escaping afterwards protects Markdown syntax.
    const sourceDisplay = escapeMarkdownTable(redactSensitive(result.sourceTask)) || "-";
    const numberDisplay = escapeMarkdownTable(redactSensitive(result.number));
    const durationDisplay = escapeMarkdownTable(result.duration);
    const retryDisplay = result.isRetry === true ? "是" : result.isRetry === false ? "否" : "-";

    // Keep cells in sync with the rendered columns; the 用例结果 cell is only
    // emitted when the column itself is shown.
    const cells = [sourceDisplay, numberDisplay, stateDisplay, durationDisplay];
    if (showResultColumn) cells.push(urlDisplay);
    if (showRetryColumn) cells.push(retryDisplay);

    // Table-level defense: strip any residual CR/LF before the row is appended
    // (rows are \n-delimited; escapeMarkdownTable already normalized cells).
    markdown += stripCellLineBreaks(`| ${cells.join(" | ")} |`) + "\n";
  });

  if (truncatedCount > 0) {
    markdown += `\n*已截断 ${truncatedCount} 行（超过 ${MAX_ROWS} 上限）*\n`;
  }

  return markdown;
}

/**
 * Count test case statistics
 * @param {object[]} testResults - Array of test results
 * @returns {object} - Statistics object
 */
function countStatistics(testResults) {
  const total = testResults.length;
  const passed = testResults.filter((r) => r.state === "passed").length;
  const notPassed = total - passed;

  return { total, passed, notPassed };
}

/**
 * Parse JSON file input with optional source task prefix
 * Format: "SourceTask:/path/to/file.json" or "/path/to/file.json"
 * @param {string} input - Input string (newline-separated)
 * @returns {object[]} - Array of {sourceTask, jsonFile} objects
 */
function parseJsonFileInput(input) {
  const lines = input.split("\n").filter((line) => line.trim());
  const result = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // Check if line contains "source:json_file" format
    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex > 0) {
      // Skip Windows absolute path (e.g., C:\Users\test.json, D:/data/results.json)
      const isWindowsPath = colonIndex === 1 && /^[A-Za-z]:[/\\]/.test(trimmedLine.substring(0, 3));

      if (!isWindowsPath) {
        // Check if it's a valid "source:json_file" format
        const possibleSource = trimmedLine.substring(0, colonIndex).trim();
        const possiblePath = trimmedLine.substring(colonIndex + 1).trim();

        // Validate: source should not be empty, path should look like a file path
        if (possibleSource && possiblePath && !possiblePath.includes(":")) {
          result.push({
            sourceTask: possibleSource,
            jsonFile: possiblePath,
          });
          continue;
        }
      }
    }

    // Fallback: treat entire line as JSON file path (no source task)
    result.push({
      sourceTask: "",
      jsonFile: trimmedLine,
    });
  }

  return result;
}

// Maximum bytes allowed in the step summary append.
// Prevents unbounded disk/summary growth from large attacker-influenced Markdown.
const MAX_SUMMARY_BYTES = 256 * 1024;

/**
 * Cap summary content to MAX_SUMMARY_BYTES, appending a truncation notice if exceeded.
 * Truncation happens on UTF-8 byte boundary; a partial multi-byte char at the cut
 * becomes the replacement char, which is acceptable for a DoS safeguard.
 * @staticmethod
 * @param {string} content - Raw summary content
 * @returns {string} - Possibly truncated content
 */
function capSummarySize(content) {
  const contentBytes = Buffer.byteLength(content, "utf8");
  if (contentBytes <= MAX_SUMMARY_BYTES) return content;

  const notice = `\n\n*摘要已截断：原始 ${contentBytes} 字节超过 ${MAX_SUMMARY_BYTES} 字节上限*\n`;
  const budget = Math.max(0, MAX_SUMMARY_BYTES - Buffer.byteLength(notice, "utf8"));
  const truncated = Buffer.from(content, "utf8").slice(0, budget).toString("utf8");
  core.warning(`Summary truncated from ${contentBytes} to fit ${MAX_SUMMARY_BYTES} byte limit`);
  return truncated + notice;
}

/**
 * Main function
 */
async function run() {
  try {
    const jsonFileInput = core.getInput("json-file", { required: true });
    const lastJsonInput = core.getInput("last-json", { required: false });

    // Parse JSON file input with optional source task prefix
    const jsonFiles = parseJsonFileInput(jsonFileInput);
    core.info(`Parsing test results from ${jsonFiles.length} source(s)`);

    // Parse last-json input if provided
    let lastJsonFiles = [];
    if (lastJsonInput && lastJsonInput.trim()) {
      lastJsonFiles = parseJsonFileInput(lastJsonInput);
      core.info(`Parsing last test results from ${lastJsonFiles.length} source(s)`);
    }

    // Merge results from all JSON files (mark as retry = true)
    let allTestResults = [];
    for (const item of jsonFiles) {
      // Skip if jsonFile is empty or whitespace
      if (!item.jsonFile || item.jsonFile.trim() === "") {
        core.warning(`Skipping entry with empty jsonFile path`);
        continue;
      }

      const sourceTaskDisplay = sanitizeSourceTask(item.sourceTask) || "(no source task)";
      let results;
      try {
        results = parseTestResults(item.jsonFile, item.sourceTask || "");
      } catch (err) {
        core.warning(`Skipping entry for source task "${sourceTaskDisplay}": ${err.message}`);
        continue;
      }
      core.info(`Got ${results.length} results from "${sourceTaskDisplay}"`);
      // Mark as retry results
      results.forEach((r) => {
        r.isRetry = true;
      });
      allTestResults = allTestResults.concat(results);
      core.info(`allTestResults now has ${allTestResults.length} total results`);
    }

    // Merge results from last-json files (only passed cases, mark as retry = false)
    let lastTestResults = [];
    for (const item of lastJsonFiles) {
      // Skip if jsonFile is empty or whitespace
      if (!item.jsonFile || item.jsonFile.trim() === "") {
        core.warning(`Skipping entry with empty jsonFile path`);
        continue;
      }

      const sourceTaskDisplay = sanitizeSourceTask(item.sourceTask) || "(no source task)";
      let results;
      try {
        results = parseTestResults(item.jsonFile, item.sourceTask || "", true);
      } catch (err) {
        core.warning(`Skipping last-json entry for source task "${sourceTaskDisplay}": ${err.message}`);
        continue;
      }
      core.info(`Got ${results.length} results from last-json "${sourceTaskDisplay}"`);
      // Mark as non-retry results
      results.forEach((r) => {
        r.isRetry = false;
      });
      lastTestResults = lastTestResults.concat(results);
      core.info(`lastTestResults now has ${lastTestResults.length} total results`);
    }

    // Combine all results
    const combinedResults = allTestResults.concat(lastTestResults);
    const showRetryColumn = lastTestResults.length > 0;

    core.info(`allTestResults length: ${allTestResults.length}`);
    core.info(`lastTestResults length: ${lastTestResults.length}`);
    core.info(`combinedResults length: ${combinedResults.length}`);

    const stats = countStatistics(combinedResults);

    core.info(`Found ${stats.total} test cases (${stats.passed} passed, ${stats.notPassed} not passed)`);

    const markdownTable = generateMarkdownTable(combinedResults, showRetryColumn);

    // Output to GitHub workflow step summary ($GITHUB_STEP_SUMMARY)
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    if (summaryFile) {
      try {
        const validatedSummaryPath = validateSummaryFilePath(summaryFile);
        // Cap summary size before append to prevent unbounded growth
        const summaryContent = capSummarySize(markdownTable + "\n");
        // fd-binding: write through the descriptor pinned at open time so a
        // symlink swap between validation and write cannot redirect the append
        // (mirrors the TOCTOU-safe read path in parseTestResults).
        const fd = fs.openSync(validatedSummaryPath, "a");
        try {
          fs.appendFileSync(fd, summaryContent);
        } finally {
          fs.closeSync(fd);
        }
        core.info(`Summary written to ${validatedSummaryPath}`);
      } catch (err) {
        core.warning(`Summary not written: ${err.message}`);
      }
    } else {
      // GITHUB_STEP_SUMMARY 未设置时不输出汇总表，避免绕过 capSummarySize 造成日志洪泛
      core.info(
        "GITHUB_STEP_SUMMARY not set; summary table not emitted to console " + "(would bypass capSummarySize)"
      );
    }

    // Set outputs
    core.setOutput("total-cases", stats.total.toString());
    core.setOutput("passed-cases", stats.passed.toString());
    core.setOutput("not-passed-cases", stats.notPassed.toString());

    core.info("Test results summary generated successfully");
  } catch (error) {
    core.setOutput("total-cases", "0");
    core.setOutput("passed-cases", "0");
    core.setOutput("not-passed-cases", "0");
    core.setFailed(error.message);
  }
}

// Run if executed directly
if (require.main === module) {
  run();
}

// Exposed for unit testing (entry point remains dist/index.js at runtime)
module.exports = {
  escapeMarkdownTable,
  redactSensitive,
  sanitizeState,
  sanitizeSourceTask,
  validateResultUrl,
  validateJsonFilePath,
  validateSummaryFilePath,
  capSummarySize,
  generateMarkdownTable,
  hasHttpResultUrl,
  parseJsonFileInput,
  parseTestResults,
  MASKED_URL_DISPLAY,
  MAX_SUMMARY_BYTES,
  MAX_INPUT_BYTES,
  OBS_HOST_PATTERN,
  SENSITIVE_PATTERNS,
};
