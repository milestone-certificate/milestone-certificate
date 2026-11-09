import { describe, expect, it } from "vitest";

import { navigationForRoles } from "@/lib/navigation";
import { canAccessPath } from "@/lib/roles";

const pathsFor = (roles: string[]) => navigationForRoles(roles).map((item) => item.to);

const accountRoles = [
  ["admin"],
  ["staff"],
  ["agent"],
  ["management"],
  ["service_provider"],
  ["admin", "agent"],
  ["management", "agent"],
  [],
];

describe("role-based navigation", () => {
  it("removes the office address from every account's menu", () => {
    for (const roles of accountRoles) {
      expect(pathsFor(roles)).not.toContain("/office");
    }
  });

  it("puts SVP booking first for agents and keeps it out of the admin menu", () => {
    const agentPaths = pathsFor(["agent"]);
    expect(agentPaths[0]).toBe("/svp-booking");
    expect(agentPaths).toContain("/dashboard");
    expect(agentPaths).not.toContain("/takamol");

    for (const roles of [["admin"], ["staff"]]) {
      const paths = pathsFor(roles);
      expect(paths).not.toContain("/svp-booking");
      expect(paths).toContain("/dashboard");
    }

    const adminPaths = pathsFor(["admin"]);
    expect(adminPaths).toContain("/accounts");
    expect(adminPaths).toContain("/svp-history");

    const staffPaths = pathsFor(["staff"]);
    expect(staffPaths).not.toContain("/accounts");
    expect(staffPaths).not.toContain("/svp-history");
  });

  it("keeps manager navigation precedence for mixed admin and agent roles", () => {
    const paths = pathsFor(["admin", "agent"]);

    expect(paths).not.toContain("/svp-booking");
    expect(paths).not.toContain("/takamol");
    expect(paths).toContain("/finance");
    expect(paths).not.toContain("/submit-job");
  });

  it("keeps agent navigation while excluding admin-only navigation", () => {
    const paths = pathsFor(["agent"]);

    expect(paths[0]).toBe("/svp-booking");
    expect(paths).toContain("/dashboard");
    expect(paths).toContain("/submit-job");
    expect(paths).toContain("/my-works");
    expect(paths).not.toContain("/takamol");
    expect(paths).not.toContain("/finance");
  });

  it("does not expose booking navigation to provider or management-only roles", () => {
    for (const roles of [["service_provider"], ["management"]]) {
      const paths = pathsFor(roles);
      expect(paths).not.toContain("/svp-booking");
      expect(paths).not.toContain("/takamol");
    }
  });
});

describe("authenticated path policy", () => {
  it("retires office address URLs for all roles, including admins and mixed accounts", () => {
    for (const roles of accountRoles) {
      for (const path of [
        "/office",
        "/office/",
        "//office",
        "/%6fffice",
        "/office/details",
        "/office?share=true",
      ]) {
        expect(canAccessPath(path, roles), `${roles.join("+") || "customer"}: ${path}`).toBe(false);
      }
    }
    expect(canAccessPath("/center-addresses", ["admin"])).toBe(true);
  });

  it("keeps SVP booking agent-only while finance stays admin-only", () => {
    expect(canAccessPath("/svp-booking", ["staff"])).toBe(false);
    expect(canAccessPath("/svp-booking", ["admin"])).toBe(false);
    expect(canAccessPath("/takamol", ["agent"])).toBe(false);
    expect(canAccessPath("/svp-booking", ["agent"])).toBe(true);
    expect(canAccessPath("/finance", ["staff"])).toBe(false);
    expect(canAccessPath("/finance", ["admin"])).toBe(true);
  });

  it("shows the account and SVP history lists only to admins", () => {
    for (const path of ["/accounts", "/svp-history"]) {
      expect(canAccessPath(path, ["admin"])).toBe(true);
      expect(canAccessPath(path, ["staff"])).toBe(false);
      expect(canAccessPath(path, ["agent"])).toBe(false);
    }
  });

  it("denies booking to provider and management-only roles", () => {
    for (const roles of [["service_provider"], ["management"]]) {
      expect(canAccessPath("/svp-booking", roles)).toBe(false);
    }
  });

  it("lets a mixed admin and agent account use manager routes", () => {
    expect(canAccessPath("/svp-booking", ["admin", "agent"])).toBe(true);
    expect(canAccessPath("/finance", ["admin", "agent"])).toBe(true);
  });
});
