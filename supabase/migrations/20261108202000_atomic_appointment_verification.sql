BEGIN;
CREATE OR REPLACE FUNCTION public.verify_appointment_scan(_extraction_id uuid,_exam_date text,_exam_time text,_reporting_time text,_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.appointment_extractions; w public.job_submissions; v_exam_at timestamptz; corrected boolean;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='admin') THEN
  RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501';
 END IF;
 IF _exam_date IS NULL OR _exam_date !~ '^\d{4}-\d{2}-\d{2}$' OR _exam_time IS NULL OR _exam_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RAISE EXCEPTION 'Invalid exam date/time'; END IF;
 IF length(coalesce(_reason,''))>500 OR (_reporting_time IS NOT NULL AND _reporting_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RAISE EXCEPTION 'Invalid review details'; END IF;
 SELECT * INTO e FROM public.appointment_extractions WHERE id=_extraction_id FOR UPDATE;
 IF e.id IS NULL THEN RAISE EXCEPTION 'Extraction not found'; END IF;
 SELECT * INTO w FROM public.job_submissions WHERE id=e.submission_id FOR UPDATE;
 IF w.id IS NULL OR w.status='rejected' THEN RAISE EXCEPTION 'Work cannot be changed'; END IF;
 v_exam_at:=(_exam_date::date+_exam_time::time) AT TIME ZONE 'Asia/Dhaka';
 corrected:=(e.extracted->>'exam_date') IS DISTINCT FROM _exam_date OR (e.extracted->>'exam_time') IS DISTINCT FROM _exam_time;
 IF corrected AND nullif(trim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Correction reason required'; END IF;
 IF w.exam_at IS DISTINCT FROM e.old_exam_at AND w.exam_at IS DISTINCT FROM v_exam_at THEN RAISE EXCEPTION 'Work changed; scan again'; END IF;
 -- The approved-work trigger synchronizes the linked exam in this same transaction.
 UPDATE public.job_submissions SET exam_at=v_exam_at WHERE id=w.id;
 UPDATE public.appointment_extractions SET status=CASE WHEN corrected THEN 'corrected' ELSE 'verified' END,
  verified_exam_at=v_exam_at,verified_reporting_time=_reporting_time,correction_reason=nullif(trim(_reason),''),reviewed_by=auth.uid(),reviewed_at=now()
 WHERE id=e.id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.verify_appointment_scan(uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_appointment_scan(uuid,text,text,text,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
