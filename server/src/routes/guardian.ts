import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import {
  loadScope,
  requireAthleteAccess,
} from "../middleware/coachAthleteAccess";
import { AthleteProfile } from "../models/AthleteProfile";
import { User } from "../models/User";
import { CoachComment } from "../models/CoachComment";
import { buildDailyCardForAthlete, dayRange } from "../services/dashboard";
import { buildTrendSeries, clampDays } from "../services/trends";
import { buildActivityFeed, clampLimit } from "../services/activity";
import {
  buildWellnessSeries,
  buildAttendanceSeries,
  buildSessionSeries,
  buildPerformanceSeries,
} from "../services/analytics";
import { parseDateOrNull } from "../lib/trainingCategories";

const router = Router();

// Guardians only — read-only access to their linked athletes' summaries.
router.use(requireAuth, requireRole("guardian"), loadScope);

function linkedIds(req: Request): Types.ObjectId[] {
  return req.actor?.linkedAthleteIds ?? [];
}

function strictDate(input: unknown, res: Response): Date | null {
  if (input === undefined || input === null || input === "") {
    return dayRange(undefined).start;
  }
  const d = parseDateOrNull(input);
  if (!d) {
    res.status(400).json({ error: "invalid_date" });
    return null;
  }
  return d;
}

/**
 * GET /api/guardian/athletes
 * Linked athletes (summary only).
 */
router.get("/athletes", async (req: Request, res: Response) => {
  if (!req.actor) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  const ids = linkedIds(req);
  if (ids.length === 0) {
    res.json({ athletes: [] });
    return;
  }
  const profiles = await AthleteProfile.find({ _id: { $in: ids } })
    .select("_id userId sport position academyId")
    .lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select("_id name")
    .lean();
  const userById = new Map(users.map((u) => [u._id.toString(), u]));
  res.json({
    athletes: profiles.map((p) => {
      const u = userById.get((p.userId as Types.ObjectId).toString());
      return {
        athleteId: p._id.toString(),
        name: (u?.name as string) ?? "",
        sport: p.sport,
        position: p.position ?? null,
      };
    }),
  });
});

/**
 * GET /api/guardian/athletes/:athleteId/daily-card?date=YYYY-MM-DD
 * Read-only daily summary for a linked athlete.
 */
router.get(
  "/athletes/:athleteId/daily-card",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const start = strictDate(req.query.date, res);
    if (!start) return;
    const card = await buildDailyCardForAthlete(
      new Types.ObjectId(req.params.athleteId),
      start
    );
    if (!card) {
      res.status(404).json({ error: "athlete_not_found" });
      return;
    }
    res.json({ card });
  }
);

/**
 * GET /api/guardian/athletes/:athleteId/trends?days=7
 * Read-only trailing trend series for a linked athlete.
 */
router.get(
  "/athletes/:athleteId/trends",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days);
    const series = await buildTrendSeries(
      new Types.ObjectId(req.params.athleteId),
      days
    );
    res.json({ days, series });
  }
);

/**
 * GET /api/guardian/athletes/:athleteId/activity?limit=40
 * Read-only recent-activity timeline for a linked athlete.
 */
router.get(
  "/athletes/:athleteId/activity",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const limit = clampLimit(req.query.limit);
    const items = await buildActivityFeed(new Types.ObjectId(req.params.athleteId), limit);
    res.json({ items });
  }
);

/**
 * Read-only per-athlete analytics series for a linked athlete (charts).
 *   GET /api/guardian/athletes/:athleteId/analytics/{wellness,attendance,sessions,performance}
 */
router.get(
  "/athletes/:athleteId/analytics/wellness",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 30, 90);
    res.json({ days, series: await buildWellnessSeries(new Types.ObjectId(req.params.athleteId), days) });
  }
);
router.get(
  "/athletes/:athleteId/analytics/attendance",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 30, 90);
    res.json({ days, ...(await buildAttendanceSeries(new Types.ObjectId(req.params.athleteId), days)) });
  }
);
router.get(
  "/athletes/:athleteId/analytics/sessions",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 30, 90);
    res.json({ days, series: await buildSessionSeries(new Types.ObjectId(req.params.athleteId), days) });
  }
);
router.get(
  "/athletes/:athleteId/analytics/performance",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const days = clampDays(req.query.days, 90, 90);
    const metric = typeof req.query.metric === "string" ? req.query.metric : undefined;
    res.json({ days, ...(await buildPerformanceSeries(new Types.ObjectId(req.params.athleteId), metric, days)) });
  }
);

/**
 * GET /api/guardian/athletes/:athleteId/coach-comments?date=YYYY-MM-DD
 * Coach feedback visible to the guardian for a linked athlete.
 */
router.get(
  "/athletes/:athleteId/coach-comments",
  requireAthleteAccess("athleteId"),
  async (req: Request, res: Response) => {
    const start = strictDate(req.query.date, res);
    if (!start) return;
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const comments = await CoachComment.find({
      athleteId: new Types.ObjectId(req.params.athleteId),
      date: { $gte: start, $lt: end },
    })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ comments });
  }
);

export default router;
