import {
  ROLES,
  ROLE_DASHBOARDS,
  dashboardPathForRole,
  isKnownRole,
} from "../lib/roles";

describe("dashboardPathForRole", () => {
  it("maps each supported role to its dashboard", () => {
    expect(dashboardPathForRole("coach")).toBe("/coach/dashboard");
    expect(dashboardPathForRole("athlete")).toBe("/athlete/dashboard");
    expect(dashboardPathForRole("guardian")).toBe("/guardian/dashboard");
  });

  it("returns null for unknown / unsupported roles (incl. the removed admin)", () => {
    expect(dashboardPathForRole("physio")).toBeNull();
    expect(dashboardPathForRole("")).toBeNull();
    expect(dashboardPathForRole("admin")).toBeNull(); // admin flow removed
    expect(dashboardPathForRole("COACH")).toBeNull(); // case-sensitive on purpose
  });

  // The security-relevant property: routing follows the SERVER-returned role,
  // never the login page the user happened to start on.
  it("routes by the server role even when it differs from the login page role", () => {
    const pageRole = "coach"; // user opened /login/coach …
    const serverReturnedRole = "athlete"; // … but signed in with athlete creds
    expect(dashboardPathForRole(serverReturnedRole)).toBe("/athlete/dashboard");
    expect(dashboardPathForRole(serverReturnedRole)).not.toBe(
      dashboardPathForRole(pageRole)
    );
  });

  it("covers exactly the three supported roles (admin removed)", () => {
    expect([...ROLES].sort()).toEqual(["athlete", "coach", "guardian"]);
    expect(Object.keys(ROLE_DASHBOARDS).sort()).toEqual([
      "athlete",
      "coach",
      "guardian",
    ]);
  });

  it("isKnownRole narrows correctly", () => {
    expect(isKnownRole("coach")).toBe(true);
    expect(isKnownRole("nope")).toBe(false);
  });
});
