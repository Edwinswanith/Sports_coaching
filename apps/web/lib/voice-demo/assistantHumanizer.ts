import "server-only";

import path from "node:path";
import dotenv from "dotenv";
import type { AssistantTurnResponse } from "./types";

dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

type HumanizerGenerator = (input: {
  athleteMessage: string;
  fallbackMessage: string;
  facts: GroundingFact[];
}) => Promise<string>;

type GroundingFact = { id: string; label: string; value: string; dateKey?: string };

const METRIC_TERMS = [
  "readiness", "sleep", "mood", "soreness", "fatigue", "hydration", "training completion", "training load",
  "sprint", "vertical jump", "farmer", "benchmark",
];

const UNSAFE_LANGUAGE = /\b(caus(?:e|ed|es|ing)|because of|led to|resulted in|proves?|guarantee[ds]?|diagnos(?:e|ed|is)|prescrib(?:e|ed|ing)|you should|you must|increase your|decrease your)\b/i;

export async function humanizeAnalyticsTurn(
  turn: AssistantTurnResponse,
  athleteMessage: string,
  generator: HumanizerGenerator = generateWithGemini,
): Promise<AssistantTurnResponse> {
  if (turn.kind !== "answer" || !turn.debug.analysisQuery || !turn.debug.groundingFacts?.length) return turn;
  const startedAt = Date.now();
  const groundingFacts = turn.debug.groundingFacts.slice(0, 6);
  try {
    const candidate = await generator({
      athleteMessage,
      fallbackMessage: turn.message,
      facts: groundingFacts,
    });
    const validated = validateHumanizedMessage(candidate, groundingFacts);
    if (!validated) return withHumanizer(turn, "deterministic_fallback", Date.now() - startedAt);
    return {
      ...turn,
      message: validated,
      debug: {
        ...turn.debug,
        humanizer: "gemini",
        humanizerLatencyMs: Date.now() - startedAt,
      },
    };
  } catch {
    return withHumanizer(turn, "deterministic_fallback", Date.now() - startedAt);
  }
}

export function validateHumanizedMessage(
  candidate: string,
  facts: GroundingFact[],
): string | null {
  const message = candidate.trim();
  if (!message || message.length > 1_200 || UNSAFE_LANGUAGE.test(message)) return null;
  const factMap = new Map(facts.map((fact) => [`{{${fact.id}}}`, fact.value]));
  const tokens = message.match(/\{\{E\d+\}\}/g) ?? [];
  if (!tokens.length || tokens.some((token) => !factMap.has(token))) return null;
  const languageOnly = message.replace(/\{\{E\d+\}\}/g, "");
  if (/\d/.test(languageOnly)) return null;

  const supportedTerms = METRIC_TERMS.filter((term) => facts.some((fact) => fact.label.toLowerCase().includes(term)));
  const unsupportedMetric = METRIC_TERMS.some((term) => message.toLowerCase().includes(term) && !supportedTerms.includes(term));
  if (unsupportedMetric) return null;

  const grounded = message.replace(/\{\{E\d+\}\}/g, (token) => factMap.get(token) ?? token);
  return /\{\{E\d+\}\}/.test(grounded) ? null : grounded;
}

function withHumanizer(
  turn: Extract<AssistantTurnResponse, { kind: "answer" }>,
  humanizer: "deterministic_fallback",
  humanizerLatencyMs: number,
): AssistantTurnResponse {
  return { ...turn, debug: { ...turn.debug, humanizer, humanizerLatencyMs } };
}

async function generateWithGemini(input: {
  athleteMessage: string;
  fallbackMessage: string;
  facts: GroundingFact[];
}) {
  const apiKey = process.env.GOOGLE_API_KEY ?? "";
  if (!apiKey) throw new Error("gemini_not_configured");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const factList = input.facts.map((fact) => `{{${fact.id}}} = ${fact.label}: ${fact.value}`).join("\n");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: [
              "You rewrite a grounded athlete analytics answer so it feels concise, warm, and conversational.",
              "Every factual or numeric statement must be represented by one of the supplied {{E#}} tokens.",
              "Each token is a value. Write its supplied label naturally immediately before the token, for example: 'Readiness was {{E2}}.' Do not repeat or paraphrase the value.",
              "Use metric labels naturally in lower case inside a sentence. Start with the finding, not filler such as 'Absolutely', 'Certainly', or 'Great question'.",
              "Do not type digits outside tokens. Do not add facts, metrics, dates, scores, defaults, causal claims, diagnoses, or training prescriptions.",
              "Use language such as 'coincided with' for associations. Never say one signal caused another.",
              "Keep the answer under 110 words. Use at least two evidence tokens when two or more are available.",
              "Return JSON with one string property named message and no other properties.",
            ].join(" "),
          }],
        },
        contents: [{
          role: "user",
          parts: [{
            text: `Athlete question: ${JSON.stringify(input.athleteMessage)}\nSafe fallback: ${JSON.stringify(input.fallbackMessage)}\nGrounding tokens:\n${factList}`,
          }],
        }],
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { message: { type: "STRING" } },
            required: ["message"],
          },
        },
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error(`gemini_humanizer_failed_${response.status}`);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = body.candidates?.[0]?.content?.parts?.find((part) => typeof part.text === "string")?.text;
  if (!text) throw new Error("gemini_humanizer_empty");
  const parsed = JSON.parse(text) as { message?: unknown };
  if (typeof parsed.message !== "string") throw new Error("gemini_humanizer_invalid");
  return parsed.message;
}
