-- Restore the documented submission workflow and role boundaries on the reconstructed schema.
-- No existing candidate, exam, payment, or wallet record is rewritten.
BEGIN;
ALTER TABLE public.job_submissions ALTER COLUMN submitted_by SET DEFAULT auth.uid();
ALTER TABLE public.job_submissions ALTER COLUMN status SET DEFAULT 'pending_approval';
ALTER TABLE public.payments ALTER COLUMN status SET DEFAULT 'pending';
ALTER TABLE public.exams ALTER COLUMN result SET DEFAULT 'PENDING';

CREATE OR REPLACE FUNCTION public.guard_submission_workflow()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE trusted boolean := current_user IN ('postgres','service_role'); allowed text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT trusted AND NOT public.is_staff(auth.uid()) THEN
      IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='agent')
         OR NOT public.is_active_account(auth.uid()) OR NEW.submitted_by IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Agent access required' USING ERRCODE='42501';
      END IF;
      NEW.status := CASE WHEN public.parent_agent_of(auth.uid()) IS NULL THEN 'pending_approval' ELSE 'pending_agent' END;
      NEW.candidate_id:=NULL; NEW.exam_id:=NULL; NEW.svp_result:=NULL; NEW.svp_checked_at:=NULL;
      NEW.svp_old_result:=NULL; NEW.svp_exam_date:=NULL; NEW.reviewed_at:=NULL; NEW.reviewed_by:=NULL;
      NEW.rejection_reason:=NULL; NEW.arrival_status:='not_arrived'; NEW.received_at:=NULL; NEW.received_by:=NULL;
      NEW.created_at:=now(); NEW.ref_code:=public.gen_ref_code(); NEW.ref_no:=NULL;
    END IF;
    NEW.ref_code:=coalesce(NEW.ref_code,public.gen_ref_code());
    NEW.status:=coalesce(NEW.status,'pending_approval');
  ELSIF NOT trusted AND NOT public.is_staff(auth.uid()) THEN
    IF NOT public.is_active_account(auth.uid()) THEN RAISE EXCEPTION 'Account disabled' USING ERRCODE='42501'; END IF;
    IF public.is_management_user(auth.uid()) THEN
      allowed:=ARRAY['arrival_status','secondary_mobile','skill_details','candidate_photo_path','received_at','received_by'];
    ELSIF OLD.submitted_by=auth.uid() THEN
      allowed:=ARRAY['mobile','secondary_mobile'];
      IF OLD.status IN ('pending_agent','pending_approval') THEN
        allowed:=allowed || ARRAY['candidate_name','passport_no','skill_details','exam_at','candidate_photo_path'];
      END IF;
    ELSE RAISE EXCEPTION 'Submission update not allowed' USING ERRCODE='42501';
    END IF;
    IF (to_jsonb(OLD)-allowed) IS DISTINCT FROM (to_jsonb(NEW)-allowed) THEN
      RAISE EXCEPTION 'Protected submission fields' USING ERRCODE='42501';
    END IF;
  END IF;
  IF NEW.status NOT IN ('pending_agent','pending_approval','approved','rejected') THEN
    RAISE EXCEPTION 'Invalid submission status';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER a_guard_submission BEFORE INSERT OR UPDATE ON public.job_submissions
FOR EACH ROW EXECUTE FUNCTION public.guard_submission_workflow();

CREATE OR REPLACE FUNCTION public.sync_approved_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result_value public.exam_result;
BEGIN
  IF NEW.status <> 'approved' OR pg_trigger_depth()>1 THEN RETURN NEW; END IF;
  IF NEW.candidate_id IS NULL THEN
    INSERT INTO public.candidates(name,passport_no,mobile,secondary_mobile,occupation_id,ttc_id,photo_url,
      arrival_status,received_at,received_by,skill_details)
    VALUES (NEW.candidate_name,NEW.passport_no,NEW.mobile,NEW.secondary_mobile,NEW.occupation_id,NEW.ttc_id,
      NEW.candidate_photo_path,NEW.arrival_status,NEW.received_at,NEW.received_by,NEW.skill_details)
    RETURNING id INTO NEW.candidate_id;
  ELSE
    UPDATE public.candidates SET name=NEW.candidate_name,passport_no=NEW.passport_no,mobile=NEW.mobile,
      secondary_mobile=NEW.secondary_mobile,occupation_id=NEW.occupation_id,ttc_id=NEW.ttc_id,
      photo_url=NEW.candidate_photo_path,arrival_status=NEW.arrival_status,received_at=NEW.received_at,
      received_by=NEW.received_by,skill_details=NEW.skill_details,updated_at=now() WHERE id=NEW.candidate_id;
  END IF;
  IF NEW.svp_result IN ('PASS','FAIL','ABSENT','CANCELLED','PENDING') THEN result_value:=NEW.svp_result::public.exam_result; END IF;
  IF NEW.exam_id IS NULL THEN
    INSERT INTO public.exams(candidate_id,submission_id,occupation_id,ttc_id,exam_date,exam_time,result,result_date,result_last_checked_at)
    VALUES (NEW.candidate_id,NEW.id,NEW.occupation_id,NEW.ttc_id,
      (NEW.exam_at AT TIME ZONE 'Asia/Dhaka')::date::text,to_char(NEW.exam_at AT TIME ZONE 'Asia/Dhaka','HH24:MI'),
      coalesce(result_value,'PENDING'),CASE WHEN result_value IS NOT NULL AND result_value<>'PENDING' THEN coalesce(NEW.svp_exam_date,current_date::text) END,NEW.svp_checked_at)
    RETURNING id INTO NEW.exam_id;
  ELSE
    UPDATE public.exams SET candidate_id=NEW.candidate_id,submission_id=NEW.id,occupation_id=NEW.occupation_id,ttc_id=NEW.ttc_id,
      exam_date=(NEW.exam_at AT TIME ZONE 'Asia/Dhaka')::date::text,exam_time=to_char(NEW.exam_at AT TIME ZONE 'Asia/Dhaka','HH24:MI'),
      result=coalesce(result_value,result),result_last_checked_at=NEW.svp_checked_at,
      result_date=CASE WHEN result_value IS NOT NULL AND result_value<>'PENDING' AND result IS DISTINCT FROM result_value
        THEN coalesce(NEW.svp_exam_date,current_date::text) ELSE result_date END WHERE id=NEW.exam_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER b_sync_approved_submission BEFORE INSERT OR UPDATE ON public.job_submissions
FOR EACH ROW EXECUTE FUNCTION public.sync_approved_submission();

CREATE OR REPLACE FUNCTION public.record_exam_result_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.result IS NOT NULL AND NEW.result<>'PENDING' AND
    (TG_OP='INSERT' OR OLD.result IS DISTINCT FROM NEW.result) THEN
    INSERT INTO public.results(candidate_id,exam_id,result,result_date,score,source)
      VALUES (NEW.candidate_id,NEW.id,NEW.result,coalesce(NEW.result_date,current_date::text),NEW.score,'exam');
  END IF;
  IF TG_OP='UPDATE' AND pg_trigger_depth()=1 AND NEW.result IS DISTINCT FROM OLD.result AND NEW.submission_id IS NOT NULL THEN
    UPDATE public.job_submissions SET svp_result=NEW.result::text,svp_checked_at=now(),svp_old_result=NULL
      WHERE id=NEW.submission_id AND status='approved';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_exam_result AFTER INSERT OR UPDATE ON public.exams
FOR EACH ROW EXECUTE FUNCTION public.record_exam_result_change();
CREATE OR REPLACE FUNCTION public.preserve_result_history()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Result history is immutable'; END $$;
CREATE TRIGGER preserve_result_history BEFORE UPDATE OR DELETE ON public.results
FOR EACH ROW EXECUTE FUNCTION public.preserve_result_history();
DROP POLICY IF EXISTS results_staff_all ON public.results;
DROP POLICY IF EXISTS results_management_all ON public.results;
CREATE POLICY results_staff_read ON public.results FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY results_management_read ON public.results FOR SELECT TO authenticated USING (public.is_management_user(auth.uid()));
-- Reception changes are made through the authenticated server workflow, not exam/result editors.
DROP POLICY IF EXISTS candidates_management_all ON public.candidates;
DROP POLICY IF EXISTS exams_management_all ON public.exams;
CREATE POLICY candidates_management_read ON public.candidates FOR SELECT TO authenticated USING (public.is_management_user(auth.uid()));
CREATE POLICY exams_management_read ON public.exams FOR SELECT TO authenticated USING (public.is_management_user(auth.uid()));
DROP POLICY IF EXISTS job_submissions_management_all ON public.job_submissions;
CREATE POLICY job_submissions_management_read ON public.job_submissions FOR SELECT TO authenticated USING(public.is_management_user(auth.uid()));
CREATE POLICY job_submissions_provider_read ON public.job_submissions FOR SELECT TO authenticated
USING (status='approved' AND public.is_active_account(auth.uid()) AND EXISTS
  (SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role::text='service_provider'));

-- A customer is a role-less phone-login identity; normalize Bangladesh's optional 88 prefix.
CREATE OR REPLACE FUNCTION public.customer_owns_candidate(candidate_uuid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()) AND EXISTS(
 SELECT 1 FROM public.candidates c JOIN auth.users u ON u.id=auth.uid()
 WHERE c.id=candidate_uuid AND u.email ~ '^(88)?01[3-9][0-9]{8}@phone[.]login[.]local$'
 AND regexp_replace(regexp_replace(c.mobile,'[^0-9]','','g'),'^88','')=
     regexp_replace(split_part(u.email,'@',1),'^88',''))
$$;
REVOKE ALL ON FUNCTION public.customer_owns_candidate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_owns_candidate(uuid) TO authenticated,service_role;
CREATE POLICY candidates_customer_read ON public.candidates FOR SELECT TO authenticated USING(public.customer_owns_candidate(id));
CREATE OR REPLACE FUNCTION public.customer_result_visible(candidate_uuid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.customer_owns_candidate(candidate_uuid) AND EXISTS(SELECT 1 FROM public.candidates c
 WHERE c.id=candidate_uuid AND c.result_check_at<=now() AND coalesce(c.fee_amount,0)<=
 (SELECT coalesce(sum(p.amount),0) FROM public.payments p WHERE p.candidate_id=c.id AND p.status='approved'))
$$;
REVOKE ALL ON FUNCTION public.customer_result_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_result_visible(uuid) TO authenticated,service_role;
CREATE POLICY exams_customer_read ON public.exams FOR SELECT TO authenticated USING(public.customer_result_visible(candidate_id));
-- Customers can submit a payment for their own candidate, never approve their own receipt.
DROP POLICY IF EXISTS payments_own_insert ON public.payments;
DROP POLICY IF EXISTS payments_own_update ON public.payments;
CREATE POLICY payments_customer_insert ON public.payments FOR INSERT TO authenticated
WITH CHECK(created_by=auth.uid() AND public.customer_owns_candidate(candidate_id) AND status='pending' AND amount>0 AND amount<=1000000);
CREATE POLICY payments_customer_read ON public.payments FOR SELECT TO authenticated USING(public.customer_owns_candidate(candidate_id));
CREATE OR REPLACE FUNCTION public.guard_customer_payment()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user NOT IN ('postgres','service_role') AND NOT public.is_staff(auth.uid()) THEN
   IF TG_OP<>'INSERT' OR NOT public.customer_owns_candidate(NEW.candidate_id) OR NEW.created_by IS DISTINCT FROM auth.uid() OR NEW.status<>'pending'
      OR NEW.amount IS NULL OR NEW.amount<=0 OR NEW.amount>1000000 OR NEW.amount::text IN ('NaN','Infinity','-Infinity')
      OR NEW.amount<>round(NEW.amount,2) OR NEW.method NOT IN ('bkash','nagad','rocket','bank') THEN
     RAISE EXCEPTION 'Payment operation not allowed' USING ERRCODE='42501';
   END IF;
   NEW.reviewed_at:=NULL; NEW.reviewed_by:=NULL; NEW.created_at:=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_customer_payment BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.guard_customer_payment();
-- Return the public result contract only after publication and full fee settlement.
CREATE OR REPLACE FUNCTION public.check_applicant_result(_passport text,_occupation_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.candidates; e public.exams;
BEGIN
 IF length(regexp_replace(_passport,'[^A-Za-z0-9]','','g'))<5 OR coalesce(_occupation_id,'')='' THEN
   RETURN jsonb_build_object('status','not_found');
 END IF;
 SELECT * INTO c FROM public.candidates WHERE upper(regexp_replace(passport_no,'[^A-Za-z0-9]','','g'))=
 upper(regexp_replace(_passport,'[^A-Za-z0-9]','','g')) AND occupation_id=_occupation_id ORDER BY created_at DESC LIMIT 1;
 IF c.id IS NULL THEN RETURN jsonb_build_object('status','not_found'); END IF;
 IF c.result_check_at IS NULL OR c.result_check_at>now() OR coalesce(c.fee_amount,0)>
   (SELECT coalesce(sum(amount),0) FROM public.payments WHERE candidate_id=c.id AND status='approved') THEN
   RETURN jsonb_build_object('status','pending','result_check_at',c.result_check_at);
 END IF;
 SELECT * INTO e FROM public.exams WHERE candidate_id=c.id AND occupation_id=_occupation_id ORDER BY exam_date DESC,created_at DESC LIMIT 1;
 IF e.id IS NULL THEN RETURN jsonb_build_object('status','pending','result_check_at',c.result_check_at); END IF;
 RETURN jsonb_build_object('status','available','name',c.name,'passport_no',c.passport_no,
   'occupation',(SELECT name FROM public.occupations WHERE id::text=e.occupation_id),
   'ttc',(SELECT name FROM public.ttc_centers WHERE id::text=e.ttc_id),
   'exam_date',e.exam_date,'result',coalesce(e.result,'PENDING'));
END $$;
CREATE OR REPLACE FUNCTION public.portal_agent_contact()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (SELECT jsonb_build_object('name',a.full_name,'mobile',a.mobile,'code',a.agent_code)
 FROM public.job_submissions j JOIN public.agent_accounts a ON a.user_id=j.submitted_by
 WHERE j.status='approved' AND public.customer_owns_candidate(j.candidate_id)
 ORDER BY j.created_at DESC LIMIT 1)
$$;
NOTIFY pgrst,'reload schema';
COMMIT;
