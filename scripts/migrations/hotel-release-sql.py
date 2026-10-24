"""Emit a fail-closed one-time migration wrapper. Never connect to a database."""
from pathlib import Path
from hashlib import sha256
root = Path(__file__).resolve().parents[2]
files = sorted((root / 'packages/db/drizzle/migrations').glob('*.sql'))
assert len(files) == 13 and files[-1].name == '0013_hotel_quotes_attempts.sql', 'Review runner for new migrations'
print("SET LOCAL search_path = public; SET LOCAL lock_timeout = '10s'; SET LOCAL statement_timeout = '120s';")
print("SELECT pg_advisory_xact_lock(712903, 13);")
print("""DO $$ BEGIN
 IF to_regclass('public.poomas_schema_migrations') IS NULL THEN
  RAISE EXCEPTION 'Approved migration ledger/baseline required; never replay legacy SQL';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_constraint k JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=k.conkey[1] WHERE k.conrelid='public.poomas_schema_migrations'::regclass AND k.contype='p' AND array_length(k.conkey,1)=1 AND a.attname='name') THEN RAISE EXCEPTION 'Migration ledger requires unique name primary key'; END IF;
END $$;""")
for file in files[:-1]:
    digest = sha256(file.read_bytes()).hexdigest()
    print(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.poomas_schema_migrations WHERE name='{file.name}' AND sha256='{digest}') THEN RAISE EXCEPTION 'Legacy baseline/checksum mismatch: {file.name}'; END IF; END $$;")
file = files[-1]; digest = sha256(file.read_bytes()).hexdigest()
print(f"""DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.poomas_schema_migrations WHERE name='{file.name}' AND sha256<>'{digest}') THEN RAISE EXCEPTION 'Hotel checksum mismatch'; END IF;
END $$;
SELECT NOT EXISTS(SELECT 1 FROM public.poomas_schema_migrations WHERE name='{file.name}') AS hotel_pending \\gset
\\if :hotel_pending
DO $$ BEGIN IF to_regclass('public.hotel_quotes') IS NOT NULL OR to_regclass('public.hotel_attempts') IS NOT NULL THEN RAISE EXCEPTION 'Untracked hotel schema: stop for inspection'; END IF; END $$;
""")
print(file.read_text())
print(f"INSERT INTO public.poomas_schema_migrations(name,sha256) VALUES ('{file.name}','{digest}');")
print('\\endif')
print((root / 'scripts/migrations/verify-hotel-schema.sql').read_text())
# Check exact columns/types/nullability/defaults, not counts alone.
expected=[]
for table,names in [('hotel_quotes',['id','tenant_id','user_id','selection','snapshot','provider_booking_id','provider_scope','expires_at','created_at']),('hotel_attempts',['id','tenant_id','user_id','quote_id','idempotency_key','request_hash','provider_booking_id','state','mode','confirmation_started_at','cancellation_started_at','outcome','checks','next_check_at','created_at','updated_at'])]:
 for name in names:
  kind='timestamp with time zone' if name.endswith('_at') else 'jsonb' if name in ['selection','snapshot','outcome'] else 'integer' if name=='checks' else 'text'
  required=name not in ['confirmation_started_at','cancellation_started_at','outcome']
  default='now()' if name in ['created_at','updated_at','next_check_at'] else "'PREPARING'::text" if name=='state' else '0' if name=='checks' else ''
  quote=lambda value:"'"+value.replace("'","''")+"'"
  expected.append('('+','.join([quote(table),quote(name),quote(kind),'true' if required else 'false',quote(default)])+')')
print("DO $$ BEGIN IF EXISTS (WITH expected(t,n,kind,required,def) AS (VALUES "+','.join(expected)+"""), actual AS (
 SELECT c.relname::text,a.attname::text,format_type(a.atttypid,a.atttypmod),a.attnotnull,coalesce(pg_get_expr(d.adbin,d.adrelid),'')
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relname IN ('hotel_quotes','hotel_attempts') AND a.attnum>0 AND NOT a.attisdropped
) SELECT * FROM ((SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)) delta)
THEN RAISE EXCEPTION 'Exact hotel column/default schema mismatch'; END IF; END $$;""")
