'use strict';

/**
 * obs-sdk：@openlibing/huaweicloud-oidc-client SDK 的 OBS 上传测试（GitHub Actions 流水线插件）。
 *
 * 核心用法即下方三步：configure() 应用配置（与 openlibing-upload-reports 相同参数并固定
 * debug: true：GitHubActions 提供商 + github-actions 委托）-> getCredentials() OIDC 免密换证
 * （SDK 打印关键步骤与请求/响应定位日志，敏感字段自动脱敏）-> 临时凭证交给 OBS SDK
 * （esdk-obs-nodejs）putObject 上传。
 * 输入 file-path 为待上传文件，上传到桶 op-case-result 的 obs-sdk/<文件名>。
 */

const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
// 顶层静态 require，ncc 打包时将 OBS SDK 与 SDK 包一并内联进 dist
const ObsClient = require('esdk-obs-nodejs');
const { getCredentials, configure } = require('@openlibing/huaweicloud-oidc-client');

const BUCKET = 'op-case-result'; // openlibing 账号固定 OBS 桶

// 模块顶层应用配置，与 openlibing-upload-reports 相同的 configure 参数，额外固定开启 debug：
// 本插件运行在 GitHub Actions，覆盖 SDK 默认的 GitCodeActions 提供商（提供商与委托固定，不支持修改）
const cfg = configure({
  oidcProviderName: 'GitHubActions',
  agencyName: 'github-actions',
  debug: true
});

async function run() {
  try {
    core.info('=== obs-sdk：基于 OIDC 免认证上传 OBS（GitHub Actions） ===');

    // 读取并校验待上传文件（action 输入 file-path，必填）
    const filePath = core.getInput('file-path', { required: true });
    if (!fs.existsSync(filePath)) {
      throw new Error(`file-path 指向的文件不存在: ${filePath}`);
    }
    const fileSize = fs.statSync(filePath).size;
    const objectKey = `obs-sdk/${path.basename(filePath)}`;
    core.info(`上传目标: ${BUCKET}/${objectKey}（${fileSize} 字节，来源 ${filePath}）`);

    // OIDC 免密换证（SDK 默认打印换证开始/成功关键信息，敏感字段脱敏）
    const cred = await getCredentials();

    // 临时凭证上传 OBS（esdk-obs-nodejs），凭证脱敏打印已由 SDK getCredentials 完成
    const server = `https://obs.${cfg.region}.myhuaweicloud.com`;
    core.info(`OBS 客户端: server=${server}`);
    const client = new ObsClient({
      access_key_id: cred.accessKeyId,
      secret_access_key: cred.secretAccessKey,
      security_token: cred.securityToken,
      server
    });
    const result = await client.putObject({ Bucket: BUCKET, Key: objectKey, SourceFile: filePath });
    await client.close();

    const msg = (result && result.CommonMsg) || {};
    core.info(`OBS 响应: HTTP ${msg.Status}${msg.RequestId ? `, RequestId: ${msg.RequestId}` : ''}`);
    if (!(msg.Status >= 200 && msg.Status < 300)) {
      throw new Error(`OBS upload failed (${msg.Status})${msg.Code ? ' [' + msg.Code + ']' : ''}: ${msg.Message || '未知错误'}`);
    }
    core.info(`OBS 上传成功！ETag: ${result.InterfaceResult && result.InterfaceResult.ETag}`);
    core.info('obs-sdk 执行成功！');
  } catch (error) {
    core.setFailed(error.message);
  }
}

module.exports = { run };

if (require.main === module) {
  run();
}
