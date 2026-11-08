import {
  BarChart3,
  Briefcase,
  CalendarDays,
  ClipboardCheck,
  Globe,
  Home,
  MapPin,
  Settings,
  UserCheck,
  Users,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { isManager } from "./roles";

export type NavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  desktopOnly?: boolean;
};

const commonNav: readonly NavigationItem[] = [
  { to: "/dashboard", label: "হোম", icon: Home },
  { to: "/wallet", label: "ব্যালেন্স", icon: Wallet },
  { to: "/submissions", label: "জমা দেওয়া কাজ", icon: ClipboardCheck, desktopOnly: true },
  { to: "/management", label: "রিসেপশন", icon: UserCheck, desktopOnly: true },
  { to: "/candidates", label: "পরীক্ষার্থী", icon: Users },
  { to: "/exams", label: "পরীক্ষা", icon: CalendarDays },
  { to: "/results", label: "রেজাল্ট", icon: ClipboardCheck, desktopOnly: true },
  { to: "/reports", label: "রিপোর্ট", icon: BarChart3 },
  { to: "/payments", label: "পেমেন্ট", icon: ClipboardCheck, desktopOnly: true },
  { to: "/settings", label: "সেটিংস", icon: Settings },
];

const svpBookingNav: NavigationItem = {
  to: "/svp-booking",
  label: "SVP বুকিং",
  icon: CalendarDays,
};

const adminNav: readonly NavigationItem[] = [
  { to: "/accounts", label: "এজেন্ট/প্রোভাইডার", icon: Users },
  { to: "/svp-history", label: "SVP হিস্ট্রি", icon: ClipboardCheck },
  { to: "/messages", label: "মেসেজ ম্যানেজমেন্ট", icon: ClipboardCheck },
  { to: "/center-addresses", label: "কেন্দ্রের ঠিকানা", icon: MapPin, desktopOnly: true },
  { to: "/agency-report", label: "এজেন্সি রিপোর্ট", icon: BarChart3 },
  { to: "/finance", label: "গোপন হিসাব", icon: BarChart3, desktopOnly: true },
];

const agentNav: readonly NavigationItem[] = [
  { to: "/dashboard", label: "ড্যাশবোর্ড", icon: Home },
  { to: "/wallet", label: "ব্যালেন্স", icon: Wallet },
  { to: "/submit-job", label: "কাজ জমা", icon: ClipboardCheck },
  { to: "/my-works", label: "আমার কাজ", icon: Briefcase },
  { to: "/sub-agents", label: "সাব-এজেন্ট", icon: Users },
  { to: "/result-check", label: "রেজাল্ট চেক", icon: ClipboardCheck },
  { to: "/office", label: "অফিস ঠিকানা", icon: Home },
  { to: "/about", label: "আমাদের সেবা", icon: Globe },
];

const providerNav: readonly NavigationItem[] = [
  { to: "/provider", label: "আমার কাজ", icon: Briefcase },
];

const managementNav: readonly NavigationItem[] = [
  { to: "/management", label: "রিসেপশন", icon: UserCheck },
  { to: "/submissions", label: "জমা দেওয়া কাজ", icon: ClipboardCheck },
];

/** Return the menu for a role set. Manager roles intentionally take precedence over agent menus. */
export function navigationForRoles(roles: string[]): NavigationItem[] {
  if (isManager(roles)) {
    // Admins/staff run the management systems; the SVP booking workspace is agent-only.
    return [...commonNav, ...(roles.includes("admin") ? adminNav : [])];
  }

  return [
    ...(roles.includes("agent") ? [svpBookingNav, ...agentNav] : []),
    ...(roles.includes("service_provider") ? providerNav : []),
    ...(roles.includes("management") ? managementNav : []),
  ];
}
