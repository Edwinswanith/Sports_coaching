import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { Types } from "mongoose";
import { env } from "../config/env";
import { runSweep } from "../services/notificationSweep";

const router = Router();

/**
 * Guards every route below — this is NEVER called by a client app, only by
 * the external scheduler (Cloud Scheduler in production). Fail-closed: a
 * missing/mismatched header always 401s, even if the secret is somehow unset.
 */
function requireSweepSecret(req: Request, res: Response, next: () => void): void {
  const header = req.header("authorization") ?? "";
  const expected = `Bearer ${env.internalNotifications.sweepSecret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!match) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

router.use(requireSweepSecret);

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * POST /internal/notifications/sweep?limit=&pages=&cursor=
 * See services/notificationSweep.ts for the actual algorithm — this route is
 * just query-param parsing + auth.
 */
router.post("/sweep", async (req: Request, res: Response) => {
  const limit = clampInt(req.query.limit, env.notification.sweepDefaultLimit, 1, 1000);
  const pages = clampInt(req.query.pages, env.notification.sweepDefaultPages, 1, 50);
  const cursor =
    typeof req.query.cursor === "string" && Types.ObjectId.isValid(req.query.cursor)
      ? new Types.ObjectId(req.query.cursor)
      : null;

  const result = await runSweep({ limit, pages, cursor });
  res.json(result);
});

export default router;
