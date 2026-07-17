"use client";

// Renders the spotlight cutout + tooltip for the active guided-tour step.
// Plain fixed positioning (no portal), matching the existing overlay
// convention in components/BottomSheet.tsx, but at a higher z-index since the
// tour must never be visually trapped under a modal/dropdown.

import { useTour } from "../../lib/tour/TourProvider";

const PADDING = 8;
const TOOLTIP_WIDTH = 264;
const TOOLTIP_GAP = 10;

export function TourOverlay() {
  const { state, next, back, skip } = useTour();
  const { active, rect, stepIndex, steps, note, noteLoading } = state;

  if (!active || !rect) return null;

  const step = steps[stepIndex];
  if (!step) return null;

  const spot = {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };

  const viewportH = window.innerHeight;
  // Keep the tooltip within the visible app-shell column (centered, max-w-md)
  // rather than the full browser window on wide/desktop viewports.
  const shellRect = document.getElementById("app-shell")?.getBoundingClientRect();
  const shellLeft = shellRect?.left ?? 0;
  const shellRight = shellRect?.right ?? window.innerWidth;

  const showBelow = spot.top + spot.height + 130 < viewportH;
  const tooltipLeft = Math.min(Math.max(shellLeft + 12, spot.left), shellRight - TOOLTIP_WIDTH - 12);

  const isLast = stepIndex === steps.length - 1;
  const isFirst = stepIndex === 0;

  return (
    <div
      className="fixed inset-0 z-[70] animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`App tour: ${step.title}`}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") skip();
      }}
    >
      {/* Spotlight cutout */}
      <div
        className="pointer-events-none absolute rounded-2xl ring-2 ring-accent transition-[top,left,width,height] duration-200"
        style={{
          top: spot.top,
          left: spot.left,
          width: spot.width,
          height: spot.height,
          boxShadow: "0 0 0 9999px rgba(15,23,42,0.72)",
        }}
      />

      {/* Tooltip */}
      <div
        className="absolute rounded-xl border border-line bg-surface-raised p-3 shadow-pop animate-rise"
        style={{
          [showBelow ? "top" : "bottom"]: showBelow
            ? spot.top + spot.height + TOOLTIP_GAP
            : Math.max(12, viewportH - spot.top + TOOLTIP_GAP),
          left: tooltipLeft,
          width: TOOLTIP_WIDTH,
          maxWidth: "80vw",
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-[13px] font-bold leading-tight text-ink">{step.title}</h3>
          <p className="nums shrink-0 text-[10px] font-semibold text-ink-faint">
            {stepIndex + 1}/{steps.length}
          </p>
        </div>
        <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-ink-muted">
          {note ?? step.fallbackNote}
          {noteLoading ? <span className="ml-1 inline-block animate-pulse text-ink-faint">…</span> : null}
        </p>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <button onClick={skip} className="text-[11px] font-semibold text-ink-faint hover:text-ink">
            Skip
          </button>
          <div className="flex items-center gap-1.5">
            {!isFirst ? (
              <button onClick={back} className="btn-secondary h-7 px-2.5 text-[11px]">
                Back
              </button>
            ) : null}
            <button onClick={next} className="btn-primary h-7 px-3 text-[11px]">
              {isLast ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
