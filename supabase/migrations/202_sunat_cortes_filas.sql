-- ═══════════════════════════════════════════════════════════════════
-- 202 — LAS FILAS DEL CSV DE SUNAT SÍ SE GUARDAN. Tanda 18, entrega B.
--
-- EL PEDIDO, de Gabriel (9-set-2026): «SUNAT vs JARVEX, no se guardan los csv.
-- Agregué los csv del mes de julio para la empresa de Jarvex, luego cambié de
-- pestaña y se borró, ya no me sale lo que falta o incoherencias. Deberían
-- guardarse los csv de cada mes por empresa tanto de compra como de venta, y si
-- queremos actualizarlo que se pueda lograr también».
--
-- ── DÓNDE ESTUVO EL ERROR ─────────────────────────────────────────
-- La migración 196 dice, con todas las letras: «POR QUÉ NO SE GUARDAN LAS FILAS
-- DEL COTEJO... porque son DERIVADAS y caras». La primera mitad es falsa. Las
-- filas del CSV NO son derivadas: el CSV es la fuente de AFUERA, lo único de
-- toda la pantalla que la app no puede recalcular sola. Lo derivado es el
-- RESUMEN —que sale de cruzar esas filas contra los movimientos—, y es
-- justamente lo que sí se guardó.
--
-- Resultado medido: los dos cortes de julio de JARVEX que Gabriel cargó el
-- 9-set quedaron en la base con su resumen (compras: 35 comprobantes, 29
-- cuadran, brecha S/ 17.254,60 · ventas: 5) y CERO filas. Al cambiar de
-- pestaña le quedó el número de la brecha y ninguna lista con la que trabajar.
--
-- ── POR QUÉ UNA COLUMNA jsonb Y NO UNA TABLA HIJA ─────────────────
-- Un corte tiene decenas o cientos de filas y se REEMPLAZA entero cuando se
-- vuelve a cargar el mes (SUNAT actualiza la propuesta del RCE y la del día 20
-- no es la del día 7). Como tabla hija, cada recarga sería un borrado y un alta
-- masivos que el SyncEngine tendría que empujar fila por fila entre las dos PCs
-- de Gabriel — cientos de registros por mes cotejado para algo que se lee
-- SIEMPRE entero y nunca por partes. Como jsonb es UN registro que viaja con su
-- corte y se reemplaza con él.
--
-- ── LAS FILAS VAN PODADAS ─────────────────────────────────────────
-- `filasGuardables()` (src/lib/sunat-csv.js) deja los 19 campos que el cruce y
-- la pantalla leen de verdad y tira los 10 que son derivables o que nadie mira
-- (el periodo y el libro ya están en el corte, el número en texto sale del
-- número, etc.). No es por espacio —el ahorro es un tercio— sino porque cada
-- campo guardado es un campo que promete estar bien; el resto está en el CSV
-- que Gabriel bajó de SUNAT.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE sunat_cortes
  -- Las filas del archivo, ya leídas y podadas. `[]` = corte viejo (guardado
  -- antes de esta migración) o archivo sin ninguna fila legible: la pantalla lo
  -- dice y pide volver a cargar el CSV en vez de mostrar una tabla vacía.
  ADD COLUMN IF NOT EXISTS filas jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Las líneas que NO se pudieron leer, con su número de línea y el motivo.
  -- La cuenta ya vivía en `avisos`; sin el detalle, «⚠️ 3 líneas ilegibles» no
  -- se puede ir a mirar al archivo. Se guardan hasta 50 (ver `avisosGuardables`).
  ADD COLUMN IF NOT EXISTS avisos_detalle jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN sunat_cortes.filas IS
  'Las filas del CSV de SUNAT ya parseadas y podadas a los 19 campos que usa el cruce. Es la FUENTE EXTERNA del cotejo: lo único que la app no puede recalcular sola. Vacío = corte anterior a la mig 202, hay que volver a cargar el archivo.';
COMMENT ON COLUMN sunat_cortes.avisos_detalle IS
  'Las líneas del archivo que no se pudieron leer: { linea, motivo, texto }. Hasta 50; la cuenta completa está en `avisos`.';

NOTIFY pgrst, 'reload schema';
