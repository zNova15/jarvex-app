-- ═══════════════════════════════════════════════════════════════════
-- 196 — SUNAT CONTRA JARVEX, Y EL ESCÁNER — tanda 14, entregas 5 y 6.
--
-- QUÉ GUARDAN ESTAS DOS TABLAS
-- `sunat_cortes`      → el RESUMEN de un cotejo: empresa, periodo, libro, y en
--                       cuánto quedó la brecha. Un renglón por mes cotejado.
-- `cotejo_decisiones` → «esta diferencia ya la miré» / «esta no aplica». Una
--                       decisión por LLAVE, no por fila de archivo.
--
-- ── POR QUÉ NO SE GUARDAN LAS FILAS DEL COTEJO ────────────────────
-- Porque son DERIVADAS y caras: el corte de julio de JARVEX son 40 filas, pero
-- el de EL INCA en un mes cargado son cientos, y todas se vuelven a calcular en
-- un instante con el CSV y los movimientos que ya están sincronizados. Lo que
-- NO se puede recalcular es el juicio de una persona («la comisión del banco no
-- aplica») y el estado en que quedó el mes. Eso es lo que se guarda.
--
-- Guardar las filas, además, obligaría a decidir qué pasa cuando alguien carga
-- de nuevo el CSV del mismo mes con datos distintos —SUNAT actualiza la
-- propuesta del RCE— y ahí siempre gana el archivo nuevo. El resumen se
-- REEMPLAZA (una fila viva por empresa+periodo+libro); las decisiones no se
-- tocan, porque son de la persona, no del archivo.
--
-- ── LA LLAVE DE UNA DECISIÓN ──────────────────────────────────────
-- Para la COMPARATIVA es `tipo|serie|número|RUC` — la misma que cruza, la que
-- lleva el TIPO de comprobante adentro porque en el archivo de ventas de julio
-- conviven `01 E001-1` (la factura de S/ 12.920 a EL INCA) y `07 E001-1` (la
-- nota que la anula). Sin el tipo, marcar una marcaría la otra.
-- Para el ESCÁNER es `regla:movimiento_id` — derivada, no aleatoria, así el
-- mismo hallazgo tiene la misma llave en las dos PCs de Gabriel y lo que decide
-- en una vale en la otra.
--
-- 🔴 En los dos casos la llave es ESTABLE ENTRE MESES. El CSV de agosto es otro
-- archivo con otras filas, pero la comisión de INTERBANK que él marcó «no
-- aplica» en julio es la misma comisión. Sin esto, la pantalla repetiría todos
-- los meses lo que ya contestó — que es exactamente el error que se pagó caro
-- en la bandeja de categorización (mig 195) y en el mapeo (mig 183).
--
-- ── SIN UNIQUE, A PROPÓSITO ───────────────────────────────────────
-- Lo mismo que migs 113/154/183/192/193/195: Gabriel alterna dos PCs y la app
-- es offline-first. Dos devices decidiendo la misma diferencia generarían un
-- 23505 que el SyncEngine mandaría a conflictos manuales por un caso benigno.
-- Se resuelve al LEER (`aplicarDecisiones()` en src/lib/comparativa-sunat.js):
-- a igual llave gana la más reciente.
--
-- ── LO MEDIDO ANTES DE ESCRIBIR (8-set-2026, JARVEX periodo 202607) ─
-- COMPRAS: SUNAT 35 · JARVEX 30. 29 cruzan exacto. 1 con la serie mal (CHIFA
--   MONTEORO es FA01-5101 y está cargada F001-5101). 5 faltan de verdad, por
--   S/ 17.254,60: FRONTIER F001-170359 (S/ 16.949,60), CGR F004-2866 (S/ 100),
--   PETRO LA MERCED F203-1570 (S/ 120) y dos comisiones de INTERBANK
--   FCC1-7964323/24 (S/ 85, no gravadas).
-- VENTAS: SUNAT 5 · JARVEX 4. Falta la nota de crédito 07 E001-1 de −S/ 12.920,
--   así que la app cuenta como ingreso vivo una factura anulada.
-- Y de yapa, para la entrega 6: E001-1 y E001-2 están marcadas intercompany y
--   CONSORCIO EL INCA no tiene el costo (los S/ 19.028,68 de la E001-2 son
--   reales y le faltan a la obra).
-- ═══════════════════════════════════════════════════════════════════

-- ── El corte: cómo quedó un mes ───────────────────────────────────
CREATE TABLE IF NOT EXISTS sunat_cortes (
  id uuid PRIMARY KEY,

  -- De quién y de cuándo. El propio CSV los trae (RUC en la columna 1, periodo
  -- en la 3), así que la pantalla no los pregunta: los verifica contra la
  -- empresa en la que está parada y avisa si no coinciden.
  company_id uuid NOT NULL REFERENCES companies(id),
  periodo text NOT NULL CHECK (periodo ~ '^\d{6}$'),
  libro text NOT NULL CHECK (libro IN ('compras','ventas')),

  -- El nombre del archivo que se cargó, para poder decir de dónde salió esto.
  archivo text,
  -- Cuántas filas traía el CSV y cuántas no se pudieron leer. Si `avisos` no es
  -- cero, el corte está INCOMPLETO y la pantalla tiene que decirlo: un total al
  -- que le falta una factura miente peor que un error a la vista.
  filas_archivo integer NOT NULL DEFAULT 0,
  avisos integer NOT NULL DEFAULT 0,

  -- El resumen completo tal como lo devuelve `resumirComparativa()`: conteos
  -- por estado, totales de SUNAT y de la app, y la brecha. Va en jsonb y no en
  -- veinte columnas porque los estados van a cambiar con el uso y no se va a
  -- migrar la tabla cada vez que aparezca uno nuevo.
  resumen jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Desnormalizados del resumen, SOLO estos tres, porque son con los que se
  -- ordena y se grafica el mes a mes y no se pueden pedir dentro del jsonb sin
  -- pagar un scan.
  total integer NOT NULL DEFAULT 0,
  cuadran integer NOT NULL DEFAULT 0,
  brecha numeric NOT NULL DEFAULT 0,

  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

COMMENT ON TABLE sunat_cortes IS
  'Resumen de un cotejo SUNAT ↔ JARVEX por empresa, periodo y libro. Tanda 14, entrega 5. Las filas del cotejo NO se guardan: se recalculan del CSV.';
COMMENT ON COLUMN sunat_cortes.avisos IS
  'Líneas del CSV que no se pudieron leer. Si es > 0 el corte está incompleto y la pantalla debe decirlo.';
COMMENT ON COLUMN sunat_cortes.brecha IS
  'Plata que falta (o sobra) registrar. Suma solo lo ausente de un lado y las diferencias de importe; NO suma lo que está cargado en otra empresa o con otra serie.';

CREATE INDEX IF NOT EXISTS idx_sunat_cortes_empresa
  ON sunat_cortes (company_id, periodo, libro) WHERE deleted_at IS NULL;

-- ── Las decisiones: lo que una persona ya contestó ────────────────
CREATE TABLE IF NOT EXISTS cotejo_decisiones (
  id uuid PRIMARY KEY,

  -- 'comparativa' = una diferencia contra SUNAT (entrega 5).
  -- 'escaner'     = una incoherencia interna (entrega 6).
  ambito text NOT NULL CHECK (ambito IN ('comparativa','escaner')),

  -- La llave estable descrita arriba. Es lo único que hace falta para volver a
  -- encontrar esto el mes que viene.
  llave text NOT NULL,

  -- 'revisada'  = la miré y ya está (se corrigió, o se va a corregir).
  -- 'no_aplica' = no es un error y no quiero que vuelva a salir nunca (la
  --               comisión del banco, un comprobante que la empresa no lleva).
  decision text NOT NULL CHECK (decision IN ('revisada','no_aplica')),
  nota text,

  -- Contexto congelado al decidir, para que la lista de lo decidido se pueda
  -- leer sin recalcular nada. Redundante a propósito, igual que la familia en
  -- `insumo_categoria` (mig 195): es la respuesta tal como se dio.
  company_id uuid REFERENCES companies(id),
  periodo text,
  libro text,
  estado text,
  documento text,
  monto numeric,

  demo boolean NOT NULL DEFAULT false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  idempotency_key text UNIQUE
);

COMMENT ON TABLE cotejo_decisiones IS
  '«Esta diferencia ya la miré» / «no aplica». Sirve a la comparativa SUNAT (entrega 5) y al escáner (entrega 6). Tanda 14.';
COMMENT ON COLUMN cotejo_decisiones.llave IS
  'Comparativa: tipo|serie|numero|RUC (con el TIPO adentro: 01 E001-1 y 07 E001-1 son distintos). Escáner: regla:movimiento_id. Estable entre meses y entre las dos PCs.';

-- Toda lectura pregunta lo mismo: «lo decidido en este ámbito, por llave».
CREATE INDEX IF NOT EXISTS idx_cotejo_decisiones_llave
  ON cotejo_decisiones (ambito, llave) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_cotejo_decisiones_empresa
  ON cotejo_decisiones (company_id, periodo) WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_sunat_cortes_updated ON sunat_cortes;
CREATE TRIGGER trg_sunat_cortes_updated
  BEFORE UPDATE ON sunat_cortes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_cotejo_decisiones_updated ON cotejo_decisiones;
CREATE TRIGGER trg_cotejo_decisiones_updated
  BEFORE UPDATE ON cotejo_decisiones
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE sunat_cortes ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotejo_decisiones ENABLE ROW LEVEL SECURITY;

-- 🔴 Criterio de RLS DISTINTO al del catálogo: acá SÍ hay plata.
-- El catálogo (migs 192-195) lo lee todo el mundo porque son nombres de
-- categorías. Un corte de SUNAT dice cuánto facturó y cuánto compró una
-- empresa: eso es contabilidad. Lee y escribe la gerencia y quien lleva los
-- libros; el resto de los roles no lo ve. Es el mismo criterio con el que ya
-- está protegido `accounting_movements`.
DROP POLICY IF EXISTS "sunat_cortes: contabilidad lee" ON sunat_cortes;
CREATE POLICY "sunat_cortes: contabilidad lee" ON sunat_cortes
  FOR SELECT TO authenticated
  USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "sunat_cortes: contabilidad inserta" ON sunat_cortes;
CREATE POLICY "sunat_cortes: contabilidad inserta" ON sunat_cortes
  FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "sunat_cortes: contabilidad actualiza" ON sunat_cortes;
CREATE POLICY "sunat_cortes: contabilidad actualiza" ON sunat_cortes
  FOR UPDATE TO authenticated
  USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "sunat_cortes: admin borra" ON sunat_cortes;
CREATE POLICY "sunat_cortes: admin borra" ON sunat_cortes
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

DROP POLICY IF EXISTS "cotejo_decisiones: contabilidad lee" ON cotejo_decisiones;
CREATE POLICY "cotejo_decisiones: contabilidad lee" ON cotejo_decisiones
  FOR SELECT TO authenticated
  USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "cotejo_decisiones: contabilidad inserta" ON cotejo_decisiones;
CREATE POLICY "cotejo_decisiones: contabilidad inserta" ON cotejo_decisiones
  FOR INSERT TO authenticated
  WITH CHECK (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "cotejo_decisiones: contabilidad actualiza" ON cotejo_decisiones;
CREATE POLICY "cotejo_decisiones: contabilidad actualiza" ON cotejo_decisiones
  FOR UPDATE TO authenticated
  USING (has_role(ARRAY['admin'::text,'gerente'::text,'contador'::text,'ayudante_contador'::text]));
DROP POLICY IF EXISTS "cotejo_decisiones: admin borra" ON cotejo_decisiones;
CREATE POLICY "cotejo_decisiones: admin borra" ON cotejo_decisiones
  FOR DELETE TO authenticated USING (has_role(ARRAY['admin'::text]));

NOTIFY pgrst, 'reload schema';
