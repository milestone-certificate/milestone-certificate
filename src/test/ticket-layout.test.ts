import { expect, it } from "vitest";
import { parseAppointmentLayout } from "@/lib/ticket-layout";
import {
  appointmentDate,
  parseAppointmentText,
  matchTicketCatalogue,
} from "@/lib/ticket-extraction";
import { paccTicketItems } from "./fixtures/pacc-ticket-layout";

it("reads PACC multi-column values below their headings and its unlabeled date/time card", () => {
  const { extraction: x, hasConflicts } = parseAppointmentLayout([{ items: paccTicketItems }]);
  expect(x.candidate_name.value).toBe("SAMPLE PERSON");
  expect(x.passport_no.value).toBe("A12345678");
  expect(x.occupation.value).toBe("Private Car Driver - Musaned");
  expect(x.center.value).toBe("Bogura Technical Training Centre");
  expect(x.exam_date.value).toBe("2026-11-17");
  expect(x.exam_time.value).toBe("13:00");
  expect(x.booking_no.value).toBe("7001234");
  expect(x.candidate_count).toBe(1);
  expect(x.ambiguities).toEqual([]);
  expect(hasConflicts).toBe(false);
});
it("uses physical columns even when the PDF stream lists cells out of reading order", () => {
  expect(parseAppointmentLayout([{ items: [...paccTicketItems].reverse() }]).extraction).toEqual(
    parseAppointmentLayout([{ items: paccTicketItems }]).extraction,
  );
});
it("does not use headings as values or mistake the address city for the test centre", () => {
  const raw = parseAppointmentText(
    "Name  Passport Number  Nationality\nOccupation  Occupation Code  Test Language\nOccupation Code: 9141055",
  );
  expect(raw.candidate_name.value).toBeNull();
  expect(raw.occupation.value).toBeNull();
  const x = parseAppointmentLayout([{ items: paccTicketItems }]).extraction;
  expect(
    matchTicketCatalogue(x.center.value, [
      { id: "bogura", name: "Bogura Technical Training Centre" },
      { id: "rajshahi", name: "Rajshahi Technical Training Centre" },
    ])?.id,
  ).toBe("bogura");
});
it("leaves missing fields blank instead of reading arrival instructions or header labels", () => {
  const items = paccTicketItems.filter(
    (i) => !["A12345678", "Tue, Nov 17, 2026", "01:00 PM"].includes(i.text),
  );
  const x = parseAppointmentLayout([{ items }]).extraction;
  expect(x.passport_no.value).toBeNull();
  expect(x.exam_date.value).toBeNull();
  expect(x.exam_time.value).toBeNull();
});
it("flags multiple passport rows for manual review rather than mixing applicants", () => {
  const original = paccTicketItems.find((i) => i.text === "A12345678")!;
  const x = parseAppointmentLayout([
    { items: [...paccTicketItems, { ...original, text: "A87654321", y: original.y - 10 }] },
  ]);
  expect(x.extraction.candidate_count).toBe(2);
  expect(x.hasConflicts).toBe(true);
  expect(x.extraction.passport_no.value).toBeNull();
});
it("keeps actual OCR confidence when reading structured scan data", () => {
  expect(
    parseAppointmentLayout([{ items: paccTicketItems }], 0.71).extraction.passport_no.confidence,
  ).toBe(0.71);
});
for (const [value, expected] of [
  ["Tue, Nov 17, 2026", "2026-11-17"],
  ["November 17th, 2026", "2026-11-17"],
  ["Nov 31, 2026", null],
] as const)
  it(`normalizes the printed date ${value}`, () => expect(appointmentDate(value)).toBe(expected));
