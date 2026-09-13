-- ═══════════════════════════════════════════════════════════════════
-- 207 — ANTICIPOS A PROVEEDORES: A QUÉ FACTURA SE APLICA CADA UNO
--
-- ── EL PEDIDO (Gabriel, 13-set-2026) ──────────────────────────────
-- «En el inventario de las empresas (en este caso de GASOMI) puede ocurrir que
-- tenemos anticipos. Estos hay que ubicarlos y vincularlos con la factura que
-- anticipan su pago. Este caso pasa con KOPLAST. […] No olvides que los
-- anticipos deberían identificarse.»
--
-- ── EL CASO REAL, MEDIDO CONTRA PRODUCCIÓN EL 13-SET ──────────────
-- KOPLAST INDUSTRIAL S.A.C (RUC 20505543174) contra GASOMI:
--   · US$ 150.000 (S/ 524.250) de anticipo en DOS facturas del 31-mar-2026,
--     con un solo ítem cada una: «ANTICIPO DE CLIENTE» (F003-3384 por 80.000 y
--     F003-3385 por 70.000).
--   · US$ 54.874,04 consumidos por cuatro notas de crédito del 6-may que
--     anulan cuatro facturas completas (FC03-187/188/189/190).
--   · 19 facturas más de KOPLAST con TOTAL 0 — las entregas ya cubiertas por
--     el anticipo, que es lo que Gabriel vio: «ellos facturan a 0 pero sale
--     allí que se disminuye el anticipo para que al final la factura tenga
--     insumos comprados pero al precio final de 0».
--   · De los 35 comprobantes que SUNAT tiene de este proveedor, JARVEX tiene
--     13. Faltan 22, y 19 de ellos son justamente los de total 0.
--
-- El mecanismo NO es una jugada: facturar el anticipo con IGV y después
-- descontarlo en las entregas es la forma estándar en el Perú, y el crédito
-- fiscal ya se tomó en marzo. El riesgo es otro y es de datos: se pagaron
-- US$ 150.000 por adelantado y sin estas filas nadie puede decir cuánta
-- mercadería llegó contra ese anticipo ni cuánto saldo queda a favor.
--
-- ── POR QUÉ UNA TABLA Y NO UN CAMPO ───────────────────────────────
-- Un anticipo se consume en VARIAS entregas y una entrega puede consumir más
-- de un anticipo (KOPLAST tiene dos). Es muchos-a-muchos con un monto por
-- vínculo; un `anticipo_id` en el movimiento no podría expresarlo y obligaría
-- a inventar filas.
--
-- ── POR QUÉ LA APLICACIÓN NO SE DERIVA SOLA ───────────────────────
-- Porque el comprobante no dice a qué anticipo pertenece. Una factura en cero
-- de KOPLAST no referencia el F003-3384 en ningún campo legible por máquina:
-- lo dice el PDF, en una línea de descuento. La app PROPONE (mismo proveedor,
-- misma moneda, fecha posterior, y las que una nota de crédito anuló) y una
-- persona confirma. Igual que en todo el resto de la casa: se propone con el
-- motivo a la vista y se recuerda la respuesta.
--
-- ── SIN UNIQUE SOBRE (anticipo, factura), A PROPÓSITO ─────────────
-- Lo de siempre: dos PCs offline. El duplicado benigno se resuelve al leer
-- (`resolverAplicaciones()` en src/lib/anticipos.js): a igual par gana la más
-- reciente.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS anticipo_aplicaciones (
  id uuid PRIMARY KEY,

  -- El movimiento que ES el anticipo (la factura «ANTICIPO DE CLIENTE»).
  anticipo_movimiento_id uuid NOT NULL REFERENCES accounting_movements(id),
  -- El movimiento al que se le aplica (la entrega, que suele venir en cero, o
  -- la factura que una nota de crédito anuló).
  factura_movimiento_id uuid NOT NULL REFERENCES accounting_movements(id),

  -- De qué empresa es el par. Redundante contra los movimientos a propósito:
  -- la pantalla lista «los anticipos de esta empresa» sin tener que resolver
  -- dos joins para filtrar.
  company_id uuid REFERENCES companies(id),

  -- Cuánto del anticipo consume ESTA factura, en la moneda del anticipo. El
  -- saldo del anticipo es su monto menos la suma de esto.
  monto numeric NOT NULL DEFAULT 0,
  moneda text NOT NULL DEFAULT 'PEN',

  -- 'propuesta' = lo dedujo la app y nadie lo confirmó todavía; 'manual' = lo
  -- dijo una persona. 'manual' PISA a 'propuesta' y nunca al revés.
  fuente text NOT NULL DEFAULT 'manual' CHECK (fuente IN ('propuesta','manual')),
  -- Por qué se propuso: se muestra en pantalla para que quien confirma entienda.
  motivo text,
  nota text,

  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  last_synced_at timestamptz,
  deleted_at timestamptz,
  idempotency_key text UNIQUE,

  -- Un anticipo no se aplica a sí mismo.
  CONSTRAINT anticipo_aplicaciones_distintos CHECK (anticipo_movimiento_id <> factura_movimiento_id)
);

COMMENT ON TABLE anticipo_aplicaciones IS
  'A que factura se aplica cada anticipo a proveedores, y por cuanto. Tanda 19. El saldo del anticipo es su monto menos la suma de sus aplicaciones.';
COMMENT ON COLUMN anticipo_aplicaciones.monto IS
  'Cuanto del anticipo consume esta factura, en la MONEDA DEL ANTICIPO (KOPLAST factura en dolares).';

CREATE INDEX IF NOT EXISTS idx_anticipo_aplicaciones_anticipo
  ON anticipo_aplicaciones (anticipo_movimiento_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_anticipo_aplicaciones_factura
  ON anticipo_aplicaciones (factura_movimiento_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_anticipo_aplicaciones_empresa
  ON anticipo_aplicaciones (company_id) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_anticipo_aplicaciones_updated ON anticipo_aplicaciones;
CREATE TRIGGER trg_anticipo_aplicaciones_updated
  BEFORE UPDATE ON anticipo_aplicaciones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE anticipo_aplicaciones ENABLE ROW LEVEL SECURITY;

-- Acá SÍ hay plata —un anticipo mal aplicado esconde un saldo a favor de
-- cientos de miles—, así que el gate es el de las tablas contables: leen
-- todos los autenticados (el reporte lo mira gerencia), escriben los roles
-- contables, y el DELETE físico solo admin.
DROP POLICY IF EXISTS "anticipo_aplicaciones: autenticado lee" ON anticipo_aplicaciones;
CREATE POLICY "anticipo_aplicaciones: autenticado lee" ON anticipo_aplicaciones
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "anticipo_aplicaciones: contabilidad inserta" ON anticipo_aplicaciones;
CREATE POLICY "anticipo_aplicaciones: contabilidad inserta" ON anticipo_aplicaciones
  FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "anticipo_aplicaciones: contabilidad actualiza" ON anticipo_aplicaciones;
CREATE POLICY "anticipo_aplicaciones: contabilidad actualiza" ON anticipo_aplicaciones
  FOR UPDATE TO authenticated
  USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "anticipo_aplicaciones: admin borra" ON anticipo_aplicaciones;
CREATE POLICY "anticipo_aplicaciones: admin borra" ON anticipo_aplicaciones
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));
