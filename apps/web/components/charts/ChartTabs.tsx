"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export type ChartTab = { key: string; label: string; node: ReactNode };

/**
 * Tabbed, swipeable chart switcher: short name tabs along the top, one chart
 * shown at a time, horizontal swipe (or tap a tab) to move between them. Keeps
 * the Trends section to a single screen instead of a long vertical scroll.
 *
 * All charts stay mounted (laid out as full-width slides in a translated flex
 * row), so switching is instant — no refetch flash — and Recharts still gets a
 * real width for off-screen slides. The viewport height tracks the ACTIVE slide
 * (measured live, since charts load async), so each chart sizes to its own
 * content instead of every slide inheriting the tallest one's height.
 */
export function ChartTabs({ tabs }: { tabs: ChartTab[] }) {
  const [active, setActive] = useState(0);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const startX = useRef<number | null>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);
  const idx = Math.min(active, Math.max(0, tabs.length - 1));

  // Keep the viewport height pinned to the active slide; ResizeObserver catches
  // the height change when that slide's chart finishes loading.
  useEffect(() => {
    const el = slideRefs.current[idx];
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [idx, tabs.length]);

  useEffect(() => {
    tabRefs.current[idx]?.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "smooth",
    });
  }, [idx]);

  if (tabs.length === 0) return null;
  const go = (i: number) => setActive(Math.max(0, Math.min(tabs.length - 1, i)));

  return (
    <div>
      {/* Name tabs — horizontally scrollable on narrow screens */}
      <div
        role="tablist"
        aria-label="Charts"
        className="flex scroll-px-4 gap-1.5 overflow-x-auto pb-1 pr-4 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={(el) => {
              tabRefs.current[i] = el;
            }}
            role="tab"
            aria-selected={i === idx}
            onClick={() => go(i)}
            className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              i === idx
                ? "bg-accent text-accent-ink shadow-sm"
                : "border border-line bg-surface-raised text-ink-muted hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Swipeable viewport — height tracks the active slide */}
      <div
        className="mt-3 overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ height }}
        onTouchStart={(e) => {
          startX.current = e.touches[0]?.clientX ?? null;
        }}
        onTouchEnd={(e) => {
          if (startX.current === null) return;
          const dx = (e.changedTouches[0]?.clientX ?? startX.current) - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 45) go(idx + (dx < 0 ? 1 : -1));
        }}
      >
        <div
          className="flex items-start transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ transform: `translateX(-${idx * 100}%)` }}
        >
          {tabs.map((t, i) => (
            <div
              key={t.key}
              ref={(el) => {
                slideRefs.current[i] = el;
              }}
              className="w-full shrink-0 self-start"
            >
              {t.node}
            </div>
          ))}
        </div>
      </div>

      {/* Position dots + next/prev affordance */}
      <div className="mt-2 flex items-center justify-center gap-1.5">
        {tabs.map((t, i) => (
          <button
            key={t.key}
            aria-label={`Show ${t.label}`}
            onClick={() => go(i)}
            className={`h-1.5 rounded-full transition-all ${
              i === idx ? "w-4 bg-accent" : "w-1.5 bg-line-strong hover:bg-ink-faint"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
