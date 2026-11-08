BEGIN;

CREATE TABLE IF NOT EXISTS public.rspay_gateway_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  bkash boolean NOT NULL DEFAULT true,
  nagad boolean NOT NULL DEFAULT true,
  rocket boolean NOT NULL DEFAULT true,
  upay boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.rspay_gateway_settings(id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.rspay_gateway_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control text NOT NULL CHECK (control IN ('enabled','bkash','nagad','rocket','upay')),
  old_value boolean NOT NULL,
  new_value boolean NOT NULL,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.rspay_gateway_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rspay_gateway_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rspay_gateway_settings,public.rspay_gateway_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rspay_gateway_settings,public.rspay_gateway_audit TO authenticated,service_role;
DROP POLICY IF EXISTS rspay_settings_admin_read ON public.rspay_gateway_settings;
CREATE POLICY rspay_settings_admin_read ON public.rspay_gateway_settings FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()),'admin'));
DROP POLICY IF EXISTS rspay_audit_admin_read ON public.rspay_gateway_audit;
CREATE POLICY rspay_audit_admin_read ON public.rspay_gateway_audit FOR SELECT TO authenticated
  USING (public.has_role((SELECT auth.uid()),'admin'));

-- Patch exactly one control under a row lock, so concurrent administrators
-- changing different methods cannot overwrite each other's preferences.
CREATE OR REPLACE FUNCTION public.set_rspay_gateway_control(_control text,_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.rspay_gateway_settings%ROWTYPE; old_value boolean;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.has_role(auth.uid(),'admin'),false) THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;
  IF _control IS NULL OR _control NOT IN ('enabled','bkash','nagad','rocket','upay') OR _enabled IS NULL THEN
    RAISE EXCEPTION 'Invalid gateway control';
  END IF;
  SELECT * INTO STRICT s FROM public.rspay_gateway_settings WHERE id=1 FOR UPDATE;
  old_value := (to_jsonb(s)->>_control)::boolean;
  IF old_value = _enabled THEN RETURN to_jsonb(s); END IF;
  UPDATE public.rspay_gateway_settings SET
    enabled = CASE WHEN _control='enabled' THEN _enabled ELSE enabled END,
    bkash = CASE WHEN _control='bkash' THEN _enabled ELSE bkash END,
    nagad = CASE WHEN _control='nagad' THEN _enabled ELSE nagad END,
    rocket = CASE WHEN _control='rocket' THEN _enabled ELSE rocket END,
    upay = CASE WHEN _control='upay' THEN _enabled ELSE upay END,
    updated_by=auth.uid(),updated_at=now()
    WHERE id=1 RETURNING * INTO s;
  INSERT INTO public.rspay_gateway_audit(control,old_value,new_value,changed_by)
    VALUES (_control,old_value,_enabled,auth.uid());
  RETURN to_jsonb(s);
END;
$$;
REVOKE ALL ON FUNCTION public.set_rspay_gateway_control(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_rspay_gateway_control(text,boolean) TO authenticated;

-- Existing payment callbacks remain independent of these switches. Only new
-- checkout creation is gated; never discard a payment already made by a user.
CREATE OR REPLACE FUNCTION public.wallet_rspay_begin(
  _user_id uuid, _request_id uuid, _amount numeric, _method text,
  _identity text, _callback_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.wallet_rspay_orders%ROWTYPE; d uuid;
BEGIN
  IF _user_id IS NULL OR _request_id IS NULL OR _amount IS NULL OR _amount <= 0
      OR _amount > 1000000 OR _amount <> round(_amount,2)
      OR _method NOT IN ('bkash','nagad','rocket','upay')
      OR length(coalesce(_identity,'')) NOT BETWEEN 3 AND 254
      OR coalesce(_callback_hash,'') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid deposit';
  END IF;
  PERFORM 1 FROM public.rspay_gateway_settings WHERE id=1 AND enabled
    AND CASE _method WHEN 'bkash' THEN bkash WHEN 'nagad' THEN nagad WHEN 'rocket' THEN rocket WHEN 'upay' THEN upay ELSE false END
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment method is disabled'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || _request_id::text,0));
  SELECT * INTO o FROM public.wallet_rspay_orders WHERE user_id=_user_id AND request_id=_request_id;
  IF FOUND THEN
    IF o.amount<>_amount OR o.method<>_method OR o.identity_address<>_identity THEN RAISE EXCEPTION 'Request already used'; END IF;
    RETURN jsonb_build_object('id',o.deposit_id,'created',false,
      'url',CASE WHEN o.callback_private THEN o.checkout_url ELSE NULL END,'status',o.status);
  END IF;
  IF (SELECT count(*) FROM public.wallet_rspay_orders WHERE user_id=_user_id AND created_at>now()-interval '10 minutes')>=10 THEN
    RAISE EXCEPTION 'Too many payment requests';
  END IF;
  INSERT INTO public.wallet_deposits(user_id,amount,method,provider,gateway_status)
    VALUES (_user_id,_amount,_method,'rspay','CREATING') RETURNING id INTO d;
  INSERT INTO public.wallet_rspay_orders(deposit_id,user_id,request_id,amount,method,identity_address,callback_hash)
    VALUES (d,_user_id,_request_id,_amount,_method,_identity,_callback_hash);
  RETURN jsonb_build_object('id',d,'created',true,'status','CREATING');
END;
$$;
REVOKE ALL ON FUNCTION public.wallet_rspay_begin(uuid,uuid,numeric,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_rspay_begin(uuid,uuid,numeric,text,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
