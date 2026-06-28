-- ═══════════════════════════════════════════════════════════════════
-- 111 — Heal de insumos con unidad de PORCENTAJE (%mo, %MO, …) inflados ×100.
--
-- Síntoma (reportado por Gabriel): en "Conciliación de Insumos" el insumo
-- HERRAMIENTAS MANUALES (370020009, unidad %mo) mostraba S/ 13,250,809.57
-- cuando el consolidado de Delphin dice S/ 132,505. Factor exacto: ×100.
--
-- Causa: en el APU de Delphin, los insumos calculados como "% de la mano de
-- obra" traen la cantidad como PORCENTAJE entero (p.ej. 2.994 = 2.994%), no
-- como fracción (0.02994). El parser (parseAPU) la guardaba tal cual en
-- `cantidad_presupuestada`, y como `costo_presupuestado` es una COLUMNA
-- GENERADA (= cantidad_presupuestada * precio_presupuestado), el costo queda
-- ×100. (La "Lista de Insumos" consolidada de Delphin sí trae la fracción
-- 0.0296 → ese camino, parseInsumosList, ya era correcto.)
--
-- Fix: dividir entre 100 la `cantidad_presupuestada` de las filas con unidad
-- de porcentaje. El `costo_presupuestado` (generado) se recalcula solo. Con
-- esto HERRAMIENTAS MANUALES pasa a S/ 132,508 y el subtotal EQUIPO de la obra
-- cae de 14.19M a ~1.07M = el subtotal "EQUIPO 1,075,804.67" del Excel.
--
-- Idempotencia: el guard `cantidad_presupuestada > 1` distingue el porcentaje
-- entero (≈3) de la fracción ya correcta (≈0.03); tras el heal la fila queda
-- <1 y un re-run no la vuelve a tocar.
--
-- Propagación a clientes: no hay trigger de version/updated_at en
-- insumos_partida, así que bumpeamos ambos a mano. El pull master es
-- incremental por `updated_at` (bulkPut), de modo que cada PC baja la fila
-- corregida en su próxima sync (la tabla es server-as-truth en el pull, y
-- `costo_presupuestado` se strippea del push por ser generada).
-- ═══════════════════════════════════════════════════════════════════

UPDATE insumos_partida
SET cantidad_presupuestada = cantidad_presupuestada / 100.0,
    updated_at = now(),
    version    = COALESCE(version, 1) + 1
WHERE deleted_at IS NULL
  AND unidad ~ '^\s*%'
  AND cantidad_presupuestada > 1;

-- El forward-fix (parseAPU divide entre 100 las unidades de porcentaje) va en
-- src/lib/apuParser.js para que nuevas importaciones ya entren correctas.
