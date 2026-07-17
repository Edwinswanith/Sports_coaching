"use client";

// Guided app-tour engine. Mounted once in the root layout so its state
// survives client-side navigation across the whole cross-page tour (every
// page here navigates via next/navigation's useRouter, never a hard reload).
//
// A step's DOM target is found by `data-tour="<step.id>"` — see lib/tour/steps.ts
// for the step list and components/tour/TourOverlay.tsx for the visual.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getStoredUser } from "../api";
import type { Role } from "../roles";
import { TOUR_STEPS, type TourStep, type TourStepContext } from "./steps";
import { TourOverlay } from "../../components/tour/TourOverlay";

// Keep this false in normal app builds: the tour should auto-start once per user.
const TESTING_ALWAYS_SHOW_TOUR = true;

// Same-page steps can still be waiting on that page's own initial data fetch
// (e.g. a step right after mount, before a real network call to Mongo has
// resolved) — not just an already-rendered DOM query — so this needs real
// headroom, not just enough time for a re-render.
const SAME_PAGE_TIMEOUT_MS = 5000;
const CROSS_PAGE_TIMEOUT_MS = 7000;
const POLL_INTERVAL_MS = 100;

function seenKey(userId: string): string {
  return `scp.tour.seen.${userId}`;
}

export type TourRect = { top: number; left: number; width: number; height: number };

type TourState = {
  active: boolean;
  role: Role | null;
  stepIndex: number;
  steps: TourStep[];
  rect: TourRect | null;
  note: string | null;
  noteLoading: boolean;
};

const INITIAL_STATE: TourState = {
  active: false,
  role: null,
  stepIndex: 0,
  steps: [],
  rect: null,
  note: null,
  noteLoading: false,
};

type TourContextValue = {
  state: TourState;
  startTour: (role: Role) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  registerAction: (id: string, fn: () => void) => () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error("useTour must be used within TourProvider");
  return ctx;
}

/** Registers a callback the tour can run right before it measures a step's target on this page. */
export function useTourAction(id: string, fn: () => void): void {
  const { registerAction } = useTour();
  useEffect(() => registerAction(id, fn), [registerAction, id, fn]);
}

/** Starts the tour on mount if this user hasn't seen it yet (or the testing override is on). */
export function useAutoStartTour(role: Role): void {
  const { startTour } = useTour();
  useEffect(() => {
    const user = getStoredUser();
    if (!user?.id) return;
    const seen = window.localStorage.getItem(seenKey(user.id));
    if (!seen || TESTING_ALWAYS_SHOW_TOUR) {
      startTour(role);
    }
    // Fires once per mount only — re-checking on every render would restart mid-tour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function TourProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<TourState>(INITIAL_STATE);
  const actionsRef = useRef(new Map<string, () => void>());
  const noteCacheRef = useRef(new Map<string, string>());
  const runIdRef = useRef(0);

  const registerAction = useCallback((id: string, fn: () => void) => {
    actionsRef.current.set(id, fn);
    return () => {
      if (actionsRef.current.get(id) === fn) actionsRef.current.delete(id);
    };
  }, []);

  const finish = useCallback(() => {
    setState(INITIAL_STATE);
    const user = getStoredUser();
    if (user?.id) window.localStorage.setItem(seenKey(user.id), "1");
  }, []);

  const advanceTo = useCallback(
    (steps: TourStep[], index: number, myRun: number) => {
      if (index >= steps.length) {
        finish();
        return;
      }
      const step = steps[index];
      const stepContext: TourStepContext = { isAcademyOwner: getStoredUser()?.isAcademyOwner };
      if (step.skipIf && step.skipIf(stepContext)) {
        advanceTo(steps, index + 1, myRun);
        return;
      }
      setState((prev) => ({ ...prev, stepIndex: index, rect: null, note: null, noteLoading: false }));

      // Read the browser's own URL (not a React-cached pathname) so this stays
      // correct even when called recursively from within an in-flight poll/skip.
      const cameFromNav = window.location.pathname !== step.route;
      if (cameFromNav) {
        router.push(step.route);
      }

      const deadline = Date.now() + (cameFromNav ? CROSS_PAGE_TIMEOUT_MS : SAME_PAGE_TIMEOUT_MS);
      let actionRan = false;

      const poll = () => {
        if (runIdRef.current !== myRun) return; // superseded by a newer step/skip/finish
        const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`);
        if (el && (actionRan || !step.action)) {
          const r = el.getBoundingClientRect();
          setState((prev) =>
            prev.stepIndex === index
              ? { ...prev, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }
              : prev
          );
          return;
        }
        if (!actionRan && step.action) {
          actionsRef.current.get(step.action)?.();
          actionRan = true;
        }
        if (Date.now() > deadline) {
          advanceTo(steps, index + 1, myRun);
          return;
        }
        window.setTimeout(poll, POLL_INTERVAL_MS);
      };
      poll();
    },
    [router, finish]
  );

  const startTour = useCallback(
    (role: Role) => {
      const steps = TOUR_STEPS[role];
      const myRun = ++runIdRef.current;
      setState({ ...INITIAL_STATE, active: true, role, steps });
      advanceTo(steps, 0, myRun);
    },
    [advanceTo]
  );

  const next = useCallback(() => {
    const myRun = ++runIdRef.current;
    advanceTo(state.steps, state.stepIndex + 1, myRun);
  }, [advanceTo, state.steps, state.stepIndex]);

  const back = useCallback(() => {
    const myRun = ++runIdRef.current;
    advanceTo(state.steps, Math.max(0, state.stepIndex - 1), myRun);
  }, [advanceTo, state.steps, state.stepIndex]);

  const skip = useCallback(() => {
    runIdRef.current++;
    finish();
  }, [finish]);

  // Fetch the AI-agent narration once the current step's target is found;
  // shows the fallback note instantly and swaps in the live text on arrival.
  useEffect(() => {
    if (!state.active || !state.rect) return;
    const step = state.steps[state.stepIndex];
    if (!step) return;

    const cached = noteCacheRef.current.get(step.id);
    if (cached) {
      setState((prev) => (prev.stepIndex === state.stepIndex ? { ...prev, note: cached, noteLoading: false } : prev));
      return;
    }

    setState((prev) => (prev.stepIndex === state.stepIndex ? { ...prev, note: step.fallbackNote, noteLoading: true } : prev));
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/tour/narrate", {
          method: "POST",
          body: JSON.stringify({ stepId: step.id, title: step.title, fallbackNote: step.fallbackNote }),
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json().catch(() => ({}))) as { note?: string };
        const note = typeof json.note === "string" && json.note.trim() ? json.note.trim() : step.fallbackNote;
        noteCacheRef.current.set(step.id, note);
        if (!cancelled) {
          setState((prev) => (prev.stepIndex === state.stepIndex ? { ...prev, note, noteLoading: false } : prev));
        }
      } catch {
        if (!cancelled) {
          setState((prev) => (prev.stepIndex === state.stepIndex ? { ...prev, noteLoading: false } : prev));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.active, state.rect, state.stepIndex]);

  // Re-measure the current target on scroll/resize while a step is showing.
  useEffect(() => {
    if (!state.active) return;
    const index = state.stepIndex;
    const step = state.steps[index];
    if (!step) return;
    function remeasure() {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.id}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      setState((prev) =>
        prev.stepIndex === index
          ? { ...prev, rect: { top: r.top, left: r.left, width: r.width, height: r.height } }
          : prev
      );
    }
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
    };
  }, [state.active, state.stepIndex]);

  // Lock body scroll while the tour is active (same trick as BottomSheet).
  useEffect(() => {
    if (!state.active) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [state.active]);

  const value = useMemo<TourContextValue>(
    () => ({ state, startTour, next, back, skip, registerAction }),
    [state, startTour, next, back, skip, registerAction]
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <TourOverlay />
    </TourContext.Provider>
  );
}
