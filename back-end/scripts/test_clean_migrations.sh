#!/usr/bin/env bash
set -e

DB=test_uytap
echo "=== Step 1: Setting up roles and extensions ==="
sudo -u postgres psql -d $DB << 'SQLEOF'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQLEOF

echo "=== Step 2: Applying migrations in order ==="
MIGRATIONS_DIR="/mnt/c/Users/User/Desktop/Проект/uytapkg/supabase/migrations"
for f in $(ls $MIGRATIONS_DIR/*.sql | sort); do
  echo "===> Applying: $(basename $f)"
  sudo -u postgres psql -d $DB -v ON_ERROR_STOP=1 -f "$f" > /dev/null
done

echo "=== Step 3: Verifying tables and functions ==="
sudo -u postgres psql -d $DB -c "SELECT count(*) AS total_tables FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';"
sudo -u postgres psql -d $DB -c "SELECT count(*) AS total_views FROM information_schema.views WHERE table_schema = 'public';"
sudo -u postgres psql -d $DB -c "SELECT count(*) AS total_routines FROM information_schema.routines WHERE routine_schema = 'public';"
echo "SUCCESS: All migrations applied without errors!"
