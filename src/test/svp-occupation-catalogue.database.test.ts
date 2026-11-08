// @vitest-environment node
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
const url = process.env.SVP_CATALOGUE_TEST_DATABASE_URL;
const local =
  !!url &&
  ["127.0.0.1", "localhost"].includes(new URL(url).hostname) &&
  new URL(url).pathname === "/svp_catalogue_test";
describe.runIf(local)("Full occupation catalogue in disposable PostgreSQL", () => {
  const sql = postgres(url || "postgres://localhost/svp_catalogue_test", {
    max: 2,
    onnotice: () => {},
  });
  let snapshot: { key: string; name: string }[];
  const small = [
    { key: "933301", name: "Load and Unload Worker" },
    { key: "753104", name: "Agal Tailor" },
  ];
  const sync = async (items: unknown) =>
    (
      await sql`SELECT public.sync_svp_occupation_catalogue(${sql.json(items as never)}) AS stats`
    )[0].stats;
  beforeAll(async () => {
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
      CREATE TABLE public.occupations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text,svp_key text,active boolean,created_at timestamptz DEFAULT now());`);
    const migration = await readFile(
      new URL(
        "../../supabase/migrations/20261108210000_full_svp_occupation_catalogue.sql",
        import.meta.url,
      ),
      "utf8",
    );
    snapshot = JSON.parse(migration.split("$catalogue$")[1]);
    const connection = await sql.reserve();
    try {
      await connection.unsafe(migration);
    } finally {
      connection.release();
    }
  });
  beforeEach(async () => {
    await sql`TRUNCATE public.occupations`;
  });
  afterAll(async () => {
    await sql.end();
  });
  it("imports all 297 official codes and reimport keeps every existing ID", async () => {
    expect(await sync(snapshot)).toMatchObject({
      official: 297,
      inserted: 297,
      total: 297,
      conflicts: 0,
    });
    const before = await sql`SELECT id,svp_key FROM occupations ORDER BY svp_key`;
    expect(await sync(snapshot)).toMatchObject({ inserted: 0, unchanged: 297, total: 297 });
    expect(await sql`SELECT id,svp_key FROM occupations ORDER BY svp_key`).toEqual(before);
  });
  it("preserves edited names and inactive flags, and links a matching unkeyed manual row without replacing its ID", async () => {
    const [edited] =
      await sql`INSERT INTO occupations(name,svp_key,active) VALUES('Locally edited name','933301',false) RETURNING id`;
    const [manual] =
      await sql`INSERT INTO occupations(name,active) VALUES('Agal Tailor',false) RETURNING id`;
    expect(await sync(small)).toMatchObject({ inserted: 0, linked: 1, unchanged: 1 });
    const rows = await sql`SELECT * FROM occupations ORDER BY svp_key`;
    expect(rows.find((r) => r.id === edited.id)).toMatchObject({
      name: "Locally edited name",
      active: false,
      svp_key: "933301",
    });
    expect(rows.find((r) => r.id === manual.id)).toMatchObject({
      name: "Agal Tailor",
      active: false,
      svp_key: "753104",
    });
  });
  it("reports conflicting named rows without overwriting their codes", async () => {
    await sql`INSERT INTO occupations(name,svp_key,active) VALUES('Agal Tailor','999999',true)`;
    expect(await sync(small)).toMatchObject({ inserted: 1, conflicts: 1, total: 2 });
    expect((await sql`SELECT svp_key FROM occupations WHERE name='Agal Tailor'`)[0].svp_key).toBe(
      "999999",
    );
  });
  it("rejects malformed or duplicate payloads atomically", async () => {
    for (const items of [
      [],
      null,
      [small[0], small[0]],
      [...small, { key: "invalid", name: "Bad trade" }],
    ]) {
      await expect(sync(items)).rejects.toThrow(/Invalid/);
      expect((await sql`SELECT count(*)::int AS n FROM occupations`)[0].n).toBe(0);
    }
  });
  it("allows only the service-role RPC, not anonymous or authenticated direct imports", async () => {
    for (const role of ["anon", "authenticated"])
      await expect(
        sql.begin(async (tx) => {
          await tx.unsafe(`SET LOCAL ROLE ${role}`);
          return tx`SELECT public.sync_svp_occupation_catalogue(${tx.json(small)})`;
        }),
      ).rejects.toThrow(/permission denied/);
    expect(
      await sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE service_role");
        return tx`SELECT public.sync_svp_occupation_catalogue(${tx.json(small)}) AS stats`;
      }),
    ).toMatchObject([{ stats: { inserted: 2 } }]);
  });
  it("serializes simultaneous imports so no duplicate code is created", async () => {
    const results = await Promise.all([sync(small), sync(small)]);
    expect(results.map((r) => r.inserted).sort()).toEqual([0, 2]);
    expect((await sql`SELECT count(*)::int AS n FROM occupations`)[0].n).toBe(2);
  });
});
