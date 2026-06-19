-- 082: Vínculo Frentes <-> Partidas (F1, fundación de Gestión de Obra).
-- Muchos-a-muchos. Se guarda el NODO asignado (codigo_delfin: capítulo '02',
-- subcapítulo '02.01' o ítem '02.01.01.01'); la expansión a las partidas hijas
-- se calcula al leer (helper src/lib/frente-partidas.js). Un capítulo = 1 fila,
-- no N. partida_id es opcional (un nodo intermedio puede no tener fila propia).
-- Espejo de 065_frentes_obra (mismas columnas de sync + RLS).

CREATE TABLE IF NOT EXISTS public.frente_partidas (
  id uuid PRIMARY KEY,
  obra_id uuid NOT NULL,
  frente_id uuid NOT NULL,            -- → frentes_obra.id (sin FK estricta, como el resto)
  codigo_delfin text NOT NULL,        -- nodo asignado ('02', '02.01', '02.01.01.01')
  partida_id uuid,                    -- → partidas.id si el nodo tiene fila propia (opcional)
  nivel integer,                      -- profundidad del nodo (segmentos), para la UI
  created_by uuid, updated_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  version integer DEFAULT 1, sync_status text, last_synced_at timestamptz,
  idempotency_key text, deleted_at timestamptz, demo boolean DEFAULT false
);
CREATE INDEX IF NOT EXISTS idx_frente_partidas_obra ON public.frente_partidas(obra_id);
CREATE INDEX IF NOT EXISTS idx_frente_partidas_frente ON public.frente_partidas(obra_id, frente_id);
CREATE INDEX IF NOT EXISTS idx_frente_partidas_codigo ON public.frente_partidas(obra_id, codigo_delfin);
-- No asignar dos veces el mismo nodo al mismo frente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_frente_partidas_nodo
  ON public.frente_partidas(obra_id, frente_id, codigo_delfin) WHERE deleted_at IS NULL;

ALTER TABLE public.frente_partidas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "frente_partidas: select autenticado" ON public.frente_partidas;
CREATE POLICY "frente_partidas: select autenticado" ON public.frente_partidas FOR SELECT TO authenticated USING (deleted_at IS NULL);
DROP POLICY IF EXISTS "frente_partidas: insert autenticado" ON public.frente_partidas;
CREATE POLICY "frente_partidas: insert autenticado" ON public.frente_partidas FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "frente_partidas: update autenticado" ON public.frente_partidas;
CREATE POLICY "frente_partidas: update autenticado" ON public.frente_partidas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "frente_partidas: admin elimina" ON public.frente_partidas;
CREATE POLICY "frente_partidas: admin elimina" ON public.frente_partidas FOR DELETE TO authenticated USING ((SELECT rol FROM public.profiles WHERE id = auth.uid()) = 'admin');

NOTIFY pgrst, 'reload schema';
