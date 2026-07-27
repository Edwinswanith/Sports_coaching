import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import express from "express";
import request from "supertest";
import bcrypt from "bcryptjs";
import { User } from "../src/models/User";
import { AthleteProfile } from "../src/models/AthleteProfile";
import { CoachAthleteAssignment } from "../src/models/CoachAthleteAssignment";
import authRouter, { __resetLoginRateLimit } from "../src/routes/auth";
import coachRouter from "../src/routes/coach";
import athleteRouter from "../src/routes/athlete";
import { env } from "../src/config/env";

let mongo: MongoMemoryServer;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
  app.use("/api/coach", coachRouter);
  app.use("/api/athlete", athleteRouter);
  return app;
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
  __resetLoginRateLimit();
  await Promise.all(
    Object.values(mongoose.connection.collections).map((c) => c.deleteMany({}))
  );
});

async function makeCoach(password: string) {
  const passwordHash = await bcrypt.hash(password, 10);
  return User.create({
    email: "coach@test.io",
    passwordHash,
    role: "coach",
    name: "Coach One",
  });
}

describe("POST /api/auth/login", () => {
  test("returns access token + safe user, then access token unlocks /api/coach/athletes", async () => {
    const coach = await makeCoach("s3cret!");

    const athleteUser = await User.create({
      email: "ath@test.io",
      passwordHash: "x",
      role: "athlete",
      name: "Ath One",
    });
    const profile = await AthleteProfile.create({
      userId: athleteUser._id,
      sport: "football",
    });
    await CoachAthleteAssignment.create({
      coachId: coach._id,
      athleteId: profile._id,
      assignedBy: coach._id,
    });

    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "s3cret!" });

    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe("string");
    expect(login.body.refreshToken).toBeUndefined();
    expect(login.body.user).toEqual({
      id: coach._id.toString(),
      name: "Coach One",
      email: "coach@test.io",
      role: "coach",
      academyId: null,
      isAcademyOwner: false,
      mustChangePassword: false,
      avatar: { kind: null, defaultId: null },
    });
    expect(login.body.user).not.toHaveProperty("passwordHash");
    expect(login.body.user).not.toHaveProperty("refreshTokenHash");

    const setCookie = login.headers["set-cookie"];
    const cookieHeader = Array.isArray(setCookie) ? setCookie.join(",") : String(setCookie ?? "");
    expect(cookieHeader).toMatch(/accessToken=/);
    expect(cookieHeader).toMatch(/refreshToken=/);
    expect(cookieHeader).toMatch(/HttpOnly/);

    const me = await request(app)
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${login.body.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.athletes).toHaveLength(1);
    expect(me.body.athletes[0]).toMatchObject({
      athleteId: profile._id.toString(),
      name: "Ath One",
      sport: "football",
    });

    const accessCookie = (Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")])
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("accessToken="));
    expect(accessCookie).toBeTruthy();

    const meByCookie = await request(app)
      .get("/api/auth/me")
      .set("Cookie", accessCookie!);

    expect(meByCookie.status).toBe(200);
    expect(meByCookie.body.user).toEqual({
      id: coach._id.toString(),
      name: "Coach One",
      email: "coach@test.io",
      role: "coach",
      academyId: null,
      isAcademyOwner: false,
      mustChangePassword: false,
      avatar: { kind: null, defaultId: null },
    });
  });

  test("wrong password returns 401", async () => {
    await makeCoach("right-password");
    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_credentials" });
  });

  test("unknown email returns 401", async () => {
    const res = await request(buildApp())
      .post("/api/auth/login")
      .send({ email: "nobody@test.io", password: "whatever" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid_credentials" });
  });
});

describe("POST /api/auth/register-athlete (self-signup)", () => {
  const body = {
    name: "Solo Sam",
    email: "sam@solo.io",
    password: "longenough1",
    sport: "Athletics",
    position: "Sprinter",
  };

  test("creates an unassigned athlete + profile, signs them in, and unlocks athlete self-service", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/auth/register-athlete").send(body);

    expect(res.status).toBe(201);
    expect(typeof res.body.accessToken).toBe("string");
    expect(res.body.user).toMatchObject({ role: "athlete", email: "sam@solo.io", name: "Solo Sam" });
    expect(res.body.user).not.toHaveProperty("passwordHash");

    const user = await User.findOne({ email: "sam@solo.io" }).lean();
    expect(user?.role).toBe("athlete");
    expect(user?.academyId).toBeFalsy();
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(profile).toMatchObject({ sport: "Athletics", position: "Sprinter" });
    // No coach assignment — invisible to every coach (scope invariant intact).
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id })).toBe(0);

    // The returned token works against the athlete self-service surface.
    const me = await request(app)
      .get("/api/athlete/me")
      .set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.athlete).toMatchObject({ sport: "Athletics" });
  });

  test("duplicate email returns 409 and creates no orphan profile", async () => {
    const app = buildApp();
    await request(app).post("/api/auth/register-athlete").send(body);
    const dup = await request(app).post("/api/auth/register-athlete").send(body);
    expect(dup.status).toBe(409);
    expect(dup.body).toEqual({ error: "email_already_exists" });
    expect(await AthleteProfile.countDocuments()).toBe(1);
  });

  test("short password returns 400 weak_password and creates nothing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/auth/register-athlete")
      .send({ ...body, password: "short" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "weak_password" });
    expect(await User.countDocuments()).toBe(0);
  });

  test("missing sport returns 400 invalid_sport", async () => {
    const res = await request(buildApp())
      .post("/api/auth/register-athlete")
      .send({ ...body, sport: "" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_sport" });
  });
});

describe("POST /api/auth/google self-signup roles", () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>;
  let previousGoogleClientId: string;
  let previousGoogleClientIds: string[];

  beforeEach(() => {
    previousGoogleClientId = env.googleClientId;
    previousGoogleClientIds = [...env.googleClientIds];
    env.googleClientId = "web-client";
    env.googleClientIds = ["web-client", "android-client"];
    fetchSpy = jest.spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    env.googleClientId = previousGoogleClientId;
    env.googleClientIds = previousGoogleClientIds;
  });

  function mockGoogleToken(email: string, name = "Google User") {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        aud: "web-client",
        iss: "accounts.google.com",
        email,
        email_verified: "true",
        name,
      }),
    } as Response);
  }

  test("brand-new Google athlete creates an independent athlete account", async () => {
    mockGoogleToken("google.athlete@test.io", "Google Athlete");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "athlete-token", requestedRole: "athlete" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "google.athlete@test.io",
      name: "Google Athlete",
      role: "athlete",
      academyId: null,
      mustChangePassword: false,
    });
    const user = await User.findOne({ email: "google.athlete@test.io" }).lean();
    const profile = await AthleteProfile.findOne({ userId: user!._id }).lean();
    expect(profile?.sport).toBe("Not set");
    expect(await CoachAthleteAssignment.countDocuments({ athleteId: profile!._id })).toBe(0);
  });

  test("brand-new Google coach creates a coach account and can link an existing athlete", async () => {
    const app = buildApp();
    await request(app)
      .post("/api/auth/register-athlete")
      .send({
        name: "Existing Athlete",
        email: "existing.athlete@test.io",
        password: "longenough1",
        sport: "Athletics",
      });
    mockGoogleToken("google.coach@test.io", "Google Coach");

    const coachLogin = await request(app)
      .post("/api/auth/google")
      .send({ credential: "coach-token", requestedRole: "coach" });

    expect(coachLogin.status).toBe(200);
    expect(coachLogin.body.user).toMatchObject({
      email: "google.coach@test.io",
      name: "Google Coach",
      role: "coach",
      academyId: null,
      isAcademyOwner: false,
      mustChangePassword: false,
    });
    const coach = await User.findOne({ email: "google.coach@test.io" }).lean();
    expect(await AthleteProfile.exists({ userId: coach!._id })).toBeFalsy();

    const link = await request(app)
      .post("/api/coach/athletes/link")
      .set("Authorization", `Bearer ${coachLogin.body.accessToken}`)
      .send({ email: "existing.athlete@test.io" });

    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({ linkedExisting: true });

    const roster = await request(app)
      .get("/api/coach/athletes")
      .set("Authorization", `Bearer ${coachLogin.body.accessToken}`);
    expect(roster.status).toBe(200);
    expect(roster.body.athletes.map((a: { email: string }) => a.email)).toContain("existing.athlete@test.io");
  });

  test("native Google sign-in returns an explicit refresh token", async () => {
    mockGoogleToken("native.google.coach@test.io", "Native Google Coach");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "native-coach-token", requestedRole: "coach", client: "native" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "native.google.coach@test.io",
      role: "coach",
    });
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  test("existing Google email keeps its stored role even if another role page is selected", async () => {
    const user = await User.create({
      email: "existing-role@test.io",
      passwordHash: "x",
      role: "athlete",
      name: "Existing Role",
      isActive: true,
    });
    await AthleteProfile.create({ userId: user._id, sport: "Football" });
    mockGoogleToken("existing-role@test.io", "Wrong Role Attempt");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "existing-token", requestedRole: "coach" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "existing-role@test.io",
      role: "athlete",
      name: "Existing Role",
    });
    expect(await User.countDocuments({ email: "existing-role@test.io" })).toBe(1);
    expect(await AthleteProfile.countDocuments({ userId: user._id })).toBe(1);
  });

  test("existing Google athlete without a profile keeps role and gets profile repaired", async () => {
    const user = await User.create({
      email: "missing-profile@test.io",
      passwordHash: "x",
      role: "athlete",
      name: "Missing Profile",
      isActive: true,
    });
    mockGoogleToken("missing-profile@test.io", "Missing Profile Google");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "missing-profile-token", requestedRole: "coach" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "missing-profile@test.io",
      role: "athlete",
      name: "Missing Profile",
    });
    const profile = await AthleteProfile.findOne({ userId: user._id }).lean();
    expect(profile?.sport).toBe("Not set");
  });

  test("existing Google coach keeps coach role even if athlete page is selected", async () => {
    await User.create({
      email: "existing-coach-role@test.io",
      passwordHash: "x",
      role: "coach",
      name: "Existing Coach Role",
      isActive: true,
    });
    mockGoogleToken("existing-coach-role@test.io", "Wrong Athlete Attempt");

    const res = await request(buildApp())
      .post("/api/auth/google")
      .send({ credential: "existing-coach-token", requestedRole: "athlete" });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "existing-coach-role@test.io",
      role: "coach",
      name: "Existing Coach Role",
    });
    const user = await User.findOne({ email: "existing-coach-role@test.io" }).lean();
    expect(user?.role).toBe("coach");
    expect(await AthleteProfile.exists({ userId: user!._id })).toBeFalsy();
  });
});

describe("protected routes", () => {
  test("GET /api/coach/athletes without token returns 401", async () => {
    const res = await request(buildApp()).get("/api/coach/athletes");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
  });
});

describe("POST /api/auth/refresh", () => {
  test("refresh cookie issues a new access token", async () => {
    await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw" });

    const setCookie = login.headers["set-cookie"];
    const cookieArr = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];
    const refreshCookie = cookieArr
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("refreshToken="));
    expect(refreshCookie).toBeTruthy();

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .set("Cookie", refreshCookie!);

    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.accessToken).toBe("string");
    expect(refresh.body.refreshToken).toBeUndefined();
  });

  test("native refresh token in body rotates native tokens", async () => {
    await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw", client: "native" });

    expect(login.status).toBe(200);
    expect(typeof login.body.accessToken).toBe("string");
    expect(typeof login.body.refreshToken).toBe("string");

    const refresh = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: login.body.refreshToken, client: "native" });

    expect(refresh.status).toBe(200);
    expect(typeof refresh.body.accessToken).toBe("string");
    expect(typeof refresh.body.refreshToken).toBe("string");
    expect(refresh.body.refreshToken).not.toBe(login.body.refreshToken);
  });

  test("refresh without cookie returns 401", async () => {
    const res = await request(buildApp()).post("/api/auth/refresh");
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/logout", () => {
  test("clears refreshTokenHash on the user", async () => {
    const coach = await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw" });

    const before = await User.findById(coach._id).lean();
    expect(before?.refreshTokenHash).toBeTruthy();

    const setCookie = login.headers["set-cookie"];
    const cookieArr = Array.isArray(setCookie) ? setCookie : [String(setCookie ?? "")];
    const refreshCookie = cookieArr
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("refreshToken="));

    const logout = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", refreshCookie!);

    expect(logout.status).toBe(200);
    const after = await User.findById(coach._id).lean();
    expect(after?.refreshTokenHash).toBeFalsy();
  });

  test("native logout clears refreshTokenHash from body refresh token", async () => {
    const coach = await makeCoach("pw");
    const app = buildApp();
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "coach@test.io", password: "pw", client: "native" });

    expect(typeof login.body.refreshToken).toBe("string");
    const before = await User.findById(coach._id).lean();
    expect(before?.refreshTokenHash).toBeTruthy();

    const logout = await request(app)
      .post("/api/auth/logout")
      .send({ refreshToken: login.body.refreshToken, client: "native" });

    expect(logout.status).toBe(200);
    const after = await User.findById(coach._id).lean();
    expect(after?.refreshTokenHash).toBeFalsy();
  });
});
