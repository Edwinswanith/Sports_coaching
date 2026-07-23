import express from "express";
import "express-async-errors";
import cors from "cors";
import { createServer } from "http";
import { env } from "./config/env";
import { connectMongo } from "./db/mongoose";
import coachRouter from "./routes/coach";
import authRouter from "./routes/auth";
import athleteRouter from "./routes/athlete";
import guardianRouter from "./routes/guardian";
import notificationsRouter from "./routes/notifications";
import avatarRouter from "./routes/avatar";
import tourRouter from "./routes/tour";
import voiceRouter from "./routes/voice";
import { attachVoiceStreamProxy } from "./routes/voiceStream";
import { errorHandler } from "./middleware/errorHandler";

function isAllowedCorsOrigin(origin: string, allowedCorsOrigins: Set<string>): boolean {
  if (allowedCorsOrigins.has(origin)) return true;
  if (env.nodeEnv !== "production" && /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin)) return true;

  // Cloud Run creates stable service URLs with a generated suffix, e.g.
  // https://scp-web-futtj2vwgq-el.a.run.app. The suffix can change between
  // deployments, so allow the frontend service family while still rejecting
  // arbitrary run.app origins.
  return /^https:\/\/scp-web-[a-z0-9-]+\.a\.run\.app$/i.test(origin);
}

async function main() {
  const app = express();

  const allowedCorsOrigins = new Set(env.corsOrigins);
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (isAllowedCorsOrigin(origin, allowedCorsOrigins)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS origin not allowed: ${origin}`));
      },
    })
  );
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", env: env.nodeEnv });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteRouter);
  app.use("/api/guardian", guardianRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/me", avatarRouter);
  app.use("/api/tour", tourRouter);
  app.use("/api/voice", voiceRouter);

  // 404 for unknown /api/* paths
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Global error middleware — catches anything routes throw (incl. async).
  app.use(errorHandler);

  // Last-resort process guards — keep the server alive on stray rejections.
  process.on("unhandledRejection", (reason) => {
    console.error("[unhandledRejection]", reason);
  });
  process.on("uncaughtException", (err) => {
    console.error("[uncaughtException]", err);
  });

  const server = createServer(app);
  attachVoiceStreamProxy(server);

  await connectMongo();

  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
