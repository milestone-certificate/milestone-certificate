import { describe, expect, it } from "vitest";
import {
  appointmentDate,
  appointmentTime,
  hasAppointmentIdentity,
  matchTicketCatalogue,
  parseAppointmentText,
  ticketMime,
} from "@/lib/ticket-extraction";
export const sample = `Candidate Name: JOHN SAMPLE
Passport Number: A1234567
Occupation: Load and Unload Worker
Exam Date: 29 Nov 2026
Reporting Time: 08:30 AM
Exam Time: 09:15 AM
Test Center: Cumilla Technical Training Centre
Booking Number: B9876543
Mobile Number: +8801777777774`;
it("extracts printed fields, including non-preset start times, without treating a booking ID as another candidate", () => {
  const x = parseAppointmentText(sample);
  expect(x.candidate_name.value).toBe("JOHN SAMPLE");
  expect(x.passport_no.value).toBe("A1234567");
  expect(x.exam_date.value).toBe("2026-11-29");
  expect(x.exam_time.value).toBe("09:15");
  expect(x.mobile?.value).toBe("01777777774");
  expect(x.candidate_count).toBe(1);
  expect(hasAppointmentIdentity(x)).toBe(true);
});
it("supports PDF labels on separate rows and ignores birth/arrival dates", () => {
  const x = parseAppointmentText(
    `Date of birth: 12/11/1990\nName:\nJOHN SAMPLE\nPassport No.:\nA1234567\nTest Date:\n23/11/2026\nPlease arrive 30 minutes before 08:00\nTest Time:\n01:30 PM`,
  );
  expect(x.exam_date.value).toBe("2026-11-23");
  expect(x.exam_time.value).toBe("13:30");
  expect(x.candidate_name.value).toBe("JOHN SAMPLE");
});
it("flags multiple applicants and does not invent unreadable fields", () => {
  expect(parseAppointmentText(sample + "\nPassport No: A7654321").candidate_count).toBe(2);
  const x = parseAppointmentText("Unreadable scan");
  expect(x.passport_no.value).toBeNull();
  expect(x.exam_time.value).toBeNull();
  expect(hasAppointmentIdentity(x)).toBe(false);
});
describe("ticket dates and start times", () => {
  for (const [value, expected] of [
    ["23/11/2026", "2026-11-23"],
    ["2026-11-23", "2026-11-23"],
    ["২৯/১১/২০২৬", "2026-11-29"],
    ["31/02/2026", null],
    ["29/02/2028", "2028-02-29"],
  ])
    it(`normalizes ${value}`, () => expect(appointmentDate(value!)).toBe(expected));
  for (const [value, expected] of [
    ["12:00 AM", "00:00"],
    ["12:00 PM", "12:00"],
    ["01:45 PM", "13:45"],
    ["০৯:১৫ AM", "09:15"],
    ["14:30 - 15:30", "14:30"],
    ["24:00", null],
    ["09:75", null],
  ])
    it(`normalizes ${value}`, () => expect(appointmentTime(value!)).toBe(expected));
});
it("matches the correct centre rather than the first centre sharing a generic word", () => {
  const rows = [
    { id: "bogura", name: "Bogura Technical Training Centre", active: true },
    { id: "cumilla", name: "Cumilla Technical Training Centre", active: true },
  ];
  expect(matchTicketCatalogue("Cumilla Technical Training Centre", rows)?.id).toBe("cumilla");
  expect(matchTicketCatalogue("Technical", rows)).toBeUndefined();
  expect(matchTicketCatalogue("Technical", rows.slice(0, 1))).toBeUndefined();
  expect(
    matchTicketCatalogue("Cumilla Technical Training Centre", [
      ...rows,
      { id: "duplicate", name: rows[1].name },
    ]),
  ).toBeUndefined();
  expect(
    matchTicketCatalogue("Load & Unload Worker", [{ id: "trade", name: "Load and Unload Worker" }])
      ?.id,
  ).toBe("trade");
});
it("requires file signatures, handling empty or incorrect browser MIME metadata", () => {
  expect(ticketMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
  expect(ticketMime(new TextEncoder().encode("renamed executable"))).toBeNull();
  expect(ticketMime(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
});
