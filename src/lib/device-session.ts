import { supabase } from "@/integrations/supabase/client";

const KEY = "device_session_key";
const AT = "device_login_at";
const MAX = "device_session_max";
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const ADMIN_SESSION_MAX_MS = 24 * 60 * 60 * 1000;

// Short in-memory cache so page-to-page navigation doesn't hit the server every time.
let lastOkAt = 0;
const CACHE_MS = 60 * 1000;
export const resetDeviceCheckCache = () => {
  lastOkAt = 0;
};

/** Call right after a successful sign-in: this device becomes the active one (admins: 24h, others: 12h). */
export async function claimDeviceSession(isAdmin?: boolean) {
  const key = crypto.randomUUID() + crypto.randomUUID();
  let admin = isAdmin;
  const claim = supabase.rpc("claim_device_session" as never, { _key: key } as never);
  if (admin === undefined) {
    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.user.id)
        .eq("role", "admin");
      admin = (data?.length ?? 0) > 0;
    }
  }
  const result = await claim;
  if (result.error || result.data === false)
    throw new Error("সেশন তৈরি করা যায়নি। আবার চেষ্টা করুন।");
  localStorage.setItem(KEY, key);
  localStorage.setItem(AT, String(Date.now()));
  localStorage.setItem(MAX, String(admin ? ADMIN_SESSION_MAX_MS : SESSION_MAX_MS));
  lastOkAt = Date.now();
}

/** Returns a Bengali reason when this device must be signed out, else null. */
export async function checkDeviceSession(force = false): Promise<string | null> {
  const key = localStorage.getItem(KEY);
  const at = Number(localStorage.getItem(AT) ?? 0);
  const max = Math.min(
    Number(localStorage.getItem(MAX) ?? SESSION_MAX_MS) || SESSION_MAX_MS,
    ADMIN_SESSION_MAX_MS,
  );
  if (!key || !at || Date.now() - at > max) return "সেশনের মেয়াদ শেষ। আবার লগইন করুন।";
  if (!force && Date.now() - lastOkAt < CACHE_MS) return null;
  const { data, error } = await supabase.rpc(
    "is_current_device_session" as never,
    { _key: key } as never,
  );
  if (error || typeof data !== "boolean")
    throw new Error("সেশন যাচাই করা যাচ্ছে না। আবার চেষ্টা করুন।");
  if (data === false)
    return "অন্য একটি ডিভাইসে এই আইডিতে লগইন করা হয়েছে, তাই এখান থেকে লগআউট করা হয়েছে।";
  lastOkAt = Date.now();
  return null;
}

export async function forceSignOut(reason: string) {
  lastOkAt = 0;
  localStorage.removeItem(KEY);
  localStorage.removeItem(AT);
  localStorage.removeItem(MAX);
  sessionStorage.setItem("logout_reason", reason);
  await supabase.auth.signOut({ scope: "local" });
}
