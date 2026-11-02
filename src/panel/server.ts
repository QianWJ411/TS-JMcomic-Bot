import express, { type Express, type Request, type Response } from "express";
import path from "node:path";
import type { Server } from "node:http";
import type { AppConfig } from "../config.js";
import { saveConfig } from "../config.js";
import { probeProxy, describeProxy } from "../proxy/agents.js";
import { probeComic } from "../comic/jm.js";
import type { TsBot } from "../ts/bot.js";
import { log } from "../log.js";

function json(res: Response, body: unknown): void {
  res.type("application/json; charset=utf-8").send(JSON.stringify(body));
}

function ok(res: Response, message: string, extra: Record<string, unknown> = {}): void {
  json(res, { ok: true, message, ...extra });
}

function fail(res: Response, message: string): void {
  json(res, { ok: false, error: message });
}

export function createPanel(
  root: string,
  config: AppConfig,
  bot: TsBot,
  onQuit: () => void,
): Server {
  const app: Express = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(root, "public")));

  app.get("/api/state", (_req: Request, res: Response) => {
    json(res, {
      ok: true,
      ts: {
        host: config.ts.host,
        port: config.ts.port,
        nickname: config.ts.nickname,
        channel: config.ts.channel,
        connected: bot.isConnected(),
        uploadDir: config.ts.uploadDir,
      },
      proxy: {
        mode: config.proxy.mode,
        host: config.proxy.host,
        port: config.proxy.port,
        user: config.proxy.user,
        passwordSet: config.proxy.password.length > 0,
        label: describeProxy(config.proxy),
      },
      comic: {
        domains: config.comic.domains,
      },
    });
  });

  app.post("/api/proxy", (req: Request, res: Response) => {
    const mode = String(req.body?.mode ?? "off").toLowerCase();
    if (!["off", "http", "socks5"].includes(mode)) {
      fail(res, "模式只能是 off/http/socks5");
      return;
    }
    const port = Number(req.body?.port ?? config.proxy.port);
    if (mode !== "off" && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      fail(res, "代理端口不合法");
      return;
    }
    config.proxy.mode = mode as "off" | "http" | "socks5";
    config.proxy.host = String(req.body?.host ?? config.proxy.host).trim() || "127.0.0.1";
    if (mode !== "off") {
      config.proxy.port = port;
    }
    if (typeof req.body?.user === "string") {
      config.proxy.user = req.body.user.trim();
    }
    if (typeof req.body?.password === "string" && req.body.password.length > 0) {
      config.proxy.password = req.body.password;
    }
    saveConfig(config);
    ok(res, mode === "off" ? "已改为直连" : `已保存下载代理 ${config.proxy.host}:${config.proxy.port}`);
  });

  app.post("/api/proxy/test", async (_req: Request, res: Response) => {
    try {
      const status = await probeProxy(config.proxy);
      ok(res, `代理可用，访问 gstatic 返回 HTTP ${status}`);
    } catch (error) {
      fail(res, `代理不可用：${error instanceof Error ? error.message : String(error)}`);
    }
  });

  app.post("/api/comic", (req: Request, res: Response) => {
    const domains = String(req.body?.domains ?? "")
      .split(/[\s,]+/)
      .map((value) => value.trim())
      .filter((value) => /^https?:\/\//i.test(value));
    if (domains.length === 0) {
      fail(res, "至少填一个 http(s) API 域名");
      return;
    }
    config.comic.domains = domains;
    saveConfig(config);
    ok(res, "API 域名已保存");
  });

  app.post("/api/comic/test", async (_req: Request, res: Response) => {
    try {
      const result = await probeComic(config.comic, config.proxy);
      ok(res, `API 可用：${result.domain}，示例专辑《${result.title || "350234"}》`);
    } catch (error) {
      fail(res, `API 不可用：${error instanceof Error ? error.message : String(error)}`);
    }
  });

  app.post("/api/ts", (req: Request, res: Response) => {
    const host = String(req.body?.host ?? "").trim();
    if (!host) {
      fail(res, "服务器地址不能为空");
      return;
    }
    const port = Number(req.body?.port ?? 9987);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      fail(res, "端口不合法");
      return;
    }
    config.ts.host = host;
    config.ts.port = port;
    config.ts.nickname = String(req.body?.nickname ?? config.ts.nickname);
    config.ts.channel = String(req.body?.channel ?? config.ts.channel);
    if (typeof req.body?.channelPassword === "string" && req.body.channelPassword.length > 0) {
      config.ts.channelPassword = req.body.channelPassword;
    }
    if (typeof req.body?.serverPassword === "string" && req.body.serverPassword.length > 0) {
      config.ts.serverPassword = req.body.serverPassword;
    }
    if (typeof req.body?.uploadDir === "string") {
      config.ts.uploadDir = req.body.uploadDir.trim();
    }
    saveConfig(config);
    bot.restart();
    ok(res, "已保存，正在用新配置重连");
  });

  app.post("/api/quit", (_req: Request, res: Response) => {
    ok(res, "正在退出程序");
    setTimeout(onQuit, 200);
  });

  return app.listen(config.panel.port, config.panel.host, () => {
    log.info(`面板：http://${config.panel.host}:${config.panel.port}/`);
  });
}
