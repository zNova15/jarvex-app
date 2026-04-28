-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Realtime para tablas master que faltaban.
-- Sin esto, cuando un usuario crea/edita una obra, los demás no la
-- ven hasta que sincronicen manualmente o recarguen la app.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE obras;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE materiales;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE herramientas;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE personal;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE proveedores;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE partidas;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
