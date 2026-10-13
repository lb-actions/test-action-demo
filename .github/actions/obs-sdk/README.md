# obs-sdk：@openlibing/huaweicloud-oidc-client SDK 的 OBS 上传测试（GitHub Actions 本地自定义 Action）

`obs-sdk` 是基于 `@openlibing/huaweicloud-oidc-client` SDK 的本地自定义 Action（位于 `.github/actions/obs-sdk`，通过 `uses: ./.github/actions/obs-sdk` 引用），用于在 GitHub Actions 流水线中基于 OIDC 免认证上传 OBS：

- **OIDC 免认证上传 OBS**：SDK `getCredentials()` 用 GitHub Actions 签发的 OIDC ID Token 换取华为云临时凭证 -> `esdk-obs-nodejs` 的 `putObject()` 上传文件。

整个链路零 Secret 引用，仅需 workflow 声明 `permissions: id-token: write`。

## 输入

| 输入        | 必填 | 说明                               |
| ----------- | ---- | ---------------------------------- |
| `file-path` | 是   | 待上传文件的路径，如 `./README.md` |

其余参数使用内置默认值（不支持修改）：

- OBS 桶：`op-case-result`
- 对象名：`obs-sdk/<文件名>`（取自 `file-path` 的文件名）
- OIDC 提供商：`GitHubActions`、委托：`github-actions`（插件内写死，与 openlibing-upload-reports 插件一致）
- 换证其余参数：SDK 内置 openlibing 账号默认值（区域 `cn-southwest-2` 等）

## 华为云侧前置配置

在 GitHub Actions 上使用本插件前，需确认 openlibing 华为云账号侧：

1. IAM 身份提供商已注册 GitHub OIDC（颁发者 `https://token.actions.githubusercontent.com`，客户端 ID 与 SDK `audience`（`huawei-cloud-service`）一致），名称为 `GitHubActions`；
2. 信任委托 `github-actions` 的信任策略已放行 GitHub 签发的 OIDC 令牌（`oidc:iss` / `oidc:aud` / `oidc:sub` 条件匹配目标 GitHub 仓库与 workflow）；
3. 委托拥有目标 OBS 桶 `op-case-result` 的上传权限（桶与凭证区域需一致，否则 OBS 会返回 403 AccessDenied）。

若未配置，换证会返回 STS5.1001/403，SDK 会以 `[ERROR]` 级打印 OIDC Token 的 iss/aud/azp/sub 声明供与信任策略逐项比对。

## 日志

obs-sdk 只打印插件标题与上传信息；换证关键步骤由 SDK info 级打印，插件 configure 固定 `debug: true`，SDK 会额外打印每次 HTTP 请求/响应的完整定位日志（敏感字段自动脱敏）：

```text
=== obs-sdk：基于 OIDC 免认证上传 OBS（GitHub Actions） ===
上传目标: op-case-result/obs-sdk/<文件名>（N 字节，来源 ./README.md）
-- OIDC ID Token 申请成功（Actions 兼容流水线 OIDC 接口）--   ← SDK info
-- OIDC 免密换证开始：区域 cn-southwest-2，提供商 GitHubActions，委托 github-actions --   ← SDK info
-- 临时凭证获取成功：AK N1xg***abcd，有效期约 3600 秒 --   ← SDK info
OBS 客户端: server=https://obs.cn-southwest-2.myhuaweicloud.com
OBS 响应: HTTP 200, RequestId: ...
OBS 上传成功！ETag: ...
```

说明：SDK 实际输出每行均带 `[INFO]` / `[DEBUG]` / `[ERROR]` 前缀与 ISO 8601 UTC 时间戳，示例中为突出关键信息而省略。

脱敏规则：`Authorization`、`X-Security-Token`、`id_token`、临时 AK/SK/SecurityToken 及 JWT 令牌仅保留首尾若干字符；其余非敏感信息（URL、请求参数、状态码、响应头、响应体）原样输出。

## 使用（workflow）

```yaml
permissions:
  id-token: write
  contents: read

jobs:
  test-obs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: 运行 obs-sdk（OIDC 上传 OBS）
        uses: ./.github/actions/obs-sdk
        with:
          file-path: ./README.md
```

## 本地开发

SDK 以 npm 包 `@openlibing/huaweicloud-oidc-client` 引入（`package.json` 中 `"^0.0.6"`）：

```bash
cd .github/actions/obs-sdk

npm install     # 安装 @actions/core / SDK / esdk-obs-nodejs
npm test        # 运行测试（拦截 STS 请求 + 注入 FakeObsClient）
npm run build   # 使用 ncc 将 SDK 包与 esdk-obs-nodejs 内联进 dist/
```

注意：GitHub/GitCode Actions runner 不执行 `npm install`，`dist/` 需随代码提交；SDK 版本升级后更新 `package.json` 依赖版本并重新 `npm install && npm run build` 提交 dist。
