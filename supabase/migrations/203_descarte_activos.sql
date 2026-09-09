-- ═══════════════════════════════════════════════════════════════════
-- 203 — «ESTO NO ES UN ACTIVO», Y NO ME LO VUELVAS A PREGUNTAR
-- Tanda 18, entrega C (feedback de Gabriel del 9-set-2026).
--
-- QUÉ CAMBIA: una sola cosa — el CHECK de `cotejo_decisiones.ambito` acepta
-- ahora un tercer valor, 'activos'.
--
-- POR QUÉ HACE FALTA
-- El recomendador de activos fijos bajó su piso de S/ 300 a S/ 80 y aprendió a
-- leer las 42 subfamilias del catálogo. Medido contra producción, eso lleva la
-- lista de candidatos de 42 a 70 líneas. Con 42 se podía convivir; con 70, y
-- creciendo con cada factura, una lista que vuelve a proponer TODAS LAS VECES
-- lo que ya se dijo que no es una lista que se deja de abrir. Es exactamente la
-- lección de la mig 183 y de la mig 195: lo que no se guarda se vuelve a
-- preguntar.
--
-- POR QUÉ ACÁ Y NO EN UNA TABLA NUEVA
-- Porque es LA MISMA PREGUNTA que la mig 196 ya resolvió dos veces: «esto ya lo
-- miré, no aplica, no me lo muestres más». Misma forma de llave (estable entre
-- meses y entre las dos PCs), mismo par de decisiones, misma RLS —son datos de
-- contabilidad—, misma necesidad de sincronizar. Una tabla nueva sería la misma
-- tabla con otro nombre.
--
-- LA LLAVE en este ámbito es `movimiento_id::indice_de_linea` — la misma que
-- `claveLinea()` en src/lib/recomendador-activos.js y la misma con la que
-- `activos_fijos` recuerda de qué línea salió cada bien (mig 182). Así el
-- descarte y el alta hablan de lo mismo, y una línea aceptada no puede además
-- estar descartada.
--
-- DECISIÓN: siempre 'no_aplica'. 'revisada' no significa nada acá — mirar un
-- candidato y no activarlo ES decir que no lo es. Deshacer el descarte da de
-- baja la fila (lo hace `decidirCotejo` con `decision = null`), y la línea
-- vuelve a proponerse.
--
-- Sin datos que migrar: el ámbito nace vacío.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE cotejo_decisiones DROP CONSTRAINT IF EXISTS cotejo_decisiones_ambito_check;
ALTER TABLE cotejo_decisiones ADD CONSTRAINT cotejo_decisiones_ambito_check
  CHECK (ambito IN ('comparativa', 'escaner', 'activos'));

COMMENT ON COLUMN cotejo_decisiones.llave IS
  'Comparativa: tipo|serie|numero|RUC (con el TIPO adentro: 01 E001-1 y 07 E001-1 son distintos). Escáner: regla:movimiento_id. Activos: movimiento_id::indice_de_linea, la misma llave de activos_fijos (mig 182). Estable entre meses y entre las dos PCs.';

COMMENT ON TABLE cotejo_decisiones IS
  '«Esta diferencia ya la miré» / «no aplica». Sirve a la comparativa SUNAT (entrega 5), al escáner (entrega 6) y al recomendador de activos fijos (tanda 18, entrega C).';

NOTIFY pgrst, 'reload schema';
