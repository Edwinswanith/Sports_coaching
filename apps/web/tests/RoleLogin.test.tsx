import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoleLogin } from "../components/RoleLogin";
import { ROLE_THEMES } from "../lib/roleThemes";

// next/navigation + next/link need the App Router runtime, which isn't present
// in jsdom — mock them down to the surface RoleLogin actually uses.
const push = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: jest.fn() }),
}));
jest.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: unknown }) => (
    <a href={typeof href === "string" ? href : "#"}>{children}</a>
  ),
}));

function mockFetchOnce(status: number, body: unknown) {
  (global.fetch as jest.Mock) = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

async function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@y.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret123" } });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

beforeEach(() => {
  push.mockReset();
  window.localStorage.clear();
});

describe("RoleLogin — per-role identity", () => {
  it("renders the COACH page with its distinct label, heading, and accent", () => {
    const { container } = render(<RoleLogin role="coach" />);
    expect(screen.getByText("Coach login")).toBeInTheDocument();
    expect(screen.getByText(ROLE_THEMES.coach.heading)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in as coach/i })).toBeInTheDocument();
    const main = container.querySelector("main")!;
    expect(main.style.getPropertyValue("--accent-rgb").trim()).toBe(ROLE_THEMES.coach.accentRgb);
  });

  it("renders the ATHLETE page with a different theme than coach", () => {
    const { container } = render(<RoleLogin role="athlete" />);
    expect(screen.getByText("Athlete login")).toBeInTheDocument();
    expect(screen.getByText(ROLE_THEMES.athlete.heading)).toBeInTheDocument();
    const main = container.querySelector("main")!;
    expect(main.style.getPropertyValue("--accent-rgb").trim()).toBe(ROLE_THEMES.athlete.accentRgb);
    expect(ROLE_THEMES.athlete.accentRgb).not.toBe(ROLE_THEMES.coach.accentRgb);
  });

  it.each(["coach", "athlete", "guardian"] as const)(
    "renders a '%s login' indicator on its page",
    (role) => {
      render(<RoleLogin role={role} />);
      expect(screen.getByText(`${ROLE_THEMES[role].label} login`)).toBeInTheDocument();
    }
  );
});

describe("RoleLogin — auth routes by the SERVER role, not the URL", () => {
  it("sends athlete creds (entered on the coach page) to the athlete dashboard", async () => {
    mockFetchOnce(200, {
      accessToken: "t",
      user: { id: "1", name: "Pat", email: "x@y.com", role: "athlete" },
    });

    render(<RoleLogin role="coach" />);
    await fillAndSubmit();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/athlete/dashboard"));
    // Soft note tells the user they're being routed to their real workspace.
    expect(screen.getByText(/Athlete workspace/i)).toBeInTheDocument();
    // It posted to the real auth endpoint, unchanged.
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/auth/login");
    expect(opts.method).toBe("POST");
  });

  it("routes a matching coach login to the coach dashboard", async () => {
    mockFetchOnce(200, {
      user: { id: "2", name: "Sam", email: "c@y.com", role: "coach" },
    });
    render(<RoleLogin role="coach" />);
    await fillAndSubmit();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/coach/dashboard"));
  });

  it("shows an error and does not navigate on 401", async () => {
    mockFetchOnce(401, { error: "invalid_credentials" });
    render(<RoleLogin role="coach" />);
    await fillAndSubmit();
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/invalid email or password/i)
    );
    expect(push).not.toHaveBeenCalled();
  });
});
