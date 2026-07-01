import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { GuardianAthleteLink } from "../src/models/GuardianAthleteLink";
import { CoachComment } from "../src/models/CoachComment";
import { Wellness } from "../src/models/Wellness";
import guardianRouter from "../src/routes/guardian";
import { signAccessToken } from "../src/lib/tokens";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/guardian", guardianRouter);
  return app;
}

async function makeUser(role: "guardian" | "athlete" | "coach", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

async function makeAthlete(name: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "football" });
  return { user, profile };
}

function tokenFor(userId: Types.ObjectId, role: "guardian" | "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

const TODAY_STR = (() => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
})();

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});

beforeEach(async () => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

async function guardianWithChild() {
  const guardian = await makeUser("guardian", "parent");
  const { profile: child } = await makeAthlete("child");
  await GuardianAthleteLink.create({
    guardianId: guardian._id,
    athleteId: child._id,
    relationship: "parent",
  });
  return { guardian, child };
}

describe("Guardian roster", () => {
  test("guardian lists only linked athletes", async () => {
    const { guardian, child } = await guardianWithChild();
    await makeAthlete("not-my-child"); // unlinked

    const res = await request(buildApp())
      .get("/api/guardian/athletes")
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`);
    expect(res.status).toBe(200);
    expect(res.body.athletes).toHaveLength(1);
    expect(res.body.athletes[0].athleteId).toBe(child._id.toString());
    expect(res.body.athletes[0].name).toBe("child");
  });

  test("guardian with no links → empty roster", async () => {
    const guardian = await makeUser("guardian", "lonely");
    const res = await request(buildApp())
      .get("/api/guardian/athletes")
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`);
    expect(res.status).toBe(200);
    expect(res.body.athletes).toEqual([]);
  });
});

describe("Guardian auth gate", () => {
  test("athlete role hitting guardian endpoint → 403", async () => {
    const { user } = await makeAthlete("a1");
    const res = await request(buildApp())
      .get("/api/guardian/athletes")
      .set("Authorization", `Bearer ${tokenFor(user._id, "athlete")}`);
    expect(res.status).toBe(403);
  });

  test("no token → 401", async () => {
    const res = await request(buildApp()).get("/api/guardian/athletes");
    expect(res.status).toBe(401);
  });
});

describe("Guardian daily-card access", () => {
  test("linked child card → 200; unlinked → 403", async () => {
    const { guardian, child } = await guardianWithChild();
    const { profile: stranger } = await makeAthlete("stranger");
    await Wellness.create({
      athleteId: child._id,
      date: new Date(`${TODAY_STR}T00:00:00.000Z`),
      sleepQuality: 4,
      mood: 4,
      stress: 2,
      soreness: 2,
      fatigue: 2,
    });
    const app = buildApp();
    const token = tokenFor(guardian._id, "guardian");

    const ok = await request(app)
      .get(`/api/guardian/athletes/${child._id}/daily-card?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.card.athleteId).toBe(child._id.toString());

    const forbidden = await request(app)
      .get(`/api/guardian/athletes/${stranger._id}/daily-card?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${token}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toBe("not_linked_guardian");
  });

  test("guardian reads coach comments for a linked child", async () => {
    const { guardian, child } = await guardianWithChild();
    const coach = await makeUser("coach", "kumar");
    await CoachComment.create({
      athleteId: child._id,
      coachId: coach._id,
      date: new Date(`${TODAY_STR}T00:00:00.000Z`),
      body: "Great progress this week.",
    });
    const res = await request(buildApp())
      .get(`/api/guardian/athletes/${child._id}/coach-comments?date=${TODAY_STR}`)
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`);
    expect(res.status).toBe(200);
    expect(res.body.comments).toHaveLength(1);
    expect(res.body.comments[0].body).toBe("Great progress this week.");
  });

  test("guardian has no write endpoint (POST → 404)", async () => {
    const { guardian, child } = await guardianWithChild();
    const res = await request(buildApp())
      .post(`/api/guardian/athletes/${child._id}/daily-card`)
      .set("Authorization", `Bearer ${tokenFor(guardian._id, "guardian")}`)
      .send({ foo: "bar" });
    expect(res.status).toBe(404);
  });
});
