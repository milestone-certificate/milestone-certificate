-- Administrators retain their latest two device keys; other accounts retain one.
BEGIN;
CREATE OR REPLACE FUNCTION public.claim_device_session(_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid:=auth.uid(); admin boolean;
BEGIN
 IF uid IS NULL OR _key IS NULL OR length(_key)<32 OR length(_key)>200 THEN
   RAISE EXCEPTION 'Invalid device session' USING ERRCODE='42501';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=uid AND role::text='admin') INTO admin;
 INSERT INTO public.device_sessions(user_id,session_key,prev_session_key,updated_at)
 VALUES(uid,_key,NULL,now()) ON CONFLICT(user_id) DO UPDATE SET
   prev_session_key=CASE WHEN admin THEN public.device_sessions.session_key ELSE NULL END,
   session_key=excluded.session_key,updated_at=now();
END $$;
CREATE OR REPLACE FUNCTION public.is_current_device_session(_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.device_sessions d WHERE d.user_id=auth.uid()
 AND (d.session_key=_key OR (d.prev_session_key=_key AND EXISTS
   (SELECT 1 FROM public.user_roles r WHERE r.user_id=auth.uid() AND r.role::text='admin'))))
$$;
REVOKE ALL ON FUNCTION public.claim_device_session(text),public.is_current_device_session(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_device_session(text),public.is_current_device_session(text) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
