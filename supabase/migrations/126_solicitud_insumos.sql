-- ═══════════════════════════════════════════════════════════════════
-- 126 — "Solicitud de Insumos" (rediseño del flujo de pedidos).
--
-- Pedido de Gabriel (14 jul 2026): el personal pide insumos (materiales,
-- herramientas, EPPs, insumos de emergencia, maquinaria) a la encargada;
-- ella carga una SOLICITUD con responsable, razón, fecha deseada y, opcional,
-- un mínimo urgente con su fecha. La solicitud va a Requisiciones para que un
-- revisor (admin) la ACEPTE (total o parcial) o DENIEGUE con motivo; al
-- aceptarla se genera la Orden de Compra.
--
-- TAMBIÉN arregla bugs latentes que rompían la sincronización HOY:
--  · requisiciones.estado no incluía 'pendiente_aprobacion' (lo que la página
--    de Solicitud escribía) → esas requisiciones fallaban el push al server.
--  · requisicion_items no tenía descripcion/notas/precio_estimado (columnas que
--    el código ya escribía) → PostgREST rechazaba esos inserts.
-- ═══════════════════════════════════════════════════════════════════

-- ── requisiciones: nuevos campos del pedido + revisión ──
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS responsable_id uuid;          -- personal que requiere
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS responsable_nombre text;      -- denormalizado (offline/display)
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS razon text;                   -- razón del requerimiento (la técnica decide)
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS fecha_urgente date;           -- fecha del mínimo urgente (opcional)
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS revisor_id uuid;
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS revisor_nombre text;
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS revisado_at timestamptz;
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS motivo_revision text;         -- motivo de aceptar/denegar (obligatorio en ambos)
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS observaciones_parcial text;   -- detalle de aceptación parcial
ALTER TABLE requisiciones ADD COLUMN IF NOT EXISTS veces_editada integer NOT NULL DEFAULT 0;  -- límite de edición del solicitante (máx 1)

-- ── estado: agregar los estados del flujo nuevo (y 'pendiente_aprobacion'
-- que el código ya usaba y violaba el CHECK) ──
ALTER TABLE requisiciones DROP CONSTRAINT IF EXISTS requisiciones_estado_check;
ALTER TABLE requisiciones ADD CONSTRAINT requisiciones_estado_check CHECK (estado = ANY (ARRAY[
  'borrador','solicitada','cotizando','pendiente','pendiente_aprobacion',
  'aprobada','aprobada_parcial','rechazada','ordenada',
  'recibida_parcial','recibida','cancelada'
]));

-- ── requisicion_items: tipo de insumo + campos que el código ya escribía + revisión parcial ──
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS tipo_insumo text NOT NULL DEFAULT 'material';
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS insumo_id uuid;              -- ref genérica al insumo real (cualquiera de las 5 tablas)
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS insumo_pendiente_id uuid;    -- ref al catálogo pendiente si no existe en el real
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS nombre text;                 -- nombre del insumo (real o libre)
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS descripcion text;            -- usado hoy por solicitud-residente
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS notas text;                  -- idem
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS precio_estimado numeric;     -- idem
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS cantidad_minima numeric;     -- mínimo urgente (opcional)
ALTER TABLE requisicion_items ADD COLUMN IF NOT EXISTS cantidad_aprobada numeric;   -- cantidad que el revisor aprueba (parcial)

ALTER TABLE requisicion_items DROP CONSTRAINT IF EXISTS requisicion_items_tipo_insumo_check;
ALTER TABLE requisicion_items ADD CONSTRAINT requisicion_items_tipo_insumo_check CHECK (tipo_insumo = ANY (ARRAY[
  'material','herramienta','epp','emergencia','maquinaria'
]));

-- ── insumos_pendientes: catálogo SEPARADO de nombres de insumo solicitados que
-- NO existen en las tablas reales de la obra. Evita ensuciar materiales/
-- herramientas/epps/... con nombres que quizá nunca se usen; sirve como fuente
-- de RECOMENDACIONES de nombres (aprendizaje). Se "promueve" a la tabla real
-- recién cuando la compra se recibe (Vinculación de Compras). ──
CREATE TABLE IF NOT EXISTS insumos_pendientes (
  id uuid PRIMARY KEY,
  obra_id uuid REFERENCES obras(id),
  tipo_insumo text NOT NULL DEFAULT 'material',
  nombre text NOT NULL,
  nombre_norm text,                    -- normalizado (para dedup): minúsculas sin acentos
  unidad text,
  categoria text,
  veces_solicitado integer NOT NULL DEFAULT 1,
  promovido_a_id uuid,                 -- id del insumo real cuando se promueve (o null)
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_insumos_pend_obra ON insumos_pendientes (obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_insumos_pend_norm ON insumos_pendientes (tipo_insumo, nombre_norm) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_insumos_pendientes_updated ON insumos_pendientes;
CREATE TRIGGER trg_insumos_pendientes_updated BEFORE UPDATE ON insumos_pendientes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE insumos_pendientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "insumos_pend: autenticado lee" ON insumos_pendientes;
CREATE POLICY "insumos_pend: autenticado lee" ON insumos_pendientes
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "insumos_pend: autenticado inserta" ON insumos_pendientes;
CREATE POLICY "insumos_pend: autenticado inserta" ON insumos_pendientes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "insumos_pend: autenticado actualiza" ON insumos_pendientes;
CREATE POLICY "insumos_pend: autenticado actualiza" ON insumos_pendientes
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "insumos_pend: admin borra" ON insumos_pendientes;
CREATE POLICY "insumos_pend: admin borra" ON insumos_pendientes
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
