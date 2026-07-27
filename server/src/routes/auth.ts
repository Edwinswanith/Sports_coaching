import { Router, type Request, type Response } from "express";
import { Types } from "mongoose";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { User, type UserDoc } from "../models/User";
import { AthleteProfile } from "../models/AthleteProfile";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../lib/tokens";
import { env } from "../config/env";
import { requireAuth } from "../middleware/auth";
import { avatarSummary } from "../services/avatar";

const router = Router();

const ACCESS_COOKIE = "accessToken";
const REFRESH_COOKIE = "refreshToken";
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 5;
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

/** Test helper: clear the in-memory login rate-limit state between tests. */
export function __resetLoginRateLimit(): void {
  loginAttempts.clear();
}

function readCookie(req: Request, cookieName: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

// In production the web app and API can live on different domains (e.g. separate
// Cloud Run URLs), so auth cookies must be sent on cross-site requests — that
// requires SameSite=None, which browsers only honour together with Secure. In
// dev we stay on Lax: SameSite=None without Secure is rejected over http://localhost.
const COOKIE_SAME_SITE = env.nodeEnv === "production" ? "None" : "Lax";

function cookieParts(cookieName: string, value: string, path: string): string[] {
  const parts: string[] = [
    `${cookieName}=${encodeURIComponent(value)}`,
    `Path=${path}`,
    "HttpOnly",
    `SameSite=${COOKIE_SAME_SITE}`,
  ];
  if (env.nodeEnv === "production") parts.push("Secure");
  return parts;
}

function setAuthCookies(res: Response, accessToken: string, refreshToken: string): void {
  res.setHeader("Set-Cookie", [
    cookieParts(ACCESS_COOKIE, accessToken, "/").join("; "),
    cookieParts(REFRESH_COOKIE, refreshToken, "/api/auth").join("; "),
  ]);
}

function clearAuthCookies(res: Response): void {
  const accessParts: string[] = [
    `${ACCESS_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${COOKIE_SAME_SITE}`,
    "Max-Age=0",
  ];
  const refreshParts: string[] = [
    `${REFRESH_COOKIE}=`,
    "Path=/api/auth",
    "HttpOnly",
    `SameSite=${COOKIE_SAME_SITE}`,
    "Max-Age=0",
  ];
  if (env.nodeEnv === "production") {
    accessParts.push("Secure");
    refreshParts.push("Secure");
  }
  res.setHeader("Set-Cookie", [accessParts.join("; "), refreshParts.join("; ")]);
}

function safeUser(user: UserDoc) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    academyId: user.academyId
      ? (user.academyId as Types.ObjectId).toString()
      : null,
    isAcademyOwner: Boolean(user.isAcademyOwner),
    mustChangePassword: Boolean(user.mustChangePassword),
    avatar: avatarSummary(user),
  };
}

function wantsNativeTokens(req: Request): boolean {
  return (
    req.header("x-client-type")?.toLowerCase() === "native" ||
    req.body?.client === "native"
  );
}

async function issueTokensForUser(
  user: UserDoc,
  res: Response
): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccessToken({
    sub: user._id.toString(),
    role: user.role,
  });
  const refreshToken = signRefreshToken({ sub: user._id.toString() });
  const refreshTokenHash = await bcrypt.hash(refreshToken, 10);
  await User.updateOne({ _id: user._id }, { $set: { refreshTokenHash } });
  setAuthCookies(res, accessToken, refreshToken);
  return { accessToken, refreshToken };
}

async function ensureAthleteProfile(user: UserDoc): Promise<void> {
  if (user.role !== "athlete") return;
  await AthleteProfile.updateOne(
    { userId: user._id },
    {
      $setOnInsert: {
        userId: user._id,
        ...(user.academyId ? { academyId: user.academyId } : {}),
        sport: "Not set",
      },
    },
    { upsert: true }
  );
}

function authResponsePayload(
  req: Request,
  tokens: { accessToken: string; refreshToken: string },
  user: UserDoc
) {
  return {
    accessToken: tokens.accessToken,
    ...(wantsNativeTokens(req) ? { refreshToken: tokens.refreshToken } : {}),
    user: safeUser(user),
  };
}

function readRefreshToken(req: Request): string | null {
  return (
    readCookie(req, REFRESH_COOKIE) ||
    (typeof req.body?.refreshToken === "string" ? req.body.refreshToken : null)
  );
}

function checkLoginRateLimit(req: Request): boolean {
  if (env.nodeEnv === "test") return true;

  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const current = loginAttempts.get(key);

  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  if (current.count >= LOGIN_MAX_ATTEMPTS) {
    return false;
  }

  current.count += 1;
  return true;
}

router.post("/login", async (req: Request, res: Response) => {
  if (!checkLoginRateLimit(req)) {
    res.status(429).json({ error: "too_many_login_attempts" });
    return;
  }

  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    res.status(400).json({ error: "invalid_credentials" });
    return;
  }

  const user = await User.findOne({ email });
  if (!user || !user.isActive) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_credentials" });
    return;
  }

  const tokens = await issueTokensForUser(user, res);
  res.json(authResponsePayload(req, tokens, user));
});

/**
 * POST /api/auth/google
 * body: { credential }  — the Google ID token from Google Identity Services.
 *
 * We verify the token with Google, sign in existing users, and provision
 * first-time Google identities as independent athlete or coach accounts based
 * on the selected login role.
 */
type GoogleTokenInfo = {
  aud?: string;
  iss?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
};

router.post("/google", async (req: Request, res: Response) => {
  if (!env.googleClientId) {
    res.status(503).json({ error: "google_signin_unconfigured" });
    return;
  }
  if (!checkLoginRateLimit(req)) {
    res.status(429).json({ error: "too_many_login_attempts" });
    return;
  }

  const credential =
    typeof req.body?.credential === "string" ? req.body.credential : "";
  const requestedRole =
    typeof req.body?.requestedRole === "string"
      ? req.body.requestedRole.trim().toLowerCase()
      : undefined;
  if (!credential) {
    res.status(400).json({ error: "missing_credential" });
    return;
  }

  // Verify the ID token with Google (checks signature + expiry server-side),
  // then assert the audience/issuer/verification ourselves.
  let info: GoogleTokenInfo;
  try {
    const r = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`
    );
    if (!r.ok) {
      res.status(401).json({ error: "invalid_google_token" });
      return;
    }
    info = (await r.json()) as GoogleTokenInfo;
  } catch {
    res.status(502).json({ error: "google_verification_failed" });
    return;
  }

  const issuerOk =
    info.iss === "accounts.google.com" || info.iss === "https://accounts.google.com";
  const emailVerified = info.email_verified === true || info.email_verified === "true";
  // Accept any configured client as the audience (web/PWA + native Android).
  const audOk = typeof info.aud === "string" && env.googleClientIds.includes(info.aud);
  if (!audOk || !issuerOk || !emailVerified || !info.email) {
    res.status(401).json({ error: "invalid_google_token" });
    return;
  }

  const email = info.email.trim().toLowerCase();
  let user = await User.findOne({ email });

  // A disabled existing account is never silently reactivated.
  if (user && !user.isActive) {
    res.status(403).json({ error: "account_disabled" });
    return;
  }

  // Google sign-up: first-time Google identities are provisioned according to
  // the selected login role. Existing users never change role here.
  if (!user) {
    const signupRole =
      requestedRole === undefined || requestedRole === "athlete"
        ? "athlete"
        : requestedRole === "coach"
        ? "coach"
        : null;
    if (!signupRole) {
      res.status(400).json({ error: "self_signup_role_not_supported" });
      return;
    }

    const displayName =
      typeof info.name === "string" && info.name.trim()
        ? info.name.trim()
        : email.split("@")[0];
    const randomHash = await bcrypt.hash(randomBytes(24).toString("hex"), 10);
    try {
      user = await User.create({
        email,
        passwordHash: randomHash,
        role: signupRole,
        name: displayName,
        isActive: true,
        mustChangePassword: false,
      });
      if (signupRole === "athlete") {
        await AthleteProfile.create({ userId: user._id, sport: "Not set" });
      }
    } catch (err) {
      if (user) await User.deleteOne({ _id: user._id }).catch(() => undefined);
      // Race: the account was created between the lookup and insert — reuse it.
      if ((err as { code?: number }).code === 11000) {
        user = await User.findOne({ email });
      } else {
        throw err;
      }
      if (!user) {
        res.status(500).json({ error: "signup_failed" });
        return;
      }
    }
  }

  await ensureAthleteProfile(user);
  const tokens = await issueTokensForUser(user, res);
  res.json(authResponsePayload(req, tokens, user));
});

/**
 * POST /api/auth/register-athlete
 * body: { name, email, password, sport, position?, timezone? }
 *
 * Self-service athlete sign-up: creates a User(role: athlete) + AthleteProfile
 * with NO coach assignment and NO academy, then signs the new athlete straight
 * in. This is the ONE self-signup path on the platform (by explicit request) so
 * athletes can log their own training/wellness without a coach — coaches and
 * guardians are still provisioned only. A self-registered athlete is simply
 * unassigned, so they remain invisible to every coach until/unless a coach later
 * adds them, which keeps the coach-scope invariant intact.
 */
const REG_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post("/register-athlete", async (req: Request, res: Response) => {
  if (!checkLoginRateLimit(req)) {
    res.status(429).json({ error: "too_many_login_attempts" });
    return;
  }

  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const sport = typeof req.body?.sport === "string" ? req.body.sport.trim() : "";
  const position =
    typeof req.body?.position === "string" && req.body.position.trim()
      ? req.body.position.trim()
      : undefined;
  const timezone =
    typeof req.body?.timezone === "string" && req.body.timezone.trim()
      ? req.body.timezone.trim()
      : "UTC";

  if (!name) {
    res.status(400).json({ error: "invalid_name" });
    return;
  }
  if (!REG_EMAIL_RE.test(email)) {
    res.status(400).json({ error: "invalid_email" });
    return;
  }
  if (password.length < 8) {
    res.status(400).json({ error: "weak_password" });
    return;
  }
  if (!sport) {
    res.status(400).json({ error: "invalid_sport" });
    return;
  }

  if (await User.exists({ email })) {
    res.status(409).json({ error: "email_already_exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  // No DB transactions in this stack — roll back the user if the profile fails.
  let user: UserDoc | null = null;
  try {
    user = await User.create({
      email,
      passwordHash,
      role: "athlete",
      name,
      isActive: true,
      mustChangePassword: false,
    });
    await AthleteProfile.create({
      userId: user._id,
      sport,
      position,
      timezone,
    });
  } catch (err) {
    if (user) await User.deleteOne({ _id: user._id }).catch(() => undefined);
    if ((err as { code?: number }).code === 11000) {
      res.status(409).json({ error: "email_already_exists" });
      return;
    }
    throw err;
  }

  const tokens = await issueTokensForUser(user, res);
  res.status(201).json(authResponsePayload(req, tokens, user));
});

router.post("/refresh", async (req: Request, res: Response) => {
  const token = readRefreshToken(req);
  if (!token) {
    res.status(401).json({ error: "no_refresh_token" });
    return;
  }

  let sub: string;
  try {
    ({ sub } = verifyRefreshToken(token));
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  if (!Types.ObjectId.isValid(sub)) {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  const user = await User.findById(sub);
  if (!user || !user.isActive || !user.refreshTokenHash) {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  const match = await bcrypt.compare(token, user.refreshTokenHash);
  if (!match) {
    clearAuthCookies(res);
    res.status(401).json({ error: "invalid_refresh_token" });
    return;
  }

  const tokens = await issueTokensForUser(user, res);
  res.json(authResponsePayload(req, tokens, user));
});

router.get("/me", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.actor?.userId);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "user_inactive" });
    return;
  }

  res.json({ user: safeUser(user) });
});

router.post("/change-password", requireAuth, async (req: Request, res: Response) => {
  const user = await User.findById(req.actor?.userId);
  if (!user || !user.isActive) {
    res.status(401).json({ error: "user_inactive" });
    return;
  }

  const currentPassword =
    typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
  const newPassword =
    typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

  if (newPassword.length < 8) {
    res.status(400).json({ error: "weak_password" });
    return;
  }

  const ok = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!ok) {
    res.status(401).json({ error: "invalid_current_password" });
    return;
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    res.status(400).json({ error: "same_password" });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.mustChangePassword = false;
  await user.save();

  // Rotate tokens so any other session using the old refresh token is invalidated.
  const tokens = await issueTokensForUser(user, res);
  res.json({ ok: true, ...authResponsePayload(req, tokens, user) });
});

router.post("/logout", async (req: Request, res: Response) => {
  const token = readRefreshToken(req);
  if (token) {
    try {
      const { sub } = verifyRefreshToken(token);
      if (Types.ObjectId.isValid(sub)) {
        await User.updateOne({ _id: sub }, { $unset: { refreshTokenHash: "" } });
      }
    } catch {
      // ignore — we still clear the cookie below
    }
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

export default router;
