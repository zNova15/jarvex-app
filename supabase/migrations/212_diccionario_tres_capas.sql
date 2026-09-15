-- 212 · El diccionario aprendido deja de disfrazarse de ley (tanda 1)
--
-- LO QUE PASABA (medido el 14-sep-2026, reportado por Gabriel: «el diccionario
-- que aparece no es 100% seguro que esté bien clasificado»):
--
--   clasificacion_terminos vivos ........ 368
--   decisiones vivas que los respaldan ..  12
--   términos HUÉRFANOS .................. 365
--   decisiones desclasificadas .......... 649
--
-- Gabriel deshizo 649 decisiones y 365 términos sobrevivieron, porque
-- desclasificar NUNCA desenseñaba. Y esos términos no son inertes: en
-- `clasificarConIUPC()` el diccionario propio entraba con score 0.99, ANTES
-- que el Anexo 2 de la R.J. 016-2026, y `evidenciaDiccionario()` se los
-- mandaba a la IA rotulados como «EVIDENCIA DEL DICCIONARIO OFICIAL». O sea:
-- el error de la IA de ayer volvía hoy con la autoridad de la norma peruana.
-- Circuito de realimentación de errores. Ejemplos vivos al momento de escribir
-- esto: «PL. GALV. 0.80 X 1200 X 2400» → [53] Petróleo diésel · «CUSQUEÑA» →
-- [21] Cemento · «PERFORADOR INDUSTRIAL FABER CASTELL» → [48] Maquinaria
-- liviana. ~70 de ~350 estaban mal o se contradecían entre sí.
--
-- LAS TRES CAPAS, que de acá en adelante NO se mezclan:
--   ① LA LEY — IUPC (82 códigos) + Anexo 2 (938 términos) + árbol de servicios
--     S01-S14. Inmutable, viaja en el bundle, no tiene filas en la base.
--   ② CLASIFICACIONES PROPIAS — tabla `clasificaciones` (mig 205). Las crea
--     Gabriel a mano, deliberadamente, con código que no pisa el de ①.
--   ③ DICCIONARIO APRENDIDO — esta tabla. Provisional: tiene que ganarse la
--     confianza, no partir con ella.
--
-- QUÉ HACE ESTA MIGRACIÓN:
--   1. `origen` en clasificacion_terminos, para saber de dónde salió cada
--      término y tratarlo distinto:
--        · 'manual'   — lo escribió una persona en el panel de Clasificaciones.
--                       Es una corrección deliberada sobre la norma: sigue
--                       ganándole al Anexo 2 (score 0.99) y desclasificar NO
--                       lo borra.
--        · 'decision' — salió de decidir una fila en la bandeja. Vale, pero
--                       DESPUÉS de la ley, y desclasificar esa fila lo borra.
--        · 'ia'       — lo dejó un recorrido automático. No se le manda a la
--                       IA como evidencia (sería discutir contra sí misma) y
--                       nunca le gana a la norma.
--   2. Borra lógicamente los 365 huérfanos: empezar el diccionario desde cero,
--      pedido explícito de Gabriel. Sobreviven los 3 que sí tienen hoy una
--      decisión viva detrás (dos «OBRA: …» → S14 y un uniforme de drill → 83).
--
-- El borrado es LÓGICO (deleted_at) y NO físico: así el pull incremental del
-- SyncEngine lo baja como tombstone y los borra del Dexie de cada equipo. Un
-- DELETE físico no viajaría y las PCs seguirían clasificando con los 365
-- errores para siempre.

-- ── 1. De dónde salió cada término ─────────────────────────────────
ALTER TABLE clasificacion_terminos
  ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'decision';

ALTER TABLE clasificacion_terminos
  DROP CONSTRAINT IF EXISTS clasificacion_terminos_origen_valido;
ALTER TABLE clasificacion_terminos
  ADD CONSTRAINT clasificacion_terminos_origen_valido
  CHECK (origen IN ('manual', 'decision', 'ia'));

COMMENT ON COLUMN clasificacion_terminos.origen IS
  'De dónde salió el término: manual (una persona lo escribió en el panel; le gana al Anexo 2 y desclasificar no lo borra), decision (lo dejó una decisión de la bandeja; vale después de la ley y desclasificar lo borra), ia (recorrido automático; no vuelve a la IA como evidencia). Tanda 1, 15-sep-2026.';

-- ── 2. Los huérfanos se van ────────────────────────────────────────
-- Huérfano = ninguna decisión viva de `insumo_categoria` sostiene hoy esa
-- descripción. Idempotente: correrla dos veces no cambia nada.
UPDATE clasificacion_terminos t
   SET deleted_at = now(),
       updated_at = now(),
       version = COALESCE(t.version, 0) + 1
 WHERE t.deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM insumo_categoria d
      WHERE d.deleted_at IS NULL AND d.norm = t.norm
   );
