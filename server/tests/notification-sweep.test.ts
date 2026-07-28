import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import { Wellness } from "../src/models/Wellness";
import { TrainingSession } from "../src/models/TrainingSession";
import { RpeMonitoring } from "../src/models/RpeMonitoring";
import { AthleteNote } from "../src/models/AthleteNote";
import { CoachComment } from "../src/models/CoachComment";
import { DeviceToken } from "../src/models/DeviceToken";
import { Notification } from "../src/models/Notification";
import { NotificationDecision } from "../src/models/NotificationDecision";
import internalNotificationsRouter from "../src/routes/internalNotifications";
import { runSweep } from "../src/services/notificationSweep";
import { env } from "../src/config/env";
import {
  setPushDeliveryAdapterForTests,
  type PushDeliveryAdapter,
} from "../src/services/fcmDelivery";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/internal/notifications", internalNotificationsRouter);
  return app;
}

const noopAdapter: PushDeliveryAdapter = {
  async send(input) {
    return input.tokens.map((t) => ({ token: t.token, ok: true }));
  },
};

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
  setPushDeliveryAdapterForTests(noopAdapter);
});
afterAll(() => setPushDeliveryAdapterForTests(null));

describe("POST /internal/notifications/sweep — auth", () => {
  test("missing Authorization header → 401", async () => {
    const res = await request(buildApp()).post("/internal/notifications/sweep");
    expect(res.status).toBe(401);
  });

  test("wrong secret → 401", async () => {
    const res = await request(buildApp())
      .post("/internal/notifications/sweep")
      .set("Authorization", "Bearer not-the-secret");
    expect(res.status).toBe(401);
  });

  test("correct secret → 200 with an empty-DB sweep summary", async () => {
    const res = await request(buildApp())
      .post("/internal/notifications/sweep")
      .set("Authorization", `Bearer ${env.internalNotifications.sweepSecret}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ usersProcessed: 0, decisionsSent: 0 });
  });
});

async function seedAthlete(timezone = "UTC") {
  const user = await User.create({ email: `ath${Date.now()}${Math.random()}@t.io`, passwordHash: "x", role: "athlete", name: "Arjun" });
  const profile = await AthleteProfile.create({ userId: user._id, sport: "athletics", timezone });
  await DeviceToken.create({ userId: user._id, platform: "android", token: `tok-${user._id}` });
  return { user, profile };
}

async function seedRpe(athleteId: Types.ObjectId, date: Date): Promise<void> {
  await RpeMonitoring.create({
    athleteId,
    date,
    day: "Thursday",
    sessionType: "AM",
    trainingCategory: "ENDURANCE",
    plannedIntensityPercent: 60,
    rpe: 4,
    sleepQuality: 4,
    muscleSoreness: 1,
    fatigue: 1,
    moodMotivation: 4,
  });
}

describe("runSweep — daily_checkin_reminder", () => {
  // 2026-01-01T21:00:00Z — past the default 20:00 local reminder threshold.
  const now = new Date(Date.UTC(2026, 0, 1, 21, 0, 0));

  test("fires when the athlete hasn't checked in yet today", async () => {
    const { user } = await seedAthlete();
    const result = await runSweep({ limit: 200, pages: 5, cursor: null, now });
    expect(result.decisionsSent).toBeGreaterThanOrEqual(1);
    expect(
      await Notification.countDocuments({ recipientUserId: user._id, type: "daily_checkin_reminder" })
    ).toBe(1);
    const decision = await NotificationDecision.findOne({
      userId: user._id,
      type: "daily_checkin_reminder",
    }).lean();
    expect(decision?.status).toBe("sent");
  });

  test("does not fire when the athlete already checked in today", async () => {
    const { user, profile } = await seedAthlete();
    await Wellness.create({ athleteId: profile._id, date: new Date(Date.UTC(2026, 0, 1)), sleepHours: 8 });
    await runSweep({ limit: 200, pages: 5, cursor: null, now });
    expect(
      await Notification.countDocuments({ recipientUserId: user._id, type: "daily_checkin_reminder" })
    ).toBe(0);
    const decision = await NotificationDecision.findOne({
      userId: user._id,
      type: "daily_checkin_reminder",
    }).lean();
    expect(decision?.status).toBe("suppressed");
    expect(decision?.suppressReason).toBe("already_completed");
  });

  test("before the reminder hour, no candidate is generated at all", async () => {
    await seedAthlete();
    // 05:00 UTC — before every default local-time threshold (the earliest is 07:00).
    const early = new Date(Date.UTC(2026, 0, 1, 5, 0, 0));
    const result = await runSweep({ limit: 200, pages: 5, cursor: null, now: early });
    expect(result.decisionsSent).toBe(0);
    expect(await NotificationDecision.countDocuments({ type: "daily_checkin_reminder" })).toBe(0);
  });

  test("running the sweep twice on identical data sends no duplicates", async () => {
    await seedAthlete();
    const first = await runSweep({ limit: 200, pages: 5, cursor: null, now });
    const totalAfterFirst = await NotificationDecision.countDocuments({});
    expect(first.decisionsSent).toBeGreaterThanOrEqual(1);

    const second = await runSweep({ limit: 200, pages: 5, cursor: null, now });
    const totalAfterSecond = await NotificationDecision.countDocuments({});
    expect(totalAfterSecond).toBe(totalAfterFirst); // no new rows at all
    expect(second.decisionsSent).toBe(0);
    expect(second.decisionsSuppressed).toBe(0); // already-decided keys are a fast-path skip, not a new suppression
  });
});

describe("runSweep — missed_activity_reminder", () => {
  const today = new Date(Date.UTC(2026, 0, 2));
  const yesterday = new Date(Date.UTC(2026, 0, 1));
  const afterThreshold = new Date(Date.UTC(2026, 0, 2, 8, 30, 0));

  test("fires after 08:00 local when yesterday has an unresolved planned session", async () => {
    const { user, profile } = await seedAthlete();
    await seedRpe(profile._id, today);
    await TrainingSession.create({
      athleteId: profile._id,
      date: yesterday,
      slot: "PM",
      status: "planned",
      type: "Strength",
    });

    const result = await runSweep({ limit: 200, pages: 5, cursor: null, now: afterThreshold });

    expect(result.decisionsSent).toBeGreaterThanOrEqual(1);
    const notification = await Notification.findOne({
      recipientUserId: user._id,
      type: "missed_activity_reminder",
    }).lean();
    expect(notification?.title).toBe("Finish yesterday's activity log");
    expect(notification?.body).toBe("You still have 1 planned session to mark completed or skipped.");
    const decision = await NotificationDecision.findOne({
      userId: user._id,
      type: "missed_activity_reminder",
    }).lean();
    expect(decision?.status).toBe("sent");
    expect(decision?.sentTime?.toISOString()).toBe(afterThreshold.toISOString());
  });

  test("does not fire before 08:00 local", async () => {
    const { user, profile } = await seedAthlete();
    await TrainingSession.create({
      athleteId: profile._id,
      date: yesterday,
      slot: "PM",
      status: "planned",
      type: "Strength",
    });

    await runSweep({
      limit: 200,
      pages: 5,
      cursor: null,
      now: new Date(Date.UTC(2026, 0, 2, 7, 30, 0)),
    });

    expect(
      await Notification.countDocuments({ recipientUserId: user._id, type: "missed_activity_reminder" })
    ).toBe(0);
    expect(await NotificationDecision.countDocuments({ userId: user._id, type: "missed_activity_reminder" })).toBe(0);
  });

  test("does not fire when yesterday's planned session was completed", async () => {
    const { user, profile } = await seedAthlete();
    await seedRpe(profile._id, today);
    await TrainingSession.create({
      athleteId: profile._id,
      date: yesterday,
      slot: "PM",
      status: "completed",
      attended: true,
      type: "Strength",
    });

    await runSweep({ limit: 200, pages: 5, cursor: null, now: afterThreshold });

    expect(
      await Notification.countDocuments({ recipientUserId: user._id, type: "missed_activity_reminder" })
    ).toBe(0);
    expect(await NotificationDecision.countDocuments({ userId: user._id, type: "missed_activity_reminder" })).toBe(0);
  });
});

describe("runSweep — note_needs_reply", () => {
  const now = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));

  async function seedCoachAthleteWithNote(hoursOld: number) {
    const admin = await User.create({ email: `admin${Date.now()}@t.io`, passwordHash: "x", role: "coach", name: "Admin" });
    const coach = await User.create({ email: `coach${Date.now()}@t.io`, passwordHash: "x", role: "coach", name: "Coach" });
    const { profile } = await seedAthlete();
    await CoachAthleteAssignment.create({ coachId: coach._id, athleteId: profile._id, assignedBy: admin._id });
    await DeviceToken.create({ userId: coach._id, platform: "android", token: `tok-${coach._id}` });
    // Mongoose's `timestamps: true` makes `createdAt` immutable after insert — an
    // updateOne $set on it silently no-ops. Must be set at create() time instead.
    const oldCreatedAt = new Date(now.getTime() - hoursOld * 60 * 60 * 1000);
    const note = await AthleteNote.create({
      athleteId: profile._id,
      date: now,
      body: "Knee feels tight",
      createdAt: oldCreatedAt,
    } as unknown as { athleteId: Types.ObjectId; date: Date; body: string });
    return { coach, profile, note };
  }

  test("fires for a note older than the reply window with no coach reply", async () => {
    const { coach } = await seedCoachAthleteWithNote(env.notification.noteNeedsReplyHours + 1);
    const result = await runSweep({ limit: 200, pages: 5, cursor: null, now });
    expect(result.decisionsSent).toBeGreaterThanOrEqual(1);
    expect(
      await Notification.countDocuments({ recipientUserId: coach._id, type: "note_needs_reply" })
    ).toBe(1);
  });

  test("does not fire for a note still within the reply window", async () => {
    const { coach } = await seedCoachAthleteWithNote(1);
    await runSweep({ limit: 200, pages: 5, cursor: null, now });
    expect(
      await Notification.countDocuments({ recipientUserId: coach._id, type: "note_needs_reply" })
    ).toBe(0);
  });

  test("does not fire once the coach has replied", async () => {
    const { coach, profile, note } = await seedCoachAthleteWithNote(env.notification.noteNeedsReplyHours + 1);
    await CoachComment.create({ athleteId: profile._id, coachId: coach._id, date: now, body: "On it, thanks!" });
    await runSweep({ limit: 200, pages: 5, cursor: null, now });
    expect(
      await Notification.countDocuments({ recipientUserId: coach._id, type: "note_needs_reply" })
    ).toBe(0);
    const decision = await NotificationDecision.findOne({
      type: "note_needs_reply",
      "entityRef.id": note._id,
    }).lean();
    expect(decision?.status).toBe("suppressed");
    expect(decision?.suppressReason).toBe("already_completed");
  });
});

describe("runSweep — pagination", () => {
  test("nextCursor is null once every user has been paged through", async () => {
    await seedAthlete();
    await seedAthlete();
    await seedAthlete();
    const result = await runSweep({
      limit: 2,
      pages: 5,
      cursor: null,
      now: new Date(Date.UTC(2026, 0, 1, 8, 0, 0)), // before any timing gate — just exercising paging
    });
    expect(result.usersProcessed).toBe(3);
    expect(result.nextCursor).toBeNull();
  });
});
