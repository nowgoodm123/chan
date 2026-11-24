# 测试指南

测试使用 Node.js 内置的 `node:test`，完全离线，不需要 API Key、不需要安装依赖。

```bash
npm test          # 运行全部测试
npm run test:watch
npm run lint      # 语法检查 + 入口/文档完整性
node --test test/tools.test.js
```

## 覆盖范围

| 文件 | 内容 |
| --- | --- |
| `test/config.test.js` | 默认值、深度合并、环境变量覆盖、项目配置、预设解析、密钥打码、`config set`、初始化 |
| `test/tools.test.js` | 读写编辑、行号、offset、路径越界、glob、grep、bash 退出码、危险命令、todo、webfetch |
| `test/providers.test.js` | OpenAI/Anthropic SSE 分片、工具调用聚合、usage、错误提示、消息转换、Provider 校验 |
| `test/agent.test.js` | 文本流、工具执行与回填、失败工具、未知工具、非法 JSON、循环检测、步数上限、错误传播 |
| `test/sessions.test.js` | 增删改查、工作区隔离、非法 id、图片 data URL 剥离与回填 |
| `test/palette.test.js` | 斜杠命令列表、渲染与补全 |
| `test/mcp.test.js` | MCP stdio/HTTP 连接、工具发现与调用、失败隔离、Session 头、SSE 响应 |
| `test/permissions.test.js` | 通配匹配、最后规则生效、`.env` 默认规则、工具资源映射、保存规则 |
| `test/skills.test.js` | frontmatter（含 BOM）、SKILL.md 发现、隐藏技能、skill 工具 |
| `test/commands.test.js` | 命令发现与命名空间、参数替换、追加规则、shell 插值 |
| `test/agents.test.js` | 内置/自定义 Agent、工具白名单、子 Agent 运行、嵌套限制 |
| `test/server.test.js` | 健康检查、配置、会话 CRUD、SSE 聊天、输入校验、上传、静态资源、Token 鉴权、审批接口、扩展端点、MCP 工具调用、fork/export/compact、自定义命令展开 |

## 测试技巧

### 模拟 Provider

`test/server.test.js` 展示了如何注入假 Provider：

```js
const server = new ChanServer({
  cwd,
  config,
  providerFactory: () => ({
    name: 'fake',
    model: 'fake-1',
    async *stream({ messages }) {
      yield { type: 'text-delta', text: 'Hello' };
      yield { type: 'done', stopReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } };
    },
  }),
});
```

### 模拟 SSE

`test/providers.test.js` 中的 `sseResponse()` 把字符串片段包装成 `Response`，可以精确测试跨分片的事件解析：

```js
const stream = new ReadableStream({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
    controller.close();
  },
});
return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
```

### 隔离文件系统

所有文件相关测试使用 `fs.mkdtempSync(path.join(os.tmpdir(), 'chan-...'))`，不会污染仓库。需要配置文件时用 `CHAN_HOME` 指向临时目录。

### 测试 CLI

```bash
$env:CHAN_HOME="C:\Temp\chan-test"; node bin/chan.js models
CHAN_HOME=/tmp/chan-test node bin/chan.js tools
```

## 新增测试的约定

- 一个行为一个 `test()`，名字描述行为而不是函数名；
- 涉及网络的逻辑一律 mock `fetch`，测试必须离线可跑；
- 涉及磁盘的必须清理（`t.after` 或临时目录）；
- 断言优先检查用户可见行为（输出文本、HTTP 状态、事件类型），少依赖内部实现细节。

## 持续集成建议

```yaml
# .github/workflows/test.yml 示例
name: test
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        node: [18, 20, 22]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: ${{ matrix.node }} }
      - run: npm test
      - run: npm run lint
```
