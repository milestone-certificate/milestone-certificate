-- Apply only a server-verified result for the same candidate, trade and exam day.
-- No historical results or existing exam rows are rewritten by this migration.
BEGIN;
-- Also protect already-open browser tabs running the previous auto-save code.
CREATE OR REPLACE FUNCTION public.guard_svp_exam_result_date()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.remarks='SVP অটো চেক' AND NEW.result IN ('PASS','FAIL')
     AND (NEW.result IS DISTINCT FROM OLD.result OR NEW.result_date IS DISTINCT FROM OLD.result_date OR NEW.exam_date IS DISTINCT FROM OLD.exam_date)
     AND (NEW.result_date IS NULL OR NEW.result_date IS DISTINCT FROM NEW.exam_date) THEN
    RAISE EXCEPTION 'SVP result belongs to another exam date';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_svp_exam_result_date BEFORE UPDATE ON public.exams
FOR EACH ROW EXECUTE FUNCTION public.guard_svp_exam_result_date();

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
  IF e.result IS DISTINCT FROM 'PENDING'::public.exam_result THEN
    RETURN jsonb_build_object('ok',false,'reason','already_complete');
  END IF;
  UPDATE public.exams SET result=_result::public.exam_result,result_date=_result_date,
    result_last_checked_at=now(),remarks='SVP অটো চেক' WHERE id=_exam_id;
  RETURN jsonb_build_object('ok',true,'reason','saved');
END $$;
REVOKE ALL ON FUNCTION public.apply_verified_svp_exam_result(uuid,jsonb,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_verified_svp_exam_result(uuid,jsonb,text,text) TO service_role;

-- Preserve the existing append-only history and reverse synchronization, including the provider date.
CREATE OR REPLACE FUNCTION public.record_exam_result_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.result IS NOT NULL AND NEW.result<>'PENDING' AND
    (TG_OP='INSERT' OR OLD.result IS DISTINCT FROM NEW.result) THEN
    INSERT INTO public.results(candidate_id,exam_id,result,result_date,score,source)
      VALUES (NEW.candidate_id,NEW.id,NEW.result,coalesce(NEW.result_date,current_date::text),NEW.score,'exam');
  END IF;
  IF TG_OP='UPDATE' AND pg_trigger_depth()=1 AND NEW.result IS DISTINCT FROM OLD.result AND NEW.submission_id IS NOT NULL THEN
    UPDATE public.job_submissions SET svp_result=NEW.result::text,svp_checked_at=now(),svp_old_result=NULL,
      svp_exam_date=NEW.exam_date
      WHERE id=NEW.submission_id AND status='approved';
  END IF;
  RETURN NEW;
END $$;
COMMIT;
