# TS-JMcomic-Bot

TeamSpeak 漫画下载机器人。以普通客户端身份进入频道，接收频道指令，把 JM 漫画下载、还原并合成为 PDF 后放进 TeamSpeak 文件目录。

> 本项目只负责下载和整理，不提供漫画源站，也不内置代理或订阅。

## 功能

- 在 TeamSpeak 频道里发送 `!jm <本子ID|链接>` 下载整本漫画
- 支持话数范围：`!jm 350234 1-5`、`!jm 350234 3-8,10`
- 自动还原禁漫的条带切割图片，按章节顺序合成一个 PDF
- 已下载过的本子会记录在本地清单，不重复下载、不重复发送
- 可选直接写入 TeamSpeak 服务端文件目录，绕过客户端上传配额
- 本地网页面板：TeamSpeak 连接、下载代理、漫画 API 域名
- 下载代理只作用于漫画请求，不影响 TeamSpeak 连接

## 环境要求

- Windows 10/11 或 Windows Server
- Node.js **20.19 或更高**（推荐 22 LTS）
- 一个可用的 TeamSpeak 3 / TeamSpeak 6 服务器
- 可选：Clash Verge 或其他 HTTP / SOCKS5 代理；能直连漫画站就不需要
- 可选：如果要用“直接复制到 TS 文件目录”，机器人需要能访问 TeamSpeak 服务端的 `files` 目录

首次启动会自动生成客户端身份文件和本地配置，不需要手动准备。

## 快速开始

1. 安装 Node.js 22 LTS。
2. 下载整个.zip，完全解压。
3. 双击 `scripts\setup.bat`，安装依赖并构建。
4. 双击 `start.bat`，打开面板 <http://127.0.0.1:3000>。
5. 在面板填写 TeamSpeak 地址、端口、昵称、频道。
6. 如果下载需要代理，填写 Clash Verge 的 HTTP 或 SOCKS5 端口，点「测试代理」。
7. 在 TeamSpeak 频道发送例如： `!jm 350234`。

不上传文件、只把 PDF 写进服务端目录时，在面板「TeamSpeak 连接」填写上传目录，例如：

```text
C:/teamspeak6-server-win-x64/files/virtualserver_1/channel_22
```

也可以使用占位符：

```text
C:/teamspeak6-server-win-x64/files/virtualserver_1/{channelDir}
```

## 指令

| 指令 | 说明 |
| --- | --- |
| `!jm <本子ID\|链接> [话数范围]` | 下载并生成 `<本子ID>.pdf` |
| `!jm <本子ID> --force` | 忽略已下载记录，重新下载 |
| `!jm <本子ID> --send` | 不重新下载，把本地 PDF 再发送一次 |
| `!status` | 查看连接和代理状态 |
| `!move <频道名>` | 把机器人移到指定频道 |
| `!ping` / `!help` | 测试与帮助 |

PDF 默认保存在：

```text
downloads/JM<本子ID>/<本子ID>.pdf
```

## 注意点

### 权限

机器人是普通 TeamSpeak 客户端，频道移动和文件上传都受服务器权限控制：

- 移动频道需要机器人所在服务器组有足够的 `i_client_move_power`
- 目标频道的加入权限不能高于机器人的移动权限
- 上传文件需要文件传输权限和上传配额；配额不足会报 2069
- 不想处理上传权限时，可以让机器人直接写 TeamSpeak 服务端的 `files` 目录，但机器人进程必须对该目录有写权限

权限不足不是程序能自动绕过的，需要服务器管理员给机器人所在组授权。

### 初始频道

启动后机器人进入 TeamSpeak 服务器默认频道；面板里的默认频道配置并不可靠生效。目前**无法稳定指定机器人启动时进入哪个频道**，这是已知限制。

### 下载与文件

- 下载过程没有稳定的实时进度提示（见下方“已知缺点”）
- 漫画图片会先还原再写入 PDF，下载和合成需要一些时间
- PDF 体积过大时，可以调低 `config.json` 里的 `comic.jpegQuality`（默认 85）
- 已下载清单在 `data/downloaded.json`，删掉它不会删除 PDF，但会失去“曾经下载过”的判断
- `data/identity.txt` 是本地客户端身份，属于隐私文件，不要提交到 Git 或发给别人

## 已知缺点

### 1. 下载反馈没有提示

目前下载过程的反馈不稳定：频道里可能只看到开始或结束，甚至没有提示；没有进度条，也没有“第几页 / 第几话”的实时进度。

如果您有能力修改代码，可以从这几个位置入手：

- `src/index.ts` 的 `!jm` 处理逻辑：在开始下载、每章完成、PDF 生成完成、复制完成时调用 `client.reply(...)`
- `src/ts/bot.ts` 的 `reply()`：负责把消息发到当前频道，可在这里加发送失败日志
- `src/comic/jm.ts` 的下载循环：可以增加进度回调，把当前章节/页数传回入口后再发频道消息

最简单的修法是先在 `!jm` 开始处和完成处各加一条 `client.reply`，确认消息能到频道；再做章节级进度。

### 2. 频道移动和上传权限受限(未解决，没搞明白，手动拉一下频道)

`!move` 和上传文件依赖 TeamSpeak 服务器权限，目前只做了错误提示，没有自动授权或自动绕过：

- `!move` 失败通常是 `i_client_move_power` 或目标频道加入权限不足
- 上传失败通常是文件传输权限或 `i_ft_quota_mb_upload_per_client` 配额不足
- 机器人启动时无法稳定选用指定初始频道

这部分需要服务器管理员配合设置权限，或在同机部署时使用“直接写 TS 文件目录”的方式。

## 数据与备份

升级或重装前，建议备份：

```text
config.json
data/identity.txt
data/downloaded.json
downloads/
```

不要随意删除 `data/identity.txt`，否则机器人会变成一个新客户端；`downloads/` 里是已经生成的 PDF。

## 参考

- [ZHANGTIANYAO1/teamspeak-music-bot](https://github.com/ZHANGTIANYAO1/teamspeak-music-bot)：TeamSpeak 客户端机器人的整体思路
- [hect0x7/JMComic-Crawler-Python](https://github.com/hect0x7/JMComic-Crawler-Python)：JM 漫画接口、图片还原与下载逻辑参考
