-- No fixtures or writes. Verification is part of the migration transaction.
DO $$ BEGIN
 IF to_regclass('public.hotel_quotes') IS NULL OR to_regclass('public.hotel_attempts') IS NULL THEN RAISE EXCEPTION 'Hotel tables absent'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hotel_quotes') <> 9
 OR (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='hotel_attempts') <> 16 THEN RAISE EXCEPTION 'Hotel column count mismatch'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN ('public.hotel_quotes'::regclass,'public.hotel_attempts'::regclass)) <> 5 THEN RAISE EXCEPTION 'Hotel foreign key mismatch'; END IF;
 IF (SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND tablename IN ('hotel_quotes','hotel_attempts')) <> 7 THEN RAISE EXCEPTION 'Hotel index mismatch'; END IF;
 IF (SELECT count(*) FROM pg_index WHERE indisunique AND indisvalid AND indexrelid IN ('public.hotel_attempts_key_idx'::regclass,'public.hotel_attempts_quote_idx'::regclass,'public.hotel_attempts_provider_idx'::regclass)) <> 3 THEN RAISE EXCEPTION 'Hotel uniqueness missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.hotel_attempts'::regclass AND conname='hotel_attempts_checks_valid' AND convalidated AND pg_get_constraintdef(oid) LIKE '%checks >= 0%') THEN RAISE EXCEPTION 'Hotel counter constraint missing'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (
  WITH expected(t,def) AS (VALUES
   ('hotel_quotes','FOREIGN KEY (tenant_id) REFERENCES tenants(id)'),
   ('hotel_quotes','FOREIGN KEY (user_id) REFERENCES users(id)'),
   ('hotel_attempts','FOREIGN KEY (tenant_id) REFERENCES tenants(id)'),
   ('hotel_attempts','FOREIGN KEY (user_id) REFERENCES users(id)'),
   ('hotel_attempts','FOREIGN KEY (quote_id) REFERENCES hotel_quotes(id)')),
  actual AS (SELECT c.relname::text,pg_get_constraintdef(k.oid) FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE k.contype='f' AND k.convalidated AND k.conrelid IN ('public.hotel_quotes'::regclass,'public.hotel_attempts'::regclass))
  SELECT * FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) delta
 ) THEN RAISE EXCEPTION 'Exact hotel foreign key mismatch'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (
  WITH expected(def) AS (VALUES
   ('CREATE UNIQUE INDEX hotel_quotes_pkey ON public.hotel_quotes USING btree (id)'),
   ('CREATE INDEX hotel_quotes_provider_idx ON public.hotel_quotes USING btree (tenant_id, provider_scope, provider_booking_id)'),
   ('CREATE UNIQUE INDEX hotel_attempts_pkey ON public.hotel_attempts USING btree (id)'),
   ('CREATE UNIQUE INDEX hotel_attempts_key_idx ON public.hotel_attempts USING btree (tenant_id, user_id, idempotency_key)'),
   ('CREATE UNIQUE INDEX hotel_attempts_quote_idx ON public.hotel_attempts USING btree (quote_id)'),
   ('CREATE INDEX hotel_attempts_owner_idx ON public.hotel_attempts USING btree (tenant_id, user_id, created_at)'),
   ('CREATE UNIQUE INDEX hotel_attempts_provider_idx ON public.hotel_attempts USING btree (tenant_id, provider_booking_id)')),
  actual AS (SELECT indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('hotel_quotes','hotel_attempts'))
  SELECT * FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) delta
 ) THEN RAISE EXCEPTION 'Exact hotel indexes mismatch'; END IF;
END $$;
