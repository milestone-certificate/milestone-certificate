import type { SvpLanguage } from "./svp-api.shared";

/** Display names only: provider codes are always sent unchanged. */
export function svpLanguageLabel(label: string): string {
  const labels: Record<string, string> = {
    en: "ইংরেজি",
    english: "ইংরেজি",
    bn: "বাংলা",
    bengali: "বাংলা",
    bangla: "বাংলা",
    ar: "আরবি",
    arabic: "আরবি",
    hi: "হিন্দি",
    hindi: "হিন্দি",
    ur: "উর্দু",
    urdu: "উর্দু",
    ne: "নেপালি",
    nepali: "নেপালি",
  };
  return labels[label.trim().toLowerCase()] ?? label;
}

/** Same country filtering and preferred question count for booking and rescheduling. */
export function svpLanguageOptions(
  primary: SvpLanguage[],
  fallback: SvpLanguage[],
  targeted: boolean,
): SvpLanguage[] {
  const filtered = primary.filter((entry) => entry.nonTargeted === !targeted);
  const fallbackFiltered = fallback.filter((entry) => entry.nonTargeted === !targeted);
  const source = filtered.length
    ? filtered
    : fallbackFiltered.length
      ? fallbackFiltered
      : primary.length
        ? primary
        : fallback;
  const byLabel = new Map<string, SvpLanguage>();
  for (const entry of source) {
    const key = svpLanguageLabel(entry.label).trim().toLowerCase();
    const previous = byLabel.get(key);
    if (!previous || (entry.questionCount ?? 0) > (previous.questionCount ?? 0))
      byLabel.set(key, entry);
  }
  return [...byLabel.values()];
}
