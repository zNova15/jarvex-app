-- ═══════════════════════════════════════════════════════════════════
-- 164 — Estado 'leida' para la bandeja de capturas de campo
--
-- Por qué: "🤖 Leer con IA" no cambiaba el estado, así que la foto seguía
-- en la bandeja de Captura Mágica aunque ya estuviera trabajada, y había
-- que acordarse de marcarla a mano. Con el volumen real eso es basura
-- acumulada (pedido de Gabriel, 1-sep).
--
-- 'leida' = ya se mandó al lector de IA, todavía no se confirmó el
-- movimiento. La UI la muestra en una pestaña aparte ("🤖 Trabajadas"),
-- desde donde se cierra como 'registrada' / 'descartada' o se devuelve a
-- 'pendiente' si se quiere seguir viéndola en la bandeja principal.
--
-- Aditiva y reversible. NO toca las políticas del cerco del rol campo: esas
-- exigen 'pendiente' tanto en USING como en WITH CHECK, así que campo sigue
-- sin poder mover sus propias fotos a ningún otro estado.
-- ═══════════════════════════════════════════════════════════════════

-- El CHECK de la 155 se creó INLINE (ADD COLUMN ... CHECK (...)), así que
-- Postgres lo auto-nombró. Un DROP por nombre adivinado podría no encontrarlo
-- y dejaríamos DOS checks: el viejo seguiría rechazando 'leida'. Por eso se
-- borra cualquier CHECK de la tabla que mencione la columna.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'public'
       AND rel.relname = 'evidencias'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%campo_revision%'
  LOOP
    EXECUTE format('ALTER TABLE public.evidencias DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.evidencias ADD CONSTRAINT evidencias_campo_revision_check
  CHECK (campo_revision IS NULL
         OR campo_revision IN ('pendiente', 'leida', 'registrada', 'descartada'));

COMMENT ON COLUMN public.evidencias.campo_revision IS
  'Bandeja de capturas de campo: pendiente | leida (mandada a la IA, sin confirmar) | registrada | descartada. NULL = no viene del portal de campo.';
