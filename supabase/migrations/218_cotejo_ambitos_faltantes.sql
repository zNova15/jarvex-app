-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — LOS ÁMBITOS DE `cotejo_decisiones` QUE NUNCA SE AGREGARON
-- (16-set-2026)
--
-- ── EL SÍNTOMA ────────────────────────────────────────────────────
-- Gabriel, 16-set, con el panel de sincronización abierto:
--   «El campo "ambito" tiene un valor que el servidor no acepta:
--    "destino_inv". Corregí ese campo y reintentá.»
--
-- ── QUÉ PASÓ ──────────────────────────────────────────────────────
-- `cotejo_decisiones` nació en la mig 196 con un CHECK cerrado:
--     ambito   IN ('comparativa','escaner','activos')
--     decision IN ('revisada','no_aplica')
--
-- Después se le colgaron DOS usos nuevos y nadie tocó el CHECK:
--   · tanda 3 (15-set) → ambito 'inventario',  decision 'no_inventariable'
--     («esto no va al inventario»: arbitrajes, seguros, detracciones)
--   · tanda 6 (15-set) → ambito 'destino_inv', decision gasto | activo_uso |
--     reventa | transforma («qué va a pasar con este insumo»)
--
-- Las dos escribían local sin problema —Dexie no valida CHECKs— y rebotaban
-- en el push. Medido el 16-set antes de esta migración: 0 filas de esos dos
-- ámbitos en el servidor, contra 29 'comparativa' y 8 'activos'.
--
-- 🔴 Y ESTUVO TAPADO POR UN SEGUNDO BUG. El cliente ni siquiera llegaba a
-- escribir: `guardarDestino` llamaba a `window.__useAuth()` (el hook de React)
-- desde un onChange y moría con "Invalid hook call" antes del try. Arreglado
-- eso (commit 463f494), la escritura local empezó a funcionar y recién ahí
-- apareció ESTE error en el panel de sincronización. Dos capas rotas, una
-- tapando a la otra: el síntoma del cliente era «no pasa nada» y el del
-- servidor es «no se pudo subir».
--
-- ── POR QUÉ EL CHECK QUEDA POR ÁMBITO Y NO COMO UNA LISTA PLANA ────
-- Una lista plana de decisiones aceptaría 'transforma' en el ámbito
-- 'comparativa', que no significa nada. Atar cada ámbito a SUS decisiones es
-- lo que hace que este CHECK siga sirviendo de red la próxima vez que alguien
-- cuelgue un uso nuevo: el push falla fuerte y temprano, en vez de guardar
-- basura que nadie va a mirar.
--
-- Verificado contra las 37 filas existentes: (activos,no_aplica) 8,
-- (comparativa,no_aplica) 5, (comparativa,revisada) 24 — las tres pasan.
-- ═══════════════════════════════════════════════════════════════════

alter table cotejo_decisiones drop constraint if exists cotejo_decisiones_ambito_check;
alter table cotejo_decisiones drop constraint if exists cotejo_decisiones_decision_check;
alter table cotejo_decisiones drop constraint if exists cotejo_decisiones_ambito_decision_check;

alter table cotejo_decisiones
  add constraint cotejo_decisiones_ambito_check
  check (ambito in ('comparativa', 'escaner', 'activos', 'inventario', 'destino_inv'));

alter table cotejo_decisiones
  add constraint cotejo_decisiones_ambito_decision_check
  check (
    (ambito in ('comparativa', 'escaner', 'activos') and decision in ('revisada', 'no_aplica'))
    or (ambito = 'inventario'  and decision = 'no_inventariable')
    or (ambito = 'destino_inv' and decision in ('gasto', 'activo_uso', 'reventa', 'transforma'))
  );

comment on column cotejo_decisiones.ambito is
  'Qué pregunta contestó la persona. comparativa/escaner/activos → revisada|no_aplica · '
  'inventario → no_inventariable («esto no es mercadería») · '
  'destino_inv → gasto|activo_uso|reventa|transforma («qué va a pasar con este insumo»). '
  'El CHECK ata cada ámbito a SUS decisiones: ver la cabecera de la mig 218.';
