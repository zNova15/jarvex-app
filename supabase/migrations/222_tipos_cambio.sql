-- ═══════════════════════════════════════════════════════════════════
-- 222 — EL TIPO DE CAMBIO, UNA VEZ POR FECHA (17-set-2026, tanda 7)
--
-- PEDIDO DE GABRIEL, textual: «para los comprobantes en dólares hay que darle
-- una pasada y colocarle el tipo de cambio que aceptó SUNAT el día de la
-- emisión. Y después la tasa SUNAT del día se consulta 1 sola vez por fecha:
-- si hay 6 facturas de las cuales 2 son del mismo día, en esa factura se
-- solicita el cambio de SUNAT para dicha fecha y luego para la segunda solo se
-- jala el dato que queda registrado».
--
-- ── LO MEDIDO (producción, 17-set-2026) ───────────────────────────
-- 42 comprobantes en USD sobre 23 FECHAS distintas, del 11-set-2024 al
-- 3-set-2026. O sea: 23 consultas, no 42. Y ninguno tiene tipo de cambio,
-- porque la columna no existía —`sunat-ple.js` leía `m.tipo_cambio` desde
-- siempre y siempre encontraba undefined, así que el Registro de Compras se
-- declaraba con la columna del tipo de cambio VACÍA en las 42.
--
-- ── EL DATO QUE HABÍA ERA PEOR QUE NINGUNO ────────────────────────
-- `src/lib/tipo-cambio.js` traía seis tasas escritas a mano en el código. Se
-- verificaron contra SUNAT el 17-set y están MAL: para el 12-set-2026 decía
-- compra 3,745 / venta 3,755 y la real es 3,363 / 3,371. Un 11 % de error, en
-- un archivo que se usa para convertir plata. Esta migración es lo que permite
-- borrarlas: sin un lugar donde guardar la tasa de verdad, borrarlas dejaba a
-- la app sin ninguna.
--
-- ── DOS COSAS, Y NO SON LA MISMA ──────────────────────────────────
-- 1. `tipos_cambio` — la tasa que SUNAT publicó para UNA FECHA. Es un dato
--    público, del país, no de la empresa: no tiene company_id, y la lee
--    cualquier rol (el inventario también convierte monedas). Una fila por
--    día, y se pide una sola vez en la vida: el que la pida primero la deja
--    guardada para la otra PC y para todos los meses que vengan.
-- 2. `accounting_movements.tipo_cambio` — la tasa CON LA QUE SE DECLARÓ ESE
--    comprobante. Se estampa en la pasada y queda congelada a propósito: si
--    mañana alguien corrige la tasa de una fecha, lo ya declarado no puede
--    cambiar solo. Es la misma disciplina de `cuenta_pcge` (mig 220): la app
--    deduce, la decisión se guarda.
--
-- ── SIN UNIQUE EN `fecha`, A PROPÓSITO ────────────────────────────
-- Igual que las migs 113/154/183/192/195/196: Gabriel alterna dos PCs y la app
-- es offline-first. Las dos pidiendo el 3-set generarían un 23505 que el
-- SyncEngine mandaría a conflictos manuales por un caso benigno —las dos filas
-- dirían lo MISMO, porque las dos salieron de SUNAT—. Se resuelve al leer: a
-- igual fecha gana la más reciente, y una cargada a mano le gana a la de la API
-- (`fuente`).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tipos_cambio (
  id uuid PRIMARY KEY,

  -- El día al que corresponde la tasa. NO es el día en que se consultó.
  fecha date NOT NULL,
  moneda text NOT NULL DEFAULT 'USD' CHECK (moneda IN ('USD','EUR')),

  -- Las dos puntas, como las publica SUNAT. Para una COMPRA en dólares el
  -- Registro usa la de VENTA (es la que se paga); la de compra se guarda igual
  -- porque las ventas usan esa y porque el dato viene junto.
  compra numeric(10,4),
  venta  numeric(10,4) NOT NULL CHECK (venta > 0),

  -- De dónde salió: 'sunat' (la API oficial, vía /api/sunat) o 'manual'
  -- (alguien la copió del portal de SUNAT porque la API no la tenía o no
  -- contestó). La manual le gana a la de la API al leer.
  fuente text NOT NULL DEFAULT 'sunat' CHECK (fuente IN ('sunat','manual')),
  nota text,

  created_by uuid REFERENCES profiles(id),
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text,
  last_synced_at timestamptz
);

-- La pregunta que hace la app siempre es «¿tengo la tasa de ESTE día?».
CREATE INDEX IF NOT EXISTS idx_tipos_cambio_fecha
  ON tipos_cambio (fecha, moneda) WHERE deleted_at IS NULL;

COMMENT ON TABLE tipos_cambio IS
  'Tipo de cambio publicado por SUNAT, una fila por fecha. Dato público del '
  'país, no de una empresa: por eso no tiene company_id y lo lee cualquier '
  'rol. Se consulta una sola vez por fecha y queda para las dos PCs.';
COMMENT ON COLUMN tipos_cambio.fuente IS
  'sunat = vino de la API oficial. manual = alguien la copió del portal porque '
  'la API no la tenía. La manual le gana a la de la API al leer.';

ALTER TABLE tipos_cambio ENABLE ROW LEVEL SECURITY;

-- 🔴 RLS DISTINTA a la de `sunat_cortes`, y a propósito: un corte de SUNAT
-- dice cuánto facturó una empresa —eso es contabilidad y va cercado—, pero el
-- tipo de cambio de un día es un dato público del Estado peruano. Lo LEE
-- cualquiera (el inventario convierte monedas y no es de contabilidad); lo
-- ESCRIBE quien lleva los libros.
DROP POLICY IF EXISTS "tipos_cambio: todos leen" ON tipos_cambio;
CREATE POLICY "tipos_cambio: todos leen" ON tipos_cambio
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "tipos_cambio: contabilidad inserta" ON tipos_cambio;
CREATE POLICY "tipos_cambio: contabilidad inserta" ON tipos_cambio
  FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));

DROP POLICY IF EXISTS "tipos_cambio: contabilidad actualiza" ON tipos_cambio;
CREATE POLICY "tipos_cambio: contabilidad actualiza" ON tipos_cambio
  FOR UPDATE TO authenticated
  USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));

DROP POLICY IF EXISTS "tipos_cambio: admin borra" ON tipos_cambio;
CREATE POLICY "tipos_cambio: admin borra" ON tipos_cambio
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

-- ── La tasa con la que se declaró CADA comprobante ────────────────
-- `sunat-ple.js` y el Registro de Compras ya leían este campo desde antes de
-- que existiera. Nace vacío: lo llena la pasada, y solo en lo que no es PEN.
ALTER TABLE public.accounting_movements
  ADD COLUMN IF NOT EXISTS tipo_cambio numeric(10,4);

COMMENT ON COLUMN public.accounting_movements.tipo_cambio IS
  'Tipo de cambio con el que se declara ESTE comprobante (la tasa SUNAT de su '
  'fecha de emisión). Queda congelado a propósito: corregir después la tasa de '
  'una fecha no puede mover lo que ya se declaró. NULL en soles.';

ALTER TABLE public.accounting_movements
  DROP CONSTRAINT IF EXISTS accounting_movements_tipo_cambio_positivo;
ALTER TABLE public.accounting_movements
  ADD CONSTRAINT accounting_movements_tipo_cambio_positivo
  CHECK (tipo_cambio IS NULL OR tipo_cambio > 0);
