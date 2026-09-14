-- 211 · La RLS se quedó atrás del rol que ya puede usar la pantalla
--
-- SÍNTOMA (Gabriel, 14-sep-2026): la Contadora Jefe (rol 'contador') se puso a
-- clasificar insumos y servicios en "🗂 Clasificación de insumos y servicios"
-- y le salía un cartel de que su cuenta no tiene permiso, y en el estado de
-- sincronización quedaban filas en error.
--
-- CAUSA: el gate de la pantalla (AnalisisInsumosPage, jx-analisis-insumos.jsx)
-- deja entrar a 'admin', 'gerente' Y 'contador' — es SU pantalla de trabajo,
-- para eso se le dio acceso. Pero las políticas RLS de escritura de las tablas
-- que esa pantalla toca (mig 192, 193, 195, 205, 206) se quedaron en el
-- criterio viejo: solo 'admin' y 'gerente' pueden INSERT/UPDATE. Dexie no
-- valida RLS — la fila se guarda LOCAL sin problema (por eso el toast decía
-- "clasificado" / "correlacionado" con éxito) y recién revienta al hacer push
-- (42501, insufficient_privilege), con el mismo patrón que ya describe la
-- regla 9 del CLAUDE.md para otras tablas: guardado local + reventón en el
-- push + sync en reintento eterno.
--
-- Además, `handleSyncError` (SyncEngine.js) marca un error RLS como FAILED de
-- una — no lo reintenta 5 veces como a un error transitorio, porque reintentar
-- un 42501 nunca va a cambiar nada — y el self-heal #2 (records FAILED >10min)
-- SALTA a propósito los marcados `_last_error_is_rls` (línea "if
-- (r._last_error_is_rls) return false;"): asume que un bloqueo de permisos
-- necesita intervención humana y no lo reintenta solo. Por eso las filas que
-- la contadora ya clasificó/correlacionó NO SE PERDIERON: siguen en su Dexie
-- local en estado FAILED, con el nombre y la categoría que ella eligió. Una
-- vez que esta migración amplía la política, hay que decirle que abra el
-- indicador de sincronización y toque "Reintentar todos" (o esperar: el
-- próximo push agresivo tras cualquier cambio nuevo las reintenta a todas
-- igual) — ahí entran solas, nada que recuperar a mano en la base.
--
-- Mismo patrón en TODAS las tablas que esa pantalla escribe, no solo la que
-- ella tocó primero — todas comparten el mismo gate de UI y habrían fallado
-- igual apenas las usara: catalogo_insumos/catalogo_disgregacion (mig 192,
-- vista "Insumos y servicios"), catalogo_familia_mapeo (mig 193, equivalencias
-- de categorías propias), insumo_categoria (mig 195, bandeja "Nombres de
-- factura por reconocer"), clasificaciones/clasificacion_terminos (mig 205,
-- vista "Clasificaciones y diccionario"), insumo_trabajo_mapeo (mig 206,
-- pestaña "Mapeo al presupuesto", misma página). insumo_correlaciones (mig
-- 154, pestaña "Correlaciones") NO se toca: su RLS ya es "cualquier
-- autenticado", nunca fue el problema ahí.
--
-- El DELETE físico se deja como estaba (solo admin, a propósito): la pantalla
-- no le ofrece a la contadora ningún botón de borrado físico, solo
-- alta/edición/baja lógica (activo=false), que son UPDATE.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'clasificaciones', 'clasificacion_terminos',
    'catalogo_insumos', 'catalogo_disgregacion', 'catalogo_familia_mapeo',
    'insumo_categoria', 'insumo_trabajo_mapeo'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': gerencia inserta', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK (has_role(ARRAY[''admin'',''gerente'',''contador'']))',
      t || ': gerencia inserta', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': gerencia actualiza', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING (has_role(ARRAY[''admin'',''gerente'',''contador'']))',
      t || ': gerencia actualiza', t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
