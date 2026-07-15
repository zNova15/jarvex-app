-- ═══════════════════════════════════════════════════════════════════
-- 128 — Vínculo requisición → orden de compra generada.
--
-- El código (viejo y nuevo) escribe requisiciones.oc_id / oc_codigo al generar
-- la OC, pero esas columnas NO existían: el push a Supabase manda la fila
-- completa (stripLocalFields solo quita _*, sync_status, last_synced_at y
-- campos trigger-managed) → PostgREST rechazaba el UPDATE por columna
-- desconocida y la requisición aceptada NUNCA sincronizaba. Las agregamos.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS oc_id uuid;
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS oc_codigo text;

NOTIFY pgrst, 'reload schema';
