import {
  Controller,
  Get,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import { PrismaService } from "./prisma.service";
import { uploadsRoot } from "./uploads";

type DependencyStatus = "up" | "down";

const redisCommand = (...parts: string[]) =>
  `*${parts.length}\r\n${parts
    .map((part) => `$${Buffer.byteLength(part)}\r\n${part}\r\n`)
    .join("")}`;

async function probeRedis(timeoutMs = 1_500): Promise<void> {
  const target = new URL(process.env.REDIS_URL ?? "");
  if (target.protocol !== "redis:" && target.protocol !== "rediss:") {
    throw new Error("Unsupported Redis protocol");
  }

  const port = Number(target.port || (target.protocol === "rediss:" ? 6380 : 6379));
  const commands: string[] = [];
  if (target.password) {
    const password = decodeURIComponent(target.password);
    const username = decodeURIComponent(target.username || "default");
    commands.push(redisCommand("AUTH", username, password));
  }
  commands.push(redisCommand("PING"));

  await new Promise<void>((resolve, reject) => {
    const options = { host: target.hostname, port };
    const socket = target.protocol === "rediss:"
      ? connectTls({ ...options, servername: target.hostname })
      : connectTcp(options);
    let response = "";
    let settled = false;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Redis health probe timed out"));
    }, timeoutMs);

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      error ? reject(error) : resolve();
    };
    socket.once("error", (error) => finish(error));
    socket.once(target.protocol === "rediss:" ? "secureConnect" : "connect", () =>
      socket.write(commands.join("")),
    );
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (/(?:^|\r\n)-/.test(response)) finish(new Error("Redis rejected health probe"));
      else if (response.includes("+PONG\r\n")) finish();
    });
  });
}

async function probeUploads(): Promise<void> {
  const directory = uploadsRoot();
  await mkdir(directory, { recursive: true });
  const probePath = `${directory}/.health-${randomUUID()}`;
  const payload = randomUUID();
  try {
    await writeFile(probePath, payload, { encoding: "utf8", flag: "wx" });
    if ((await readFile(probePath, "utf8")) !== payload) {
      throw new Error("Upload storage health probe read mismatch");
    }
  } finally {
    await unlink(probePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    const checks = await Promise.all([
      this.probe(() => this.prisma.$queryRawUnsafe("SELECT 1")),
      this.probe(() => probeRedis()),
      this.probe(() => probeUploads()),
    ]);
    const dependencies: Record<"postgres" | "redis" | "uploads", DependencyStatus> = {
      postgres: checks[0],
      redis: checks[1],
      uploads: checks[2],
    };
    const result = {
      ok: checks.every((status) => status === "up"),
      service: "yoleotard-crm-api",
      dependencies,
    };

    if (!result.ok) throw new ServiceUnavailableException(result);
    return result;
  }

  private async probe(operation: () => Promise<unknown>): Promise<DependencyStatus> {
    try {
      await operation();
      return "up";
    } catch {
      return "down";
    }
  }
}
