-- ═══════════════════════════════════════════════════════════════════
-- 185 — LA CADENA CON INTERMEDIARIO: A → B → ejecutora. Tanda 7, entrega 6b.
--
-- EL PEDIDO (Gabriel, 6-set-2026): «incluso que hay un intermediario, que en
-- este caso sería que la empresa A le vende a la empresa B, y la empresa B le
-- vende a la ejecutora o el consorcio». Y sobre qué tan seguido pasa:
-- «suele pasar, normalmente si existen los intermediarios, incluso con alguna
-- empresa que sería un tercero que hace el favor y hace de intermediario. Eso
-- no quita que existan compras directas sin intermediario».
--
-- Decidió que sean DOS ÓRDENES ENCADENADAS, no una con la cadena anotada:
-- cada empresa emite su propio papel, con su propia numeración, y así la
-- cadena está completa si alguien la audita.
--
--   OC-014-2026  EL INCA  →  JHEENSEG     (la que pide la obra)
--   OC-003-2026  JHEENSEG →  GASOMI       (la que respalda a la de arriba)
--
-- `orden_origen_id` es el vínculo: la SEGUNDA apunta a la PRIMERA. Se guarda
-- en la hija y no en la madre porque una orden puede necesitar abastecerse de
-- más de un origen (dos empresas con el mismo insumo), y al revés no: una
-- orden encadenada existe por UNA sola orden de arriba.
--
-- ⚠️ CUANDO EL INTERMEDIARIO ES UN TERCERO, LA CADENA TIENE UN SOLO PAPEL.
-- Si B no es una empresa nuestra —el favor que mencionó Gabriel— JARVEX no
-- puede emitir la orden de B hacia A: sería fabricar un documento a nombre de
-- alguien que no controlamos, y ese papel no vale. En ese caso se emite solo
-- la de la ejecutora hacia B, y `intermediario_externo` deja dicho que hubo un
-- tercero en el medio para que la cadena se lea completa aunque falte su
-- papel. La app lo explica en pantalla en vez de simular la segunda orden.
--
-- Las tres columnas son ADITIVAS y NULLABLE: una compra directa —que sigue
-- existiendo— las deja todas en NULL y se comporta igual que antes.
--
-- Sin FK sobre `orden_origen_id` a propósito, igual que el resto de las
-- referencias que la app crea offline: las dos órdenes de una cadena nacen en
-- la misma pasada y una FK dura convertiría un orden de llegada distinto en un
-- 23503 que el SyncEngine manda a conflictos manuales.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE ordenes_compra
  ADD COLUMN IF NOT EXISTS orden_origen_id uuid,
  ADD COLUMN IF NOT EXISTS intermediario_company_id uuid,
  ADD COLUMN IF NOT EXISTS intermediario_externo text;

COMMENT ON COLUMN ordenes_compra.orden_origen_id IS
  'La orden de ARRIBA en la cadena: esta orden existe para abastecerla. NULL en una compra directa.';
COMMENT ON COLUMN ordenes_compra.intermediario_company_id IS
  'Empresa del grupo que hace de intermediaria (B) entre quien tiene el material (A) y la ejecutora. NULL si la compra es directa.';
COMMENT ON COLUMN ordenes_compra.intermediario_externo IS
  'Nombre del tercero que hace de intermediario cuando NO es una empresa nuestra. En ese caso la cadena tiene un solo papel: no podemos emitir una orden a nombre de alguien que no controlamos.';

CREATE INDEX IF NOT EXISTS idx_ordenes_compra_origen
  ON ordenes_compra (orden_origen_id) WHERE deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
