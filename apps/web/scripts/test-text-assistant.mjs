const baseUrl = process.env.ASSISTANT_DEMO_BASE_URL ?? "http://localhost:3000";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(`${path}: ${body.message ?? response.status}`);
  return body;
}

async function reset() {
  return (await request("/voice-demo/api/reset", { method: "POST" })).state;
}

async function state() {
  return (await request("/voice-demo/api/state")).state;
}

async function turn(message) {
  return (
    await request("/voice-demo/api/assistant/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })
  ).turn;
}

async function confirm(planId) {
  return (await request(`/voice-demo/api/assistant/plans/${encodeURIComponent(planId)}/confirm`, { method: "POST" })).turn;
}

const scenarios = [
  {
    name: "read-only daily status",
    message: "What is left today?",
    expectedKind: "answer",
    verify: ({ before, after, response }) =>
      response.message.includes("750 ml") && before.operations.length === after.operations.length,
  },
  {
    name: "grounded progress guidance",
    message: "What are the things I need to improve?",
    expectedKind: "answer",
    verify: ({ before, after, response }) =>
      response.message.includes("today’s data") &&
      response.message.includes("can’t reliably judge a long-term") &&
      response.message.includes("Coach Priya") &&
      before.operations.length === after.operations.length,
  },
  {
    name: "coach message lookup",
    message: "Did coach sent any message?",
    expectedKind: "answer",
    verify: ({ before, after, response }) =>
      response.message.includes("Coach Priya") &&
      response.message.includes("Focus on clean form today") &&
      before.operations.length === after.operations.length,
  },
  {
    name: "clear hydration command",
    message: "Add 250 ml of water.",
    expectedKind: "plan",
    confirm: true,
    verifyBeforeConfirm: ({ before, beforeConfirm }) => before.hydration.totalMl === 750 && beforeConfirm.hydration.totalMl === 750,
    verify: ({ after }) => after.hydration.totalMl === 1000 && after.hydration.entries.length === 1,
  },
  {
    name: "partial wellness command",
    message: "My sleep quality was eight.",
    expectedKind: "plan",
    confirm: true,
    verify: ({ after }) =>
      after.wellness.sleepQuality === 8 &&
      after.wellness.mood === 7 &&
      after.wellness.soreness === null &&
      after.wellness.fatigue === null,
  },
  {
    name: "generic wellness score clarification",
    message: "Wellness score is 2.",
    expectedKind: "clarification",
    verify: ({ after, response }) =>
      /which wellness field/i.test(response.message) &&
      after.operations.length === 0 &&
      after.wellness.sleepQuality === null &&
      after.wellness.soreness === null &&
      after.wellness.fatigue === null,
  },
  {
    name: "out-of-range soreness clarification",
    message: "Soreness to 100.",
    expectedKind: "clarification",
    verify: ({ after, response }) =>
      /whole number from 1 to 10/i.test(response.message) &&
      after.operations.length === 0 &&
      after.wellness.soreness === null,
  },
  {
    name: "nonnumeric soreness clarification",
    message: "Muscle soreness as a volcano.",
    expectedKind: "clarification",
    verify: ({ after, response }) =>
      /whole number from 1 to 10/i.test(response.message) &&
      after.operations.length === 0 &&
      after.wellness.soreness === null,
  },
  {
    name: "ambiguous training command",
    message: "I completed training.",
    expectedKind: "clarification",
    verify: ({ after }) => after.sessions.every((session) => session.status === "planned"),
  },
  {
    name: "explicit training actuals",
    message: "I completed evening strength, four sets of eight, effort seven.",
    expectedKind: "plan",
    confirm: true,
    verify: ({ after }) => {
      const morning = after.sessions.find((session) => session.id === "session_demo_am");
      const evening = after.sessions.find((session) => session.id === "session_demo_pm");
      return morning?.status === "planned" && evening?.status === "completed" && evening.sets === 4 && evening.reps === 8 && evening.effort === 7;
    },
  },
  {
    name: "invalid hydration amount",
    message: "I drank fifty litres of water.",
    expectedKind: "unsupported",
    verify: ({ before, after }) => before.hydration.totalMl === after.hydration.totalMl && after.operations.length === 0,
  },
  {
    name: "compound command safety",
    message: "I completed evening strength and drank 500 ml of water.",
    expectedKind: "clarification",
    verify: ({ after }) => after.operations.length === 0 && after.sessions.every((session) => session.status === "planned"),
  },
  {
    name: "coach message",
    message: "Tell my coach I completed evening strength.",
    expectedKind: "plan",
    confirm: true,
    verify: ({ after }) => {
      const latest = after.coach.messages.at(-1);
      return latest?.sender === "athlete" && /completed evening strength/i.test(latest.body);
    },
  },
  {
    name: "recovery activities",
    message: "I did mobility and stretching for recovery.",
    expectedKind: "plan",
    confirm: true,
    verify: ({ after }) => after.recovery.modalities.includes("Mobility") && after.recovery.modalities.includes("Stretching"),
  },
];

let failures = 0;
for (const scenario of scenarios) {
  try {
    const before = await reset();
    const response = await turn(scenario.message);
    const beforeConfirm = await state();
    let finalResponse = response;
    if (scenario.confirm && response.kind === "plan") finalResponse = await confirm(response.plan.id);
    const after = await state();
    const kindPassed = response.kind === scenario.expectedKind;
    const preConfirmPassed = scenario.verifyBeforeConfirm ? scenario.verifyBeforeConfirm({ before, beforeConfirm, response }) : true;
    const impactPassed = scenario.verify({ before, beforeConfirm, after, response, finalResponse });
    const passed = kindPassed && preConfirmPassed && impactPassed;
    if (!passed) failures += 1;
    const provider = response.debug?.provider ?? "n/a";
    const tools = response.debug?.candidateTools?.join(",") ?? "n/a";
    console.log(`${passed ? "PASS" : "FAIL"} | ${scenario.name} | kind=${response.kind} | provider=${provider} | tools=${tools} | operations=${after.operations.length}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL | ${scenario.name} | ${error instanceof Error ? error.message : String(error)}`);
  }
}

await reset();
console.log(`\n${scenarios.length - failures}/${scenarios.length} live assistant scenarios passed. Demo state reset.`);
if (failures) process.exitCode = 1;
