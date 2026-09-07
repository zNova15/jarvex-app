-- ═══════════════════════════════════════════════════════════════════
-- 187 — CADA EMPRESA CON SU SERIE Y SU DISEÑO. Tanda 9.
--
-- EL PEDIDO (Gabriel, 7-set-2026):
--   «El correlativo quiero que me recomiendes cómo debería ser, pues puede
--    suceder que la empresa que emitirá la factura ya tenga otra factura que
--    emitió» … «me hablas sobre el diseño para las facturas, quisiera que se
--    pueda personalizar y pueda incluso ser distinto para cada empresa del
--    grupo».
--
-- ── LA SERIE ES DE LA EMPRESA, EL CORRELATIVO ES DERIVADO ─────────
-- La SERIE la asigna SUNAT y no cambia: F001 para las facturas de JARVEX, otra
-- para GASOMI. Va acá, escrita una vez.
--
-- El CORRELATIVO **no se guarda**. Se calcula mirando lo que esa empresa ya
-- emitió en esa serie (`src/lib/serie-comprobante.js`), igual que el correlativo
-- de las órdenes. Un contador guardado en una columna se desincroniza el día que
-- alguien carga a mano una factura vieja, o que dos dispositivos offline emiten
-- a la vez — y un correlativo repetido es un rechazo de SUNAT que después hay
-- que anular con nota. Derivarlo no puede desincronizarse: si el comprobante
-- existe, el número está tomado.
--
-- ── EL DISEÑO, LO MÍNIMO QUE CAMBIA ALGO ──────────────────────────
-- `companies` ya tiene `logo_dataurl`, `nombre_corto` y `codigo_doc_prefix`: la
-- personalización por empresa ya existía a medias. Se suman las dos cosas que
-- de verdad cambian cómo se ve un documento sin inventar un maquetador:
--
--   doc_color — el acento (la banda del encabezado y los títulos de tabla).
--               Hex `#RRGGBB`. NULL = el dorado JARVEX de siempre.
--   doc_pie   — el pie de página: dirección, teléfono, «Gracias por su
--               preferencia», lo que cada empresa quiera. NULL = el pie actual.
--
-- Deliberadamente NO se agrega una plantilla libre. Un documento contable tiene
-- bloques obligatorios (RUC, numeración, desglose de IGV, firmas) y dejar
-- moverlos termina en un papel que SUNAT no acepta. Lo que se personaliza es la
-- marca, no la estructura.
--
-- Todo NULLABLE y aditivo: una empresa que no configure nada se ve igual que hoy.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS serie_factura text,
  ADD COLUMN IF NOT EXISTS serie_boleta text,
  ADD COLUMN IF NOT EXISTS doc_color text,
  ADD COLUMN IF NOT EXISTS doc_pie text;

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_serie_factura_check;
ALTER TABLE companies ADD CONSTRAINT companies_serie_factura_check
  CHECK (serie_factura IS NULL OR serie_factura ~ '^[A-Z][A-Z0-9]{3}$');

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_serie_boleta_check;
ALTER TABLE companies ADD CONSTRAINT companies_serie_boleta_check
  CHECK (serie_boleta IS NULL OR serie_boleta ~ '^[A-Z][A-Z0-9]{3}$');

ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_doc_color_check;
ALTER TABLE companies ADD CONSTRAINT companies_doc_color_check
  CHECK (doc_color IS NULL OR doc_color ~ '^#[0-9A-Fa-f]{6}$');

COMMENT ON COLUMN companies.serie_factura IS
  'Serie SUNAT de las facturas de esta empresa (F001). La asigna SUNAT y no cambia. El correlativo NO se guarda: se deriva de lo ya emitido (src/lib/serie-comprobante.js).';
COMMENT ON COLUMN companies.doc_color IS
  'Acento de sus documentos en #RRGGBB. NULL = el dorado JARVEX. Se personaliza la marca, no la estructura: un documento contable tiene bloques obligatorios.';

NOTIFY pgrst, 'reload schema';
