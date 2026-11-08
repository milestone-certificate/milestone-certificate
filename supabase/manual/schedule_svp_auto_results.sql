-- Run after the matching application deployment. No credentials leave the database.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
INSERT INTO public.cron_tokens(name,token)
VALUES('svp_results',replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''))
ON CONFLICT(name) DO UPDATE SET token=CASE WHEN length(public.cron_tokens.token)>=32 THEN public.cron_tokens.token ELSE excluded.token END;
CREATE OR REPLACE FUNCTION public.dispatch_svp_auto_results()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE secret text; request_id bigint;
BEGIN
  IF NOT coalesce((SELECT enabled FROM public.svp_result_automation_state WHERE id=1),false) THEN RETURN NULL; END IF;
  SELECT token INTO secret FROM public.cron_tokens WHERE name='svp_results';
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Result scheduler token unavailable'; END IF;
  SELECT net.http_post(
    url:='https://mci-edu.xyz/api/public/cron/svp-results',
    headers:=jsonb_build_object('Authorization','Bearer '||secret,'Content-Type','application/json'),
    body:='{}'::jsonb, timeout_milliseconds:=90000) INTO request_id;
  RETURN request_id;
END $$;
REVOKE ALL ON FUNCTION public.dispatch_svp_auto_results() FROM PUBLIC,anon,authenticated,service_role;
-- Dispatch each minute; the claim RPC enforces the two-hour delay and five-minute per-exam interval.
SELECT cron.schedule('mci-svp-auto-results','* * * * *','SELECT public.dispatch_svp_auto_results();');
UPDATE public.svp_result_automation_state SET enabled=true WHERE id=1;
COMMIT;
