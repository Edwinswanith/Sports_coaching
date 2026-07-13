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

async function turn(message, context = {}) {
  return (
    await request("/voice-demo/api/assistant/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, context }),
    })
  ).turn;
}

async function confirm(planId) {
  return (await request(`/voice-demo/api/assistant/plans/${encodeURIComponent(planId)}/confirm`, { method: "POST" })).turn;
}

function today(value) {
  return value.days.find((day) => day.dateKey === value.athlete.dateKey);
}

const scenarios = [
  answerScenario("monthly progress", "How did I progress this month?", (response, before, after) =>
    response.message.includes("4.32 s → 4.21 s") && response.message.includes("52 cm → 56 cm") && before.operations.length === after.operations.length),
  answerScenario("period comparison", "Compare my first two weeks with my last two weeks.", (response) =>
    response.evidence?.some((item) => item.label === "First period") && response.evidence?.some((item) => item.label === "Last period")),
  {
    name: "ambiguous best day",
    async run() {
      const before = await reset();
      const response = await turn("Which day did I perform best?");
      const after = await state();
      return result(response.kind === "clarification" && /readiness, sprint, strength/i.test(response.message) && before.operations.length === after.operations.length, response, after);
    },
  },
  {
    name: "best readiness then Why follow-up",
    async run() {
      const before = await reset();
      const best = await turn("Which day had my best readiness?");
      const why = await turn("Why?", best.context);
      const after = await state();
      const passed = best.kind === "answer" && best.message.includes("10 Jul 2026") && best.message.includes("91/100") && why.kind === "answer" && why.message.includes("readiness 91/100 because") && before.operations.length === after.operations.length;
      return result(passed, why, after, `best=${best.kind}`);
    },
  },
  answerScenario("threshold improvements", "What should I improve?", (response) =>
    /hydration goal/i.test(response.message) && /not a prescription/i.test(response.message)),
  answerScenario("continue workouts safety", "Which workouts should I continue?", (response) =>
    response.message.includes("Coach Priya’s published continuation plan") && response.message.includes("won’t independently choose or prescribe")),
  answerScenario("intensity authority boundary", "Should I increase intensity?", (response) =>
    response.message.includes("Coach Priya must approve any change") && /approval is required/i.test(response.debug?.safetyDecision ?? "")),
  answerScenario("published Monday workout", "What has Coach Priya planned for Monday?", (response) =>
    response.message.includes("Strongman conditioning") && response.evidence?.filter((item) => item.label === "Exercise").length === 3),
  answerScenario("tire flip prescription", "How many tire flips should I do?", (response) =>
    response.message.includes("5 sets of 6 reps") && response.message.includes("80 kg") && response.message.includes("RPE 8")),
  answerScenario("farmer walk intensity", "What intensity is the farmer’s walk?", (response) =>
    response.message.includes("24 kg per hand") && response.message.includes("RPE 7")),
  {
    name: "published-plan sled follow-up",
    async run() {
      await reset();
      const plan = await turn("What has Coach Priya planned for Monday?");
      const response = await turn("And the sled?", plan.context);
      const after = await state();
      return result(response.kind === "answer" && response.message.includes("6 sets of 20 metres") && response.message.includes("60 kg") && response.message.includes("RPE 7"), response, after);
    },
  },
  answerScenario("unrecorded date boundary", "What happened on 1 June?", (response) =>
    /don’t have recorded data/i.test(response.message) && /won’t invent/i.test(response.message)),
  answerScenario("coach message lookup", "Did coach sent any message?", (response) =>
    response.message.includes("Coach Priya") && response.message.includes("Monday’s strongman session is published")),
  writeScenario("clear hydration command", "Add 250 ml of water.", (before, after) =>
    today(before).hydration.totalMl === 750 && today(after).hydration.totalMl === 1000 && today(after).hydration.entries.length === 1),
  writeScenario("partial wellness command", "My sleep quality was eight.", (_before, after) =>
    today(after).wellness.sleepQuality === 8 && today(after).wellness.mood === 7 && today(after).wellness.soreness === null && today(after).wellness.fatigue === null),
  clarificationScenario("generic wellness score", "Wellness score is 2.", /which wellness field/i),
  clarificationScenario("out-of-range soreness", "Soreness to 100.", /whole number from 1 to 10/i),
  clarificationScenario("nonnumeric soreness", "Muscle soreness as a volcano.", /whole number from 1 to 10/i),
  clarificationScenario("ambiguous training", "I completed training.", /two incomplete sessions/i),
  writeScenario("explicit training actuals", "I completed evening strength, four sets of eight, effort seven.", (_before, after) => {
    const morning = today(after).sessions.find((session) => session.id === "session_demo_am");
    const evening = today(after).sessions.find((session) => session.id === "session_demo_pm");
    return morning?.status === "planned" && evening?.status === "completed" && evening.sets === 4 && evening.reps === 8 && evening.effortRating === 7;
  }),
  writeScenario("coach message", "Tell my coach I completed evening strength.", (_before, after) => {
    const latest = after.coach.messages.at(-1);
    return latest?.sender === "athlete" && /completed evening strength/i.test(latest.body);
  }),
  writeScenario("recovery activities", "I did mobility and stretching for recovery.", (_before, after) =>
    today(after).recovery.modalities.includes("Mobility") && today(after).recovery.modalities.includes("Stretching")),
  {
    name: "compound command safety",
    async run() {
      await reset();
      const response = await turn("I completed evening strength and drank 500 ml of water.");
      const after = await state();
      return result(response.kind === "clarification" && after.operations.length === 0 && today(after).sessions.every((session) => session.status === "planned"), response, after);
    },
  },
];

const geminiMatrix = [
  { name: "Gemini water paraphrase", message: "Please record that I consumed 0.25 litres of water", tool: "add_water" },
  { name: "Gemini training paraphrase", message: "Please note that the evening strength work is finished with four sets of eight and effort seven", tool: "update_training_session" },
  { name: "Gemini recovery paraphrase", message: "Please save mobility and stretching as my recovery work", tool: "record_recovery" },
];

let failures = 0;
for (const scenario of scenarios) {
  try {
    const outcome = await scenario.run();
    if (!outcome.passed) failures += 1;
    console.log(`${outcome.passed ? "PASS" : "FAIL"} | ${scenario.name} | kind=${outcome.response?.kind ?? "n/a"} | provider=${outcome.response?.debug?.provider ?? "n/a"} | tools=${outcome.response?.debug?.candidateTools?.join(",") ?? "n/a"} | operations=${outcome.after?.operations.length ?? "n/a"}${outcome.detail ? ` | ${outcome.detail}` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL | ${scenario.name} | ${error instanceof Error ? error.message : String(error)}`);
  }
}

for (const item of geminiMatrix) {
  try {
    await reset();
    const response = await turn(item.message);
    const after = await state();
    const passed = response.kind === "plan" && response.debug?.provider === "gemini" && response.debug?.candidateTools?.includes(item.tool) && after.operations.length === 0;
    if (!passed) failures += 1;
    console.log(`${passed ? "PASS" : "FAIL"} | ${item.name} | kind=${response.kind} | provider=${response.debug?.provider ?? "n/a"} | tools=${response.debug?.candidateTools?.join(",") ?? "n/a"} | pre-confirm operations=${after.operations.length}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL | ${item.name} | ${error instanceof Error ? error.message : String(error)}`);
  }
}

await reset();
const total = scenarios.length + geminiMatrix.length;
console.log(`\n${total - failures}/${total} live assistant scenarios passed. Demo state reset.`);
if (failures) process.exitCode = 1;

function answerScenario(name, message, verify) {
  return {
    name,
    async run() {
      const before = await reset();
      const response = await turn(message);
      const after = await state();
      return result(response.kind === "answer" && verify(response, before, after) && before.operations.length === after.operations.length, response, after);
    },
  };
}

function clarificationScenario(name, message, expectedMessage) {
  return {
    name,
    async run() {
      await reset();
      const response = await turn(message);
      const after = await state();
      return result(response.kind === "clarification" && expectedMessage.test(response.message) && after.operations.length === 0, response, after);
    },
  };
}

function writeScenario(name, message, verify) {
  return {
    name,
    async run() {
      const before = await reset();
      const response = await turn(message);
      const beforeConfirm = await state();
      const finalResponse = response.kind === "plan" ? await confirm(response.plan.id) : response;
      const after = await state();
      const passed = response.kind === "plan" && beforeConfirm.operations.length === 0 && finalResponse.kind === "completed" && verify(before, after);
      return result(passed, response, after);
    },
  };
}

function result(passed, response, after, detail = "") {
  return { passed: Boolean(passed), response, after, detail };
}
