import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";

export interface TsSettings {
  host: string;
  port: number;
  nickname: string;
  channel: string;
  channelPassword: string;
  serverPassword: string;
  identityFile: string;
  reconnectSeconds: number;
  /** TS 服务端 files 目录（含 {channelId} 占位符）；配置后直接写盘，绕过客户端上传权限。 */
  uploadDir: string;
}

export interface PanelSettings {
  host: string;
  port: number;
  openBrowser: boolean;
}

export interface ProxySettings {
  mode: "off" | "http" | "socks5";
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface ComicSettings {
  domains: string[];
  dir: string;
  maxChapters: number;
  /** PDF 内 JPEG 质量；配额小的服务器可降到 75。 */
  jpegQuality: number;
}

export interface AppConfig {
  ts: TsSettings;
  panel: PanelSettings;
  proxy: ProxySettings;
  comic: ComicSettings;
}

const DEFAULTS: AppConfig = {
  ts: {
    host: "127.0.0.1",
    port: 9987,
    nickname: "漫画小助手",
    channel: "",
    channelPassword: "",
    serverPassword: "",
    identityFile: "data/identity.txt",
    reconnectSeconds: 5,
    uploadDir: "",
  },
  panel: {
    host: "127.0.0.1",
    port: 3000,
    openBrowser: true,
  },
  proxy: {
    mode: "http",
    host: "127.0.0.1",
    port: 7897,
    user: "",
    password: "",
  },
  comic: {
    domains: [
      "https://www.cdngwc.cc",
      "https://www.cdngwc.net",
      "https://www.cdngwc.club",
      "https://www.cdnhjk.net",
    ],
    dir: "downloads",
    maxChapters: 30,
    jpegQuality: 85,
  },
};

function merge<T>(base: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) {
    return patch === undefined ? base : (patch as T);
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    const current = (base as Record<string, unknown>)[key];
    out[key] =
      current && typeof current === "object" && !Array.isArray(current)
        ? merge(current, value)
        : value;
  }
  return out as T;
}

/** 修正手写 Windows 路径：C:\a\b 在 JSON 里 \a 非法，统一改成 C:/a/b。 */
function repairWindowsPaths(raw: string): string {
  return raw.replace(
    /("(?:uploadDir|identityFile|dir)"\s*:\s*")([^"]*)(")/g,
    (_match, prefix: string, value: string, suffix: string) =>
      `${prefix}${JSON.stringify(value.replace(/\\/g, "/")).slice(1, -1)}${suffix}`,
  );
}

function parseConfig(file: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (firstError) {
    const repaired = repairWindowsPaths(raw);
    if (repaired !== raw) {
      try {
        const parsed = JSON.parse(repaired) as unknown;
        fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
        log.warn(`config.json 中的 Windows 路径已自动改为正斜杠并保存`);
        return parsed;
      } catch {
        // 继续走下面的备份 + 默认配置
      }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backup = `${file}.bad-${stamp}`;
    fs.copyFileSync(file, backup);
    log.error(
      `config.json 不是合法 JSON（${firstError instanceof Error ? firstError.message : String(firstError)}）。` +
        ` 已备份到 ${backup}，本次使用默认配置；Windows 路径请写成 C:/xxx 或 C:\\\\xxx，改完重启。`,
    );
    return JSON.parse(JSON.stringify(DEFAULTS)) as unknown;
  }
}

export function loadConfig(file = "config.json"): AppConfig {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2), "utf8");
  }
  const raw = fs.readFileSync(file, "utf8");
  const parsed = parseConfig(file, raw);
  const config = merge(DEFAULTS, parsed);
  config.ts.uploadDir = normalizePath(config.ts.uploadDir);
  config.ts.identityFile = normalizePath(config.ts.identityFile);
  config.comic.dir = normalizePath(config.comic.dir);
  return config;
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/");
}

export function saveConfig(config: AppConfig, file = "config.json"): void {
  config.ts.uploadDir = normalizePath(config.ts.uploadDir);
  config.ts.identityFile = normalizePath(config.ts.identityFile);
  config.comic.dir = normalizePath(config.comic.dir);
  fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
}

export function ensureDirs(config: AppConfig): void {
  for (const dir of ["data", "logs", config.comic.dir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.mkdirSync(path.dirname(config.ts.identityFile), { recursive: true });
}
