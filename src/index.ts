import { ensureDirs, loadConfig } from "./config.js";
import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.js";
import { JmDownloader, parseAlbumId, parseRange } from "./comic/jm.js";
import { existingPdf } from "./comic/cache.js";
import { DownloadCatalog } from "./comic/catalog.js";
import { TsBot } from "./ts/bot.js";
import { createPanel } from "./panel/server.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const root = fs.existsSync(path.join(moduleDir, "package.json"))
  ? moduleDir
  : path.dirname(moduleDir);
process.chdir(root);

// 部分漫画站点在 IPv6 上不稳定；优先 IPv4，失败仍会回退 IPv6。
dns.setDefaultResultOrder("ipv4first");
const config = loadConfig();
ensureDirs(config);
log.info(`工作目录：${root}`);

const bot = new TsBot(config);
const downloader = new JmDownloader(config);
const catalog = new DownloadCatalog();
let downloading = false;

bot.onCommand(async (client, command) => {
  const text = command.message;
  const [head, ...rest] = text.slice(1).split(/\s+/);
  const name = (head ?? "").toLowerCase();
  const args = rest.join(" ");

  try {
    switch (name) {
      case "ping":
        await client.reply(command, "pong");
        break;
      case "help":
        await client.reply(
          command,
          "指令：!jm <本子ID|链接> [话数范围] [--force|--send] / !status / !move <频道名> / !ping / !help",
        );
        break;
      case "jm": {
        if (!args) {
          await client.reply(command, "用法：!jm <本子ID|链接> [话数范围] [--force|--send]");
          break;
        }
        if (downloading) {
          await client.reply(command, "正在下载另一本，完成后再试");
          break;
        }
        try {
          const force = /(?:^|\s)--force(?:\s|$)/.test(args);
          const send = /(?:^|\s)--send(?:\s|$)/.test(args);
          const cleaned = args
            .replace(/(?:^|\s)--(?:force|send)(?=\s|$)/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          const [albumArg, rangeArg] = cleaned.split(/\s+/);
          if (!albumArg) {
            await client.reply(command, "用法：!jm <本子ID|链接> [话数范围] [--force|--send]");
            break;
          }
          const albumId = parseAlbumId(albumArg);
          const range = parseRange(rangeArg);
          const cached = range.size === 0 ? existingPdf(config, albumId) : null;
          const record = catalog.get(albumId);

          if (send) {
            if (!cached) {
              await client.reply(command, `本地没有 JM${albumId}.pdf，无法发送`);
              break;
            }
            if (!record) {
              catalog.add({
                albumId,
                title: `JM${albumId}`,
                pages: 0,
                chapters: 0,
                pdf: cached,
                downloadedAt: new Date().toISOString(),
              });
            }
            downloading = true;
            try {
              const mode = await client.upload(cached, `/${path.basename(cached)}`);
              catalog.markDelivered(albumId, mode);
              await client.reply(command, "已完成");
            } catch (error) {
              await client.reply(
                command,
                `发送失败：${error instanceof Error ? error.message : String(error)}`,
              );
            } finally {
              downloading = false;
            }
            break;
          }

          if (!force && range.size === 0 && cached) {
            if (!record) {
              catalog.add({
                albumId,
                title: `JM${albumId}`,
                pages: 0,
                chapters: 0,
                pdf: cached,
                downloadedAt: new Date().toISOString(),
              });
            }
            await client.reply(command, `曾下载过，请在文件夹中寻找`);
            break;
          }
          if (record && !cached) {
            catalog.remove(albumId);
          }

          downloading = true;
          let pdfPath = "";
          try {
            await client.reply(command, "正在下载");
            const result = await downloader.download(albumId, range);
            pdfPath = result.files[0] ?? "";
            catalog.add({
              albumId: result.album.id,
              title: result.album.title,
              pages: result.pages,
              chapters: result.chapters,
              pdf: pdfPath,
              downloadedAt: new Date().toISOString(),
            });
            const modes: Array<"direct" | "client"> = [];
            for (const file of result.files) {
              modes.push(await client.upload(file, `/${path.basename(file)}`));
            }
            const mode: "direct" | "client" = modes.includes("client") ? "client" : "direct";
            catalog.markDelivered(result.album.id, mode);
            await client.reply(command, "已完成");
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            log.error(`JM${albumId} 下载失败：${message}`);
            if (/2069|client quota exceeded/i.test(message)) {
              await client
                .reply(
                  command,
                  `上传失败：文件传输客户端配额不足（2069）。PDF 已保存在 ${pdfPath || `downloads/JM${albumId}/${albumId}.pdf`}；请给机器人服务器组提高 i_ft_quota_mb_upload_per_client（例如 1024 MB）。`,
                )
                .catch(() => {});
            } else {
              await client.reply(command, `失败：${message}`).catch(() => {});
            }
          } finally {
            downloading = false;
          }
        } catch (error) {
          await client.reply(command, `失败：${error instanceof Error ? error.message : String(error)}`);
        }
        break;
      }
      case "status":
        await client.reply(
          command,
          `状态：TS ${client.isConnected() ? "已连接" : "未连接"}，下载代理 ${
            config.proxy.mode === "off" ? "直连" : `${config.proxy.host}:${config.proxy.port}`
          }`,
        );
        break;
      case "move":
        if (!args) {
          await client.reply(command, "用法：!move <频道名>");
          break;
        }
        try {
          await client.moveTo(args.trim());
          await client.reply(command, `已移动到 ${args.trim()}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/2568|insufficient client permissions/i.test(message)) {
            log.error("移动失败：机器人缺少移动权限（2568）");
            await client.reply(
              command,
              "移动失败：机器人缺少移动权限。请给机器人的服务器组加 i_client_move_power（建议 75），并确保目标频道 i_channel_needed_join_power 不高于它。",
            );
            break;
          }
          throw error;
        }
        break;
      default:
        break;
    }
  } catch (error) {
    log.error(`处理指令失败：${error instanceof Error ? error.message : String(error)}`);
    await client.reply(command, "处理失败，看服务端日志").catch(() => {});
  }
});

const server = createPanel(root, config, bot, () => shutdown("panel"));

function shutdown(signal: string): void {
  log.info(`收到 ${signal}，正在退出`);
  bot.stop();
  server.close();
  setTimeout(() => process.exit(0), 300);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));

log.info("TS-JMcomic-Bot 启动中（外置 Clash Verge 代理模式）");
void bot.start();
