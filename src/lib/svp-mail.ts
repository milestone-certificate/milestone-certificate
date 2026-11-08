/** Only known Yopmail aliases can be opened; never put credentials or OTPs in a URL. */
export function svpMailboxUrl(login: string): string | null {
  const match = /^([a-z0-9._+-]{1,64})@(yopmail\.(?:com|fr|net)|dakbox\.net)$/i.exec(login.trim());
  return match ? `https://yopmail.com/?login=${encodeURIComponent(match[1])}` : null;
}
const KEY = "svp-open-yopmail";
export function autoOpenSvpMail(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}
export function setAutoOpenSvpMail(enabled: boolean) {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    /* Storage may be disabled. */
  }
}
/** Reserve the tab during the click, before the asynchronous OTP request. */
export function reserveSvpMail(login: string) {
  const url = svpMailboxUrl(login);
  if (!url || !autoOpenSvpMail()) return null;
  const popup = window.open("about:blank", "svp-otp-mail");
  if (popup) popup.opener = null;
  return {
    finish(sent: boolean) {
      if (!popup || popup.closed) return;
      if (sent) popup.location.replace(url);
      else popup.close();
    },
  };
}

export function svpLanguageLabel(label: string): string {
  return (
    (
      {
        english: "ইংরেজি",
        bengali: "বাংলা",
        bangla: "বাংলা",
        arabic: "আরবি",
        hindi: "হিন্দি",
        urdu: "উর্দু",
        nepali: "নেপালি",
      } as Record<string, string>
    )[label.trim().toLowerCase()] ?? label
  );
}
