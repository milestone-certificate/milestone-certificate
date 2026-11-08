/** Only known Yopmail aliases can be opened; never put credentials or OTPs in a URL. */
export function svpMailboxUrl(login: string): string | null {
  const match = /^([a-z0-9._+-]{1,64})@(yopmail\.(?:com|fr|net)|dakbox\.net)$/i.exec(login.trim());
  return match ? `https://yopmail.com/?login=${encodeURIComponent(match[1])}` : null;
}
/** Reserve the tab during the click, before the asynchronous OTP request. */
export function reserveSvpMail(login: string) {
  const url = svpMailboxUrl(login);
  if (!url) return null;
  const popup = window.open("about:blank", "_blank");
  if (popup) popup.opener = null;
  return {
    finish(sent: boolean) {
      if (!popup || popup.closed) return;
      if (sent) popup.location.replace(url);
      else popup.close();
    },
  };
}
