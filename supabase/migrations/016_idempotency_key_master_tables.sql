-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Schema completo en master tables (idempotency_key + auditoría)
-- ═══════════════════════════════════════════════════════════════════
-- Causa raíz del bug "Gabriel y Miguel se ven como bases separadas":
-- el cliente envía `idempotency_key`, `version`, `created_by`,
-- `updated_by`, `deleted_at` en cada insert, pero varias master tables
-- no tenían algunas de esas columnas en Supabase. PostgREST devolvía
-- 400 con "Could not find the 'X' column" y los inserts NUNCA llegaban
-- al servidor → otros usuarios jamás veían los datos.
--
-- Esta migración añade IF NOT EXISTS las 6 columnas comunes a todas
-- las tablas que pueden ser creadas/editadas desde el cliente.
-- ═══════════════════════════════════════════════════════════════════

-- Helper: agrega las columnas comunes (idempotente)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'obras', 'personal', 'materiales', 'herramientas', 'proveedores',
    'partidas', 'insumos_partida', 'incidencias', 'cronograma'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS idempotency_key TEXT', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1 NOT NULL', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id)', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ', t);
  END LOOP;
END $$;

-- UNIQUE para detección de duplicados al hacer push (idempotencia real).
-- Si el cliente reenvía el mismo registro, Postgres devuelve 23505 y
-- el sync engine ya sabe marcarlo como SYNCED.
DO $$ BEGIN
  ALTER TABLE obras            ADD CONSTRAINT uq_obras_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE personal         ADD CONSTRAINT uq_personal_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE materiales       ADD CONSTRAINT uq_materiales_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE herramientas     ADD CONSTRAINT uq_herramientas_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE proveedores      ADD CONSTRAINT uq_proveedores_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE partidas         ADD CONSTRAINT uq_partidas_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE insumos_partida  ADD CONSTRAINT uq_insumos_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE incidencias      ADD CONSTRAINT uq_incidencias_idempotency UNIQUE (idempotency_key);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;

-- Forzar refresh del schema cache de PostgREST (sino sigue devolviendo
-- "column not found" hasta el próximo restart o cambio).
NOTIFY pgrst, 'reload schema';
