-- Supabase-specific setup applied AFTER Drizzle migrations.
-- Idempotent — safe to re-run.

-- 1. Foreign key: reps.id → auth.users(id). Cascade on delete so removing a user removes their rep row.
ALTER TABLE public.reps
  DROP CONSTRAINT IF EXISTS reps_id_fkey;
ALTER TABLE public.reps
  ADD CONSTRAINT reps_id_fkey
  FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- 2. Trigger: when a Supabase auth.users row is inserted, create a matching reps row.
--    Uses raw_user_meta_data->>'display_name' if present, falls back to the email's local-part.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.reps (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    'rep'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- 3. RLS: enable on every public table. Default-deny; per-feature policies will be added later.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('__drizzle_migrations')
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END$$;
