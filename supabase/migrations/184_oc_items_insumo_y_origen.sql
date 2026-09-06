-- ═══════════════════════════════════════════════════════════════════
-- 184 — LA ORDEN QUE NACE ANTES DEL COMPROBANTE necesita dos datos más
--       en sus líneas. Tanda 7, entrega 6.
--
-- Hasta acá una orden solo podía nacer HACIA ATRÁS, desde una factura que ya
-- existía, y su única línea era un resumen («Insumos y materiales») con el
-- total del comprobante. Para eso alcanzaba lo que `oc_items` ya tenía.
--
-- La orden que nace ANTES no tiene factura de dónde copiar: sus líneas salen
-- de Abastecimiento de la obra, que trabaja en el catálogo canónico del
-- presupuesto. Entonces cada línea necesita decir DOS cosas que hoy no puede:
--
--   · `insumo_codigo` — a qué insumo del presupuesto responde. Sin esto la
--     orden no se puede confrontar contra lo que la obra necesita, que es
--     justamente de dónde salió. `nombre` no sirve: el mismo fierro aparece
--     con cuatro escrituras distintas en las facturas de una sola empresa
--     (medido el 6-sep-2026), y por eso existe el mapeo al catálogo.
--
--   · `proveedor_company_id` — de qué empresa DEL GRUPO sale ese material.
--     La orden ya guarda a quién se le compra en `ordenes_compra.proveedor_*`,
--     pero eso es texto de un proveedor cualquiera; acá hace falta el id de la
--     company para poder DESCONTARLE el stock comprometido. Sin este campo,
--     emitir una orden por las 318 bolsas de GASOMI dejaría esas mismas 318
--     figurando como disponibles, y la siguiente orden las comprometería otra
--     vez. Es el mismo doble conteo que el modelo B vino a cerrar, una capa
--     más abajo.
--
-- SON DOS COLUMNAS ADITIVAS Y NULLABLE: el código viejo que ya está en
-- producción no se entera, y las 0 filas actuales de `oc_items` no necesitan
-- backfill. Sin CHECK ni NOT NULL a propósito — las líneas de una orden
-- retroactiva (las de «Sin respaldo») seguirán naciendo sin código canónico,
-- porque una factura vieja no lo tiene, y forzarlo rompería esa pestaña.
--
-- NO hay FK a `companies` sobre `proveedor_company_id`, igual que el resto de
-- las referencias a empresa que la app crea offline: una FK dura convierte una
-- fila que llega antes que su padre en un 23503 que el SyncEngine manda a
-- conflictos manuales. El vínculo se resuelve al leer.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE oc_items
  ADD COLUMN IF NOT EXISTS insumo_codigo text,
  ADD COLUMN IF NOT EXISTS proveedor_company_id uuid;

COMMENT ON COLUMN oc_items.insumo_codigo IS
  'Código del catálogo canónico del presupuesto (insumos_partida.insumo_codigo) al que responde esta línea. NULL en las órdenes retroactivas: una factura vieja no lo tiene.';
COMMENT ON COLUMN oc_items.proveedor_company_id IS
  'Empresa del grupo de cuyo stock sale este material, cuando la orden nació en Abastecimiento. Es lo que permite descontarle las unidades comprometidas.';

-- Para el descuento de stock comprometido: se consulta «qué líneas vivas hay
-- de esta empresa» en cada recálculo del cuadro de abastecimiento.
CREATE INDEX IF NOT EXISTS idx_oc_items_proveedor_company
  ON oc_items (proveedor_company_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_oc_items_insumo_codigo
  ON oc_items (insumo_codigo) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
