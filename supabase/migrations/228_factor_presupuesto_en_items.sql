-- ═══════════════════════════════════════════════════════════════════
-- 228 — EN QUÉ UNIDAD SE PIDIÓ, CONTRA QUÉ UNIDAD SE DESCUENTA
--       (ronda 2, tanda 2.2 de docs/plan-simulador-ordenes.md, 24-set-2026)
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────
-- El presupuesto está en la unidad del EXPEDIENTE y nadie compra así:
-- «TUBERIA PVC UF S25 DE 8" x 6m» viene en metros (14.088 m en Miraflores)
-- y se pide por tubo. Desde la tanda 2.2 el simulador propone en unidades de
-- COMPRA: 28 tubos, no 164 m.
--
-- Pero el descuento que evita pedir dos veces (§7 del plan,
-- `coberturaPrevia()` en src/lib/simulador-ordenes.js) resta lo ya requisado
-- u ordenado de lo que pide el presupuesto, por código de insumo. Sin saber
-- cuántos metros trae cada tubo, restaría «28» de los metros: quedarían 136 m
-- por pedir que ya están pedidos. Es el doble pedido que el §7 viene a
-- evitar, y no se ve hasta que llega el segundo camión.
--
-- ── LA COLUMNA ────────────────────────────────────────────────────
-- `factor_presupuesto`: cuántas unidades del presupuesto trae UNA unidad
-- pedida (tubo de 6 m → 6; pieza de 1"x8"x8' → 5,3333 p²). NULL = 1, la misma
-- unidad: todo lo escrito antes de esta migración —y toda requisición que
-- carga el residente a mano— ya estaba en la unidad del expediente.
--
-- Va en los DOS lados del puente, porque los dos descuentan: la requisición
-- mientras no tiene orden, y la orden una vez emitida (`oc_items` hereda el
-- factor de su `requisicion_item`).
--
-- Se guarda en la fila y no se recalcula de la configuración del escenario:
-- ésa vive en el localStorage de una persona y se puede cambiar mañana
-- (el tubo era de 5 m, no de 6). Lo que ya se pidió, se pidió con el factor
-- de ese día.
--
-- La app solo escribe la columna cuando el factor NO es 1, así que una
-- requisición común no depende de que esta migración esté aplicada.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE requisicion_items
  ADD COLUMN IF NOT EXISTS factor_presupuesto numeric;

ALTER TABLE oc_items
  ADD COLUMN IF NOT EXISTS factor_presupuesto numeric;

COMMENT ON COLUMN requisicion_items.factor_presupuesto IS
  'Cuántas unidades del presupuesto (insumos_partida.unidad) trae una unidad pedida. Tubo de 6 m = 6. NULL = 1 (misma unidad). Lo usa coberturaPrevia() para no pedir dos veces.';
COMMENT ON COLUMN oc_items.factor_presupuesto IS
  'Cuántas unidades del presupuesto (insumos_partida.unidad) trae una unidad pedida. Heredado de requisicion_items. NULL = 1 (misma unidad).';

-- Un factor cero o negativo haría desaparecer lo pedido del descuento.
ALTER TABLE requisicion_items DROP CONSTRAINT IF EXISTS requisicion_items_factor_presupuesto_check;
ALTER TABLE requisicion_items ADD CONSTRAINT requisicion_items_factor_presupuesto_check
  CHECK (factor_presupuesto IS NULL OR factor_presupuesto > 0);
ALTER TABLE oc_items DROP CONSTRAINT IF EXISTS oc_items_factor_presupuesto_check;
ALTER TABLE oc_items ADD CONSTRAINT oc_items_factor_presupuesto_check
  CHECK (factor_presupuesto IS NULL OR factor_presupuesto > 0);
