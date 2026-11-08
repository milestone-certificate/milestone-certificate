import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MobileNavigation } from "@/components/app/MobileNavigation";
import { AdminSystemOverview } from "@/components/app/AdminSystemOverview";
import { canAccessPath, homeForRoles, roleSummary } from "@/lib/roles";
import { navigationForRoles } from "@/lib/navigation";
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    children,
    activeProps: _,
    ...props
  }: {
    to: string;
    children: React.ReactNode;
    activeProps?: unknown;
  }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));
const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: db.from } }));
afterEach(cleanup);
for (const roles of [
  ["admin"],
  ["staff"],
  ["agent"],
  ["management"],
  ["service_provider"],
  ["management", "agent"],
]) {
  it(`exposes every allowed mobile page and logout for ${roles.join("+")}`, async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    render(<MobileNavigation roles={roles} onLogout={logout} />);
    fireEvent.click(screen.getByRole("button", { name: "সব পেজ ও লগআউট" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleDescription(roleSummary(roles));
    const links = Array.from(
      screen.getByRole("navigation", { name: "সব পেজ" }).querySelectorAll("a"),
    );
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      navigationForRoles(roles).map((n) => n.to),
    );
    links.forEach((a) => expect(canAccessPath(a.getAttribute("href")!, roles)).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "লগআউট" }));
    await waitFor(() => expect(logout).toHaveBeenCalledOnce());
  });
}
it("renders the admin overview after the Settings object is cached", async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(["settings"], { cbt_result_fee: "125" });
  qc.setQueryData(["admin-wallet-accounts"], []);
  qc.setQueryData(["admin-wallet-deposits"], []);
  render(
    <QueryClientProvider client={qc}>
      <AdminSystemOverview />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByDisplayValue("125")).toBeInTheDocument());
  expect(screen.getByText("সিস্টেমের সারসংক্ষেপ")).toBeInTheDocument();
  expect(db.from).not.toHaveBeenCalled();
});
it("enforces restricted routes through alternate URL spellings and mixed roles", () => {
  for (const path of [
    "/finance/",
    "//finance",
    "/%66inance",
    "/finance/export",
    "/accounts/?tab=users",
    "/svp-history/",
  ]) {
    expect(canAccessPath(path, ["staff"])).toBe(false);
    expect(canAccessPath(path, ["admin"])).toBe(true);
  }
  expect(canAccessPath("/%E0%A4%A", ["admin"])).toBe(false);
  expect(homeForRoles([])).toBe("/portal");
});
