import { afterEach, describe, expect, it, vi } from "vitest";
import { reserveSvpMail, svpMailboxUrl } from "@/lib/svp-mail";
afterEach(() => vi.restoreAllMocks());
describe("automatic SVP mailbox tabs", () => {
  it("opens each successful OTP challenge in a fresh tab and clears its opener", () => {
    const replace = vi.fn(),
      close = vi.fn();
    const popup = { closed: false, opener: window, location: { replace }, close };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    reserveSvpMail("shamim-alam@yopmail.com")?.finish(true);
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(replace).toHaveBeenCalledWith("https://yopmail.com/?login=shamim-alam");
    expect(popup.opener).toBeNull();
  });
  it("closes the reserved tab when reconnect needs no OTP or login fails", () => {
    const close = vi.fn(),
      replace = vi.fn();
    vi.spyOn(window, "open").mockReturnValue({
      closed: false,
      opener: window,
      location: { replace },
      close,
    } as unknown as Window);
    reserveSvpMail("shamim-alam@yopmail.com")?.finish(false);
    expect(close).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();
  });
  it("keeps popup blocking from interrupting the OTP form", () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(() => reserveSvpMail("shamim-alam@yopmail.com")?.finish(true)).not.toThrow();
  });
  it.each(["person@gmail.com", "shamim-alam@yopmail.com.evil.test", "<script>@yopmail.com"])(
    "does not open an unsupported address: %s",
    (login) => {
      const open = vi.spyOn(window, "open");
      expect(svpMailboxUrl(login)).toBeNull();
      expect(reserveSvpMail(login)).toBeNull();
      expect(open).not.toHaveBeenCalled();
    },
  );
});
