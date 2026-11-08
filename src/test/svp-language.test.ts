import { describe, expect, it } from "vitest";
import { svpLanguageLabel, svpLanguageOptions } from "@/lib/svp-language.shared";
describe("shared booking and reschedule languages", () => {
  it.each([
    ["bn", "বাংলা"],
    ["Bengali", "বাংলা"],
    ["en", "ইংরেজি"],
    ["Arabic", "আরবি"],
    ["provider_code_123", "provider_code_123"],
  ])("labels %s without rewriting provider codes", (code, label) =>
    expect(svpLanguageLabel(code)).toBe(label),
  );
  it("prefers the larger question code and the requested country mode", () => {
    const options = svpLanguageOptions(
      [
        { code: "bn10", label: "bn", questionCount: 10, nonTargeted: false },
        { code: "bn30", label: "Bengali", questionCount: 30, nonTargeted: false },
        { code: "site-bn", label: "Bangla", questionCount: 40, nonTargeted: true },
      ],
      [],
      true,
    );
    expect(options.map((o) => o.code)).toEqual(["bn30"]);
  });
  it("uses category languages when the occupation omits the requested mode", () => {
    expect(
      svpLanguageOptions(
        [{ code: "targeted", label: "English", questionCount: 30, nonTargeted: false }],
        [{ code: "site", label: "English", questionCount: 30, nonTargeted: true }],
        false,
      ).map((o) => o.code),
    ).toEqual(["site"]);
  });
});
