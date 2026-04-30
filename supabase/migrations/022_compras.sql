-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 022 — Módulo Compras (Logística)                       ║
-- ║                                                                    ║
-- ║  Flujo: Requisición → Cotizaciones → Cuadro Comparativo →         ║
-- ║         Orden de Compra → Recepción                               ║
-- ║                                                                    ║
-- ║  Tablas:                                                           ║
-- ║   - requisiciones (solicitud de compra desde obra)                ║
-- ║   - requisicion_items (materiales solicitados)                    ║
-- ║   - cotizaciones (respuesta de proveedores)                       ║
-- ║   - cotizacion_items (precios por item cotizado)                  ║
-- ║   - ordenes_compra (PO al proveedor elegido)                      ║
-- ║   - oc_items (items de la OC)                                     ║
-- ║   - recepciones (registro al recibir mercadería)                  ║
-- ║   - recepcion_items (cantidades recibidas vs OC)                  ║
-- ╚════════════════════════════════════════════════════════════════════╝

-- ── REQUISICIONES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS requisiciones (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  codigo          TEXT,                              -- ej: REQ-2026-001
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_requerida DATE,                              -- cuándo lo necesitan en obra
  solicitante_id  UUID REFERENCES profiles(id),
  partida_id      UUID REFERENCES partidas(id),      -- opcional, para qué partida
  prioridad       TEXT CHECK (prioridad IN ('baja','normal','alta','urgente')) DEFAULT 'normal',
  estado          TEXT CHECK (estado IN (
                    'borrador','solicitada','cotizando','aprobada',
                    'ordenada','recibida_parcial','recibida','cancelada'
                  )) DEFAULT 'borrador',
  notas           TEXT,
  motivo_rechazo  TEXT,
  -- estándar
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  created_by      UUID REFERENCES auth.users(id),
  updated_by      UUID REFERENCES auth.users(id),
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_req_obra   ON requisiciones(obra_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_req_estado ON requisiciones(estado)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_req_fecha  ON requisiciones(fecha DESC);

CREATE TABLE IF NOT EXISTS requisicion_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requisicion_id  UUID NOT NULL REFERENCES requisiciones(id) ON DELETE CASCADE,
  material_id     UUID REFERENCES materiales(id),    -- null si es material nuevo no registrado
  nombre_libre    TEXT,                              -- cuando no está en BD
  unidad          TEXT,
  cantidad        NUMERIC(14,4) NOT NULL,
  observacion     TEXT,
  -- estándar
  version         INTEGER DEFAULT 1 NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at      TIMESTAMPTZ,
  idempotency_key TEXT UNIQUE,
  last_synced_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_req_items_req ON requisicion_items(requisicion_id) WHERE deleted_at IS NULL;

-- ── COTIZACIONES ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cotizaciones (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requisicion_id   UUID NOT NULL REFERENCES requisiciones(id) ON DELETE CASCADE,
  proveedor_id     UUID REFERENCES proveedores(id),
  proveedor_nombre TEXT,                             -- snapshot
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  validez_dias     INTEGER DEFAULT 7,
  monto_total      NUMERIC(14,2) DEFAULT 0,
  moneda           TEXT DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
  condicion_pago   TEXT,                             -- contado, 30 días, etc.
  plazo_entrega_dias INTEGER,
  estado           TEXT CHECK (estado IN (
                     'recibida','seleccionada','rechazada','vencida'
                   )) DEFAULT 'recibida',
  notas            TEXT,
  archivo_url      TEXT,
  -- estándar
  version          INTEGER DEFAULT 1 NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at       TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  idempotency_key  TEXT UNIQUE,
  last_synced_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cot_req ON cotizaciones(requisicion_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cot_prov ON cotizaciones(proveedor_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS cotizacion_items (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  cotizacion_id        UUID NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  requisicion_item_id  UUID REFERENCES requisicion_items(id),
  material_id          UUID REFERENCES materiales(id),
  nombre_libre         TEXT,
  unidad               TEXT,
  cantidad             NUMERIC(14,4),
  precio_unitario      NUMERIC(14,4) NOT NULL,
  subtotal             NUMERIC(14,2),
  observacion          TEXT,
  version              INTEGER DEFAULT 1 NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at           TIMESTAMPTZ,
  idempotency_key      TEXT UNIQUE,
  last_synced_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_cot_items_cot ON cotizacion_items(cotizacion_id) WHERE deleted_at IS NULL;

-- ── ÓRDENES DE COMPRA ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ordenes_compra (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  codigo               TEXT,                          -- OC-2026-001
  obra_id              UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  proveedor_id         UUID NOT NULL REFERENCES proveedores(id),
  cotizacion_id        UUID REFERENCES cotizaciones(id),
  requisicion_id       UUID REFERENCES requisiciones(id),
  fecha                DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_entrega        DATE,
  monto_subtotal       NUMERIC(14,2) DEFAULT 0,
  monto_igv            NUMERIC(14,2) DEFAULT 0,
  monto_total          NUMERIC(14,2) NOT NULL,
  moneda               TEXT DEFAULT 'PEN' CHECK (moneda IN ('PEN','USD')),
  condicion_pago       TEXT,
  estado               TEXT CHECK (estado IN (
                         'borrador','enviada','aceptada',
                         'recibida_parcial','recibida','cancelada'
                       )) DEFAULT 'borrador',
  observaciones        TEXT,
  -- estándar
  version              INTEGER DEFAULT 1 NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at           TIMESTAMPTZ,
  created_by           UUID REFERENCES auth.users(id),
  updated_by           UUID REFERENCES auth.users(id),
  idempotency_key      TEXT UNIQUE,
  last_synced_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oc_obra   ON ordenes_compra(obra_id)   WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oc_prov   ON ordenes_compra(proveedor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oc_estado ON ordenes_compra(estado)   WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS oc_items (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  orden_compra_id      UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  material_id          UUID REFERENCES materiales(id),
  nombre_libre         TEXT,
  unidad               TEXT,
  cantidad             NUMERIC(14,4) NOT NULL,
  cantidad_recibida    NUMERIC(14,4) DEFAULT 0,
  precio_unitario      NUMERIC(14,4) NOT NULL,
  subtotal             NUMERIC(14,2),
  version              INTEGER DEFAULT 1 NOT NULL,
  created_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at           TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at           TIMESTAMPTZ,
  idempotency_key      TEXT UNIQUE,
  last_synced_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oc_items_oc ON oc_items(orden_compra_id) WHERE deleted_at IS NULL;

-- ── RECEPCIONES ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recepciones (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  orden_compra_id  UUID NOT NULL REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  obra_id          UUID NOT NULL REFERENCES obras(id),
  fecha            DATE NOT NULL DEFAULT CURRENT_DATE,
  guia_remision    TEXT,
  factura_numero   TEXT,
  recibido_por     UUID REFERENCES profiles(id),
  estado_recepcion TEXT CHECK (estado_recepcion IN ('completa','parcial','rechazada')) DEFAULT 'completa',
  observaciones    TEXT,
  archivo_guia_url TEXT,
  version          INTEGER DEFAULT 1 NOT NULL,
  created_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at       TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at       TIMESTAMPTZ,
  created_by       UUID REFERENCES auth.users(id),
  updated_by       UUID REFERENCES auth.users(id),
  idempotency_key  TEXT UNIQUE,
  last_synced_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rec_oc ON recepciones(orden_compra_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS recepcion_items (
  id                  UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recepcion_id        UUID NOT NULL REFERENCES recepciones(id) ON DELETE CASCADE,
  oc_item_id          UUID REFERENCES oc_items(id),
  cantidad_recibida   NUMERIC(14,4) NOT NULL,
  observaciones       TEXT,
  version             INTEGER DEFAULT 1 NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at          TIMESTAMPTZ,
  idempotency_key     TEXT UNIQUE,
  last_synced_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rec_items_rec ON recepcion_items(recepcion_id) WHERE deleted_at IS NULL;

-- ── RLS + Triggers (todo igual de relajado a "autenticado") ──────────
DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'requisiciones','requisicion_items','cotizaciones','cotizacion_items',
    'ordenes_compra','oc_items','recepciones','recepcion_items'
  ])
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: ve" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: crea" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: actualiza" ON %I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%I: elimina" ON %I', t, t);
    EXECUTE format('CREATE POLICY "%I: ve"        ON %I FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "%I: crea"      ON %I FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "%I: actualiza" ON %I FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL)', t, t);
    EXECUTE format('CREATE POLICY "%I: elimina"   ON %I FOR DELETE USING (is_admin())', t, t);
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_updated_at ON %I', t, t);
    EXECUTE format('CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at()', t, t);
  END LOOP;
END $$;
