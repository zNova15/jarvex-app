-- ═══════════════════════════════════════════════════════════════════
-- 165 — Vínculo N:M entre guías de remisión y facturas
--
-- Por qué (pedido de Gabriel, 1-sep): en la operación real una guía de
-- remisión puede amparar VARIAS facturas y una factura puede necesitar
-- VARIAS guías (el traslado se parte en viajes). Hoy el esquema solo
-- soporta la mitad del caso: guias_remision.accounting_movement_id es UNA
-- sola FK, así que "una factura con N guías" funciona (N filas apuntando al
-- mismo movimiento) pero "una guía con N facturas" es imposible.
--
-- La tabla nueva pasa a ser la ÚNICA fuente de verdad de la vinculación.
--
-- ⚠ guias_remision.accounting_movement_id NO se borra y SE SIGUE ESCRIBIENDO
-- con el primer vínculo, a propósito: JARVEX es una PWA y los clientes que
-- todavía tengan cacheada una versión vieja del bundle leen esa columna. Si
-- la dejáramos de poblar, esos usuarios verían las guías nuevas como "sin
-- vincular". Cuando no queden clientes viejos se puede dejar de escribir.
--
-- Aditiva y reversible (un DROP TABLE deja todo como estaba: el backfill sale
-- de la columna, que queda intacta).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.guia_factura (
  id uuid PRIMARY KEY,
  guia_id uuid NOT NULL REFERENCES public.guias_remision(id),
  accounting_movement_id uuid NOT NULL REFERENCES public.accounting_movements(id),
  -- Trazabilidad de CÓMO se creó el vínculo. 'auto' = lo resolvió el matcher
  -- sin intervención; 'captura_magica' = lo confirmó una persona en la
  -- pantalla de revisión; 'manual' = desde la página Guías de Remisión;
  -- 'backfill' = lo trajo esta migración desde la columna vieja.
  origen text NOT NULL DEFAULT 'manual'
    CHECK (origen IN ('auto', 'captura_magica', 'manual', 'backfill')),
  confianza text CHECK (confianza IS NULL OR confianza IN ('alta', 'media')),
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

-- Un mismo par guía↔factura no se vincula dos veces (parcial: un vínculo
-- borrado no bloquea volver a crearlo).
CREATE UNIQUE INDEX IF NOT EXISTS uq_guia_factura_par
  ON public.guia_factura (guia_id, accounting_movement_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guia_factura_guia
  ON public.guia_factura (guia_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_guia_factura_mov
  ON public.guia_factura (accounting_movement_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_guia_factura_updated ON public.guia_factura;
CREATE TRIGGER trg_guia_factura_updated BEFORE UPDATE ON public.guia_factura
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Backfill de los vínculos que ya existen ────────────────────────
-- idempotency_key determinista sobre el par → correr la migración dos veces
-- no duplica (y el UNIQUE parcial es la segunda red).
INSERT INTO public.guia_factura
  (id, guia_id, accounting_movement_id, origen, created_by, updated_by,
   created_at, updated_at, version, idempotency_key)
SELECT
  gen_random_uuid(), g.id, g.accounting_movement_id, 'backfill',
  g.created_by, g.updated_by, g.created_at, now(), 1,
  'gf_' || g.id::text || '_' || g.accounting_movement_id::text
FROM public.guias_remision g
WHERE g.accounting_movement_id IS NOT NULL
  AND g.deleted_at IS NULL
ON CONFLICT (idempotency_key) DO NOTHING;

-- ── RLS: espejo exacto de guias_remision (mig 123) ────────────────
-- El contenido sensible vive en guias_remision y en accounting_movements;
-- esta tabla son dos FKs. Se mantiene el mismo criterio que la tabla madre
-- para no abrir ni cerrar nada nuevo por accidente.
ALTER TABLE public.guia_factura ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guia_factura: autenticado lee" ON public.guia_factura;
CREATE POLICY "guia_factura: autenticado lee" ON public.guia_factura
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "guia_factura: autenticado inserta" ON public.guia_factura;
CREATE POLICY "guia_factura: autenticado inserta" ON public.guia_factura
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "guia_factura: autenticado actualiza" ON public.guia_factura;
CREATE POLICY "guia_factura: autenticado actualiza" ON public.guia_factura
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "guia_factura: admin borra" ON public.guia_factura;
CREATE POLICY "guia_factura: admin borra" ON public.guia_factura
  FOR DELETE TO authenticated USING (public.has_role(ARRAY['admin'::text]));

COMMENT ON TABLE public.guia_factura IS
  'Vínculo N:M guía de remisión ↔ factura (mig 165). Fuente de verdad de la vinculación; guias_remision.accounting_movement_id queda como espejo del primer vínculo solo para clientes PWA con bundle viejo.';

NOTIFY pgrst, 'reload schema';
