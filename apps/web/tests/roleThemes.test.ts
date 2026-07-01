import { ROLES } from "../lib/roles";
import { ROLE_THEMES, ROLE_THEME_LIST, accentVars } from "../lib/roleThemes";

describe("role themes", () => {
  it("defines a complete theme for every role", () => {
    for (const role of ROLES) {
      const t = ROLE_THEMES[role];
      expect(t.role).toBe(role);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.heading.length).toBeGreaterThan(0);
      expect(t.subcopy.length).toBeGreaterThan(0);
      expect(t.accentRgb).toMatch(/^\d+ \d+ \d+$/);
      expect(t.accentStrongRgb).toMatch(/^\d+ \d+ \d+$/);
      expect(t.accentInkRgb).toMatch(/^\d+ \d+ \d+$/);
    }
  });

  // Each /login/<role> page must be instantly distinguishable: this guards the
  // single source of truth those pages render from.
  it("gives every role a UNIQUE label, accent, and icon", () => {
    const labels = ROLES.map((r) => ROLE_THEMES[r].label);
    const accents = ROLES.map((r) => ROLE_THEMES[r].accentRgb);
    const icons = ROLES.map((r) => ROLE_THEMES[r].icon);
    expect(new Set(labels).size).toBe(ROLES.length);
    expect(new Set(accents).size).toBe(ROLES.length);
    expect(new Set(icons).size).toBe(ROLES.length);
  });

  it("lists every role exactly once in the chooser list", () => {
    expect(new Set(ROLE_THEME_LIST.map((t) => t.role))).toEqual(new Set(ROLES));
    expect(ROLE_THEME_LIST.length).toBe(ROLES.length);
  });

  it("accentVars emits the CSS custom properties globals.css consumes", () => {
    const vars = accentVars(ROLE_THEMES.coach) as Record<string, string>;
    expect(vars["--accent-rgb"]).toBe(ROLE_THEMES.coach.accentRgb);
    expect(vars["--accent-strong-rgb"]).toBe(ROLE_THEMES.coach.accentStrongRgb);
    expect(vars["--accent-ink-rgb"]).toBe(ROLE_THEMES.coach.accentInkRgb);
    expect(vars["--accent-soft"]).toContain(ROLE_THEMES.coach.accentRgb);
  });
});
