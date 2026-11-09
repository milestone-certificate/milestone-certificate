export type AppRole = "admin" | "staff" | "agent" | "service_provider" | "management";

export const AGENT_PATHS = [
  "/dashboard",
  "/submit-job",
  "/my-works",
  "/sub-agents",
  "/about",
  "/agent-results",
  "/result-check",
  "/svp-booking",
  "/wallet",
] as const;
export const PROVIDER_PATHS = ["/provider"] as const;
export const ADMIN_ONLY_PATHS = [
  "/finance",
  "/agency-report",
  "/messages",
  "/center-addresses",
  "/accounts",
  "/svp-history",
] as const;
export const MANAGEMENT_PATHS = ["/management", "/submissions"] as const;
/** Agent-only workspace; managers without the agent role cannot open it. */
export const AGENT_ONLY_PATHS = ["/svp-booking"] as const;

/** Pick the landing page for a set of roles. No role = customer portal. */
export function homeForRoles(
  roles: string[],
): "/dashboard" | "/submit-job" | "/provider" | "/management" | "/portal" {
  if (roles.includes("admin") || roles.includes("staff")) return "/dashboard";
  if (roles.includes("agent")) return "/dashboard";
  if (roles.includes("service_provider")) return "/provider";
  if (roles.includes("management")) return "/management";
  return "/portal";
}

export const isManager = (roles: string[]) => roles.includes("admin") || roles.includes("staff");

const ROLE_LABELS: Record<string, string> = {
  admin: "অ্যাডমিন",
  staff: "স্টাফ",
  agent: "এজেন্ট",
  service_provider: "সেবা প্রদানকারী",
  management: "রিসেপশন",
};
export function roleSummary(roles: string[]): string {
  const labels = [...new Set(roles)].map((role) => ROLE_LABELS[role]).filter(Boolean);
  return labels.length ? labels.join(" · ") : "পরীক্ষার্থী";
}

export function normalizeAppPath(path: string): string {
  try {
    return (
      decodeURIComponent(path.split(/[?#]/, 1)[0])
        .replace(/\/{2,}/g, "/")
        .replace(/\/+$/, "") || "/"
    );
  } catch {
    return "";
  }
}
const inPath = (path: string, routes: readonly string[]) =>
  routes.some((base) => path === base || path.startsWith(`${base}/`));

// Retired pages remain inaccessible even to managers, who otherwise have broad access.
const RETIRED_PATHS = ["/office"] as const;

/**
 * Check the same role/path rules used by the authenticated route guard.
 * Managers can use the common management pages; only admins can use admin-only pages.
 */
export function canAccessPath(path: string, roles: string[]): boolean {
  path = normalizeAppPath(path);
  if (!path || inPath(path, RETIRED_PATHS)) return false;
  if (inPath(path, ADMIN_ONLY_PATHS)) {
    return roles.includes("admin");
  }
  if (inPath(path, AGENT_ONLY_PATHS)) {
    return roles.includes("agent");
  }
  if (isManager(roles)) return true;

  const allowed = [
    ...(roles.includes("agent") ? AGENT_PATHS : []),
    ...(roles.includes("service_provider") ? PROVIDER_PATHS : []),
    ...(roles.includes("management") ? MANAGEMENT_PATHS : []),
  ];
  return allowed.includes(path as (typeof allowed)[number]);
}
