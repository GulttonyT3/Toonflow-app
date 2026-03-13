process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
import "./logger";
import "./err";
import "./env";
import http from "http";
import net from "net";
import express, { Request, Response, NextFunction } from "express";
import expressWs from "express-ws";
import logger from "morgan";
import cors from "cors";
import buildRoute from "@/core";
import fs from "fs";
import path from "path";
import u from "@/utils";
import jwt from "jsonwebtoken";

const app = express();
let server: http.Server | null = null;
export let currentPort: number = 60000; // 当前服务端口，供 API 返回

export default async function startServe(randomPort: Boolean = false) {
  if (process.env.NODE_ENV == "dev") await buildRoute();

  const httpServer = http.createServer(app);
  expressWs(app, httpServer);

  app.use(logger("dev"));
  app.use(cors({ origin: "*" }));
  app.use(express.json({ limit: "100mb" }));
  app.use(express.urlencoded({ extended: true, limit: "100mb" }));

  let rootDir: string;
  if (typeof process.versions?.electron !== "undefined") {
    const { app } = require("electron");
    const userDataDir: string = app.getPath("userData");
    rootDir = path.join(userDataDir, "uploads");
  } else {
    rootDir = path.join(process.cwd(), "uploads");
  }

  // 确保 uploads 目录存在
  if (!fs.existsSync(rootDir)) {
    fs.mkdirSync(rootDir, { recursive: true });
  }
  console.log("文件目录:", rootDir);

  app.use(express.static(rootDir));

  // 供浏览器直接访问前端（在认证之前，GET / 会返回 index.html）
  const webDir = path.join(process.cwd(), "scripts", "web");
  app.use(express.static(webDir));

  app.use(async (req, res, next) => {
    const setting = await u.db("t_setting").where("id", 1).select("tokenKey").first();
    if (!setting) return res.status(500).send({ message: "服务器未配置，请联系管理员" });
    const { tokenKey } = setting;
    // 从 header 或 query 参数获取 token
    const rawToken = req.headers.authorization || (req.query.token as string) || "";
    const token = rawToken.replace("Bearer ", "");
    // 白名单路径（无需 token）
    if (req.path === "/other/login" || req.path === "/other/serverInfo") return next();

    if (!token) return res.status(401).send({ message: "未提供token" });
    try {
      const decoded = jwt.verify(token, tokenKey as string);
      (req as any).user = decoded;
      next();
    } catch (err) {
      return res.status(401).send({ message: "无效的token" });
    }
  });

  // 获取当前服务端口（无需 token，用于前端确认连接地址）
  app.get("/other/serverInfo", (_, res) => {
    res.json({ port: currentPort, apiUrl: `http://localhost:${currentPort}`, wsUrl: `ws://localhost:${currentPort}` });
  });

  const router = await import("@/router");
  await router.default(app);

  // 404 处理
  app.use((_, res, next: NextFunction) => {
    return res.status(404).send({ message: "Not Found" });
  });

  // 错误处理
  app.use((err: any, _: Request, res: Response, __: NextFunction) => {
    res.locals.message = err.message;
    res.locals.error = err;
    console.error(err);
    res.status(err.status || 500).send(err);
  });

  const basePort = parseInt(process.env.PORT || "60000");

  // 查找可用端口（端口被占用时自动尝试下一个）
  const getAvailablePort = (start: number, maxAttempts = 10): Promise<number> =>
    new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        if (port >= start + maxAttempts) {
          return reject(new Error(`端口 ${start}-${start + maxAttempts} 均已被占用`));
        }
        const probe = net.createServer();
        probe.once("error", (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE") {
            probe.close();
            tryPort(port + 1);
          } else {
            reject(err);
          }
        });
        probe.once("listening", () => {
          probe.close(() => resolve(port));
        });
        probe.listen(port);
      };
      tryPort(start);
    });

  const port = randomPort ? 0 : await getAvailablePort(basePort);
  server = httpServer;
  return new Promise<number>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(port, () => {
      const address = server?.address();
      const realPort = typeof address === "string" ? address : address?.port;
      currentPort = realPort as number;
      console.log(`[服务启动成功]: http://localhost:${realPort}`);
      resolve(realPort as number);
    });
  });
}

// 支持await关闭
export function closeServe(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server && server.listening) {
      server.close((err?: Error) => {
        if (err) return reject(err);
        console.log("[服务已关闭]");
        resolve();
      });
    } else {
      resolve();
    }
  });
}

const isElectron = typeof process.versions?.electron !== "undefined";
if (!isElectron) startServe();
