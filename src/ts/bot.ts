import fs from "node:fs";
import path from "node:path";
import { createReadStream } from "node:fs";
import {
  Client,
  clientMove,
  generateIdentity,
  identityFromString,
  listChannels,
  sendTextMessage,
  type TextMessage,
} from "@honeybbq/teamspeak-client";
import type { AppConfig } from "../config.js";
import { log } from "../log.js";

export interface IncomingCommand {
  message: string;
  targetMode: number;
  targetID: bigint;
  invokerName: string;
  invokerID: number;
}

type CommandHandler = (bot: TsBot, command: IncomingCommand) => Promise<void>;

export class TsBot {
  private client: Client | null = null;
  private stopped = false;
  private connected = false;
  private clid = 0;
  private handler: CommandHandler = async () => {};

  constructor(private readonly config: AppConfig) {}

  onCommand(handler: CommandHandler): void {
    this.handler = handler;
  }

  isConnected(): boolean {
    return this.connected;
  }

  identityPath(): string {
    return path.resolve(this.config.ts.identityFile);
  }

  async start(): Promise<void> {
    this.stopped = false;
    let backoff = 5;
    while (!this.stopped) {
      try {
        await this.connectOnce();
        backoff = 5;
      } catch (error) {
        log.error(`连接失败：${error instanceof Error ? error.message : String(error)}`);
      }
      if (this.stopped) {
        break;
      }
      log.info(`${backoff} 秒后重连`);
      await new Promise((resolve) => setTimeout(resolve, backoff * 1000));
      backoff = Math.min(60, backoff * 2);
    }
  }

  stop(): void {
    this.stopped = true;
    this.connected = false;
    this.client?.disconnect().catch(() => {});
    this.client = null;
  }

  restart(): void {
    this.client?.disconnect().catch(() => {});
  }

  private identity(): ReturnType<typeof generateIdentity> {
    const file = this.config.ts.identityFile;
    if (fs.existsSync(file)) {
      const saved = fs.readFileSync(file, "utf8").trim();
      if (saved) {
        try {
          return identityFromString(saved);
        } catch (error) {
          throw new Error(
            `身份文件无法解析（${this.identityPath()}）：${error instanceof Error ? error.message : String(error)}。请恢复备份，不要直接删除，否则会变成新客户端。`,
          );
        }
      }
    }
    const identity = generateIdentity(8);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, identity.toString(), "utf8");
    log.warn(`未找到可用身份，已生成新身份：${this.identityPath()}`);
    return identity;
  }

  private async connectOnce(): Promise<void> {
    this.connected = false;
    const ts = this.config.ts;
    const client = new Client(this.identity(), `${ts.host}:${ts.port}`, ts.nickname, {
      serverPassword: ts.serverPassword || undefined,
      defaultChannel: ts.channel || undefined,
      defaultChannelPassword: ts.channelPassword || undefined,
      logger: {
        debug: (message: string) => log.debug(`[ts] ${message}`),
        info: (message: string) => log.debug(`[ts] ${message}`),
        warn: (message: string) => log.warn(`[ts] ${message}`),
        error: (message: string) => log.error(`[ts] ${message}`),
      },
    });
    this.client = client;
    this.clid = 0;

    client.on("textMessage", (message: TextMessage) => {
      if (message.invokerID === client.clientID()) {
        return;
      }
      const text = message.message.trim();
      if (!text.startsWith("!")) {
        return;
      }
      void this.handler(this, {
        message: text,
        targetMode: message.targetMode,
        targetID: message.targetID,
        invokerName: message.invokerName,
        invokerID: message.invokerID,
      });
    });

    await client.connect();
    await client.waitConnected(AbortSignal.timeout(20_000));
    this.connected = true;
    this.clid = client.clientID();
    const serverUid = client.uniqueIdentifier();
    log.info(
      `已作为客户端连接 ${ts.host}:${ts.port}，昵称 ${ts.nickname}，UID ${serverUid}，频道 ${client.channelID()}`,
    );
    log.info(`身份文件：${this.identityPath()}`);
    log.info(`身份文件：${this.identityPath()}`);

    await new Promise<void>((resolve) => {
      let settled = false;
      const done = (error?: Error): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.connected = false;
        log.warn(`连接断开${error ? `：${error.message}` : ""}`);
        resolve();
      };
      client.on("disconnected", (error?: Error) => done(error));
    });
    this.client = null;
  }

  async reply(command: IncomingCommand, text: string): Promise<void> {
    if (!this.client) {
      log.warn(`未连接，无法发送频道消息：${text}`);
      return;
    }
    // 频道命令直接回到来源频道；私聊命令也发到机器人当前频道。
    const target = command.targetMode === 2 ? command.targetID : this.client.channelID();
    try {
      await sendTextMessage(this.client, 2, target, text);
    } catch (error) {
      log.error(
        `发送频道消息失败（target=${target}）：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async upload(localPath: string, remotePath: string): Promise<"direct" | "client"> {
    if (!this.client) {
      throw new Error("未连接 TeamSpeak");
    }
    const channelID = this.client.channelID();
    const directDir = this.config.ts.uploadDir
      .trim()
      .replace(/\{channelId\}/gi, channelID.toString())
      .replace(/\{channelDir\}/gi, `channel_${channelID}`);
    if (directDir) {
      const target = path.join(directDir, path.basename(remotePath));
      try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(localPath, target);
        log.info(`已直接复制到 TS 文件目录：${target}`);
        return "direct";
      } catch (error) {
        throw new Error(
          `直接复制到 TS 文件目录失败（${target}）：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const size = fs.statSync(localPath).size;
    const info = await this.client.fileTransferInitUpload(
      channelID,
      remotePath,
      "",
      BigInt(size),
      true,
    );
    await this.client.uploadFileData(this.config.ts.host, info, createReadStream(localPath));
    return "client";
  }

  async moveTo(channelName: string): Promise<void> {
    if (!this.client) {
      throw new Error("未连接 TeamSpeak");
    }
    const channels = await listChannels(this.client);
    const target = channels.find((channel) => channel.name === channelName);
    if (!target) {
      throw new Error(`找不到频道 ${channelName}`);
    }
    await clientMove(this.client, this.clid, target.id);
  }
}
