-- ═══════════════════════════════════════════════════════════════════
-- 182 — DE QUÉ LÍNEA DE FACTURA SALIÓ UN ACTIVO FIJO — tanda 7.
--
-- El recomendador (src/lib/recomendador-activos.js) propone activos a partir de
-- las LÍNEAS de las facturas, no de las facturas. Hace falta porque un mismo
-- comprobante puede traer dos activos distintos: INVERSIONES SIGLO XXII,
-- 30-dic-2025, trae dos laptops LENOVO y una impresora EPSON en la misma
-- factura. Con `accounting_movement_id` a secas, aceptar la impresora habría
-- marcado la factura entera como resuelta y las laptops nunca habrían vuelto a
-- proponerse.
--
-- POR QUÉ EL ÍNDICE NO ES ÚNICO:
-- Gabriel alterna dos PCs y la app es offline-first. Dos equipos aceptando la
-- misma línea sin red generarían un 23505 que el SyncEngine manda a la bandeja
-- de conflictos manuales por un caso benigno (los dos querían lo mismo). El
-- chequeo de "ya está cargado" va en el cliente, donde puede resolverse sin
-- molestar a nadie.
--
-- POR QUÉ `periodo` VA DENTRO DEL ÍNDICE:
-- `cerrarEjercicio()` copia cada activo al año siguiente arrastrando su
-- `accounting_movement_id`. Sin el período en el índice, el cierre de 2026
-- chocaría con la fila de 2025 en enero.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE activos_fijos
  ADD COLUMN IF NOT EXISTS accounting_item_idx INTEGER;

COMMENT ON COLUMN activos_fijos.accounting_item_idx IS
  'Índice (0-based) de la línea dentro de notas.items_factura del comprobante. '
  'NULL para los activos cargados a mano, que no vienen de una factura.';

CREATE INDEX IF NOT EXISTS idx_af_item_factura
  ON activos_fijos (accounting_movement_id, accounting_item_idx, periodo)
  WHERE deleted_at IS NULL;
