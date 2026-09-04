-- ═══════════════════════════════════════════════════════════════════
-- 180 — REGISTRO DE ACTIVOS FIJOS (Formato SUNAT 7.1) — tanda 5.
--
-- Pedido de las contadoras, con el modelo en la mano
-- (Modelos/6.1.- REGISTRO ACTIVOS_VALIDO.xls): el «FORMATO 7.1: REGISTRO DE
-- ACTIVOS FIJOS — DETALLE DE LOS ACTIVOS FIJOS», que hoy llevan en un Excel
-- suelto, ejercicio por ejercicio, a mano.
--
-- POR QUÉ NO ALCANZA CON `activos_pesados`, que ya existe:
-- son dos registros distintos con el mismo nombre coloquial.
--
--   `activos_pesados` (2 filas) es OPERATIVO y de OBRA: horómetro, combustible,
--   mantenimiento, operador, en qué obra está. Sus dos filas —un generador y un
--   martillo demoledor— no tienen ni costo de adquisición ni fecha: nadie las
--   cargó para contabilidad, y está bien, porque no es para eso.
--
--   Éste es CONTABLE y de EMPRESA: cuenta del PCGE (33411, 33611…), valor
--   histórico, tasa, meses de uso, depreciación del ejercicio y valor en
--   libros. Es lo que se le presenta a SUNAT y lo que alimenta el balance.
--
-- El puente entre los dos es `activo_pesado_id`: una excavadora puede estar en
-- los dos registros y la app no debe pedir que se cargue dos veces. Pero la
-- excavadora ALQUILADA está solo en el operativo (no es un activo de la
-- empresa) y la laptop de la oficina está solo en el contable (no tiene
-- horómetro). Fusionarlos habría roto los dos.
--
-- MEDIDO ANTES DE DECIDIR: no hay un solo movimiento contable cargado que sea
-- la compra de un activo fijo (0 filas con cuenta 33x; el único `cuenta_pcge`
-- usado es un '65'). El registro NO se puede derivar de lo que ya está en la
-- base: nace del Excel que las contadoras ya llevan. Por eso la pantalla tiene
-- que dejar cargarlos a mano y ese es su camino principal.
--
-- LO QUE NO SE GUARDA, A PROPÓSITO: valor histórico, valor ajustado,
-- depreciación del ejercicio, acumulada y valor en libros son TODOS derivados.
-- Se calculan al leer (src/lib/activos-fijos.js, con tests) — misma regla que
-- el stock, que sale de los movimientos, y que el margen de un trabajo. Un
-- total guardado que no coincide con sus partes es la clase de error que
-- después nadie sabe cuál de los dos números creer.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS activos_fijos (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- De quién es y de qué ejercicio. El formato 7.1 se presenta POR EMPRESA y
  -- POR PERÍODO: el mismo bien tiene una fila por año, con la depreciación
  -- acumulada del anterior como punto de partida.
  company_id               UUID NOT NULL REFERENCES companies(id),
  periodo                  INTEGER NOT NULL,

  -- Columnas 1-3 del formato
  codigo_relacionado       TEXT,                    -- «1», «2» — el código interno del bien
  cuenta_contable          TEXT NOT NULL,           -- 33411, 33412, 33611, 33691…
  descripcion              TEXT NOT NULL,
  marca                    TEXT,
  modelo                   TEXT,
  serie_placa              TEXT,

  -- Columnas de VALOR (el histórico y el ajustado se calculan con éstas)
  saldo_inicial            NUMERIC(16,2) NOT NULL DEFAULT 0,
  adquisiciones            NUMERIC(16,2) NOT NULL DEFAULT 0,
  mejoras                  NUMERIC(16,2) NOT NULL DEFAULT 0,
  retiros                  NUMERIC(16,2) NOT NULL DEFAULT 0,   -- retiros y/o bajas
  otros_ajustes            NUMERIC(16,2) NOT NULL DEFAULT 0,
  ajuste_inflacion         NUMERIC(16,2) NOT NULL DEFAULT 0,

  -- Fechas y método
  fecha_adquisicion        DATE,
  fecha_inicio_uso         DATE,
  metodo_depreciacion      TEXT NOT NULL DEFAULT 'linea_recta',
  doc_autorizacion         TEXT,                    -- N° de documento de autorización

  -- Depreciación
  porcentaje_depreciacion  NUMERIC(6,2) NOT NULL DEFAULT 0,
  meses_uso                INTEGER NOT NULL DEFAULT 12,
  deprec_acum_anterior     NUMERIC(16,2) NOT NULL DEFAULT 0,
  deprec_retiros           NUMERIC(16,2) NOT NULL DEFAULT 0,
  deprec_otros_ajustes     NUMERIC(16,2) NOT NULL DEFAULT 0,
  ajuste_inflacion_deprec  NUMERIC(16,2) NOT NULL DEFAULT 0,

  estado                   TEXT NOT NULL DEFAULT 'activo',
  -- Los dos puentes: el registro operativo (horómetro, obra) y el comprobante
  -- de compra. Los dos opcionales — un activo puede venir del Excel viejo sin
  -- factura cargada, y un bien alquilado nunca entra acá.
  activo_pesado_id         UUID REFERENCES activos_pesados(id),
  accounting_movement_id   UUID REFERENCES accounting_movements(id),
  obra_id                  UUID REFERENCES obras(id),
  notas                    TEXT,

  -- estándar
  version                  INTEGER DEFAULT 1 NOT NULL,
  created_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at               TIMESTAMPTZ DEFAULT now() NOT NULL,
  deleted_at               TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id),
  updated_by               UUID REFERENCES auth.users(id),
  idempotency_key          TEXT UNIQUE,
  last_synced_at           TIMESTAMPTZ
);

ALTER TABLE activos_fijos DROP CONSTRAINT IF EXISTS activos_fijos_estado_check;
ALTER TABLE activos_fijos ADD CONSTRAINT activos_fijos_estado_check
  CHECK (estado = ANY (ARRAY['activo','retirado','vendido','totalmente_depreciado']));

ALTER TABLE activos_fijos DROP CONSTRAINT IF EXISTS activos_fijos_metodo_check;
ALTER TABLE activos_fijos ADD CONSTRAINT activos_fijos_metodo_check
  CHECK (metodo_depreciacion = ANY (ARRAY['linea_recta','unidades_produccion','otro']));

-- Un porcentaje fuera de rango no es un dato raro: es un error de tipeo que
-- desbalancea el balance. 0 es válido (terrenos no se deprecian).
ALTER TABLE activos_fijos DROP CONSTRAINT IF EXISTS activos_fijos_pct_check;
ALTER TABLE activos_fijos ADD CONSTRAINT activos_fijos_pct_check
  CHECK (porcentaje_depreciacion >= 0 AND porcentaje_depreciacion <= 100);

ALTER TABLE activos_fijos DROP CONSTRAINT IF EXISTS activos_fijos_meses_check;
ALTER TABLE activos_fijos ADD CONSTRAINT activos_fijos_meses_check
  CHECK (meses_uso >= 0 AND meses_uso <= 12);

CREATE INDEX IF NOT EXISTS idx_af_company  ON activos_fijos(company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_af_periodo  ON activos_fijos(company_id, periodo) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_af_cuenta   ON activos_fijos(cuenta_contable) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_af_pesado   ON activos_fijos(activo_pesado_id) WHERE deleted_at IS NULL;

-- ── RLS ────────────────────────────────────────────────────────────
-- El activo fijo es de la EMPRESA, no de una obra: por eso NO lleva el cerco
-- de obra de la mig 177 (su `obra_id` es informativo — dónde está trabajando
-- el bien — y la mayoría de los activos no tiene ninguna).
-- El cerco de MÓDULO de la mig 178 sí aplica: la depreciación es contabilidad
-- y los roles de campo no tienen nada que hacer acá.
ALTER TABLE activos_fijos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activos_fijos: ve" ON activos_fijos;
DROP POLICY IF EXISTS "activos_fijos: crea" ON activos_fijos;
DROP POLICY IF EXISTS "activos_fijos: actualiza" ON activos_fijos;
DROP POLICY IF EXISTS "activos_fijos: elimina" ON activos_fijos;

CREATE POLICY "activos_fijos: ve"        ON activos_fijos FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "activos_fijos: crea"      ON activos_fijos FOR INSERT WITH CHECK ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "activos_fijos: actualiza" ON activos_fijos FOR UPDATE USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "activos_fijos: elimina"   ON activos_fijos FOR DELETE USING (is_admin());

-- Cerco de módulo — MISMA mecánica y MISMO nombre de policy que la mig 178,
-- para que el revert masivo de aquélla también limpie ésta. La depreciación es
-- contabilidad: los roles de campo y de especialidad no tienen nada que hacer
-- acá, igual que ya pasa con `accounting_movements` y `activos_pesados`.
-- COALESCE(..., true): un perfil a medio crear (rol NULL) no queda con la
-- pantalla vacía sin explicación — mismo criterio que la 178.
DROP POLICY IF EXISTS modulo_cerco_select ON activos_fijos;
CREATE POLICY modulo_cerco_select ON activos_fijos
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_user_rol()) <> ALL
    (ARRAY['ing_ambiental','ing_calidad','ing_social','ingeniero','prevencionista','campo']::text[]), true));

DROP TRIGGER IF EXISTS trg_activos_fijos_updated_at ON activos_fijos;
CREATE TRIGGER trg_activos_fijos_updated_at BEFORE UPDATE ON activos_fijos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

NOTIFY pgrst, 'reload schema';
