# test-result-display

<!-- 从测试结果 JSON 生成 Markdown 汇总表格，写入流水线步骤摘要。支持多文件合并与上次结果对比。 -->

## 核心特性（Features）

- **测试结果汇总**：读取测试结果 JSON，生成 Markdown 汇总表格，写入流水线步骤摘要（`$ATOMGIT_STEP_SUMMARY`，未设置时回退输出到控制台）。
- **多文件合并**：支持 `json-file` 传入多个测试结果文件（换行分隔），自动合并展示。
- **上次结果对比**：通过 `last-json` 传入上次测试结果，额外展示「重试结果」列，用例按失败优先排序。
- **用例结果列自适应**：仅当 `resultDownloadUrl` 以 `https://` 或 `http://` 开头时才展示「用例结果」列；本地路径、空值等无法作为下载链接的值不展示该列。
- **来源前缀标注**：支持 `SourceTask:/path/to/file.json` 前缀格式，在汇总表中标注各用例所属来源任务。
- **注入防护**：所有单元格内容均做 Markdown 转义，防止注入。

测试结果展示示例 [workflow](https://gitcode.com/openlibing/test-action/blob/master/workflow-example/Case-run-test.yml)

## 快速上手（Quick Start）

### 前置条件

- 已有一个 AtomGit 仓库，且已启用 GitCode Actions。

### 步骤

**1. 创建工作流文件**

在仓库根目录下创建 `.gitcode/workflows/test-result.yml`：

**2. 添加步骤**

先使用 `actions/checkout@v4` 检出代码，再调用本插件：

```yaml
name: test-result-demo

on:
  push:
    branches: [master]

jobs:
  display:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Display results
        uses: openlibing/test-action/test-result-display@v1.0.2
        with:
          json-file: ${{ steps.orch.outputs.testcase-file }}
```

**3. 提交并触发**

将 `.gitcode/workflows/test-result.yml` 提交到仓库，推送到 `master` 分支即可触发流水线，在步骤摘要中查看测试结果汇总表。

### 更多示例

**单文件展示：**

```yaml
- name: Display results
  uses: openlibing/test-action/test-result-display@v1.0.2
  with:
    json-file: ${{ steps.orch.outputs.testcase-file }}
```

**多文件带来源前缀 + 上次结果对比：**

```yaml
- name: Display results with comparison
  uses: openlibing/test-action/test-result-display@v1.0.2
  with:
    json-file: |
      SmokeTask:smoke-results.json
      FullTask:full-results.json
    last-json: last-passed-results.json
```

## 输入参数（Inputs）

| 参数        | 必填 | 默认值 | 说明                                                                                                |
| ----------- | :--: | ------ | --------------------------------------------------------------------------------------------------- |
| `json-file` |  是  | -      | 测试结果 JSON 路径，**多文件换行分隔**；支持 `SourceTask:/path/to/file.json` 前缀格式以标注来源任务 |
| `last-json` |  否  | -      | 上次测试结果 JSON（仅取 `passed` 用例用于对比），多文件换行分隔                                     |

## 输出参数（Outputs）

| 参数               | 类型   | 说明                                     |
| ------------------ | ------ | ---------------------------------------- |
| `total-cases`      | number | 用例总数                                 |
| `passed-cases`     | number | 通过用例数                               |
| `not-passed-cases` | number | 未通过用例数（失败、跳过、错误、未知等） |

## 如何使用输出参数

在后续步骤中通过 `steps.<step-id>.outputs.<参数名>` 引用：

```yaml
- name: Display results
  id: display
  uses: openlibing/test-action/test-result-display@v1.0.2
  with:
    json-file: ${{ steps.orch.outputs.testcase-file }}

- name: Use outputs
  run: |
    echo "Total cases: ${{ steps.display.outputs.total-cases }}"
    echo "Passed cases: ${{ steps.display.outputs.passed-cases }}"
    echo "Not passed cases: ${{ steps.display.outputs.not-passed-cases }}"
```

## 使用约束

- **运行时**：`node16`
- **环境变量**：`ATOMGIT_*` 前缀，上下文使用 `atomgit.*`，摘要写入 `$ATOMGIT_STEP_SUMMARY`
- **工作流目录**：`.gitcode/workflows/`
- **uses 路径**：`openlibing/test-action/test-result-display@<tag>`，示例统一使用 `@v1.0.2`
- 提供 `last-json` 时额外展示「重试结果」列，用例按失败优先排序
- `resultDownloadUrl` 均不以 `https://` 或 `http://` 开头时不展示「用例结果」列
- 所有单元格内容均做 Markdown 转义，防止注入

## JSON 结构要求

输入 JSON 顶层须含 `testCasesResult` 数组，每个用例对象可包含以下字段：

| 字段                    | 用途                                                           |
| ----------------------- | -------------------------------------------------------------- |
| `number`                | 用例名称/编号                                                  |
| `state`                 | 执行状态（`passed` 视为通过，其余计入未通过）                  |
| `beginTime` / `endTime` | 起止时间戳（毫秒），用于计算耗时                               |
| `resultDownloadUrl`     | 结果下载链接（仅以 `http`/`https` 开头时才展示「用例结果」列） |

## 信任边界（Security Notes）

- 本 action 是 CI 质量信号的**展示终端**：对输入 JSON 中声明的 `state`、`sourceTask` 等内容如实展示，不验证其真实性。
- `state` 仅识别枚举值 `passed / failed / skipped / error / unknown`：只有字面值 `passed` 计为通过；其他值（含伪造或拼写变体，如 `PASSED`、`pass`）一律归一化为 `unknown` 计入未通过，并在日志中告警。
- `json-file` / `last-json` **必须**指向由受信任上游步骤（如本仓 `pytest-orch` 的 `testcase-file` 输出）产出的测试结果 JSON。禁止将 PR/fork 贡献者可控、未经验证的内容作为输入——否则 CI 通过率与来源归因信号可被伪造。

## 上下游串联

上游结果 JSON 通常由 `pytest-orch` 插件的 `testcase-file` 输出产出：

```yaml
- name: Run tests
  id: orch
  uses: openlibing/test-action/pytest-orch@v1.0.2
  with:
    # ... pytest-orch 参数

- name: Display results
  uses: openlibing/test-action/test-result-display@v1.0.2
  with:
    json-file: ${{ steps.orch.outputs.testcase-file }}
```

## 贡献与本地调试

### 环境要求

- Node.js 16.x
- npm

### 本地调试

```bash
# 克隆仓库
git clone https://gitcode.com/openlibing/test-action.git
cd test-action/test-result-display

# 安装依赖
npm install

# 本地运行（需要准备测试 JSON 文件）
node index.js
```

### 提交贡献

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/your-feature`）
3. 提交更改（`git commit -am 'Add your feature'`）
4. 推送到分支（`git push origin feature/your-feature`）
5. 创建 Pull Request

## 开源协议（License）

本项目采用 [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) 开源协议。
