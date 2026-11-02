# TS-JMcomic-Bot 设计（外置 Clash Verge 版）

## 1. 目标

1. 以普通客户端身份常驻 TeamSpeak 频道（用户列表可见），收发文字指令。
2. `!jm <本子ID|链接> [话数范围]` 下载漫画，合并为 PDF（`<本子ID>.pdf`），上传到当前频道文件区。
3. 下载请求可走本机 Clash Verge 的 HTTP/SOCKS5 端口；TeamSpeak 连接与系统网络不经过机器人。
4. Windows 上双击启动，面板管理 TS 与下载代理。

## 2. 明确不做

- 机场订阅管理
- 节点解析与选择
- 内置 mihomo 内核 / 端口 / 进程管理
- 梯子功能整体移除，由用户自己的 Clash Verge 负责科学上网

## 3. 技术选型

| 层 | 选择 |
| --- | --- |
| 运行时 | Node.js 20.19+ |
| 语言 | TypeScript + NodeNext |
| TS 协议 | `@honeybbq/teamspeak-client`（真实客户端协议，频道可见，支持文件上传） |
| Web | Express + 原生 HTML |
| 下载代理 | `https-proxy-agent` / `socks-proxy-agent`，按请求注入 |
| 图片 | `sharp`（WebP/JPEG 解码、条带还原） |
| PDF | `pdfkit`（逐页写入，不整本堆内存） |
| 漫画接口 | 禁漫移动端 API（token + AES-256-ECB），参考 JMComic-Crawler-Python |

## 4. 目录

```
src/
  index.ts          启动、指令分发、退出
  config.ts         ts / panel / proxy / comic
  ts/bot.ts         连接、重连、文字事件、上传、移动频道
  proxy/agents.ts   agentFor / probeProxy
  comic/jm.ts       移动端 API、条带还原、PDF 写出
  panel/server.ts   /api/state、/api/proxy、/api/proxy/test、/api/comic、/api/comic/test、/api/ts、/api/quit
public/index.html
scripts/setup.bat | start.bat
```

## 5. 数据流

### 启动
1. 读 `config.json`，创建 `data/`、`downloads/`、`logs/`。
2. 启动面板（127.0.0.1:3000）。
3. `TsBot.start()`：读/生成 identity → 连接 `host:port` → 加入默认频道。

### 下载
```
!jm → /album?id= → series 章节
    → /chapter?id= → images + /chapter_view_template → scramble_id
    → 图片 CDN（cdn-msp.*）
    → fetch（走 config.proxy 的 agent）
    → 条带还原（sharp）
    → PDF 逐页写入 downloads/JM<id>/<id>.pdf
    → client.fileTransferInitUpload + uploadFileData
    → 频道回复完成/失败
```

### 代理作用域
- `agentFor(config.proxy)` 只传给漫画下载请求。
- TeamSpeak 客户端、面板请求不使用该 agent。
- Clash Verge 未启动时，漫画请求自动回退直连；直连失败会明确报错，不影响 TS 在线。

## 6. 与旧版差异

| 能力 | 之前 | 现在 |
| --- | --- | --- |
| 代理 | 内置机场订阅 + mihomo | 外置 Clash Verge，只填端口 |
| 面板 | TS + 订阅 + 节点 + 内核 | TS + 下载代理 |
| 进程 | 需要清理 mihomo | 无子进程 |
| 下载产物 | zip / PDF | PDF |

## 7. 里程碑

1. **M1（完成）**：项目骨架、客户端连接、指令、上传、面板、Windows 启动脚本。
2. **M2（完成）**：移动端 API 下载、条带还原、PDF 合并、代理下载；真实下载 JM350234 两话 50 页并生成 350234.pdf 验证通过。
3. **M3（完成）**：移除机场订阅/节点/mihomo，改为外置 Clash Verge 代理。
4. **待验证**：真实 TS 频道上传、Clash Verge 实际端口。

## 8. 风险

- 禁漫 API 域名和 token 密钥会变；面板可改域名，密钥变化需要更新代码。
- 图片 CDN 域名可能变化；当前按列表轮询。
- 文件上传需要机器人频道权限。
- 真实 TS6 服务端兼容性未测。
- 面板无鉴权，仅绑 127.0.0.1。
- Clash Verge 端口被用户改过时，需要在面板同步修改。
