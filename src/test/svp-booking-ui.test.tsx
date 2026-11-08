import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SvpLoginPanel } from "@/components/app/SvpLoginPanel";

const mocks = vi.hoisted(() => ({ submit: vi.fn(), resend: vi.fn(), storedOtp: vi.fn() }));

vi.mock("@/lib/svp-session.functions", () => ({
  submitSvpLogin: mocks.submit,
  resendSvpOtp: mocks.resend,
  resendStoredSvpOtp: mocks.resend,
  submitStoredSvpOtp: mocks.storedOtp,
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.submit.mockReset();
  mocks.resend.mockReset();
  mocks.resend.mockResolvedValue({
    ok: true,
    httpStatus: 200,
    message: "A new OTP has been sent to the registered email.",
  });
});

const loginAccepted = {
  step: "login" as const,
  httpStatus: 200,
  ok: true,
  otpRequired: true,
  authenticated: false,
  message: "SVP accepted the username and password. Enter the OTP sent to the registered email.",
  session: null,
};

const otpAccepted = {
  step: "otp" as const,
  httpStatus: 200,
  ok: true,
  otpRequired: false,
  authenticated: true,
  message: "Signed in to SVP.",
  session: { userName: "Test Labor", login: "login@example.com", expiresAt: 1_800_000_000 },
};

describe("SVP login panel", () => {
  it("shows only username and password before login; system fields stay hidden", () => {
    render(<SvpLoginPanel />);

    expect(screen.getByLabelText("SVP ইমেইল")).toBeInTheDocument();
    expect(screen.getByLabelText("পাসওয়ার্ড")).toHaveAttribute("type", "password");
    expect(screen.queryByLabelText("fe_app")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("otp_method")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("locale")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("OTP কোড")).not.toBeInTheDocument();
  });

  it("submits only username/password then advances to the OTP input", async () => {
    mocks.submit.mockResolvedValueOnce(loginAccepted);
    render(<SvpLoginPanel />);

    fireEvent.change(screen.getByLabelText("SVP ইমেইল"), {
      target: { value: "candidate-login" },
    });
    fireEvent.change(screen.getByLabelText("পাসওয়ার্ড"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "পরের ধাপ" }));

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenCalledWith({
        data: { step: "login", login: "candidate-login", password: "password-value" },
      }),
    );
    expect(await screen.findByLabelText("OTP কোড")).toBeInTheDocument();
    expect(screen.getByText(/ইমেইলে OTP পাঠানো হয়েছে/)).toBeInTheDocument();
    expect(screen.queryByLabelText("fe_app")).not.toBeInTheDocument();
  });

  it("submits the OTP attempt with the in-memory login fields", async () => {
    mocks.submit.mockResolvedValueOnce(loginAccepted).mockResolvedValueOnce(otpAccepted);
    render(<SvpLoginPanel />);

    fireEvent.change(screen.getByLabelText("SVP ইমেইল"), {
      target: { value: "candidate-login" },
    });
    fireEvent.change(screen.getByLabelText("পাসওয়ার্ড"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "পরের ধাপ" }));
    await screen.findByLabelText("OTP কোড");
    fireEvent.change(screen.getByLabelText("OTP কোড"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "OTP যাচাই" }));

    await waitFor(() =>
      expect(mocks.submit).toHaveBeenLastCalledWith({
        data: {
          step: "otp",
          login: "candidate-login",
          password: "password-value",
          otpAttempt: "123456",
        },
      }),
    );
    expect(await screen.findByText("সংযোগ হয়েছে")).toBeInTheDocument();
  });

  it("keeps the login step and shows the provider error when SVP rejects the credentials", async () => {
    mocks.submit.mockResolvedValueOnce({
      step: "login",
      httpStatus: 401,
      ok: false,
      otpRequired: false,
      authenticated: false,
      message: "SVP rejected this username or password.",
      session: null,
    });
    render(<SvpLoginPanel />);

    fireEvent.change(screen.getByLabelText("SVP ইমেইল"), {
      target: { value: "candidate-login" },
    });
    fireEvent.change(screen.getByLabelText("পাসওয়ার্ড"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "পরের ধাপ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("ইমেইল ও পাসওয়ার্ড মিলিয়ে নিন।");
    expect(screen.queryByLabelText("OTP কোড")).not.toBeInTheDocument();
  });

  it("reset clears the in-memory form and returns to username/password", async () => {
    mocks.submit.mockResolvedValueOnce(loginAccepted);
    render(<SvpLoginPanel />);
    fireEvent.change(screen.getByLabelText("SVP ইমেইল"), {
      target: { value: "candidate-login" },
    });
    fireEvent.change(screen.getByLabelText("পাসওয়ার্ড"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "পরের ধাপ" }));
    await screen.findByLabelText("OTP কোড");
    fireEvent.click(screen.getByRole("button", { name: "মুছুন" }));

    expect(screen.getByLabelText("SVP ইমেইল")).toHaveValue("");
    expect(screen.getByLabelText("পাসওয়ার্ড")).toHaveValue("");
    expect(screen.queryByLabelText("OTP কোড")).not.toBeInTheDocument();
  });
});

describe("SVP OTP resend", () => {
  it("resends the OTP for the same credentials from the OTP step", async () => {
    mocks.submit.mockResolvedValueOnce(loginAccepted);
    render(<SvpLoginPanel />);

    fireEvent.change(screen.getByLabelText("SVP ইমেইল"), {
      target: { value: "candidate-login" },
    });
    fireEvent.change(screen.getByLabelText("পাসওয়ার্ড"), {
      target: { value: "password-value" },
    });
    fireEvent.click(screen.getByRole("button", { name: "পরের ধাপ" }));
    await screen.findByLabelText("OTP কোড");

    fireEvent.click(screen.getByRole("button", { name: "নতুন OTP" }));

    await waitFor(() =>
      expect(mocks.resend).toHaveBeenCalledWith({
        data: { login: "candidate-login", password: "password-value" },
      }),
    );
    expect(await screen.findByText("নতুন OTP পাঠানো হয়েছে")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\d+ সেকেন্ড পরে/ })).toBeDisabled();
  });

  it("reconnect mode asks only for the OTP and completes with the stored password", async () => {
    mocks.storedOtp.mockResolvedValue({ ok: true, message: "Signed in to SVP." });

    render(<SvpLoginPanel otpOnly login="noor@example.com" />);

    expect(screen.queryByLabelText("পাসওয়ার্ড")).not.toBeInTheDocument();
    expect(screen.getByText(/noor@example.com–এ পাঠানো OTP/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("OTP কোড"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "OTP যাচাই" }));

    await waitFor(() =>
      expect(mocks.storedOtp).toHaveBeenCalledWith({ data: { otpAttempt: "123456" } }),
    );
  });
});

describe("SVP automatic OTP mailbox", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });
  it("automatically opens the Yopmail alias without confirmation or a saved preference", async () => {
    localStorage.setItem("svp-open-yopmail", "false");
    const replace = vi.fn();
    const close = vi.fn();
    const popup = { closed: false, opener: window, location: { replace }, close };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    mocks.submit.mockResolvedValue(loginAccepted);
    render(<SvpLoginPanel />);
    fireEvent.change(screen.getByLabelText("SVP ইমেইল"), {
      target: { value: "a13291235@dakbox.net" },
    });
    fireEvent.change(screen.getByLabelText("পাসওয়ার্ড"), { target: { value: "fixture-password" } });
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "পরের ধাপ" }));
    await screen.findByLabelText("OTP কোড");
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    expect(replace).toHaveBeenCalledWith("https://yopmail.com/?login=a13291235");
    expect(popup.opener).toBeNull();
    expect(screen.getByRole("link", { name: "Yopmail খুলুন" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });
  it("offers stored-account resend and keeps reset on the OTP step", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mocks.resend.mockResolvedValue({ ok: true, message: "sent" });
    render(<SvpLoginPanel otpOnly login="test@yopmail.com" />);
    fireEvent.click(screen.getByRole("button", { name: "নতুন OTP" }));
    await waitFor(() => expect(mocks.resend).toHaveBeenCalledWith());
    fireEvent.click(screen.getByRole("button", { name: "মুছুন" }));
    expect(screen.getByLabelText("OTP কোড")).toHaveValue("");
    expect(screen.queryByLabelText("পাসওয়ার্ড")).not.toBeInTheDocument();
  });
});
