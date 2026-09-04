-- ═══════════════════════════════════════════════════════════════════
-- 178 — CERCO DE MÓDULO POR ROL: el espejo en el servidor del sync por rol
--
-- La 177 cerró la dimensión OBRA. Falta la otra mitad del 🔴 de la mig 030:
-- la dimensión MÓDULO. Medido hoy con el JWT real de un ingeniero de campo,
-- ya con la 177 puesta:
--
--     accounting_movements visibles ...... 1270
--
-- Son los movimientos contables del grupo que no cuelgan de ninguna obra más
-- los de la suya. Un ingeniero civil no tiene una sola pantalla que los abra
-- —desde agosto su dispositivo ni siquiera se los descarga— pero el servidor
-- se los seguía entregando a quien los pidiera con `curl`.
--
-- QUÉ HACE: convierte en regla del servidor lo que el cliente ya decide desde
-- el 25-ago-2026. `PULL_SCOPE_POR_ROL` (src/sync/SyncEngine.js) dice, tabla por
-- tabla, qué roles NO la descargan porque no tienen ninguna pantalla que la
-- lea. Esta migración es ESE MISMO MAPA, generado del propio archivo (no
-- transcrito a mano), aplicado como policy RESTRICTIVE de SELECT.
--
-- ⚠ ESPEJO OBLIGATORIO: si se toca `PULL_SCOPE_POR_ROL`, se toca esta
-- migración en el MISMO commit. Si el cliente vuelve a bajar una tabla y el
-- server la sigue negando, el usuario ve una lista vacía sin entender por qué.
--
-- SOLO SELECT, nunca escritura. El SyncEngine tiene una garantía explícita:
-- "el PUSH nunca se filtra: todo lo que este dispositivo escribe se sube
-- igual, siempre". Un cerco de INSERT/UPDATE la rompería.
--
-- POR QUÉ ES SEGURO, medido y no intuido (4-sep-2026, contra producción):
--   · De los 51 pares (tabla, rol excluido), 50 tienen CERO filas creadas o
--     editadas por ese rol. Nadie escribe donde no puede leer.
--   · El par 51 apareció como una CONTRADICCIÓN REAL y se corrigió antes de
--     escribir esta migración: `caja_chica_movimientos` estaba excluida del
--     pull de la almacenera… que creó 39 de sus 56 filas (la última, del
--     1-sep). Era un bug de producción de la tanda de agosto: sus registros
--     subían pero no volvían. Se la sacó de la lista del cliente en el mismo
--     commit, y por eso acá `caja_chica_movimientos` ya no nombra a
--     `almacenero`. Sin ese hallazgo, esta migración habría convertido un bug
--     de sincronización en una negación dura del servidor.
--   · Ninguna de las 51 tablas se consulta a Supabase en directo desde la UI
--     (el único `supabase.from()` suelto en pantallas es `evidencias`, que no
--     está en esta lista): todo lo demás se lee de Dexie, que para estos roles
--     ya viene vacío.
--
-- QUEDA EXPLÍCITAMENTE ABIERTO, y es la próxima tanda: `asistente_admin` e
-- `ingeniero_residente` no tienen entrada en PULL_SCOPE_POR_ROL, así que se
-- bajan todo y este cerco no los toca. Siguen leyendo material contable del
-- grupo. Cerrarlos exige decidir primero qué DEBE ver cada uno (una decisión
-- de Gabriel, no de una policy), no copiar una lista que ya existe.
--
-- REVERSIBLE: el SQL para volver atrás está al final del archivo.
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  r record;
  n int := 0;
  -- Espejo de PULL_SCOPE_POR_ROL (src/sync/SyncEngine.js), volcado del archivo.
  -- El rol `campo` no figura acá: ya tiene su propio cerco completo (migs
  -- 155/167), que es más duro que este.
  mapa text[][] := ARRAY[
    ARRAY['accounting_movements',        'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['activos_pesados',             'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['ambiental_registros',         'almacenero,ayudante_contador'],
    ARRAY['avance_metas',                'ayudante_contador'],
    ARRAY['avance_obra',                 'ayudante_contador'],
    ARRAY['caja_chica_movimientos',      'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['calidad_certificados',        'ayudante_contador'],
    ARRAY['calidad_requisitos',          'ayudante_contador'],
    ARRAY['capacitaciones',              'almacenero,ayudante_contador'],
    ARRAY['charla_asistentes',           'almacenero,ayudante_contador'],
    ARRAY['charlas_plan',                'almacenero,ayudante_contador'],
    ARRAY['charlas_seguridad',           'almacenero,ayudante_contador'],
    ARRAY['consumos_combustible',        'ayudante_contador,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['cotizacion_items',            'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['cotizaciones',                'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['cronograma_pagos',            'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['depositos_bancarizacion',     'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['emision_reglas',              'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['epp_entregas',                'ayudante_contador'],
    ARRAY['horas_maquina',               'ayudante_contador,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['incidencias',                 'ayudante_contador'],
    ARRAY['inducciones',                 'almacenero,ayudante_contador'],
    ARRAY['inspecciones_seguridad',      'almacenero,ayudante_contador'],
    ARRAY['insumos_partida_versionadas', 'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['insumos_pendientes',          'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['intercompany_transactions',   'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['mantenimientos_maquinaria',   'ayudante_contador,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['movimientos_bancarios',       'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['movimientos_maquinaria',      'ayudante_contador,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['oc_items',                    'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['ordenes_compra',              'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['ordenes_intercompany',        'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['pagos',                       'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['pagos_partes',                'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['partidas_versionadas',        'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['planilla_boletas',            'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['planillas',                   'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['presupuestos_versiones',      'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['reportes_dia',                'ayudante_contador'],
    ARRAY['reportes_especialidad',       'almacenero,ayudante_contador'],
    ARRAY['requisicion_items',           'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['requisiciones',               'ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['social_actores',              'almacenero,ayudante_contador'],
    ARRAY['social_compromisos',          'almacenero,ayudante_contador'],
    ARRAY['social_quejas',               'almacenero,ayudante_contador'],
    ARRAY['solicitudes_frente',          'ayudante_contador'],
    ARRAY['solicitudes_reporte',         'ayudante_contador'],
    ARRAY['trazabilidad_cadenas',        'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['valorizacion_adicionales',    'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['valorizacion_partidas',       'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista'],
    ARRAY['valorizaciones',              'almacenero,ing_ambiental,ing_calidad,ing_social,ingeniero,prevencionista']
  ];
  tabla text;
  roles text;
  expr text;
BEGIN
  FOR r IN SELECT generate_subscripts(mapa, 1) AS i LOOP
    tabla := mapa[r.i][1];
    roles := mapa[r.i][2];

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = tabla
    ) THEN
      RAISE NOTICE 'Saltando %: la tabla no existe', tabla;
      CONTINUE;
    END IF;

    -- COALESCE(..., true): si el usuario no tiene fila en profiles,
    -- current_user_rol() da NULL y la comparación daría NULL = fila negada.
    -- El cliente ante un rol desconocido baja TODO (fallback conservador);
    -- el servidor hace lo mismo para no dejar a nadie con pantallas vacías
    -- por un perfil a medio crear.
    -- (SELECT …): InitPlan — se evalúa UNA vez por consulta, no por fila.
    expr := format(
      'COALESCE((SELECT public.current_user_rol()) <> ALL (%L::text[]), true)',
      string_to_array(roles, ',')
    );

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabla);
    EXECUTE format('DROP POLICY IF EXISTS modulo_cerco_select ON public.%I', tabla);
    EXECUTE format(
      'CREATE POLICY modulo_cerco_select ON public.%I AS RESTRICTIVE
         FOR SELECT TO authenticated USING (%s)', tabla, expr);

    n := n + 1;
  END LOOP;
  RAISE NOTICE 'Cerco de módulo aplicado a % tablas', n;
END $$;

NOTIFY pgrst, 'reload schema';

-- ═══════════════════════════════════════════════════════════════════
-- VERIFICACIÓN (JWT real de un ingeniero de campo de Miraflores):
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"05d2b39d-4f22-489d-89a0-2f6e2c6e6dc1","role":"authenticated"}';
--   SELECT (SELECT count(*) FROM public.accounting_movements) AS movs,
--          (SELECT count(*) FROM public.movimientos_materiales) AS mov_mat;
--   ROLLBACK;
--   -- esperado: movs 0 (no tiene pantalla que los lea) · mov_mat 1958 (su trabajo)
--
-- REVERTIR (pegar en el SQL Editor si algo sale mal):
--   DO $$ DECLARE t text; BEGIN
--     FOR t IN SELECT DISTINCT tablename FROM pg_policies
--               WHERE schemaname='public' AND policyname='modulo_cerco_select' LOOP
--       EXECUTE format('DROP POLICY IF EXISTS modulo_cerco_select ON public.%I', t);
--     END LOOP;
--   END $$;
--   NOTIFY pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════
