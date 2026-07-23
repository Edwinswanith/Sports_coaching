import mongoose, { Types } from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import athleteRouter from "../src/routes/athlete";
import { signAccessToken } from "../src/lib/tokens";
import {
  setVoiceIntentInterpreterForTests,
  MockVoiceIntentInterpreter,
  type VoiceIntentInterpreter,
} from "../src/services/voiceIntentInterpreter";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/athlete", athleteRouter);
  return app;
}

async function makeUser(role: "coach" | "athlete", name: string) {
  return User.create({ email: `${name}@test.io`, passwordHash: "x", role, name });
}

async function makeAthlete(name: string) {
  const user = await makeUser("athlete", name);
  const profile = await AthleteProfile.create({ userId: user._id, sport: "football" });
  return { user, profile };
}

function tokenFor(userId: Types.ObjectId, role: "athlete" | "coach") {
  return signAccessToken({ sub: userId.toString(), role });
}

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
  setVoiceIntentInterpreterForTests(new MockVoiceIntentInterpreter());
});

afterEach(() => {
  setVoiceIntentInterpreterForTests(null);
});

describe("POST /api/athlete/voice/interpret — RBAC", () => {
  test("rejects unauthenticated requests", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/athlete/voice/interpret").send({ transcript: "open recovery" });
    expect(res.status).toBe(401);
  });

  test("rejects non-athlete roles", async () => {
    const app = buildApp();
    const coach = await makeUser("coach", "Coach");
    const token = tokenFor(coach._id as Types.ObjectId, "coach");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open recovery" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden_role");
  });
});

describe("POST /api/athlete/voice/interpret — contract", () => {
  test("returns a navigate intent with no confirmation required", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Arjun");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open recovery" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("navigate");
    expect(res.body.requiresConfirmation).toBe(false);
    expect(res.body.fields.target).toBe("log");
  });

  test("returns fill_wellness with extracted fields and requires confirmation", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Bala");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "sleepquality is 8 and fatigue is 6" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("fill_wellness");
    expect(res.body.requiresConfirmation).toBe(true);
  });

  test("generic sleep update maps to sleepHours, not sleepQuality", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("SleepHours");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "Change sleep to 8" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("fill_wellness");
    expect(res.body.fields.sleepHours).toBe(8);
    expect(res.body.fields.sleepQuality).toBeUndefined();
  });

  test("generic sleep update accepts spoken number words", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("SleepWord");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "Update your sleep is seven" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("fill_wellness");
    expect(res.body.fields.sleepHours).toBe(7);
    expect(res.body.fields.sleepQuality).toBeUndefined();
    expect(res.body.missingFields).toEqual([]);
  });

  test("sleep update without duration asks one follow-up", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("SleepMissing");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "Update sleep" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("fill_wellness");
    expect(res.body.fields.sleepQuality).toBeUndefined();
    expect(res.body.missingFields).toContain("sleepHours");
    expect(res.body.followUpQuestion).toMatch(/how many hours/i);
  });

  test("'sleep quality' and 'sleep score' phrasing still resolve to sleepHours, not a separate score field", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("SleepQuality");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");

    const qualityRes = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "sleep quality is 8" });
    expect(qualityRes.status).toBe(200);
    expect(qualityRes.body.intent).toBe("fill_wellness");
    expect(qualityRes.body.fields.sleepHours).toBe(8);
    expect(qualityRes.body.fields.sleepQuality).toBeUndefined();

    const scoreRes = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "can you update the sleep score as 8" });
    expect(scoreRes.status).toBe(200);
    expect(scoreRes.body.intent).toBe("fill_wellness");
    expect(scoreRes.body.fields.sleepHours).toBe(8);
    expect(scoreRes.body.fields.sleepQuality).toBeUndefined();
  });

  test("returns add_water with missingFields when amount isn't spoken", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Chetan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "I drank some water" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("add_water");
    expect(res.body.missingFields).toContain("amountMl");
    expect(res.body.followUpQuestion).toBeTruthy();
  });

  test("returns add_water with amountMl parsed when spoken", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Diya");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "drink 500 ml of water" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("add_water");
    expect(res.body.fields.amountMl).toBe(500);
    expect(res.body.missingFields).toEqual([]);
  });

  test("rejects a missing or oversized transcript", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Esha");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const missing = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({});
    expect(missing.status).toBe(400);

    const oversized = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "a".repeat(2001) });
    expect(oversized.status).toBe(400);
  });

  test("falls back to a graceful unsupported response when the interpreter throws", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Farhan");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    const throwing: VoiceIntentInterpreter = {
      interpret: async () => {
        throw new Error("boom");
      },
    };
    setVoiceIntentInterpreterForTests(throwing);
    const res = await request(app)
      .post("/api/athlete/voice/interpret")
      .set("Cookie", [`accessToken=${token}`])
      .send({ transcript: "open recovery" });
    expect(res.status).toBe(200);
    expect(res.body.intent).toBe("unsupported");
  });
});

describe("POST /api/athlete/voice/interpret — rate limiting", () => {
  test("the generous voice limiter is independent of the 40/min write limiter", async () => {
    const app = buildApp();
    const { user } = await makeAthlete("Guru");
    const token = tokenFor(user._id as Types.ObjectId, "athlete");
    // 41 calls exceeds the strict write limiter (40/min) but must still succeed,
    // since /voice/interpret performs no DB write and uses its own 120/min limit.
    for (let i = 0; i < 41; i++) {
      const res = await request(app)
        .post("/api/athlete/voice/interpret")
        .set("Cookie", [`accessToken=${token}`])
        .send({ transcript: "open recovery" });
      expect(res.status).toBe(200);
    }
  });
});
