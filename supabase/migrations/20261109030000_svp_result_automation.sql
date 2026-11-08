-- A server-driven per-exam timer: first lookup 2h after start, then every 5m.
BEGIN;
ALTER TABLE public.exams
  ADD COLUMN svp_auto_checked_at timestamptz,
  ADD COLUMN svp_auto_lease_token uuid,
  ADD COLUMN svp_auto_lease_until timestamptz,
  ADD COLUMN svp_auto_outcome text;
CREATE INDEX exams_svp_auto_pending ON public.exams(svp_auto_checked_at,id) WHERE result='PENDING';
CREATE TABLE public.svp_result_automation_state (
  id integer PRIMARY KEY CHECK(id=1), enabled boolean NOT NULL DEFAULT false,
  last_run_at timestamptz, last_checked integer NOT NULL DEFAULT 0,
  last_saved integer NOT NULL DEFAULT 0, last_errors integer NOT NULL DEFAULT 0
);
INSERT INTO public.svp_result_automation_state(id) VALUES(1);
ALTER TABLE public.svp_result_automation_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.svp_result_automation_state FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.svp_result_automation_state TO service_role;

CREATE FUNCTION public.svp_exam_start_at(_date text,_time text)
RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE m text[]; h integer; mins integer; secs integer; d date;
BEGIN
  IF _date IS NULL OR _time IS NULL OR _date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RETURN NULL; END IF;
  m:=regexp_match(btrim(_time),'^([0-9]{1,2}):([0-9]{2})(?::([0-9]{2}))?(?:\s*([AP]M))?$','i');
  IF m IS NULL THEN RETURN NULL; END IF;
  h:=m[1]::integer; mins:=m[2]::integer; secs:=coalesce(m[3]::integer,0);
  IF mins>59 OR secs>59 THEN RETURN NULL; END IF;
  IF m[4] IS NOT NULL THEN
    IF h<1 OR h>12 THEN RETURN NULL; END IF;
    h:=(h%12)+CASE WHEN upper(m[4])='PM' THEN 12 ELSE 0 END;
  ELSIF h>23 THEN RETURN NULL;
  END IF;
  d:=_date::date;
  RETURN (d+make_time(h,mins,secs)) AT TIME ZONE 'Asia/Dhaka';
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_text_representation THEN RETURN NULL;
END $$;

CREATE FUNCTION public.reset_svp_auto_check()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.exam_date IS DISTINCT FROM OLD.exam_date OR NEW.exam_time IS DISTINCT FROM OLD.exam_time
     OR NEW.candidate_id IS DISTINCT FROM OLD.candidate_id OR NEW.occupation_id IS DISTINCT FROM OLD.occupation_id
     OR (NEW.result='PENDING' AND OLD.result IS DISTINCT FROM NEW.result) THEN
    NEW.svp_auto_checked_at:=NULL; NEW.svp_auto_lease_token:=NULL;
    NEW.svp_auto_lease_until:=NULL; NEW.svp_auto_outcome:=NULL;
    NEW.result_last_checked_at:=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reset_svp_auto_check BEFORE UPDATE ON public.exams FOR EACH ROW EXECUTE FUNCTION public.reset_svp_auto_check();

CREATE FUNCTION public.claim_svp_auto_result_checks(_limit integer DEFAULT 4)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE batch jsonb; at_time timestamptz:=now();
BEGIN
  IF NOT coalesce((SELECT enabled FROM public.svp_result_automation_state WHERE id=1),false) THEN RETURN '[]'::jsonb; END IF;
  WITH due AS (
    SELECT e.id FROM public.exams e
    JOIN public.candidates c ON c.id=e.candidate_id
    JOIN public.occupations o ON o.id::text=coalesce(e.occupation_id,c.occupation_id)
    LEFT JOIN public.job_submissions w ON w.id=e.submission_id
    WHERE e.result='PENDING'
      AND (e.submission_id IS NULL OR (w.status='approved' AND w.exam_id=e.id))
      AND public.svp_exam_start_at(e.exam_date,e.exam_time)+interval '2 hours'<=at_time
      AND (e.svp_auto_checked_at IS NULL OR e.svp_auto_checked_at<=at_time-interval '5 minutes')
      AND (e.svp_auto_lease_until IS NULL OR e.svp_auto_lease_until<=at_time)
      AND o.svp_key ~ '^[0-9]{4,8}$'
      AND regexp_replace(upper(c.passport_no),'[^A-Z0-9]','','g') ~ '^[A-Z]{1,3}[0-9]{5,9}$'
    ORDER BY coalesce(e.svp_auto_checked_at,public.svp_exam_start_at(e.exam_date,e.exam_time)),e.id
    FOR UPDATE OF e SKIP LOCKED LIMIT greatest(1,least(coalesce(_limit,4),20))
  ), claimed AS (
    UPDATE public.exams e SET svp_auto_checked_at=at_time,result_last_checked_at=at_time,
      svp_auto_lease_token=gen_random_uuid(),svp_auto_lease_until=at_time+interval '2 minutes',svp_auto_outcome='checking'
    FROM due WHERE e.id=due.id RETURNING e.*
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'examId',e.id,'leaseToken',e.svp_auto_lease_token,'passport',regexp_replace(upper(c.passport_no),'[^A-Z0-9]','','g'),
    'occupationKey',o.svp_key,'examDate',e.exam_date,
    'snapshot',jsonb_build_object('candidate_id',e.candidate_id,'passport',regexp_replace(upper(c.passport_no),'[^A-Z0-9]','','g'),
      'occupation_id',e.occupation_id,'resolved_occupation_id',coalesce(e.occupation_id,c.occupation_id),'occupation_key',o.svp_key,
      'exam_date',e.exam_date,'exam_time',e.exam_time,'auto_lease_token',e.svp_auto_lease_token)
  )),'[]'::jsonb) INTO batch FROM claimed e JOIN public.candidates c ON c.id=e.candidate_id
    JOIN public.occupations o ON o.id::text=coalesce(e.occupation_id,c.occupation_id);
  RETURN batch;
END $$;

CREATE FUNCTION public.finish_svp_auto_result_check(_exam_id uuid,_lease_token uuid,_outcome text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF _outcome NOT IN('saved','pending','not_found','other_date','provider_error','changed') THEN RAISE EXCEPTION 'Invalid auto-check outcome'; END IF;
  UPDATE public.exams SET svp_auto_lease_token=NULL,svp_auto_lease_until=NULL,svp_auto_outcome=_outcome
    WHERE id=_exam_id AND svp_auto_lease_token=_lease_token;
  RETURN FOUND;
END $$;

CREATE FUNCTION public.record_svp_auto_result_run(_checked integer,_saved integer,_errors integer)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
  UPDATE public.svp_result_automation_state SET last_run_at=now(),last_checked=greatest(_checked,0),
    last_saved=greatest(_saved,0),last_errors=greatest(_errors,0) WHERE id=1;
$$;

CREATE FUNCTION public.svp_result_automation_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH pending AS (
    SELECT e.*,public.svp_exam_start_at(e.exam_date,e.exam_time) AS starts,
      o.svp_key ~ '^[0-9]{4,8}$' AND regexp_replace(upper(c.passport_no),'[^A-Z0-9]','','g') ~ '^[A-Z]{1,3}[0-9]{5,9}$' AS identity_ready
    FROM public.exams e LEFT JOIN public.candidates c ON c.id=e.candidate_id
      LEFT JOIN public.occupations o ON o.id::text=coalesce(e.occupation_id,c.occupation_id)
      LEFT JOIN public.job_submissions w ON w.id=e.submission_id
    WHERE e.result='PENDING' AND (e.submission_id IS NULL OR (w.status='approved' AND w.exam_id=e.id))
  )
  SELECT jsonb_build_object('enabled',s.enabled,'lastRunAt',s.last_run_at,'lastChecked',s.last_checked,'lastSaved',s.last_saved,
    'lastErrors',s.last_errors,'delayMinutes',120,'intervalMinutes',5,
    'pending',(SELECT count(*) FROM pending),
    'missingInfo',(SELECT count(*) FROM pending WHERE starts IS NULL OR identity_ready IS DISTINCT FROM true),
    'nextCheckAt',(SELECT min(greatest(starts+interval '2 hours',coalesce(svp_auto_checked_at+interval '5 minutes',starts+interval '2 hours'))) FROM pending WHERE starts IS NOT NULL AND identity_ready=true))
  FROM public.svp_result_automation_state s WHERE id=1;
$$;
REVOKE ALL ON FUNCTION public.claim_svp_auto_result_checks(integer),public.finish_svp_auto_result_check(uuid,uuid,text),public.record_svp_auto_result_run(integer,integer,integer),public.svp_result_automation_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_svp_auto_result_checks(integer),public.finish_svp_auto_result_check(uuid,uuid,text),public.record_svp_auto_result_run(integer,integer,integer),public.svp_result_automation_status() TO service_role;

-- An automatic save must still own its current lease after a reschedule.
CREATE OR REPLACE FUNCTION public.apply_verified_svp_exam_result(_exam_id uuid, _snapshot jsonb, _result text, _result_date text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
DECLARE e public.exams; c public.candidates; w public.job_submissions; work_id uuid; occupation_key text;
BEGIN
  IF _result IS NULL OR _result NOT IN ('PASS','FAIL') OR _result_date IS NULL
     OR _snapshot->>'exam_date' IS NULL OR _result_date IS DISTINCT FROM _snapshot->>'exam_date' THEN
    RAISE EXCEPTION 'Result does not match the exam date';
  END IF;
  SELECT submission_id INTO work_id FROM public.exams WHERE id=_exam_id;
  -- Keep the same lock order as the approved-work workflow.
  IF work_id IS NOT NULL THEN
    SELECT * INTO w FROM public.job_submissions WHERE id=work_id FOR UPDATE;
    IF NOT FOUND OR w.status<>'approved' OR w.exam_id IS DISTINCT FROM _exam_id THEN
      RETURN jsonb_build_object('ok',false,'reason','changed');
    END IF;
  END IF;
  SELECT * INTO c FROM public.candidates WHERE id::text=_snapshot->>'candidate_id' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','changed'); END IF;
  SELECT * INTO e FROM public.exams WHERE id=_exam_id FOR UPDATE;
  IF NOT FOUND OR e.candidate_id IS DISTINCT FROM c.id
     OR e.exam_date IS DISTINCT FROM _snapshot->>'exam_date'
     OR e.exam_time IS DISTINCT FROM _snapshot->>'exam_time'
     OR e.occupation_id IS DISTINCT FROM _snapshot->>'occupation_id'
     OR e.submission_id IS DISTINCT FROM work_id
     OR coalesce(e.occupation_id,c.occupation_id) IS DISTINCT FROM _snapshot->>'resolved_occupation_id'
     OR regexp_replace(upper(c.passport_no),'[^A-Z0-9]','','g') IS DISTINCT FROM _snapshot->>'passport' THEN
    RETURN jsonb_build_object('ok',false,'reason','changed');
  END IF;
  SELECT svp_key INTO occupation_key FROM public.occupations WHERE id::text=coalesce(e.occupation_id,c.occupation_id) FOR SHARE;
  IF occupation_key IS DISTINCT FROM _snapshot->>'occupation_key' OR occupation_key IS NULL THEN
    RETURN jsonb_build_object('ok',false,'reason','changed');
  END IF;
  IF work_id IS NOT NULL AND (
    w.candidate_id IS DISTINCT FROM e.candidate_id OR
    w.occupation_id IS DISTINCT FROM coalesce(e.occupation_id,c.occupation_id) OR
    regexp_replace(upper(w.passport_no),'[^A-Z0-9]','','g') IS DISTINCT FROM _snapshot->>'passport' OR
    (w.exam_at AT TIME ZONE 'Asia/Dhaka')::date::text IS DISTINCT FROM e.exam_date
  ) THEN RETURN jsonb_build_object('ok',false,'reason','changed'); END IF;
  IF _snapshot ? 'auto_lease_token' AND (e.svp_auto_lease_token::text IS DISTINCT FROM _snapshot->>'auto_lease_token' OR e.svp_auto_lease_until IS NULL OR e.svp_auto_lease_until<=now() OR public.svp_exam_start_at(e.exam_date,e.exam_time) IS NULL OR public.svp_exam_start_at(e.exam_date,e.exam_time)+interval '2 hours'>now()) THEN
    RETURN jsonb_build_object('ok',false,'reason','changed');
  END IF;
  IF e.result IS DISTINCT FROM 'PENDING'::public.exam_result THEN
    RETURN jsonb_build_object('ok',false,'reason','already_complete');
  END IF;
  UPDATE public.exams SET result=_result::public.exam_result,result_date=_result_date,
    result_last_checked_at=now(),remarks='SVP অটো চেক' WHERE id=_exam_id;
  RETURN jsonb_build_object('ok',true,'reason','saved');
END $$;
COMMIT;
