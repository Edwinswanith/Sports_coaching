import { expect, test, type Page } from "@playwright/test";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";
const TODAY = new Date().toISOString().slice(0, 10);

const USERS = {
  athlete: { email: "athlete.arjun@acme.test", password: "Athlete@123" },
  coach: { email: "coach.kumar@acme.test", password: "Coach@123" },
  guardian: { email: "parent.rao@acme.test", password: "Guardian@123" },
};

const sessionCache = new Map<keyof typeof USERS, { accessToken: string; refreshToken?: string; user: unknown }>();

async function installSpeechMocks(page: Page) {
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = "en-US";
      continuous = false;
      interimResults = false;
      onstart?: () => void;
      onend?: () => void;
      onerror?: () => void;
      onresult?: (event: unknown) => void;
      stopped = false;
      start() {
        const state = window as unknown as { __askAgentTranscript?: string; __askAgentTranscriptQueue?: string[] };
        const transcript = state.__askAgentTranscriptQueue?.length ? state.__askAgentTranscriptQueue.shift() ?? "" : state.__askAgentTranscript ?? "";
        state.__askAgentTranscript = "";
        setTimeout(() => {
          if (this.stopped) return;
          this.onstart?.();
          if (transcript) this.onresult?.({ results: [[{ transcript }]] });
          if (!this.stopped) this.onend?.();
        }, 20);
      }
      stop() {
        this.stopped = true;
        this.onend?.();
      }
      abort() {
        this.stop();
      }
    }
    (window as any).SpeechRecognition = MockSpeechRecognition;
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
    (window as any).speechSynthesis = {
      speak(utterance: SpeechSynthesisUtterance) {
        setTimeout(() => utterance.onend?.(new Event("end") as SpeechSynthesisEvent), 5);
      },
      cancel() {},
      pause() {},
      resume() {},
      getVoices() {
        return [];
      },
      speaking: false,
      pending: false,
      paused: false,
    };
  });
}

async function login(page: Page, role: keyof typeof USERS) {
  await installSpeechMocks(page);
  let payload = sessionCache.get(role);
  if (!payload) {
    const credentials = USERS[role];
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Type": "native" },
      body: JSON.stringify({ email: credentials.email, password: credentials.password, client: "native" }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
    payload = (await res.json()) as { accessToken: string; refreshToken?: string; user: unknown };
    sessionCache.set(role, payload);
  }
  await page.addInitScript((session) => {
    localStorage.setItem("scp.accessToken", session.accessToken);
    if (session.refreshToken) localStorage.setItem("scp.refreshToken", session.refreshToken);
    localStorage.setItem("scp.user", JSON.stringify(session.user));
    const user = session.user as { id?: string; _id?: string; role?: string };
    const id = user.id ?? user._id;
    const roleName = user.role ?? session.role;
    if (id && roleName) localStorage.setItem(`scp.mobile.tour.seen.${id}.${roleName}`, "1");
  }, { ...payload, role });
  await page.goto(`/${role}/dashboard`);
  await expect(page.getByRole("button", { name: "Ask agent" }).last()).toBeVisible({ timeout: 20_000 });
  await dismissTour(page);
}

async function registerFreshAthlete(page: Page) {
  await installSpeechMocks(page);
  const unique = Date.now();
  const res = await fetch(`${API_BASE}/api/auth/register-athlete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Client-Type": "native" },
    body: JSON.stringify({
      name: `Fresh Athlete ${unique}`,
      email: `fresh-athlete-${unique}@acme.test`,
      password: "Athlete@123",
      sport: "Athletics",
      position: "Runner",
      client: "native",
    }),
  });
  if (!res.ok) throw new Error(`register fresh athlete failed: ${res.status} ${await res.text()}`);
  const payload = (await res.json()) as { accessToken: string; refreshToken?: string; user: unknown };
  await page.addInitScript((session) => {
    localStorage.setItem("scp.accessToken", session.accessToken);
    if (session.refreshToken) localStorage.setItem("scp.refreshToken", session.refreshToken);
    localStorage.setItem("scp.user", JSON.stringify(session.user));
    const user = session.user as { id?: string; _id?: string };
    const id = user.id ?? user._id;
    if (id) localStorage.setItem(`scp.mobile.tour.seen.${id}.athlete`, "1");
  }, payload);
  await page.goto("/athlete/dashboard");
  await expect(page.getByRole("button", { name: "Ask agent" }).last()).toBeVisible({ timeout: 20_000 });
  await dismissTour(page);
}

async function token(page: Page) {
  const value = await page.evaluate(() => localStorage.getItem("scp.accessToken"));
  if (!value) throw new Error("No mobile access token in localStorage");
  return value;
}

async function api<T>(page: Page, path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await token(page);
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function isAskAgentActive(page: Page) {
  if (await page.getByLabel("Dismiss Ask agent").isVisible().catch(() => false)) return true;
  const button = page.getByRole("button", { name: "Ask agent" }).last();
  const selected = await button
    .evaluate((el) => el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true")
    .catch(() => false);
  if (selected) return true;
  return page.getByText(/Listening|Speaking|Working|Tap to stop|Executing/i).isVisible().catch(() => false);
}

async function stopAskAgentIfActive(page: Page) {
  if (!(await isAskAgentActive(page))) return;
  const dismiss = page.getByLabel("Dismiss Ask agent");
  if (await dismiss.isVisible().catch(() => false)) {
    await dismiss.click({ timeout: 3000 }).catch(() => page.mouse.click(8, 8));
    await page.waitForTimeout(250);
    return;
  }
  const button = page.getByRole("button", { name: "Ask agent" }).last();
  await button.click({ timeout: 3000 }).catch(() => page.mouse.click(8, 8));
  await page.waitForTimeout(250);
}

async function ask(page: Page, command: string) {
  await dismissTour(page);
  await dismissInfoSheet(page);
  await stopAskAgentIfActive(page);
  const button = page.getByRole("button", { name: "Ask agent" }).last();
  await page.evaluate((text) => {
    (window as unknown as { __askAgentTranscript?: string }).__askAgentTranscript = text;
  }, command);
  await button.click({ timeout: 3000 }).catch(() => button.click({ force: true }));
}

async function askVoiceSequence(page: Page, commands: string[], finalText: RegExp | string) {
  await dismissTour(page);
  await dismissInfoSheet(page);
  await stopAskAgentIfActive(page);
  const button = page.getByRole("button", { name: "Ask agent" }).last();
  await page.evaluate((items) => {
    (window as unknown as { __askAgentTranscriptQueue?: string[] }).__askAgentTranscriptQueue = [...items];
  }, commands);
  await button.click({ timeout: 3000 }).catch(() => button.click({ force: true }));
  await expect(page.getByText(finalText).last()).toBeVisible({ timeout: 30_000 });
  await stopAskAgentIfActive(page);
}

async function typeAsk(page: Page, command: string) {
  await dismissInfoSheet(page);
  await dismissCalendar(page);
  const input = page.getByPlaceholder("Ask agent");
  if (!(await input.isVisible().catch(() => false))) {
    const button = page.getByRole("button", { name: "Ask agent" }).last();
    if (!(await button.isVisible().catch(() => false))) {
      await page.goto("/athlete/dashboard");
      await expect(page.getByRole("button", { name: "Ask agent" }).last()).toBeVisible({ timeout: 10_000 });
    }
    await button.click({ delay: 3200, timeout: 5000 }).catch(() => button.click({ delay: 3200, force: true }));
  }
  await expect(input).toBeVisible({ timeout: 5000 });
  await input.fill(command);
  await input.press("Enter");
  await page.waitForTimeout(150);
}

async function dismissInfoSheet(page: Page) {
  const close = page.getByLabel("Close result");
  if (await close.isVisible().catch(() => false)) {
    await close.click();
    await expect(close).toHaveCount(0, { timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
}

async function dismissTour(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const skip = page.getByLabel("Skip tour").first();
    if (!(await skip.isVisible().catch(() => false))) return;
    await skip.click({ timeout: 3000 }).catch(() => skip.click({ force: true }));
    await expect(skip).not.toBeVisible({ timeout: 3000 }).catch(() => undefined);
  }
}

async function dismissCalendar(page: Page) {
  const cancel = page.getByText("Cancel");
  if (await cancel.isVisible().catch(() => false)) {
    await cancel.click();
    await expect(cancel).not.toBeVisible({ timeout: 3000 }).catch(() => undefined);
  }
}

async function expectAskResultRows(page: Page, title: string, rows: string[]) {
  await expect(page.getByText(title, { exact: true }).last()).toBeVisible();
  for (const row of rows) {
    await expect(page.getByLabel(`Open ${row}`)).toHaveCount(1);
  }
}

async function expectAskResultRowsAbsent(page: Page, rows: string[]) {
  for (const row of rows) {
    await expect(page.getByLabel(`Open ${row}`)).toHaveCount(0);
  }
}

function wellnessFiveToTen(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return Math.max(1, Math.min(10, Math.round(1 + ((value - 1) * 9) / 4)));
}

type AskAgentMatrixCase = {
  name: string;
  command: string;
  title?: string;
  rows?: string[];
  absentRows?: string[];
  text?: RegExp | string;
  forbiddenText?: Array<RegExp | string>;
};

async function runAskMatrixCase(page: Page, item: AskAgentMatrixCase) {
  await test.step(`${item.name}: ${item.command}`, async () => {
    await typeAsk(page, item.command);
    if (item.title || item.rows) await expectAskResultRows(page, item.title ?? item.rows?.[0] ?? "Ask Agent", item.rows ?? []);
    if (item.absentRows) await expectAskResultRowsAbsent(page, item.absentRows);
    if (item.text) await expect(page.getByText(item.text).last()).toBeVisible();
    for (const forbidden of item.forbiddenText ?? []) {
      await expect(page.getByText(forbidden)).toHaveCount(0);
    }
  });
}

function dateKeyFromOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test.describe("mobile Ask agent athlete workflows", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    if (testInfo.title.includes("no-check-in day") || testInfo.title.includes("voice-only guided follow-ups")) return;
    await login(page, "athlete");
  });

  test("creates, edits, saves, and verifies athlete logs through Ask agent", async ({ page }) => {
    await ask(page, "set today rest day");
    await expect(page.getByText("Today is set as a rest day.")).toBeVisible();
    await expect
      .poll(async () => {
        const daily = await api<{ card: { isRestDay?: boolean; attendance: { status: string | null } } }>(
          page,
          `/api/athlete/daily?date=${TODAY}`
        );
        return daily.card.isRestDay || daily.card.attendance.status === "rest";
      })
      .toBe(true);

    await ask(page, "remove rest day");
    await expect(page.getByText("Rest day removed for today.").first()).toBeVisible();
    await expect
      .poll(async () => {
        const daily = await api<{ card: { isRestDay?: boolean; attendance: { status: string | null } } }>(
          page,
          `/api/athlete/daily?date=${TODAY}`
        );
        return daily.card.isRestDay || daily.card.attendance.status === "rest";
      })
      .toBe(false);

    await ask(page, "set session RPM is 5");
    await expect(page.getByText(/RPM updated|session updated/i)).toBeVisible();
    await expect
      .poll(async () => {
        const rpe = await api<{ entries: { sessionType: string; rpe: number }[] }>(
          page,
          `/api/athlete/rpe-monitoring?date=${TODAY}`
        );
        return rpe.entries.some((entry) => entry.rpe === 5);
      })
      .toBe(true);

    await ask(page, "add season note for e2e ask agent note");
    await expect(page.getByText(/session updated/i)).toBeVisible();
    await expect
      .poll(async () => {
        const sessions = await Promise.all(
          ["AM", "AFT", "PM"].map((slot) =>
            api<{ session: { notes?: string | null } | null }>(page, `/api/athlete/training/${slot}?date=${TODAY}`)
          )
        );
        return sessions.map((item) => item.session?.notes ?? "").join("\n");
      })
      .toContain("e2e ask agent note");

    const beforeWater = await api<{ totalMl: number }>(page, `/api/athlete/water?date=${TODAY}`);
    await ask(page, "add 250 ml water");
    await expect(page.getByText("Logged 250 ml of water.").first()).toBeVisible();
    await expect
      .poll(async () => {
        const water = await api<{ totalMl: number }>(page, `/api/athlete/water?date=${TODAY}`);
        return water.totalMl;
      })
      .toBeGreaterThanOrEqual(beforeWater.totalMl + 250);
  });

  test("opens sections, information sheets, and clickable sheet rows", async ({ page }) => {
    await ask(page, "open skill logs");
    await expect(page.getByText("PM session")).toBeVisible();

    await ask(page, "I want to update my pm session so could you go to the PM session");
    await expect(page.getByText("PM session", { exact: true })).toBeVisible();

    await ask(page, "navigate to PM Kisan");
    await expect(page.getByText("PM session", { exact: true })).toBeVisible();

    await ask(page, "PM section");
    await expect(page.getByText("PM session", { exact: true })).toBeVisible();

    await ask(page, "PM RPM 4");
    await expect(page.getByText(/PM RPM updated|PM session updated/i)).toBeVisible();
    await expect(page.getByText("PM session", { exact: true })).toBeVisible();

    await ask(page, "show which today activities are pending today");
    await expect(page.getByText("Activities To Update Today")).toBeVisible();
    await page.getByLabel(/Open .*session/i).first().click();
    await expect(page.getByText(/session/).first()).toBeVisible();

    await ask(page, "tell me how many water will consume today");
    await expect(page.getByText("Hydration Today")).toBeVisible();
    await page.getByLabel("Open Remaining").click();
    await expect(page.getByText("Water goal", { exact: true })).toBeVisible();

    await ask(page, "any message from coach");
    await expect(page.getByText("Coach Messages")).toBeVisible();
    await page.getByLabel(/Open Coach/i).first().click();
    await expect(page.getByText(/Direct message|Coach updates|Coach feedback/)).toBeVisible();
  });

  test("builds request-specific report sheets instead of default daily content", async ({ page }) => {
    await ask(page, "gether last week report");
    await expect(page.getByText("Last Week Report")).toBeVisible();
    await expect(page.getByText("Overview")).toBeVisible();
    await expect(page.getByText("What's driving it")).toBeVisible();
    await expect(page.getByText("Focus for the next 3 days")).toBeVisible();
    await expect(page.getByText("Today Summary")).toHaveCount(0);
    await dismissInfoSheet(page);

    await ask(page, "what area can i improve");
    await expect(page.getByText("Areas To Improve")).toBeVisible();
    await expect(page.getByText("Overview")).toBeVisible();
    await expect(page.getByText("Why this is the priority")).toBeVisible();
    await expect(page.getByText("Action plan for the next 3 days")).toBeVisible();
    await expect(page.getByLabel("Open Recovery")).toHaveCount(0);

    await ask(page, "what area i down");
    await expect(page.getByText("Areas Trending Down")).toBeVisible();
    await expect(page.getByText(/Load control|Hydration|Recovery|Sleep/).first()).toBeVisible();
    await expect(page.getByText("Today Summary")).toHaveCount(0);
  });

  test("creates first daily check-in on a no-check-in day through voice", async ({ page }) => {
    await registerFreshAthlete(page);

    const before = await api<{ card: { readinessScore: number | null; sleep: { quality: number | null; hours: number | null } } }>(
      page,
      `/api/athlete/daily?date=${TODAY}`
    );
    expect(before.card.readinessScore).toBeNull();
    expect(before.card.sleep.quality).toBeNull();

    await ask(page, "show pending activities today");
    await expect(page.getByText("Activities To Update Today")).toBeVisible();
    await expect(page.getByLabel("Open Check-in")).toBeVisible();

    await ask(page, "check-in sleep quality 8 mood 7 stress 3 soreness 2 fatigue 4 sleep hours 7");
    await expect(page.getByText("Check-in saved.").last()).toBeVisible();

    await expect
      .poll(async () => {
        const daily = await api<{ card: { readinessScore: number | null; sleep: { quality: number | null; hours: number | null } } }>(
          page,
          `/api/athlete/daily?date=${TODAY}`
        );
        return {
          readiness: daily.card.readinessScore,
          quality: daily.card.sleep.quality,
          hours: daily.card.sleep.hours,
        };
      })
      .toMatchObject({ quality: expect.any(Number), hours: 7 });
  });

  test("sends only the intended coach message body from a two-turn Ask request", async ({ page }) => {
    const coaches = await api<{ coaches: { coachId: string }[] }>(page, "/api/athlete/coaches");
    const coachId = coaches.coaches[0]?.coachId;
    expect(coachId).toBeTruthy();

    const body = `I won't be available for the coaching today ${Date.now()}`;
    await typeAsk(page, "can you send the message to coach setting that");
    await expect(page.getByText("What message would you like to send?").last()).toBeVisible();

    await typeAsk(page, `stating that ${body}`);
    await expect(page.getByText("Message sent to coach.").last()).toBeVisible();

    await expect
      .poll(async () => {
        const thread = await api<{ messages: { body: string }[] }>(page, `/api/athlete/messages/${coachId}?limit=10`);
        return thread.messages.map((message) => message.body);
      })
      .toContain(body);
    const thread = await api<{ messages: { body: string }[] }>(page, `/api/athlete/messages/${coachId}?limit=10`);
    expect(thread.messages.some((message) => message.body.includes("can you send the message"))).toBe(false);
    expect(thread.messages.some((message) => message.body.includes("stating that"))).toBe(false);
  });

  test("updates AM, afternoon, and PM session check-ins through voice-only guided follow-ups", async ({ page }) => {
    await registerFreshAthlete(page);

    await ask(page, "check-in sleep quality 7 mood 6 stress 3 soreness 2 fatigue 3 sleep hours 7");
    await expect(page.getByText("Check-in saved.").last()).toBeVisible();

    await askVoiceSequence(
      page,
      ["update the a.m. section", "ENDURANCE", "6", "70", "2", "3", "8"],
      /AM session check-in updated/i
    );
    await askVoiceSequence(
      page,
      ["update afternoon section", "TECHNIQUE", "7", "75", "3", "4", "7"],
      /Afternoon session check-in updated/i
    );
    await askVoiceSequence(
      page,
      ["update PM section", "STRENGTH", "5", "60", "2", "2", "8"],
      /PM session check-in updated/i
    );

    await expect
      .poll(async () => {
        const rpe = await api<{ entries: { sessionType: string; rpe: number; plannedIntensityPercent: number }[] }>(
          page,
          `/api/athlete/rpe-monitoring?date=${TODAY}`
        );
        return Object.fromEntries(rpe.entries.map((entry) => [entry.sessionType, entry]));
      })
      .toMatchObject({
        AM: { rpe: 6, plannedIntensityPercent: 70 },
        AFT: { rpe: 7, plannedIntensityPercent: 75 },
        PM: { rpe: 5, plannedIntensityPercent: 60 },
      });

    await ask(page, "what all the things I need to update today");
    await expect(page.getByText(/Today Summary|Activities To Update Today/).last()).toBeVisible();
    await expect(page.getByText(/I couldn't match|I couldn't find that data/i)).toHaveCount(0);

    await dismissInfoSheet(page);
    await ask(page, "so how is my progress over what all the things to you suggest me to");
    await expect(page.getByText("Areas To Improve")).toBeVisible();
    await expect(page.getByText("Action plan for the next 3 days")).toBeVisible();
    await expect(page.getByText(/I couldn't match|I couldn't find that data/i)).toHaveCount(0);
  });

  test("updates specific session RPE fields without misreporting them as only RPM", async ({ page }) => {
    await typeAsk(page, "open afternoon session");
    await expect(page.getByText("Afternoon session", { exact: true })).toBeVisible();

    await typeAsk(page, "reduce the plan intensity to 6");
    await expect(page.getByText("Afternoon planned intensity updated.").last()).toBeVisible();

    await typeAsk(page, "increase the fatigue score to 7");
    await expect(page.getByText("Afternoon fatigue updated.").last()).toBeVisible();

    await typeAsk(page, "reduce the soreness to 8");
    await expect(page.getByText("Afternoon soreness updated.").last()).toBeVisible();

    await expect
      .poll(async () => {
        const rpe = await api<{ entries: { sessionType: string; plannedIntensityPercent: number; fatigue?: number; muscleSoreness?: number }[] }>(
          page,
          `/api/athlete/rpe-monitoring?date=${TODAY}`
        );
        const afternoon = rpe.entries.find((entry) => entry.sessionType === "AFT");
        return {
          plannedIntensityPercent: afternoon?.plannedIntensityPercent,
          fatigue: wellnessFiveToTen(afternoon?.fatigue),
          soreness: wellnessFiveToTen(afternoon?.muscleSoreness),
        };
      })
      .toMatchObject({ plannedIntensityPercent: 6, fatigue: 7, soreness: 8 });
  });

  test("returns only requested athlete data for single metric questions", async ({ page }) => {
    await typeAsk(page, "what is my sleep score");
    await expectAskResultRows(page, "Sleep", ["Sleep"]);
    await expectAskResultRowsAbsent(page, ["Readiness", "Recovery", "Training load", "Heart rate"]);
    await expect(page.getByText(/Update your training or check-in data/i)).toHaveCount(0);
    await dismissInfoSheet(page);

    await typeAsk(page, "what is my current heart beat rate");
    await expectAskResultRows(page, "Heart rate", ["Heart rate"]);
    await expectAskResultRowsAbsent(page, ["Readiness", "Sleep", "Recovery", "Training load"]);
    await expect(page.getByText(/Your readiness is/i)).toHaveCount(0);
    await dismissInfoSheet(page);

    await typeAsk(page, "what is my recovery score");
    await expectAskResultRows(page, "Recovery", ["Recovery"]);
    await expectAskResultRowsAbsent(page, ["Readiness", "Sleep", "Heart rate", "Training load"]);
  });

  test("returns all requested athlete data in one multi-metric result", async ({ page }) => {
    await typeAsk(page, "show all my data today including sleep recovery load water streak fatigue soreness and heart rate");
    await expectAskResultRows(page, "Your Data Today", [
      "Readiness",
      "Sleep",
      "Recovery",
      "Training load",
      "Water",
      "Streak",
      "Fatigue",
      "Soreness",
      "Heart rate",
    ]);
    await expect(page.getByText(/Update your training or check-in data/i)).toHaveCount(0);
    await expect(page.getByText(/Your readiness is/i)).toHaveCount(0);
  });

  test("handles 50 natural-language Ask agent queries across read, report, create, and update workflows", async ({ page }) => {
    test.setTimeout(1_200_000);
    const unique = Date.now();
    const cases: AskAgentMatrixCase[] = [
      {
        name: "single sleep score",
        command: "what is my sleep score",
        title: "Sleep",
        rows: ["Sleep"],
        absentRows: ["Readiness", "Recovery", "Training load", "Heart rate"],
        forbiddenText: [/Update your training or check-in data/i, /Your readiness is/i],
      },
      { name: "single recovery score", command: "what is my recovery score", title: "Recovery", rows: ["Recovery"], absentRows: ["Readiness", "Sleep", "Heart rate"] },
      { name: "single training load", command: "show my training load", title: "Training load", rows: ["Training load"], absentRows: ["Readiness", "Sleep", "Recovery"] },
      { name: "single fatigue", command: "what is my fatigue", title: "Fatigue", rows: ["Fatigue"], absentRows: ["Readiness", "Sleep", "Heart rate"] },
      { name: "single soreness", command: "tell me my soreness score", title: "Soreness", rows: ["Soreness"], absentRows: ["Readiness", "Sleep", "Heart rate"] },
      { name: "single heart rate", command: "what is my current heart beat rate", title: "Heart rate", rows: ["Heart rate"], absentRows: ["Readiness", "Sleep", "Recovery"] },
      { name: "single readiness", command: "what is my readiness", title: "Readiness", rows: ["Readiness"], absentRows: ["Sleep", "Recovery", "Heart rate"] },
      { name: "single water status", command: "how many water remaining today", title: "Hydration Today", rows: ["Consumed", "Daily goal", "Remaining"] },
      { name: "single streak", command: "show my streak", title: "Streak", rows: ["Streak"] },
      {
        name: "all metric data",
        command: "show all my data today including sleep recovery load water streak fatigue soreness and heart rate",
        title: "Your Data Today",
        rows: ["Readiness", "Sleep", "Recovery", "Training load", "Water", "Streak", "Fatigue", "Soreness", "Heart rate"],
        forbiddenText: [/Update your training or check-in data/i, /Your readiness is/i],
      },
      { name: "profile name", command: "what is my name", title: "Your Profile", text: /Your name is/i },
      { name: "profile app age", command: "how many days using this app", title: "Your Profile", text: /using this app|could not confirm/i },
      { name: "profile overview", command: "show my personal profile", title: "Your Profile", text: /profile|name is|profile name/i },
      { name: "profile email lookup", command: "what is my email", title: "Your Profile", text: /Your email is|could not find an email/i },
      { name: "notification lookup", command: "show my unread notifications", title: "Notifications", text: /unread notification/i },
      { name: "today summary", command: "what is today status", title: "Today Summary", rows: ["Check-in", "AM session", "Afternoon session", "PM session", "Recovery"] },
      { name: "pending today", command: "show pending activities today", title: "Activities To Update Today", text: /need attention|No activities need updating/i },
      { name: "weekly report", command: "get last week report", title: "Last Week Report", text: /Overview|Focus for the next 3 days/i },
      { name: "improvement report", command: "what area can i improve", title: "Areas To Improve", text: /Action plan for the next 3 days/i },
      { name: "down report", command: "what areas are trending down", title: "Areas Trending Down", text: /low-readiness|load flag|injury-flagged|found/i },
      { name: "create water 10ml", command: "add 10 ml water", text: "Logged 10 ml of water." },
      { name: "create water litres", command: "log 0.02 L water", text: "Logged 20 ml of water." },
      { name: "set rest day", command: "set today rest day", text: "Today is set as a rest day." },
      { name: "remove rest day", command: "remove rest day", text: "Rest day removed for today." },
      { name: "update wake heart rate", command: "set wake heart rate 61", text: "Wake heart rate saved." },
      { name: "update bed heart rate", command: "set bed heart rate 68", text: "Bed heart rate saved." },
      { name: "update sleep hours", command: "sleep 7.5 hours", text: "Sleep is updated." },
      { name: "update sleep score", command: "set sleep score 8", text: "Sleep is updated." },
      { name: "update check-in wellness", command: "check-in mood 7 stress 3 soreness 2 fatigue 4", text: "Check-in saved." },
      { name: "update AM RPM", command: "AM RPM 6", text: /AM RPM updated|AM session updated/i },
      { name: "update afternoon RPM", command: "afternoon RPM 5", text: /Afternoon RPM updated|Afternoon session updated/i },
      { name: "update PM RPM", command: "PM RPM 4", text: /PM RPM updated|PM session updated/i },
      { name: "update AM duration", command: "AM duration 45 minutes", text: /AM session updated|AM RPM updated/i },
      { name: "update afternoon effort", command: "afternoon effort 6", text: /Afternoon session updated|Afternoon RPM updated/i },
      { name: "update PM intensity", command: "PM planned intensity 65", text: /PM planned intensity updated|PM session check-in updated/i },
      { name: "complete AM training", command: "AM training completed", text: /AM session updated|AM RPM updated/i },
      { name: "partial afternoon training", command: "afternoon training partial", text: /Afternoon session updated|Afternoon RPM updated/i },
      { name: "miss PM training", command: "PM training missed", text: /PM session updated|PM RPM updated/i },
      { name: "update AM workout type", command: "set AM workout ENDURANCE", text: /AM session updated|AM RPM updated/i },
      { name: "update body condition", command: "AM body condition feels fresh", text: /AM body condition updated|AM session check-in updated/i },
      { name: "create session note", command: `add PM session note matrix session note ${unique}`, text: /PM session updated|PM RPM updated/i },
      { name: "create private note", command: `note matrix private note ${unique}`, text: "Note saved." },
      { name: "save recovery action", command: "press save recovery", text: "Recovery saved." },
      { name: "create another water log", command: "drink 15 ml water", text: "Logged 15 ml of water." },
      { name: "update sleep and mood", command: "check-in sleep 7 hours mood 8", text: "Check-in saved." },
      { name: "update morning heart rate phrasing", command: "set morning heart rate 62", text: "Wake heart rate saved." },
      { name: "update night heart rate phrasing", command: "set night heart rate 66", text: "Bed heart rate saved." },
      { name: "update AM fatigue", command: "AM fatigue 5", text: /AM fatigue updated|AM session check-in updated/i },
      { name: "update afternoon soreness", command: "afternoon soreness 3", text: /Afternoon soreness updated|Afternoon session check-in updated/i },
      { name: "update mood without a session", command: "update mood to 7", text: "Mood is updated." },
      { name: "create coach message", command: `tell coach matrix message ${unique}`, text: new RegExp(`matrix message ${unique}`) },
    ];

    expect(cases).toHaveLength(51);
    for (const item of cases) await runAskMatrixCase(page, item);
  });

  test("redirect commands open notifications, calendar, and date views", async ({ page }) => {
    await ask(page, "move to yesterday");
    await expect(page.getByText(dateKeyFromOffset(-1), { exact: true })).toBeVisible();

    await ask(page, "open calendar");
    await expect(page.getByText(/Selected/)).toBeVisible();

    await dismissCalendar(page);
    await dismissInfoSheet(page);
    await ask(page, "open notification");
    await expect(page).toHaveURL(/\/notifications/);
  });
});

test.describe("mobile Ask agent coach and guardian workflows", () => {
  test("coach Ask agent is global and can send squad announcements", async ({ page }) => {
    await login(page, "coach");

    await page.goto("/coach/messages");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();

    const body = `e2e global announce ${Date.now()}`;
    await ask(page, `announce ${body}`);
    await expect(page.getByText("Announcement Sent")).toBeVisible();
    await expect(page.getByText(body)).toBeVisible();
    await expect
      .poll(async () => {
        const res = await api<{ announcements: { body: string }[] }>(page, "/api/coach/announcements");
        return res.announcements.some((item) => item.body === body);
      })
      .toBe(true);

    await dismissInfoSheet(page);
    const naturalBody = `Hello guys ${Date.now()}`;
    await ask(page, `message of announcement to all athlete of ${naturalBody}`);
    await expect(page.getByText("Announcement Sent")).toBeVisible();
    await expect(page.getByText(naturalBody)).toBeVisible();
    await expect
      .poll(async () => {
        const res = await api<{ announcements: { body: string }[] }>(page, "/api/coach/announcements");
        return res.announcements.some((item) => item.body === naturalBody);
      })
      .toBe(true);

    await page.goto("/coach/announcements");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();

    await page.goto("/coach/athletes");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();

    await page.goto("/coach/athletes/new");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();
  });

  test("athlete Ask agent is visible outside the dashboard", async ({ page }) => {
    await login(page, "athlete");

    await page.goto("/athlete/water");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();

    await page.goto("/athlete/trends");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();

    await page.goto("/athlete/rpe");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();
  });

  test("coach Ask agent routes to all major coach sections", async ({ page }) => {
    await login(page, "coach");

    await typeAsk(page, "show attention");
    await expect(page.getByText("Attention Report")).toBeVisible();
    await expect(page.getByLabel(/Open Bala|Open Chetan/).first()).toBeVisible();

    await typeAsk(page, "squad report");
    await expect(page.getByText("Squad Report")).toBeVisible();
    await expect(page.getByText("Avg readiness").last()).toBeVisible();

    await typeAsk(page, "athletes reports");
    await expect(page.getByText("Squad Report")).toBeVisible();
    await expect(page.getByLabel("Open Athletes")).toBeVisible();

    await typeAsk(page, "who is best athlete");
    await expect(page.getByText("Best Athlete")).toBeVisible();
    await expect(page.getByLabel(/Open .+/).filter({ hasText: /Arjun|Bala|Chetan|Best athlete/i }).first()).toBeVisible();
    await expect(page.getByLabel("Open Needs attention")).toHaveCount(0);

    await typeAsk(page, "listout the athlete");
    await expect(page.getByText(/Roster Report|Athlete List/)).toBeVisible();
    await expect(page.getByLabel(/Open Arjun|Open Bala|Open Chetan/).first()).toBeVisible();

    await typeAsk(page, "who is absented");
    await expect(page.getByText("Absent Athletes", { exact: true })).toBeVisible();

    await typeAsk(page, "who is injury today");
    await expect(page.getByText("Injury Report", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Open Bala|Open No injured athletes/).first()).toBeVisible();

    await typeAsk(page, "show athlete notes");
    await expect(page.getByText("Athlete Notes", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Open Arjun|Open Bala|Open Chetan|Open Athlete notes/).first()).toBeVisible();

    await typeAsk(page, "open roster");
    await expect(page).toHaveURL(/\/coach\/athletes/);

    await ask(page, "open calendar");
    await expect(page.getByText(/Selected/)).toBeVisible();

    await dismissCalendar(page);
    await ask(page, "open messages");
    await expect(page).toHaveURL(/\/coach\/messages/);

    await page.goto("/coach/dashboard");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();
    await ask(page, "open announcements");
    await expect(page).toHaveURL(/\/coach\/announcements/);

    await page.goto("/coach/dashboard");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();
    await ask(page, "add athlete");
    await expect(page).toHaveURL(/\/coach\/athletes\/new/);

    await page.goto("/coach/dashboard");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();
    await ask(page, "open notifications");
    await expect(page).toHaveURL(/\/notifications/);
  });

  test("coach Ask agent answers dated squad status and individual athlete data reports", async ({ page }) => {
    await login(page, "coach");
    const yesterday = dateKeyFromOffset(-1);
    const dashboard = await api<{ cards: { athleteId: string; name: string; readinessScore: number | null }[] }>(
      page,
      `/api/coach/dashboard?date=${TODAY}`
    );
    const firstAthlete = dashboard.cards[0];
    expect(firstAthlete?.name).toBeTruthy();

    await typeAsk(page, "who is absent yesterday");
    await expect(page.getByText("Absent Athletes", { exact: true })).toBeVisible();
    await expect(page.getByText(yesterday, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/absent athlete|No absent athletes/i).last()).toBeVisible();

    await typeAsk(page, "who is not check-int yesterday");
    await expect(page.getByText("Check-in Report", { exact: true })).toBeVisible();
    await expect(page.getByText(yesterday, { exact: true }).last()).toBeVisible();
    await expect(page.getByText(/not checked in|Everyone checked in/i).last()).toBeVisible();

    await typeAsk(page, "show all type of squad report generation");
    await expect(page.getByText("Squad Report", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Open Athletes")).toBeVisible();
    await expect(page.getByText("Avg readiness").last()).toBeVisible();
    await expect(page.getByText("Sessions done").last()).toBeVisible();

    await typeAsk(page, `give ${firstAthlete.name} separate athlete status`);
    await expect(page.getByText(`${firstAthlete.name} Status Report`, { exact: true })).toBeVisible();
    await expect(page.getByText(`give ${firstAthlete.name} separate athlete status`).last()).toBeVisible();
    await expect(page.getByLabel("Open Attendance")).toBeVisible();
    await expect(page.getByLabel("Open Readiness")).toBeVisible();
    await expect(page.getByLabel("Open Recovery")).toBeVisible();

    await typeAsk(page, "what about recovery");
    await expect(page.getByText(`${firstAthlete.name} Status Report`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Open Recovery")).toBeVisible();
    await expect(page.getByText("what about recovery").last()).toBeVisible();

    await typeAsk(page, "give last athlete 1 heathbeat report");
    await expect(page.getByText(`${firstAthlete.name} Heartbeat Report`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Open Heart rate")).toBeVisible();
    await expect(page.getByText(/wake .*bpm|--/i).last()).toBeVisible();

    await typeAsk(page, `show ${firstAthlete.name} wellness report fatigue soreness mood stress`);
    await expect(page.getByText(`${firstAthlete.name} Status Report`, { exact: true })).toBeVisible();
    await expect(page.getByLabel("Open Fatigue")).toBeVisible();
    await expect(page.getByLabel("Open Soreness")).toBeVisible();
    await expect(page.getByLabel("Open Mood")).toBeVisible();
    await expect(page.getByLabel("Open Stress")).toBeVisible();
  });

  test("guardian Ask agent opens date controls, athlete detail, and notifications", async ({ page }) => {
    await login(page, "guardian");

    await ask(page, "open calendar");
    await expect(page.getByText(/Selected/)).toBeVisible();

    await dismissCalendar(page);
    await ask(page, "next day");
    await expect(page.getByText(/Sleep quality|Water intake|Attendance/).first()).toBeVisible();

    await ask(page, "open athlete details");
    await expect(page).toHaveURL(/\/guardian\/athletes\//);

    await page.goto("/guardian/dashboard");
    await expect(page.getByLabel("Ask agent").last()).toBeVisible();
    await ask(page, "open notifications");
    await expect(page).toHaveURL(/\/notifications/);
  });
});
