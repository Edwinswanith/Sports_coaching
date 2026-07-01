import express from "express";
import "express-async-errors";
import cors from "cors";
import { env } from "./config/env";
import { connectMongo } from "./db/mongoose";
import coachRouter from "./routes/coach";
import authRouter from "./routes/auth";
import athleteRouter from "./routes/athlete";
import guardianRouter from "./routes/guardian";
import notificationsRouter from "./routes/notifications";
import { errorHandler } from "./middleware/errorHandler";

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
        const isLocalDevOrigin =
          env.nodeEnv !== "production" &&
          /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/i.test(origin);
        if (allowedCorsOrigins.has(origin) || isLocalDevOrigin) {
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

  await connectMongo();

  app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error("[server] fatal startup error:", err);
  process.exit(1);
});
