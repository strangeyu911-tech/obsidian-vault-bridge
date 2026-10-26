# obsidian-vault-bridge

让 AI 助手读写你的 Obsidian 笔记库 —— **不用手填路径**，装好就能用。

它是 [obsidian-mcp](https://github.com/StevenStavrakis/obsidian-mcp) 的启动适配层。
真正的笔记读写能力全部来自上游；本包只解决一个问题：**库在哪**。

## 为什么需要它

`obsidian-mcp` 只接受命令行参数指定库：

```
obsidian-mcp serve --vault notes=/absolute/path/to/vault
```

它不读环境变量。而 MCP 连接器的表单只能把用户填的值注入 `env`，塞不进命令行参数。
于是每个人库路径不同这件事，就卡死了开箱即用。

本包负责：自动找到你机器上的 Obsidian 库 → 生成合法参数 → 启动上游，stdio 原样透传。

## 库是怎么找的

1. 环境变量 `OBSIDIAN_VAULT_PATH` 优先（多个库用 `;` 分隔）；
2. 没设就读 Obsidian 自己的库注册表：
   - Windows：`%APPDATA%\obsidian\obsidian.json`
   - macOS：`~/Library/Application Support/obsidian/obsidian.json`
   - Linux：`~/.config/obsidian/obsidian.json`

只要你在 Obsidian 里打开过库，它就被登记在注册表里，本包能直接找到，一个字都不用填。

## 用法

作为 MCP server（由客户端拉起，不用手动跑）：

```bash
npx -y obsidian-vault-bridge
```

配置示例：

```json
{
  "mcpServers": {
    "obsidian": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "obsidian-vault-bridge"],
      "runtime": { "type": "node", "version": "22" }
    }
  }
}
```

显式指定库（可选）：

```json
"env": {
  "OBSIDIAN_VAULT_PATH": "D:\\Obsidian-Vault",
  "OBSIDIAN_VAULT_IDS": "notes"
}
```

看诊断信息（会打印找到了哪些库，不启动服务）：

```bash
npx -y obsidian-vault-bridge --doctor
```

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `OBSIDIAN_VAULT_PATH` | 库绝对路径，多个用 `;` 分隔。不设则自动探测 |
| `OBSIDIAN_VAULT_IDS` | 自定义库 id，逗号分隔，与上面一一对应。不设则按目录名自动生成 |

## 能力与边界

上游提供 12 个工具：列库、读笔记、新建、编辑、删除、移动、建目录、搜索、加标签、删标签、改标签、统一管理标签。

- 直接读写 Markdown 文件，**不需要 Obsidian 保持运行**
- 写操作带事务日志，删除默认进 `.obsidian-mcp/trash` 可恢复
- 编辑可用 etag 做并发冲突检测

## 许可

本包：MIT，Copyright (c) 2026 Strange Leo。
上游 `obsidian-mcp`：MIT，Copyright (c) 2024 Steven Stavrakis —— 见 LICENSE 末段。
