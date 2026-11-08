import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn().mockResolvedValue({ error: null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc, auth: { signOut } } }));
import {
  claimDeviceSession,
  checkDeviceSession,
  resetDeviceCheckCache,
  forceSignOut,
} from "@/lib/device-session";
beforeEach(() => {
  localStorage.clear();
  resetDeviceCheckCache();
  rpc.mockReset();
});
it("accepts a void claim and saves a device only after successful RPC", async () => {
  rpc.mockResolvedValue({ data: null, error: null });
  await claimDeviceSession(false);
  expect(localStorage.getItem("device_session_key")).toBeTruthy();
  expect(await checkDeviceSession()).toBeNull();
});
it("does not store or cache a failed claim", async () => {
  rpc.mockResolvedValue({ data: null, error: { message: "outage" } });
  await expect(claimDeviceSession(false)).rejects.toThrow();
  expect(localStorage.getItem("device_session_key")).toBeNull();
  expect(await checkDeviceSession()).toContain("মেয়াদ");
});
it("never treats verification errors as valid or caches them", async () => {
  localStorage.setItem("device_session_key", "test");
  localStorage.setItem("device_login_at", String(Date.now()));
  rpc.mockResolvedValue({ data: null, error: { message: "outage" } });
  await expect(checkDeviceSession()).rejects.toThrow();
  await expect(checkDeviceSession()).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(2);
  rpc.mockResolvedValue({ data: false, error: null });
  expect(await checkDeviceSession()).toContain("অন্য একটি");
});

it("signs out only this device when replaced, preserving the newest login", async () => {
  localStorage.setItem("device_session_key", "old");
  localStorage.setItem("device_session_max", "123");
  await forceSignOut("replaced");
  expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  expect(localStorage.getItem("device_session_key")).toBeNull();
  expect(localStorage.getItem("device_session_max")).toBeNull();
});
