// @vitest-environment node
import postgres from "postgres";
import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, afterAll, describe, expect, it } from "vitest";
const url = process.env.DASHBOARD_TEST_DATABASE_URL;
const run =
  !!url &&
  ["localhost", "127.0.0.1"].includes(new URL(url).hostname) &&
  new URL(url).pathname === "/dashboard_audit";
describe.runIf(run)("Dashboard workflow against disposable PostgreSQL", () => {
  const sql = postgres(url || "postgres://localhost/dashboard_audit", {
    max: 1,
    onnotice: () => {},
  });
  const ids = Object.fromEntries(
    ["agent", "child", "other", "staff", "management", "service_provider", "customer", "admin"].map(
      (role, i) => [role, `ff000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`],
    ),
  );
  beforeAll(async () => {
    await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE SCHEMA IF NOT EXISTS auth;
      DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      CREATE TABLE IF NOT EXISTS auth.users(id uuid primary key,email text);
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE TYPE app_role AS ENUM ('admin','staff','agent','management','service_provider');
      CREATE TABLE user_roles(user_id uuid,role app_role);
      CREATE TABLE profiles(id uuid,email text);
      CREATE TABLE agent_accounts(user_id uuid,active boolean,parent_agent_id uuid,full_name text,mobile text,agent_code text);
      GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
      GRANT SELECT ON user_roles TO authenticated;`);
    for (const f of [
      "manual/apply_core_functions.sql",
      "manual/apply_core_tables.sql",
      "manual/apply_core_policies.sql",
      "migrations/20261108180000_dashboard_workflow_repair.sql",
      "migrations/20261108190000_admin_device_slots.sql",
    ])
      await sql.unsafe(await readFile(new URL(`../../supabase/${f}`, import.meta.url), "utf8"));
    for (const [role, id] of Object.entries(ids)) {
      await sql`INSERT INTO auth.users(id,email) VALUES(${id},${role === "customer" ? "8801777777774@phone.login.local" : `${role}@test.local`}) ON CONFLICT(id) DO UPDATE SET email=excluded.email`;
      if (role !== "customer")
        await sql`INSERT INTO user_roles VALUES(${id},${role === "child" || role === "other" ? "agent" : role})`;
      await sql`INSERT INTO agent_accounts(user_id,active,parent_agent_id,full_name,mobile) VALUES(${id},true,${role === "child" ? ids.agent : null},${role},null)`;
    }
  });
  beforeEach(async () => {
    await sql.unsafe("TRUNCATE job_submissions,candidates,exams,results,payments");
  });
  afterAll(async () => {
    await sql.end();
  });
  const asUser = <T>(role: string, fn: (tx: postgres.TransactionSql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx`SELECT set_config('request.jwt.claim.sub',${ids[role]},true)`;
      return fn(tx);
    });
  const submit = async (role = "agent") =>
    (
      await asUser(
        role,
        (tx) =>
          tx`INSERT INTO job_submissions(candidate_name,passport_no,mobile,occupation_id,exam_at) VALUES('TEST CANDIDATE','A1234567','01777777774','trade', '2026-11-23T03:00:00Z') RETURNING *`,
      )
    )[0];
  const approve = async (id: string) =>
    (
      await asUser(
        "staff",
        (tx) => tx`UPDATE job_submissions SET status='approved' WHERE id=${id} RETURNING *`,
      )
    )[0];
  it("assigns authenticated ownership, references and correct parent approval stage", async () => {
    const a = await submit();
    const c = await submit("child");
    expect(a.submitted_by).toBe(ids.agent);
    expect(a.ref_code).toMatch(/^MC/);
    expect(a.status).toBe("pending_approval");
    expect(c.status).toBe("pending_agent");
    expect(a.reviewed_at).toBeNull();
    expect(a.received_at).toBeNull();
    expect(await asUser("other", (tx) => tx`SELECT * FROM job_submissions`)).toHaveLength(0);
    expect(await asUser("agent", (tx) => tx`SELECT * FROM job_submissions`)).toHaveLength(2);
  });
  it("rejects forged ownership and role-less job creation", async () => {
    await expect(
      asUser("agent", (tx) => tx`INSERT INTO job_submissions(submitted_by) VALUES(${ids.other})`),
    ).rejects.toThrow(/Agent access/);
    await expect(
      asUser("customer", (tx) => tx`INSERT INTO job_submissions DEFAULT VALUES`),
    ).rejects.toThrow(/Agent access/);
  });
  it("prevents agents and parents from self-approval or direct result edits", async () => {
    const row = await submit();
    const child = await submit("child");
    for (const [role, id] of [
      ["agent", row.id],
      ["agent", child.id],
    ])
      await expect(
        asUser(role, (tx) => tx`UPDATE job_submissions SET status='approved' WHERE id=${id}`),
      ).rejects.toThrow(/Protected|not allowed/);
    await expect(
      asUser("agent", (tx) => tx`UPDATE job_submissions SET svp_result='PASS' WHERE id=${row.id}`),
    ).rejects.toThrow(/Protected/);
    await asUser(
      "agent",
      (tx) => tx`UPDATE job_submissions SET candidate_name='EDITED' WHERE id=${row.id}`,
    );
    expect(
      (await sql`SELECT candidate_name FROM job_submissions WHERE id=${row.id}`)[0].candidate_name,
    ).toBe("EDITED");
  });
  it("links approval once and keeps Dhaka exam time and reception data consistent", async () => {
    const approved = await approve((await submit()).id);
    expect(approved.candidate_id).toBeTruthy();
    expect(approved.exam_id).toBeTruthy();
    await approve(approved.id);
    const exams = await sql`SELECT * FROM exams`;
    expect(exams).toHaveLength(1);
    expect(exams[0].exam_time).toBe("09:00");
    expect(exams[0].exam_date).toBe("2026-11-23");
    await sql`UPDATE job_submissions SET secondary_mobile='01800000000',arrival_status='received' WHERE id=${approved.id}`;
    expect((await sql`SELECT * FROM candidates`)[0].secondary_mobile).toBe("01800000000");
    expect(
      await asUser(
        "management",
        (tx) => tx`UPDATE job_submissions SET status='rejected' RETURNING id`,
      ),
    ).toHaveLength(0);
  });
  it("gives providers approved works without pending records or mutation rights", async () => {
    const approved = await approve((await submit()).id);
    await submit();
    const rows = await asUser("service_provider", (tx) => tx`SELECT * FROM job_submissions`);
    expect(rows.map((r) => r.id)).toEqual([approved.id]);
    expect(
      await asUser(
        "service_provider",
        (tx) => tx`UPDATE job_submissions SET status='rejected' RETURNING id`,
      ),
    ).toHaveLength(0);
  });
  it("appends actual result changes, synchronizes both directions and preserves history", async () => {
    const approved = await approve((await submit()).id);
    await sql`UPDATE job_submissions SET svp_result='PASS' WHERE id=${approved.id}`;
    await sql`UPDATE job_submissions SET svp_result='PASS' WHERE id=${approved.id}`;
    expect((await sql`SELECT result FROM exams`)[0].result).toBe("PASS");
    expect(await sql`SELECT * FROM results`).toHaveLength(1);
    await asUser("staff", (tx) => tx`UPDATE exams SET result='FAIL' WHERE id=${approved.exam_id}`);
    expect((await sql`SELECT svp_result FROM job_submissions`)[0].svp_result).toBe("FAIL");
    expect(await sql`SELECT * FROM results`).toHaveLength(2);
    await expect(
      asUser("staff", (tx) => tx`UPDATE results SET result='PASS'`),
    ).resolves.toHaveLength(0);
    await expect(sql`UPDATE results SET result='PASS'`).rejects.toThrow(/immutable/);
    await expect(sql`DELETE FROM results`).rejects.toThrow(/immutable/);
  });
  it("isolates customers by phone and gates results until published and fully paid", async () => {
    const row = await approve((await submit()).id);
    await sql`INSERT INTO candidates(name,mobile) VALUES('OTHER','01800000000')`;
    expect(await asUser("customer", (tx) => tx`SELECT * FROM candidates`)).toHaveLength(1);
    expect(await asUser("customer", (tx) => tx`SELECT * FROM exams`)).toHaveLength(0);
    await sql`UPDATE candidates SET result_check_at=now()-interval '1 day',fee_amount=500 WHERE id=${row.candidate_id}`;
    await sql`INSERT INTO payments(candidate_id,amount,status) VALUES(${row.candidate_id},200,'approved')`;
    expect(await asUser("customer", (tx) => tx`SELECT * FROM exams`)).toHaveLength(0);
    await sql`INSERT INTO payments(candidate_id,amount,status) VALUES(${row.candidate_id},300,'approved')`;
    expect(await asUser("customer", (tx) => tx`SELECT * FROM exams`)).toHaveLength(1);
    expect(await asUser("agent", (tx) => tx`SELECT * FROM candidates`)).toHaveLength(0);
  });
  it("accepts a pending receipt without allowing customer approval or a different candidate", async () => {
    const row = await approve((await submit()).id);
    const [p] = await asUser(
      "customer",
      (tx) =>
        tx`INSERT INTO payments(candidate_id,amount,method,created_by) VALUES(${row.candidate_id},500,'bkash',${ids.customer}) RETURNING *`,
    );
    expect(p.status).toBe("pending");
    expect(p.reviewed_at).toBeNull();
    expect(
      await asUser("customer", (tx) => tx`UPDATE payments SET status='approved' RETURNING id`),
    ).toHaveLength(0);
    await expect(
      asUser(
        "customer",
        (tx) =>
          tx`INSERT INTO payments(candidate_id,amount,method,created_by,status) VALUES(${row.candidate_id},500,'bkash',${ids.customer},'approved')`,
      ),
    ).rejects.toThrow(/not allowed/);
    await expect(
      asUser(
        "customer",
        (tx) =>
          tx`INSERT INTO payments(candidate_id,amount,method,created_by) VALUES(${ids.other},500,'bkash',${ids.customer})`,
      ),
    ).rejects.toThrow(/not allowed/);
  });
  it("returns the public result contract only after publication", async () => {
    const row = await approve((await submit()).id);
    await sql`UPDATE exams SET result='PASS' WHERE id=${row.exam_id}`;
    expect((await sql`SELECT check_applicant_result('A1234567','trade') AS r`)[0].r.status).toBe(
      "pending",
    );
    await sql`UPDATE candidates SET result_check_at=now()-interval '1 hour' WHERE id=${row.candidate_id}`;
    const r = (await sql`SELECT check_applicant_result('a1234567','trade') AS r`)[0].r;
    expect(r.status).toBe("available");
    expect(r.result).toBe("PASS");
    expect((await sql`SELECT check_applicant_result('A1234567','') AS r`)[0].r.status).toBe(
      "not_found",
    );
  });
  it("keeps only the latest two admin devices and one device for other roles", async () => {
    for (const role of ["admin", "agent"]) {
      for (const key of ["a", "b", "c"])
        await asUser(role, (tx) => tx`SELECT claim_device_session(${key.repeat(64)})`);
      for (const key of ["a", "b", "c"]) {
        const [row] = await asUser(
          role,
          (tx) => tx`SELECT is_current_device_session(${key.repeat(64)}) AS valid`,
        );
        expect(row.valid).toBe(key === "c" || (role === "admin" && key === "b"));
      }
    }
    await expect(asUser("agent", (tx) => tx`SELECT claim_device_session('short')`)).rejects.toThrow(
      /Invalid device/,
    );
  });
});
