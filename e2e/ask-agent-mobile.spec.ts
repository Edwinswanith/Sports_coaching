import { expect, test, type Page } from "@playwright/test";

const API_BASE = process.env.API_BASE_URL ?? "http://localhost:4000";
const TODAY = new Date().toISOString().slice(0, 10);

const USERS = {
  athlete: { email: "athlete.arjun@acme.test", password: "Athlete@123" },
  coach: { email: "coach.kumar@acme.test", password: "Coach@123" },
  guardian: { email: "parent.rao@acme.test", password: "Guardian@123" },
};

async function login(page: Page, role: keyof typeof USERS) {
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = "en-US";
      continuous = false;
      interimResults = false;
      onstart?: () => void;
      onend?: () => void;
      onerror?: () => void;
      onresult?: (event: unknown) => void;
      start() {
        const transcript = (window as unknown as { __askAgentTranscript?: string }).__askAgentTranscript ?? "";
        setTimeout(() => {
          this.onstart?.();
          this.onresult?.({ results: [[{ transcript }]] });
          this.onend?.();
        }, 20);
      }
    }
    (window as any).SpeechRecognition = MockSpeechRecognition;
    (window as any).webkitSpeechRecognition = MockSpeechRecognition;
  });
  await page.goto(`/login/${role}`);
  await page.getByPlaceholder("you@academy.com").fill(USERS[role].email);
  await page.getByPlaceholder("••••••••").fill(USERS[role].password);
  await page.getByText(`Sign in as ${role}`).click();
  await expect(page.getByLabel("Ask agent").last()).toBeVisible({ timeout: 20_000 });
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

async function ask(page: Page, command: string) {
  await page.evaluate((text) => {
    (window as unknown as { __askAgentTranscript?: string }).__askAgentTranscript = text;
  }, command);
  const button = page.getByLabel("Ask agent").last();
  await button.click({ timeout: 3000 }).catch(() => button.click({ force: true }));
}

async function dismissInfoSheet(page: Page) {
  const close = page.getByLabel("Close result");
  if (await close.isVisible().catch(() => false)) await close.click();
}

async function dismissTour(page: Page) {
  const skip = page.getByLabel("Skip tour").first();
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

async function dismissCalendar(page: Page) {
  const cancel = page.getByText("Cancel");
  if (await cancel.isVisible().catch(() => false)) await cancel.click();
}

function dateKeyFromOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

test.describe("mobile Ask agent athlete workflows", () => {
  test.beforeEach(async ({ page }) => {
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

    await ask(page, "show which today activities are pending today");
    await expect(page.getByText("Pending Today")).toBeVisible();
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
    await expect(page.getByText("Readiness average")).toBeVisible();
    await expect(page.getByText("Training logged")).toBeVisible();
    await expect(page.getByText("Hydration goal")).toBeVisible();
    await expect(page.getByText("Today Summary")).toHaveCount(0);
    await dismissInfoSheet(page);

    await ask(page, "what area can i improve");
    await expect(page.getByText("Areas To Improve")).toBeVisible();
    await expect(page.getByLabel("Open Recovery")).toBeVisible();
    await expect(page.getByLabel("Open Sleep")).toBeVisible();
    await page.getByLabel("Open Hydration").click();
    await expect(page.getByText("Water goal", { exact: true })).toBeVisible();

    await ask(page, "what area i down");
    await expect(page.getByText("Areas Trending Down")).toBeVisible();
    await expect(page.getByText(/Load control|Hydration|Recovery|Sleep/).first()).toBeVisible();
    await expect(page.getByText("Today Summary")).toHaveCount(0);
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

    await ask(page, "show attention");
    await expect(page.getByText("Attention Report")).toBeVisible();
    await expect(page.getByLabel("Open Needs attention")).toBeVisible();

    await ask(page, "squad report");
    await expect(page.getByText("Squad Report")).toBeVisible();
    await expect(page.getByLabel("Open Avg readiness")).toBeVisible();

    await ask(page, "athletes reports");
    await expect(page.getByText("Squad Report")).toBeVisible();
    await expect(page.getByLabel("Open Athletes")).toBeVisible();

    await ask(page, "who is best athlete");
    await expect(page.getByText("Best Athlete")).toBeVisible();
    await expect(page.getByLabel(/Open .+/).filter({ hasText: /Arjun|Bala|Chetan|Best athlete/i }).first()).toBeVisible();
    await expect(page.getByLabel("Open Needs attention")).toHaveCount(0);

    await ask(page, "listout the athlete");
    await expect(page.getByText("Roster Report")).toBeVisible();
    await expect(page.getByLabel(/Open Arjun|Open Bala|Open Chetan/).first()).toBeVisible();

    await ask(page, "who is absented");
    await expect(page.getByText("Absent Athletes", { exact: true })).toBeVisible();

    await ask(page, "who is injury today");
    await expect(page.getByText("Injury Report", { exact: true })).toBeVisible();
    await expect(page.getByLabel(/Open Bala|Open No injured athletes/).first()).toBeVisible();

    await ask(page, "show athlete notes");
    await expect(page.getByLabel("Open Athlete notes")).toBeVisible();

    await ask(page, "open roster");
    await expect(page.getByText("Roster Report")).toBeVisible();

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
