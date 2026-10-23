-- Runs only inside postgres.sh's disposable container.
\d+ hotel_quotes
\d+ hotel_attempts
SELECT tablename,indexname,indexdef FROM pg_indexes WHERE tablename IN ('hotel_quotes','hotel_attempts') ORDER BY indexname;
SELECT conrelid::regclass,contype,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid IN ('hotel_quotes'::regclass,'hotel_attempts'::regclass);
DO $$ BEGIN
 IF (SELECT count(*) FROM information_schema.columns WHERE table_name='hotel_quotes') <> 9 THEN RAISE EXCEPTION 'quote column mismatch'; END IF;
 IF (SELECT count(*) FROM information_schema.columns WHERE table_name='hotel_attempts') <> 16 THEN RAISE EXCEPTION 'attempt column mismatch'; END IF;
 IF (SELECT count(*) FROM pg_indexes WHERE tablename IN ('hotel_quotes','hotel_attempts')) <> 7 THEN RAISE EXCEPTION 'index mismatch'; END IF;
 IF (SELECT count(*) FROM pg_constraint WHERE contype='f' AND conrelid IN ('hotel_quotes'::regclass,'hotel_attempts'::regclass)) <> 5 THEN RAISE EXCEPTION 'foreign key mismatch'; END IF;
END $$;
INSERT INTO hotel_quotes(id,tenant_id,user_id,selection,snapshot,provider_booking_id,provider_scope,expires_at) VALUES ('q1','fixture-tenant','fixture-owner','{}','{}','provider-1','fixture-scope',now()+interval '2 minutes');
DO $$ BEGIN
 BEGIN
  INSERT INTO hotel_quotes(id,tenant_id,user_id,selection,snapshot,provider_booking_id,provider_scope,expires_at) VALUES ('bad','missing','fixture-owner','{}','{}','bad','fixture-scope',now());
  RAISE EXCEPTION 'foreign key accepted invalid tenant';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
 BEGIN
  INSERT INTO hotel_attempts(id,tenant_id,user_id,quote_id,idempotency_key,request_hash,provider_booking_id,mode,checks) VALUES ('bad','fixture-tenant','fixture-owner','q1','k','h','p','HOLD_UAT',-1);
  RAISE EXCEPTION 'negative check count accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
