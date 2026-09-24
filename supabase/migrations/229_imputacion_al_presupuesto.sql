-- ═══════════════════════════════════════════════════════════════════
-- 229 — IMPUTAR LO YA COMPRADO AL PRESUPUESTO DE LA OBRA
--       (ronda 2, tanda 2.5 de docs/plan-simulador-ordenes.md, 24-set-2026)
--
-- ── EL PROBLEMA ───────────────────────────────────────────────────
-- El simulador de órdenes resta lo ya comprado de lo que falta pedir, por
-- código de insumo del presupuesto (`coberturaPrevia()` en
-- src/lib/simulador-ordenes.js). En Miraflores no tenía contra qué restar:
--   · las 62 líneas de las 14 órdenes retroactivas: insumo_codigo NULL;
--   · el almacén, donde está de verdad lo comprado (3.140 bolsas de cemento
--     entradas contra 2.250 en órdenes), no tiene ninguna columna que lo ate
--     al presupuesto.
-- Sin eso el plan vuelve a proponer lo que ya se compró.
--
-- ── LAS COLUMNAS ──────────────────────────────────────────────────
-- `imputacion`: a qué corresponde la fila en el presupuesto de su obra.
--    'insumo' — a un código (`insumo_codigo`) con su factor.
--    'sobre'  — a un sobre (monto sin insumo, «HERRAMIENTAS MANUALES»). Solo
--               oc_items: el almacén no tiene precio con qué gastar un sobre.
--    'fuera'  — no corresponde a ninguna línea (estudios del documento de
--               trabajo, útiles). Ya no es «no se sabe».
--    NULL     — sin imputar. En oc_items también es lo que tiene toda línea
--               que el simulador escribió con código (mig 226): esas no
--               pasan por la bandeja y se siguen leyendo por insumo_codigo.
-- `insumo_codigo` / `factor_presupuesto`: los mismos nombres y el mismo
--    sentido que en requisicion_items/oc_items (migs 226 y 228) — cuántas
--    unidades del presupuesto trae UNA unidad de la fila (tubo de 6 m → 6).
--    NULL = 1.
--
-- Van en la fila del almacén (materiales/herramientas/epps son POR OBRA:
-- tienen obra_id) y no en una tabla aparte: es un dato de ese ítem de esa
-- obra, y así viaja con el sync que ya existe, sin tabla nueva que sincronizar
-- (lección del corte por egress del 9-set).
--
-- ── EL CHECK QUE LA APP DEBE RESPETAR (regla 9 de CLAUDE.md) ──────
-- Dexie no valida CHECKs: una fila mal formada se guarda local y rebota en el
-- push (23514). El parche sale siempre de `parcheImputacion()` en
-- src/lib/simulador-imputacion.js, que arma exactamente estas combinaciones.
-- El CHECK no obliga a que una fila con código tenga `imputacion`: las del
-- simulador (mig 226) tienen código y `imputacion` NULL, y son válidas.
-- ═══════════════════════════════════════════════════════════════════

-- ── oc_items: insumo_codigo y factor_presupuesto ya existen (226, 228) ──
ALTER TABLE oc_items
  ADD COLUMN IF NOT EXISTS imputacion text;

ALTER TABLE oc_items DROP CONSTRAINT IF EXISTS oc_items_imputacion_check;
ALTER TABLE oc_items ADD CONSTRAINT oc_items_imputacion_check
  CHECK (imputacion IS NULL OR imputacion IN ('insumo', 'sobre', 'fuera'));

ALTER TABLE oc_items DROP CONSTRAINT IF EXISTS oc_items_imputacion_coherente;
ALTER TABLE oc_items ADD CONSTRAINT oc_items_imputacion_coherente CHECK (
  imputacion IS NULL
  OR (imputacion IN ('insumo', 'sobre') AND insumo_codigo IS NOT NULL)
  OR (imputacion = 'fuera' AND insumo_codigo IS NULL)
);

COMMENT ON COLUMN oc_items.imputacion IS
  'A qué corresponde la línea en el presupuesto de la obra: insumo (insumo_codigo + factor), sobre (insumo_codigo del sobre, gasta monto) o fuera. NULL = sin imputar, o escrita por el simulador con código. Lo usa coberturaPrevia().';

-- ── el almacén de la obra ─────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['materiales', 'herramientas', 'epps'] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS imputacion text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS insumo_codigo text', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS factor_presupuesto numeric', t);

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_imputacion_check');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
      CHECK (imputacion IS NULL OR imputacion IN ('insumo', 'fuera'))$f$, t, t || '_imputacion_check');

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_imputacion_coherente');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I CHECK (
      (imputacion IS NULL AND insumo_codigo IS NULL AND factor_presupuesto IS NULL)
      OR (imputacion = 'insumo' AND insumo_codigo IS NOT NULL)
      OR (imputacion = 'fuera' AND insumo_codigo IS NULL AND factor_presupuesto IS NULL)
    )$f$, t, t || '_imputacion_coherente');

    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_factor_presupuesto_check');
    EXECUTE format($f$ALTER TABLE %I ADD CONSTRAINT %I
      CHECK (factor_presupuesto IS NULL OR factor_presupuesto > 0)$f$, t, t || '_factor_presupuesto_check');

    EXECUTE format($f$COMMENT ON COLUMN %I.imputacion IS
      'A qué corresponde el ítem en el presupuesto de su obra: insumo (insumo_codigo + factor_presupuesto) o fuera. NULL = sin imputar. Lo usa el simulador de órdenes para no volver a pedir lo que ya entró (mig 229).'$f$, t);
    EXECUTE format($f$COMMENT ON COLUMN %I.factor_presupuesto IS
      'Cuántas unidades del presupuesto (insumos_partida.unidad) trae una unidad de este ítem. Tubo de 6 m = 6. NULL = 1.'$f$, t);
  END LOOP;
END $$;
