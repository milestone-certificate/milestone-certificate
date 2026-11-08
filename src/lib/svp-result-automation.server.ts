import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { querySvp } from "./svp.functions";
import { svpResultSaveIssue } from "./svp-result.shared";
const claimSchema = z.object({
  examId: z.string().uuid(),
  leaseToken: z.string().uuid(),
  passport: z.string(),
  occupationKey: z.string(),
  examDate: z.string(),
  snapshot: z.object({
    candidate_id: z.string().uuid(),
    passport: z.string(),
    occupation_id: z.string().nullable(),
    resolved_occupation_id: z.string(),
    occupation_key: z.string(),
    exam_date: z.string(),
    exam_time: z.string().nullable(),
    auto_lease_token: z.string().uuid(),
  }),
});
type Claim = z.infer<typeof claimSchema>;
type Outcome = "saved" | "pending" | "not_found" | "other_date" | "provider_error" | "changed";

async function processClaim(claim: Claim): Promise<Outcome> {
  let outcome: Outcome = "provider_error";
  try {
    const result = await querySvp(claim.passport, claim.occupationKey, {
      tries: 1,
      timeoutMs: 8000,
    });
    if (result.status === "not_found") outcome = "not_found";
    else if (result.status === "found") {
      if (result.result === "PENDING") outcome = "pending";
      else if (svpResultSaveIssue(result, claim.examDate)) outcome = "other_date";
      else {
        const applied = await supabaseAdmin
          .rpc("apply_verified_svp_exam_result", {
            _exam_id: claim.examId,
            _snapshot: claim.snapshot,
            _result: result.result,
            _result_date: result.examDate!,
          })
          .abortSignal(AbortSignal.timeout(5000));
        outcome = applied.error
          ? "provider_error"
          : (applied.data as { ok?: boolean } | null)?.ok
            ? "saved"
            : "changed";
      }
    }
  } catch {
    outcome = "provider_error";
  }
  try {
    await supabaseAdmin
      .rpc("finish_svp_auto_result_check", {
        _exam_id: claim.examId,
        _lease_token: claim.leaseToken,
        _outcome: outcome,
      })
      .abortSignal(AbortSignal.timeout(5000));
  } catch {
    /* A crashed/expired lease is retried after the five-minute interval. */
  }
  return outcome;
}

/** One dispatcher run is bounded; database leases coordinate overlapping invocations. */
export async function runSvpAutoResults() {
  const began = Date.now();
  const summary = {
    ok: true,
    checked: 0,
    saved: 0,
    errors: 0,
    pending: 0,
    otherDate: 0,
    changed: 0,
  };
  while (Date.now() - began < 30000 && summary.checked < 100) {
    const batch = await supabaseAdmin
      .rpc("claim_svp_auto_result_checks", { _limit: 4 })
      .abortSignal(AbortSignal.timeout(5000));
    if (batch.error) throw new Error("Automatic result queue unavailable");
    const claims = z.array(claimSchema).parse(batch.data);
    if (!claims.length) break;
    const outcomes = await Promise.all(claims.map(processClaim));
    for (const outcome of outcomes) {
      summary.checked++;
      if (outcome === "saved") summary.saved++;
      else if (outcome === "provider_error") summary.errors++;
      else if (outcome === "other_date") summary.otherDate++;
      else if (outcome === "changed") summary.changed++;
      else summary.pending++;
    }
  }
  const recorded = await supabaseAdmin
    .rpc("record_svp_auto_result_run", {
      _checked: summary.checked,
      _saved: summary.saved,
      _errors: summary.errors,
    })
    .abortSignal(AbortSignal.timeout(5000));
  if (recorded.error) throw new Error("Automatic result heartbeat unavailable");
  return summary;
}
