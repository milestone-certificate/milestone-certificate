-- Customers receive an explicit projection of their own records. Internal tables stay private.
BEGIN;
DROP POLICY IF EXISTS candidates_customer_read ON public.candidates;
DROP POLICY IF EXISTS exams_customer_read ON public.exams;
DROP POLICY IF EXISTS payments_customer_read ON public.payments;
DROP POLICY IF EXISTS payments_own_select ON public.payments;
DROP POLICY IF EXISTS payments_management_all ON public.payments;
CREATE POLICY payments_management_read ON public.payments FOR SELECT TO authenticated USING(public.is_management_user(auth.uid()));

DO $$ DECLARE item record; BEGIN
 FOR item IN SELECT * FROM (VALUES
 ('settings','settings_read_auth'),('occupations','occupations_read_auth'),
 ('ttc_centers','ttc_centers_read_auth'),('reminders','reminders_read_auth'),
 ('sms_automations','sms_automations_read_auth'),('sms_templates','sms_templates_read_auth')) AS p(tab,policy)
 LOOP
  EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I',item.policy,item.tab);
  EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()))',item.policy,item.tab);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_customer_portal()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE c public.candidates; released boolean; candidate jsonb; exams jsonb; payments jsonb; occupations jsonb; centers jsonb; instructions text;
BEGIN
 IF auth.uid() IS NULL OR EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Customer access required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO c FROM public.candidates WHERE public.customer_owns_candidate(id) ORDER BY created_at DESC,id DESC LIMIT 1;
 IF c.id IS NULL THEN RETURN jsonb_build_object('candidate',NULL,'exams','[]'::jsonb,'payments','[]'::jsonb,'occ','{}'::jsonb,'ttc','{}'::jsonb,'instructions',''); END IF;
 released:=public.customer_result_visible(c.id);
 candidate:=jsonb_build_object('id',c.id,'name',c.name,'passport_no',c.passport_no,'occupation_id',c.occupation_id,
   'ttc_id',c.ttc_id,'photo_url',c.photo_url,'fee_amount',c.fee_amount,'result_check_at',c.result_check_at,'registration_no',c.registration_no);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'exam_date',e.exam_date,'exam_time',e.exam_time,'exam_type',e.exam_type,
   'occupation_id',e.occupation_id,'ttc_id',e.ttc_id,'result',coalesce(e.result,'PENDING'),'result_date',e.result_date,'score',e.score)
   ORDER BY e.exam_date DESC,e.created_at DESC),'[]'::jsonb) INTO exams FROM public.exams e WHERE e.candidate_id=c.id AND released;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'amount',p.amount,'method',p.method,'trx_id',p.trx_id,'status',p.status,'created_at',p.created_at)
   ORDER BY p.created_at DESC),'[]'::jsonb) INTO payments FROM public.payments p WHERE p.candidate_id=c.id;
 SELECT coalesce(jsonb_object_agg(o.id::text,o.name),'{}'::jsonb) INTO occupations FROM public.occupations o
   WHERE o.id::text=c.occupation_id OR (released AND o.id::text IN (SELECT e.occupation_id FROM public.exams e WHERE e.candidate_id=c.id));
 SELECT coalesce(jsonb_object_agg(t.id::text,t.name),'{}'::jsonb) INTO centers FROM public.ttc_centers t
   WHERE t.id::text=c.ttc_id OR (released AND t.id::text IN (SELECT e.ttc_id FROM public.exams e WHERE e.candidate_id=c.id));
 SELECT value INTO instructions FROM public.settings WHERE key='public_payment_instructions';
 RETURN jsonb_build_object('candidate',candidate,'exams',exams,'payments',payments,'occ',occupations,'ttc',centers,'instructions',coalesce(instructions,''));
END $$;
REVOKE ALL ON FUNCTION public.get_customer_portal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_customer_portal() TO authenticated;

-- An uploaded personal photo is the only private-storage object a customer may sign.
CREATE OR REPLACE FUNCTION public.customer_owns_photo(object_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.candidates c WHERE c.photo_url=object_path AND public.customer_owns_candidate(c.id))
$$;
REVOKE ALL ON FUNCTION public.customer_owns_photo(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.customer_owns_photo(text) TO authenticated;
-- The reconstructed deployment had no upload bucket or storage policies.
DO $$ BEGIN
 IF to_regclass('storage.buckets') IS NOT NULL THEN
  INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  VALUES('candidate-photos','candidate-photos',false,10485760,ARRAY['application/pdf','image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'])
  ON CONFLICT(id) DO UPDATE SET public=false;
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.internal_work_file_access(object_path text,writing boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=uid) OR NOT public.is_active_account(uid) OR object_path LIKE '%..%' THEN RETURN false; END IF;
 IF public.is_staff(uid) THEN RETURN true; END IF;
 IF object_path LIKE 'candidate-drafts/'||uid::text||'/%' THEN RETURN true; END IF;
 IF object_path LIKE 'takamul/'||uid::text||'/%' THEN
  RETURN NOT writing OR NOT EXISTS(SELECT 1 FROM public.job_submissions WHERE ticket_path=object_path);
 END IF;
 IF writing THEN
  RETURN public.is_management_user(uid) AND EXISTS(SELECT 1 FROM public.job_submissions j WHERE object_path LIKE 'candidates/'||j.id::text||'/%');
 END IF;
 RETURN EXISTS(SELECT 1 FROM public.job_submissions j WHERE (j.ticket_path=object_path OR j.candidate_photo_path=object_path OR object_path='candidate-drafts/'||j.submitted_by::text||'/agent-profile.jpg')
 AND (j.submitted_by=uid OR public.parent_agent_of(j.submitted_by)=uid OR public.is_management_user(uid)
 OR (j.status='approved' AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=uid AND role::text='service_provider'))));
END $$;
REVOKE ALL ON FUNCTION public.internal_work_file_access(text,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.internal_work_file_access(text,boolean) TO authenticated;
DO $$ BEGIN
 IF to_regclass('storage.objects') IS NOT NULL THEN
  EXECUTE 'CREATE POLICY customer_personal_photo ON storage.objects FOR SELECT TO authenticated USING(bucket_id=''candidate-photos'' AND public.customer_owns_photo(name))';
  EXECUTE 'CREATE POLICY internal_work_file_read ON storage.objects FOR SELECT TO authenticated USING(bucket_id=''candidate-photos'' AND public.internal_work_file_access(name,false))';
  EXECUTE 'CREATE POLICY internal_work_file_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK(bucket_id=''candidate-photos'' AND public.internal_work_file_access(name,true))';
  EXECUTE 'CREATE POLICY internal_work_file_update ON storage.objects FOR UPDATE TO authenticated USING(bucket_id=''candidate-photos'' AND public.internal_work_file_access(name,true)) WITH CHECK(bucket_id=''candidate-photos'' AND public.internal_work_file_access(name,true))';
 END IF;
END $$;

-- Deprecated endpoint: do not reveal the originating agent, name, telephone or code.
CREATE OR REPLACE FUNCTION public.portal_agent_contact()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT NULL::jsonb $$;

CREATE OR REPLACE FUNCTION public.passport_history(_passport text)
RETURNS TABLE(blocking boolean,created_at timestamptz,exam_at timestamptz,occupation text,ref_code text,status text,svp_result text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid()) OR NOT public.is_active_account(auth.uid()) THEN
  RAISE EXCEPTION 'Internal account required' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT false,j.created_at,j.exam_at,o.name,j.ref_code,j.status,j.svp_result
 FROM public.job_submissions j LEFT JOIN public.occupations o ON o.id::text=j.occupation_id
 WHERE upper(regexp_replace(j.passport_no,'[^A-Za-z0-9]','','g'))=upper(regexp_replace(_passport,'[^A-Za-z0-9]','','g'))
 ORDER BY j.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.passport_history(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.passport_history(text) TO authenticated;

-- Work notes are internal. Agents append notes only to works their RLS allows them to read.
ALTER TABLE public.work_notes ALTER COLUMN author_id SET DEFAULT auth.uid();
DROP POLICY IF EXISTS work_notes_own_insert ON public.work_notes;
DROP POLICY IF EXISTS work_notes_own_update ON public.work_notes;
CREATE POLICY work_notes_own_insert ON public.work_notes FOR INSERT TO authenticated WITH CHECK(
 author_id=auth.uid() AND EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid())
 AND EXISTS(SELECT 1 FROM public.job_submissions j WHERE j.id=submission_id));
NOTIFY pgrst,'reload schema';
COMMIT;
