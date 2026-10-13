'use strict';

/**
 * obs-sdk 插件测试
 *
 * 通过替换 require.cache 注入 FakeObsClient（模拟 esdk-obs-nodejs）并拦截 fetch
 * （仅模拟 OIDC -> STS 换证），真实执行插件 run()，覆盖：
 *   1. 全流程：读取 file-path 文件 -> OBS 上传（OBS 客户端参数与 putObject 参数正确，
 *      换证使用 GitHubActions 提供商）
 *   2. 文件缺失校验：file-path 指向的文件不存在 -> setFailed，退出码置 1，不调用 putObject
 *   3. OBS 失败分支：putObject 非 2xx -> setFailed，退出码置 1
 *
 * 另捕获 stdout（core.info 与 SDK 调试日志均写入 stdout）断言执行步骤与第三方接口
 * 请求/响应日志（含敏感字段脱敏）。
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// SDK 经 npm 包安装，require 缓存键为真实路径，清缓存需用 realpath 匹配
const SDK_DIR = fs.realpathSync(path.resolve(__dirname, '../node_modules/@openlibing/huaweicloud-oidc-client'));

/** 清空插件与 SDK（node_modules/@openlibing/huaweicloud-oidc-client 包全部模块）缓存，隔离各用例的凭证缓存与模块状态。 */
function freshModules() {
  delete require.cache[require.resolve('../index.js')];
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SDK_DIR)) {
      delete require.cache[key];
    }
  }
}

/**
 * 拦截 globalThis.fetch：按 URL 路由响应（仅 STS），记录请求与请求体。
 * routeResponse(record) 可返回 { statusCode, body } 或直接返回 body（默认 200）。
 */
function installRequestInterceptor(routeResponse) {
  const records = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async function (url, init = {}) {
    const parsed = new URL(url);
    const record = {
      url: url.toString(),
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: init.method || 'GET',
      headers: init.headers || {},
      body: init.body || ''
    };
    records.push(record);

    const r = routeResponse(record);
    let statusCode = 200;
    let body = r;
    if (r && typeof r === 'object' && 'statusCode' in r) {
      statusCode = r.statusCode;
      body = r.body;
    }
    const raw = body === null || body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    return {
      status: statusCode,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => raw
    };
  };
  return {
    records,
    restore() { globalThis.fetch = origFetch; }
  };
}

/** 将 require('esdk-obs-nodejs') 重定向到 FakeObsClient。 */
function stubObsClient(Fake) {
  const modPath = require.resolve('esdk-obs-nodejs');
  require.cache[modPath] = { id: modPath, filename: modPath, loaded: true, exports: Fake };
}
function unstubObsClient() {
  delete require.cache[require.resolve('esdk-obs-nodejs')];
}

/** STS 换证响应（OIDC -> STS 返回临时凭证）。 */
function stsResponse() {
  return {
    credentials: {
      access_key_id: 'T_AK',
      secret_access_key: 'T_SK',
      security_token: 'T_TOK',
      expiration: new Date(Date.now() + 3600 * 1000).toISOString()
    }
  };
}

/** 捕获 stdout 输出（core.info 与 SDK 调试日志 console.log 均写入 stdout）。 */
async function captureOutput(fn) {
  const orig = process.stdout.write;
  const chunks = [];
  process.stdout.write = function (chunk) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };
  try {
    const result = await fn();
    return { output: chunks.join(''), result };
  } finally {
    process.stdout.write = orig;
  }
}

async function main() {
  const origExitCode = process.exitCode;
  const tmpFile = path.join(os.tmpdir(), `obs-sdk-${Date.now()}.txt`);
  fs.writeFileSync(tmpFile, 'Hello OBS via OIDC on GitHub Actions!');

  function reset(env) {
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('INPUT_')) delete process.env[k];
    }
    delete process.env.HUAWEICLOUD_OIDC_TOKEN;
    for (const k of Object.keys(env)) process.env[k] = env[k];
    obsOpts = null;
    putCalls = [];
    putResult = undefined;
    unstubObsClient();
    freshModules();
  }

  // 共享的 FakeObsClient：记录构造参数与 putObject 调用，返回 putResult
  let obsOpts = null;
  let putCalls = [];
  let putResult;
  const FakeObsClient = function (opts) { obsOpts = opts; };
  FakeObsClient.prototype.putObject = async function (params) {
    putCalls.push(params);
    return putResult;
  };
  FakeObsClient.prototype.close = async function () {};

  // ---------- 1. 全流程：读文件 -> OBS 上传 ----------
  reset({
    HUAWEICLOUD_OIDC_TOKEN: 'fake-jwt-token-for-obs-test-1',
    'INPUT_FILE-PATH': tmpFile
  });
  stubObsClient(FakeObsClient);
  putResult = {
    CommonMsg: { Status: 200, Message: 'OK' },
    InterfaceResult: { ETag: '"etag-obs"' }
  };
  const route1 = (rec) => stsResponse();
  const int1 = installRequestInterceptor(route1);
  try {
    const { run } = require('../index.js');
    const { output } = await captureOutput(() => run());
    assert.strictEqual(process.exitCode, origExitCode, '全流程成功不应置退出码');

    // 插件标题日志（步骤细节由 SDK 打印，插件不再重复）
    assert.ok(output.includes('=== obs-sdk：基于 OIDC 免认证上传 OBS（GitHub Actions） ==='), '应打印插件标题');

    // OBS 上传信息
    assert.ok(output.includes(`上传目标: openlibing-gitcode-action/obs-sdk/${path.basename(tmpFile)}`),
      '应打印上传目标（桶/对象名）');
    assert.ok(output.includes('OBS 响应: HTTP 200'), '应打印 OBS 响应状态码');
    assert.ok(output.includes('OBS 上传成功'), '应打印 OBS 上传成功日志');

    // SDK info 日志：换证关键步骤（默认非调试模式，无请求概要与定位日志）
    // GitHub 平台插件显式覆盖 oidcProviderName 为 GitHubActions，委托默认 github-actions
    // （与 openlibing-upload-reports 插件一致）
    assert.ok(output.includes('-- OIDC ID Token 获取成功：来自环境变量 HUAWEICLOUD_OIDC_TOKEN 注入 --'),
      '应打印 OIDC Token 获取成功关键步骤');
    assert.ok(output.includes('-- OIDC 免密换证开始：区域 cn-southwest-2，提供商 GitHubActions，委托 github-actions --'),
      '应打印换证开始关键步骤（提供商 GitHubActions、委托 github-actions）');
    assert.ok(output.includes('-- 临时凭证获取成功：AK'), '应打印凭证获取成功关键步骤');
    assert.ok(!output.includes('--> POST') && !output.includes('-> 200'),
      '默认非调试模式不应打印请求详情定位日志与请求概要');

    // 敏感字段脱敏
    assert.ok(!output.includes('"secret_access_key":"T_SK"'), '日志中临时 SK 不应明文出现');
    assert.ok(!output.includes('T_TOK'), '日志中 SecurityToken 不应明文出现');

    // OBS 客户端参数
    assert.strictEqual(obsOpts.access_key_id, 'T_AK');
    assert.strictEqual(obsOpts.secret_access_key, 'T_SK');
    assert.strictEqual(obsOpts.security_token, 'T_TOK', '临时凭证应携带 security_token');
    assert.strictEqual(obsOpts.server, 'https://obs.cn-southwest-2.myhuaweicloud.com', 'OBS endpoint 应自动构造');
    // putObject 参数
    assert.strictEqual(putCalls.length, 1);
    assert.strictEqual(putCalls[0].Bucket, 'openlibing-gitcode-action');
    assert.strictEqual(putCalls[0].Key, `obs-sdk/${path.basename(tmpFile)}`, '对象名应为 obs-sdk/<文件名>');
    assert.strictEqual(putCalls[0].SourceFile, tmpFile, '应上传 file-path 指定的文件');

    // 仅发生 STS 一次请求，未发起 APIG 请求
    const stsRec = int1.records[0];
    assert.ok(stsRec.hostname.startsWith('sts.cn-southwest-2'), '唯一请求应发往 STS 换证');
    assert.strictEqual(int1.records.length, 1, 'OBS 测试不应发起 APIG 请求');
    console.log('PASS 1: 全流程 读文件 -> OBS 上传 成功，换证使用 GitHubActions 提供商，OBS/STS 请求响应日志完整且脱敏');
  } finally {
    int1.restore();
    process.exitCode = origExitCode;
  }

  // ---------- 1b. debug 输入生效：workflow 传 debug: true 时打印定位日志 ----------
  reset({
    HUAWEICLOUD_OIDC_TOKEN: 'fake-jwt-token-for-obs-test-1b',
    'INPUT_FILE-PATH': tmpFile,
    INPUT_DEBUG: 'true'
  });
  stubObsClient(FakeObsClient);
  putResult = {
    CommonMsg: { Status: 200, Message: 'OK' },
    InterfaceResult: { ETag: '"etag-obs"' }
  };
  const int1b = installRequestInterceptor(() => stsResponse());
  try {
    const { run } = require('../index.js');
    const { output } = await captureOutput(() => run());
    assert.ok(output.includes('--> POST'), 'debug: true 时应打印请求定位日志（--> POST）');
    assert.ok(output.includes('<-- HTTP 状态码'), 'debug: true 时应打印响应定位日志');
    assert.ok(output.includes('OBS 上传成功'), 'debug 模式全流程仍应成功');
    console.log('PASS 1b: debug 输入生效，打印请求/响应定位日志');
  } finally {
    int1b.restore();
    process.exitCode = origExitCode;
  }

  // ---------- 2. 文件缺失校验 ----------
  reset({
    HUAWEICLOUD_OIDC_TOKEN: 'fake-jwt-token-for-obs-test-2',
    'INPUT_FILE-PATH': path.join(os.tmpdir(), 'not-exist-file.txt')
  });
  stubObsClient(FakeObsClient);
  try {
    const { run } = require('../index.js');
    await captureOutput(() => run());
    assert.strictEqual(process.exitCode, 1, '文件缺失应置退出码 1');
    assert.strictEqual(putCalls.length, 0, '文件缺失不应调用 putObject');
    console.log('PASS 2: 文件缺失校验，file-path 不存在置退出码 1，不调用 putObject');
  } finally {
    process.exitCode = origExitCode;
  }

  // ---------- 3. OBS 失败分支 ----------
  reset({
    HUAWEICLOUD_OIDC_TOKEN: 'fake-jwt-token-for-obs-test-3',
    'INPUT_FILE-PATH': tmpFile
  });
  stubObsClient(FakeObsClient);
  putResult = { CommonMsg: { Status: 403, Code: 'AccessDenied', Message: 'forbidden' } };
  const route3 = (rec) => stsResponse();
  const int3 = installRequestInterceptor(route3);
  try {
    const { run } = require('../index.js');
    await captureOutput(() => run());
    assert.strictEqual(process.exitCode, 1, 'OBS 上传失败应置退出码 1');
    console.log('PASS 3: OBS 失败分支，putObject 非 2xx 置退出码 1');
  } finally {
    int3.restore();
    process.exitCode = origExitCode;
  }

  try { fs.unlinkSync(tmpFile); } catch (e) { /* ignore */ }
  console.log('\nALL TESTS PASSED');
}

main().catch((e) => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
