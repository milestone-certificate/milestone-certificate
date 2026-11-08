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
      CREATE SCHEMA IF NOT EXISTS storage;
      DROP TABLE IF EXISTS storage.objects,storage.buckets CASCADE;
      CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA storage TO authenticated;
      GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects TO authenticated;
      CREATE TABLE agent_accounts(user_id uuid,active boolean,parent_agent_id uuid,full_name text,mobile text,agent_code text);
      GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
      GRANT SELECT ON user_roles TO authenticated;`);
    for (const f of [
      "manual/apply_core_functions.sql",
      "manual/apply_core_tables.sql",
      "manual/apply_core_policies.sql",
      "migrations/20261108180000_dashboard_workflow_repair.sql",
      "migrations/20261108190000_admin_device_slots.sql",
      "migrations/20261108200000_customer_portal_privacy.sql",
      "migrations/20261108201000_verified_appointment_catalog.sql",
      "migrations/20261108202000_atomic_appointment_verification.sql",
      "migrations/20261109020000_verified_svp_exam_results.sql",
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
    await sql.unsafe(
      "TRUNCATE job_submissions,candidates,exams,results,payments,work_notes,storage.objects,appointment_extractions",
    );
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
    expect(await asUser("customer", (tx) => tx`SELECT * FROM candidates`)).toHaveLength(0);
    expect(await asUser("customer", (tx) => tx`SELECT * FROM exams`)).toHaveLength(0);
    await sql`UPDATE candidates SET result_check_at=now()-interval '1 day',fee_amount=500 WHERE id=${row.candidate_id}`;
    await sql`INSERT INTO payments(candidate_id,amount,status) VALUES(${row.candidate_id},200,'approved')`;
    expect(await asUser("customer", (tx) => tx`SELECT * FROM exams`)).toHaveLength(0);
    await sql`INSERT INTO payments(candidate_id,amount,status) VALUES(${row.candidate_id},300,'approved')`;
    expect(
      (await asUser("customer", (tx) => tx`SELECT get_customer_portal() AS data`))[0].data.exams,
    ).toHaveLength(1);
    expect(await asUser("agent", (tx) => tx`SELECT * FROM candidates`)).toHaveLength(0);
  });
  it("accepts a pending receipt without allowing customer approval or a different candidate", async () => {
    const row = await approve((await submit()).id);
    await asUser(
      "customer",
      (tx) =>
        tx`INSERT INTO payments(candidate_id,amount,method,created_by) VALUES(${row.candidate_id},500,'bkash',${ids.customer})`,
    );
    const [p] = await sql`SELECT * FROM payments WHERE candidate_id=${row.candidate_id}`;
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
  it("returns only the customer's whitelisted personal fields, with no internal identity or notes", async () => {
    const row = await approve((await submit()).id);
    await sql`UPDATE candidates SET notes='INTERNAL_ONLY',skill_details='PRIVATE_STAFF_NAME',result_check_at=now()-interval '1 day' WHERE id=${row.candidate_id}`;
    await sql`UPDATE exams SET remarks='PRIVATE_COMPANY' WHERE id=${row.exam_id}`;
    await sql`INSERT INTO settings(key,value) VALUES('org_name','PRIVATE_COMPANY'),('payment_instructions','PRIVATE_STAFF_NAME'),('public_payment_instructions','PUBLIC_INSTRUCTION') ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
    const data = (await asUser("customer", (tx) => tx`SELECT get_customer_portal() AS data`))[0]
      .data;
    expect(data.candidate.id).toBe(row.candidate_id);
    expect(data.instructions).toBe("PUBLIC_INSTRUCTION");
    expect(JSON.stringify(data)).not.toMatch(
      /INTERNAL_ONLY|PRIVATE_STAFF_NAME|PRIVATE_COMPANY|submitted_by|reviewed_by|remarks|agent_code/,
    );
    expect(Object.keys(data.candidate).sort()).toEqual(
      [
        "id",
        "name",
        "passport_no",
        "occupation_id",
        "ttc_id",
        "photo_url",
        "fee_amount",
        "result_check_at",
        "registration_no",
      ].sort(),
    );
    expect(
      (await asUser("customer", (tx) => tx`SELECT portal_agent_contact() AS contact`))[0].contact,
    ).toBeNull();
    await expect(asUser("staff", (tx) => tx`SELECT get_customer_portal()`)).rejects.toThrow(
      /Customer access/,
    );
  });
  it("blocks direct customer reads of internal tables and work history", async () => {
    await approve((await submit()).id);
    for (const table of [
      "candidates",
      "exams",
      "payments",
      "settings",
      "occupations",
      "ttc_centers",
      "reminders",
      "sms_templates",
      "sms_automations",
    ]) {
      expect(
        await asUser("customer", (tx) => tx.unsafe("SELECT * FROM public." + table)),
      ).toHaveLength(0);
    }
    await expect(
      asUser("customer", (tx) => tx`SELECT * FROM passport_history('A1234567')`),
    ).rejects.toThrow(/Internal account/);
    expect(
      await asUser("agent", (tx) => tx`SELECT * FROM passport_history('A1234567')`),
    ).toHaveLength(1);
  });
  it("creates private ticket storage and restricts uploads/signing by role and ownership", async () => {
    expect(
      (await sql`SELECT public FROM storage.buckets WHERE id='candidate-photos'`)[0].public,
    ).toBe(false);
    const path = "takamul/" + ids.agent + "/ticket.pdf";
    await asUser(
      "agent",
      (tx) => tx`INSERT INTO storage.objects(bucket_id,name) VALUES('candidate-photos',${path})`,
    );
    expect(await asUser("agent", (tx) => tx`SELECT * FROM storage.objects`)).toHaveLength(1);
    expect(await asUser("other", (tx) => tx`SELECT * FROM storage.objects`)).toHaveLength(0);
    expect(await asUser("customer", (tx) => tx`SELECT * FROM storage.objects`)).toHaveLength(0);
    for (const role of ["other", "customer"])
      await expect(
        asUser(
          role,
          (tx) =>
            tx`INSERT INTO storage.objects(bucket_id,name) VALUES('candidate-photos',${path})`,
        ),
      ).rejects.toThrow(/row-level security/);
    const row = await approve((await submit()).id);
    await sql`UPDATE candidates SET photo_url=${path} WHERE id=${row.candidate_id}`;
    expect(await asUser("customer", (tx) => tx`SELECT * FROM storage.objects`)).toHaveLength(1);
  });
  it("assigns internal work note authors and rejects public or unrelated note creation", async () => {
    const row = await submit();
    await asUser(
      "agent",
      (tx) =>
        tx`INSERT INTO work_notes(submission_id,body,kind) VALUES(${row.id},'NOTE','general')`,
    );
    expect((await sql`SELECT * FROM work_notes`)[0].author_id).toBe(ids.agent);
    for (const role of ["customer", "other"])
      await expect(
        asUser(
          role,
          (tx) =>
            tx`INSERT INTO work_notes(submission_id,body,kind) VALUES(${row.id},'FORGED','general')`,
        ),
      ).rejects.toThrow(/row-level security/);
  });
  it("has verified usable reference lists without exposing the internal directory to customers", async () => {
    expect(
      (await asUser("staff", (tx) => tx`SELECT name FROM occupations WHERE svp_key='933301'`))[0]
        .name,
    ).toBe("Load and Unload Worker");
    expect(
      await asUser(
        "agent",
        (tx) =>
          tx`SELECT * FROM ttc_centers WHERE name='Cumilla Technical Training Centre' AND active=true`,
      ),
    ).toHaveLength(1);
    expect(await asUser("customer", (tx) => tx`SELECT * FROM ttc_centers`)).toHaveLength(0);
  });
  it("applies verified SVP results once and synchronizes the linked work's exam date", async () => {
    const work = await approve((await submit()).id);
    const [exam] = await sql`SELECT * FROM exams WHERE id=${work.exam_id}`;
    const [candidate] = await sql`SELECT * FROM candidates WHERE id=${work.candidate_id}`;
    const [occupation] = await sql`SELECT * FROM occupations WHERE svp_key='933301'`;
    await sql`UPDATE job_submissions SET occupation_id=${occupation.id} WHERE id=${work.id}`;
    const snapshot = {
      candidate_id: candidate.id,
      passport: candidate.passport_no,
      occupation_id: occupation.id,
      resolved_occupation_id: occupation.id,
      occupation_key: "933301",
      exam_date: exam.exam_date,
      exam_time: exam.exam_time,
    };
    for (const role of ["agent", "admin"])
      await expect(
        asUser(
          role,
          (tx) =>
            tx`SELECT apply_verified_svp_exam_result(${exam.id},${tx.json(snapshot)},'PASS',${exam.exam_date})`,
        ),
      ).rejects.toThrow(/permission denied/);
    const apply = (date = exam.exam_date, snap = snapshot) =>
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE service_role");
        return (
          await tx`SELECT apply_verified_svp_exam_result(${exam.id},${tx.json(snap)},'PASS',${date}) AS applied`
        )[0].applied;
      });
    await expect(
      asUser(
        "admin",
        (tx) =>
          tx`UPDATE exams SET result='FAIL',result_date='2026-11-04',remarks='SVP অটো চেক' WHERE id=${exam.id}`,
      ),
    ).rejects.toThrow(/another exam date/);
    await expect(apply("2026-11-04")).rejects.toThrow(/date/);
    expect(await apply(exam.exam_date, { ...snapshot, occupation_key: "999999" })).toMatchObject({
      ok: false,
      reason: "changed",
    });
    expect((await sql`SELECT count(*)::int AS n FROM results`)[0].n).toBe(0);
    expect(await apply()).toMatchObject({ ok: true });
    expect(
      (await sql`SELECT svp_result,svp_exam_date FROM job_submissions WHERE id=${work.id}`)[0],
    ).toMatchObject({ svp_result: "PASS", svp_exam_date: exam.exam_date });
    expect(await apply()).toMatchObject({ ok: false, reason: "already_complete" });
    expect((await sql`SELECT count(*)::int AS n FROM results`)[0].n).toBe(1);
  });
  it("refuses a rescheduled exam or changed passport after the SVP lookup snapshot", async () => {
    const work = await approve((await submit()).id);
    const [occupation] = await sql`SELECT * FROM occupations WHERE svp_key='933301'`;
    await sql`UPDATE job_submissions SET occupation_id=${occupation.id} WHERE id=${work.id}`;
    const [exam] = await sql`SELECT * FROM exams WHERE id=${work.exam_id}`;
    const snapshot = {
      candidate_id: work.candidate_id,
      passport: "A1234567",
      occupation_id: occupation.id,
      resolved_occupation_id: occupation.id,
      occupation_key: "933301",
      exam_date: exam.exam_date,
      exam_time: exam.exam_time,
    };
    await sql`UPDATE job_submissions SET exam_at='2026-11-24T03:00:00Z' WHERE id=${work.id}`;
    expect(
      (
        await sql`SELECT apply_verified_svp_exam_result(${exam.id},${sql.json(snapshot)},'PASS',${exam.exam_date}) AS applied`
      )[0].applied,
    ).toMatchObject({ ok: false, reason: "changed" });
    const [changed] = await sql`SELECT * FROM exams WHERE id=${exam.id}`;
    await sql`UPDATE candidates SET passport_no='A9999999' WHERE id=${work.candidate_id}`;
    expect(
      (
        await sql`SELECT apply_verified_svp_exam_result(${exam.id},${sql.json({ ...snapshot, exam_date: changed.exam_date })},'PASS',${changed.exam_date}) AS applied`
      )[0].applied,
    ).toMatchObject({ ok: false, reason: "changed" });
    expect((await sql`SELECT count(*)::int AS n FROM results`)[0].n).toBe(0);
  });
  it("verifies appointments atomically with the linked exam and requires an explicit correction reason", async () => {
    const work = await approve((await submit()).id);
    const [e] =
      await sql`INSERT INTO appointment_extractions(submission_id,old_exam_at,status,extracted) VALUES(${work.id},${work.exam_at},'needs_review','{"exam_date":"2026-11-23","exam_time":"09:00"}') RETURNING id`;
    await expect(
      asUser(
        "agent",
        (tx) => tx`SELECT verify_appointment_scan(${e.id},'2026-11-23','09:15',null,null)`,
      ),
    ).rejects.toThrow(/Admin access/);
    await expect(
      asUser(
        "admin",
        (tx) => tx`SELECT verify_appointment_scan(${e.id},'2026-11-23','09:15',null,null)`,
      ),
    ).rejects.toThrow(/reason required/);
    expect((await sql`SELECT exam_time FROM exams WHERE id=${work.exam_id}`)[0].exam_time).toBe(
      "09:00",
    );
    await asUser(
      "admin",
      (tx) =>
        tx`SELECT verify_appointment_scan(${e.id},'2026-11-23','09:15',null,'Ticket confirmed')`,
    );
    expect((await sql`SELECT exam_time FROM exams WHERE id=${work.exam_id}`)[0].exam_time).toBe(
      "09:15",
    );
    const [saved] =
      await sql`SELECT status,reviewed_by FROM appointment_extractions WHERE id=${e.id}`;
    expect(saved.status).toBe("corrected");
    expect(saved.reviewed_by).toBe(ids.admin);
  });
  it("does not overwrite a work changed after its appointment was scanned", async () => {
    const work = await approve((await submit()).id);
    const [e] =
      await sql`INSERT INTO appointment_extractions(submission_id,old_exam_at,status,extracted) VALUES(${work.id},${work.exam_at},'needs_review','{"exam_date":"2026-11-23","exam_time":"09:00"}') RETURNING id`;
    await sql`UPDATE job_submissions SET exam_at=exam_at+interval '1 hour' WHERE id=${work.id}`;
    await expect(
      asUser(
        "admin",
        (tx) => tx`SELECT verify_appointment_scan(${e.id},'2026-11-23','09:15',null,'Review')`,
      ),
    ).rejects.toThrow(/scan again/);
    expect((await sql`SELECT status FROM appointment_extractions WHERE id=${e.id}`)[0].status).toBe(
      "needs_review",
    );
  });
});
