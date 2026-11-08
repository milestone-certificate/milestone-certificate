import { z } from "zod";
import { readBoundedJson, releaseResponseBody } from "./bounded-json";

export type SvpCatalogueOccupation = { key: string; name: string; arabic: string };
const endpoint = "https://svp-international-api.pacc.sa/api/v1/visitor_space/occupations";
const headers = {
  Accept: "application/json",
  Origin: "https://svp-international.qiwa.sa",
  Referer: "https://svp-international.qiwa.sa/",
  "X-Tenant-Name": "svp-international",
};
const occupation = z.object({
  occupation_key: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/),
  english_name: z.string().trim().min(1).max(250),
  arabic_name: z.string().max(500).nullish(),
});
const pageSchema = z.object({
  occupations: z.array(occupation).max(1000),
  pagination: z.object({
    current: z.number().int().positive(),
    next: z.number().int().positive().nullable(),
    pages: z.number().int().positive().max(100),
    count: z.number().int().positive().max(10_000),
  }),
});

/** A failed or incomplete page must never become a successful partial import. */
export async function fetchSvpOccupationCatalogue(): Promise<SvpCatalogueOccupation[]> {
  const rows = new Map<string, SvpCatalogueOccupation>();
  let expectedCount: number | undefined;
  let expectedPages: number | undefined;
  for (let page = 1; page <= 100; page++) {
    const url = new URL(endpoint);
    url.search = new URLSearchParams({
      per_page: "100",
      page: String(page),
      locale: "en",
    }).toString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
      if (!response.ok) {
        await releaseResponseBody(response);
        throw new Error("SVP occupation catalogue unavailable");
      }
      const parsed = pageSchema.safeParse(await readBoundedJson(response));
      if (!parsed.success) throw new Error("Invalid SVP occupation catalogue");
      const { occupations, pagination } = parsed.data;
      expectedCount ??= pagination.count;
      expectedPages ??= pagination.pages;
      if (
        pagination.current !== page ||
        pagination.count !== expectedCount ||
        pagination.pages !== expectedPages ||
        occupations.length === 0
      )
        throw new Error("SVP occupation catalogue changed during loading");
      for (const item of occupations) {
        if (rows.has(item.occupation_key)) throw new Error("Duplicate SVP occupation code");
        rows.set(item.occupation_key, {
          key: item.occupation_key,
          name: item.english_name,
          arabic: item.arabic_name ?? "",
        });
      }
      if (pagination.next === null) {
        if (page !== expectedPages || rows.size !== expectedCount)
          throw new Error("Incomplete SVP occupation catalogue");
        return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
      }
      if (pagination.next !== page + 1 || page >= expectedPages)
        throw new Error("Invalid SVP occupation pagination");
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("SVP occupation catalogue page limit exceeded");
}
