// Training-session slots, shared across athlete/coach/guardian screens. Keep in
// sync with the server's SESSION_SLOTS (server/src/models/TrainingSession.ts).
// Ordered through the day: AM → Afternoon → PM.

export const SESSION_SLOTS = ["AM", "AFT", "PM"] as const;
export type SessionSlot = (typeof SESSION_SLOTS)[number];

/** Display label — "AFT" reads as "Afternoon" in the UI. */
export const SLOT_LABEL: Record<SessionSlot, string> = {
  AM: "AM",
  AFT: "Afternoon",
  PM: "PM",
};
