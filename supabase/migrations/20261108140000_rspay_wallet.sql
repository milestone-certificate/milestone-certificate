-- Server-managed RSPay deposits. Apply after the existing wallet migrations.
BEGIN;

ALTER TABLE public.wallet_deposits
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual', 'rspay')),
  ADD COLUMN IF NOT EXISTS gateway_status text CHECK (gateway_status IN ('CREATING','PENDING','VERIFYING','COMPLETED','FAILED','LINK_FAILED')),
  ADD COLUMN IF NOT EXISTS gateway_short_code text,
  ADD COLUMN IF NOT EXISTS gateway_transaction_id text;

CREATE UNIQUE INDEX IF NOT EXISTS wallet_rspay_ledger_once
  ON public.wallet_transactions(reference)
  WHERE type = 'deposit' AND reference LIKE 'rspay:%';

-- This table contains callback capabilities and is never readable by a browser.
CREATE TABLE IF NOT EXISTS public.wallet_rspay_orders (
  deposit_id uuid PRIMARY KEY REFERENCES public.wallet_deposits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL,
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount <= 1000000),
  method text NOT NULL CHECK (method IN ('bkash','nagad','rocket','upay')),
  identity_address text NOT NULL,
  callback_hash text NOT NULL CHECK (callback_hash ~ '^[a-f0-9]{64}$'),
  callback_private boolean NOT NULL DEFAULT false,
  short_code text UNIQUE,
  checkout_url text,
  status text NOT NULL DEFAULT 'CREATING' CHECK (status IN ('CREATING','PENDING','VERIFYING','COMPLETED','FAILED','LINK_FAILED')),
  transaction_id text,
  deferred_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS wallet_rspay_transaction_once
  ON public.wallet_rspay_orders(method, transaction_id) WHERE status = 'COMPLETED';
ALTER TABLE public.wallet_rspay_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wallet_rspay_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.wallet_rspay_orders TO service_role;

DROP POLICY IF EXISTS wallet_deposits_insert_own ON public.wallet_deposits;
CREATE POLICY wallet_deposits_insert_own ON public.wallet_deposits FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()) AND status = 'pending' AND provider = 'manual'
    AND gateway_status IS NULL AND gateway_short_code IS NULL AND gateway_transaction_id IS NULL
    AND reviewed_by IS NULL AND reviewed_at IS NULL);

-- Protect existing admin review RPCs (and any future update path) from crediting
-- gateway orders manually. The RSPay completion RPC updates order and deposit
-- together; only that path can make a gateway deposit approved.
CREATE OR REPLACE FUNCTION public.wallet_guard_rspay_deposit()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.provider = 'rspay' AND (NEW.provider <> OLD.provider OR NEW.user_id <> OLD.user_id
      OR NEW.amount <> OLD.amount OR NEW.method <> OLD.method) THEN
    RAISE EXCEPTION 'Gateway deposit is immutable';
  END IF;
  IF OLD.provider = 'rspay' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF (SELECT status FROM public.wallet_rspay_orders WHERE deposit_id = OLD.id)
        IS DISTINCT FROM (CASE NEW.status WHEN 'approved' THEN 'COMPLETED' WHEN 'rejected' THEN 'FAILED' ELSE 'PENDING' END)
    THEN RAISE EXCEPTION 'Gateway deposits are reviewed automatically'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS wallet_guard_rspay_deposit ON public.wallet_deposits;
CREATE TRIGGER wallet_guard_rspay_deposit BEFORE UPDATE ON public.wallet_deposits
  FOR EACH ROW EXECUTE FUNCTION public.wallet_guard_rspay_deposit();

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
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || _request_id::text, 0));
  SELECT * INTO o FROM public.wallet_rspay_orders WHERE user_id = _user_id AND request_id = _request_id;
  IF FOUND THEN
    IF o.amount <> _amount OR o.method <> _method OR o.identity_address <> _identity THEN
      RAISE EXCEPTION 'Request already used';
    END IF;
    RETURN jsonb_build_object('id',o.deposit_id,'created',false,
      'url',CASE WHEN o.callback_private THEN o.checkout_url ELSE NULL END,'status',o.status);
  END IF;
  -- Limit abandoned/parallel checkouts without limiting legitimate completed deposits.
  IF (SELECT count(*) FROM public.wallet_rspay_orders WHERE user_id = _user_id
       AND created_at > now() - interval '10 minutes') >= 10 THEN
    RAISE EXCEPTION 'Too many payment requests';
  END IF;
  INSERT INTO public.wallet_deposits(user_id,amount,method,provider,gateway_status)
    VALUES (_user_id,_amount,_method,'rspay','CREATING') RETURNING id INTO d;
  INSERT INTO public.wallet_rspay_orders(deposit_id,user_id,request_id,amount,method,identity_address,callback_hash)
    VALUES (d,_user_id,_request_id,_amount,_method,_identity,_callback_hash);
  RETURN jsonb_build_object('id',d,'created',true,'status','CREATING');
END;
$$;

-- Only trusted server code calls this after verifying the callback capability.
-- _verified is true ONLY for a verified provider record or possession of the
-- private callback capability after the provider checkout privacy check.
-- A browser redirect and a short_code alone can never assert paid status.
CREATE OR REPLACE FUNCTION public.wallet_rspay_event(
  _deposit_id uuid, _callback_hash text, _event jsonb, _verified boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.wallet_rspay_orders%ROWTYPE; s text := _event->>'status';
  tx text := upper(trim(_event->>'transaction_id')); b numeric;
BEGIN
  SELECT * INTO o FROM public.wallet_rspay_orders WHERE deposit_id = _deposit_id FOR UPDATE;
  IF NOT FOUND OR o.callback_hash <> _callback_hash THEN
    RETURN jsonb_build_object('ok',false,'reason','unauthorized');
  END IF;
  IF s IS NULL OR s NOT IN ('COMPLETED','PENDING','FAILED')
     OR (_event->>'amount')::numeric IS DISTINCT FROM o.amount
     OR (_event->>'method') IS DISTINCT FROM o.method
     OR (_event->>'user_identyfy_address') IS DISTINCT FROM o.identity_address
     OR (_event#>>'{checkout_items,orderId}') IS DISTINCT FROM o.deposit_id::text
     OR coalesce(_event->>'short_code','') !~ '^[A-Za-z0-9_-]{1,128}$'
     OR (o.short_code IS NOT NULL AND o.short_code <> _event->>'short_code') THEN
    RETURN jsonb_build_object('ok',false,'reason','mismatch');
  END IF;
  IF s = 'COMPLETED' AND (coalesce(tx,'') = '' OR tx IN ('INVALID','PENDING_VERIFICATION') OR length(tx)>128) THEN
    RETURN jsonb_build_object('ok',false,'reason','invalid_transaction');
  END IF;
  IF o.status = 'COMPLETED' THEN
    RETURN jsonb_build_object('ok', s <> 'COMPLETED' OR tx = o.transaction_id,'duplicate',true,'status',o.status);
  END IF;
  IF NOT _verified THEN
    IF o.status = 'FAILED' AND s = 'PENDING' THEN
      RETURN jsonb_build_object('ok',true,'status',o.status);
    END IF;
    -- Preserve the valid notification for reconciliation, never its claim of credit.
    UPDATE public.wallet_rspay_orders SET status = 'VERIFYING', deferred_event =
      CASE WHEN (deferred_event->>'status' = 'COMPLETED' AND s <> 'COMPLETED')
          OR (deferred_event->>'status' = 'FAILED' AND s = 'PENDING')
        THEN deferred_event ELSE _event END, updated_at = now()
      WHERE deposit_id = o.deposit_id;
    UPDATE public.wallet_deposits SET gateway_status = 'VERIFYING' WHERE id = o.deposit_id;
    RETURN jsonb_build_object('ok',true,'status','VERIFYING');
  END IF;
  IF o.short_code IS NULL THEN
    UPDATE public.wallet_rspay_orders SET deferred_event =
      CASE WHEN (deferred_event->>'status' = 'COMPLETED' AND s <> 'COMPLETED')
          OR (deferred_event->>'status' = 'FAILED' AND s = 'PENDING')
        THEN deferred_event ELSE _event END, updated_at = now() WHERE deposit_id = o.deposit_id;
    RETURN jsonb_build_object('ok',true,'status','CREATING');
  END IF;
  IF s = 'PENDING' AND o.status = 'FAILED' THEN
    RETURN jsonb_build_object('ok',true,'status',o.status);
  END IF;
  -- Uniqueness errors roll the entire credit back, including the wallet balance.
  UPDATE public.wallet_rspay_orders SET status = s,
    transaction_id = CASE WHEN s = 'COMPLETED' THEN tx ELSE NULL END,
    deferred_event = NULL, updated_at = now() WHERE deposit_id = o.deposit_id;
  PERFORM 1 FROM public.wallet_deposits WHERE id = o.deposit_id FOR UPDATE;
  IF s = 'COMPLETED' THEN
    PERFORM public.wallet_ensure_account(o.user_id);
    SELECT balance INTO b FROM public.wallet_accounts WHERE user_id = o.user_id FOR UPDATE;
    b := b + o.amount;
    UPDATE public.wallet_accounts SET balance = b WHERE user_id = o.user_id;
    INSERT INTO public.wallet_transactions(user_id,type,amount,balance_after,reference,note)
      VALUES (o.user_id,'deposit',o.amount,b,'rspay:' || o.deposit_id::text,'RSPay ' || o.method || ' · ' || tx);
  END IF;
  UPDATE public.wallet_deposits SET gateway_status = s,
    status = CASE s WHEN 'COMPLETED' THEN 'approved' WHEN 'FAILED' THEN 'rejected' ELSE 'pending' END,
    gateway_transaction_id = CASE WHEN s = 'COMPLETED' THEN tx ELSE NULL END,
    reviewed_at = CASE WHEN s IN ('COMPLETED','FAILED') THEN now() ELSE NULL END,
    review_note = 'RSPay verified' WHERE id = o.deposit_id;
  RETURN jsonb_build_object('ok',true,'status',s);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok',false,'reason','transaction_reused');
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_rspay_bind(_deposit_id uuid, _short_code text, _url text, _callback_private boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o public.wallet_rspay_orders%ROWTYPE;
BEGIN
  SELECT * INTO o FROM public.wallet_rspay_orders WHERE deposit_id = _deposit_id FOR UPDATE;
  IF NOT FOUND OR _short_code !~ '^[A-Za-z0-9_-]{1,128}$' OR _url !~ '^https://' THEN
    RAISE EXCEPTION 'Invalid payment link';
  END IF;
  IF o.short_code IS NOT NULL AND o.short_code <> _short_code THEN RAISE EXCEPTION 'Already bound'; END IF;
  UPDATE public.wallet_rspay_orders SET short_code = _short_code, checkout_url = _url,
    callback_private = _callback_private,
    status = CASE WHEN status = 'CREATING' THEN 'PENDING' ELSE status END, updated_at = now()
    WHERE deposit_id = _deposit_id;
  UPDATE public.wallet_deposits SET gateway_short_code = _short_code, reference = _short_code,
    gateway_status = CASE WHEN gateway_status = 'CREATING' THEN 'PENDING' ELSE gateway_status END
    WHERE id = _deposit_id;
  -- Replay a callback received before the create-link response. It was already
  -- authenticated by the per-order capability; now the real code is bound too.
  IF _callback_private AND o.deferred_event IS NOT NULL THEN
    RETURN public.wallet_rspay_event(_deposit_id,o.callback_hash,o.deferred_event,true);
  END IF;
  RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE OR REPLACE FUNCTION public.wallet_rspay_link_failed(_deposit_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.wallet_rspay_orders SET status = 'LINK_FAILED', updated_at = now()
    WHERE deposit_id = _deposit_id AND (status = 'CREATING'
      OR (short_code IS NOT NULL AND NOT callback_private AND status IN ('PENDING','VERIFYING')));
  UPDATE public.wallet_deposits SET gateway_status = 'LINK_FAILED'
    WHERE id = _deposit_id AND EXISTS (
      SELECT 1 FROM public.wallet_rspay_orders WHERE deposit_id = _deposit_id AND status = 'LINK_FAILED'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.wallet_rspay_begin(uuid,uuid,numeric,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_rspay_event(uuid,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_rspay_bind(uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_rspay_link_failed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wallet_rspay_begin(uuid,uuid,numeric,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_rspay_event(uuid,text,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_rspay_bind(uuid,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_rspay_link_failed(uuid) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
