// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { fetchSvpOccupationCatalogue } from "@/lib/svp-occupations.server";
const occupation = (key: string) => ({
  occupation_key: key,
  english_name: `Trade ${key}`,
  arabic_name: "",
});
const response = (current: number, next: number | null, keys: string[], count = 3, pages = 3) =>
  new Response(
    JSON.stringify({
      occupations: keys.map(occupation),
      pagination: { current, next, count, pages },
    }),
  );
afterEach(() => vi.unstubAllGlobals());
it("follows all official pages, preserving SVP codes and tenant headers", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(1, 2, ["100001"]))
    .mockResolvedValueOnce(response(2, 3, ["100002"]))
    .mockResolvedValueOnce(response(3, null, ["100003"]));
  vi.stubGlobal("fetch", fetcher);
  expect((await fetchSvpOccupationCatalogue()).map((r) => r.key)).toEqual([
    "100001",
    "100002",
    "100003",
  ]);
  expect(fetcher.mock.calls.map(([url]) => url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
  expect(fetcher.mock.calls[0][1].headers["X-Tenant-Name"]).toBe("svp-international");
});
it("rejects a failed later page instead of returning the first page as the full catalogue", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(response(1, 2, ["100001"]))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 })),
  );
  await expect(fetchSvpOccupationCatalogue()).rejects.toThrow("unavailable");
});
it("rejects missing rows, repeated pages, duplicate codes and changing counts", async () => {
  for (const second of [
    response(2, null, [], 3, 3),
    response(1, 2, ["100002"]),
    response(2, 3, ["100001"]),
    response(2, null, ["100002"], 2, 3),
    response(2, null, ["100002"], 3, 3),
  ]) {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response(1, 2, ["100001"]))
        .mockResolvedValueOnce(second),
    );
    await expect(fetchSvpOccupationCatalogue()).rejects.toThrow();
  }
});
it("rejects invalid occupation records before they can be imported", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          occupations: [{ occupation_key: "", english_name: "" }],
          pagination: { current: 1, next: null, count: 1, pages: 1 },
        }),
      ),
    ),
  );
  await expect(fetchSvpOccupationCatalogue()).rejects.toThrow("Invalid SVP");
});
