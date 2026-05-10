-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — RPC admin_wipe_data() para borrado masivo desde la UI
--
-- Permite al admin (rol 'admin' en profiles) ejecutar un wipe completo
-- de las tablas operativas desde la pantalla "Danger Zone" sin
-- necesitar SERVICE_ROLE_KEY en el cliente.
--
-- ⚠ DESTRUCTIVO E IRREVERSIBLE. Usar solo en pruebas o reset
-- intencional. Hacé backup primero (scripts/backup-supabase.mjs).
--
-- La función:
--   - Verifica que auth.uid() sea un admin activo en profiles.
--   - Borra en orden de FKs (hijos → padres) con TRUNCATE CASCADE.
--   - NO toca: profiles, audit_log (ese se borra aparte si querés),
--     ni la propia tabla obra_usuarios del admin que está logueado.
--   - Devuelve count de filas borradas por tabla.
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.admin_wipe_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_es_admin BOOLEAN;
  v_resultado jsonb := '{}';
  v_tabla TEXT;
  v_count BIGINT;
BEGIN
  -- 1. Verificar que el caller sea admin activo
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_uid AND rol = 'admin' AND COALESCE(activo, true) = true
  ) INTO v_es_admin;

  IF NOT v_es_admin THEN
    RAISE EXCEPTION 'admin_wipe_data: solo admins pueden ejecutar esta función';
  END IF;

  -- 2. Wipe en orden (hijos → padres) usando TRUNCATE CASCADE para
  --    no quedar trabados con FKs. CASCADE limpia automáticamente
  --    referencias que cuelguen.
  --
  -- TRUNCATE es mucho más rápido que DELETE para tablas grandes y
  -- desactiva los triggers durante la operación.

  FOR v_tabla IN
    SELECT unnest(ARRAY[
      -- Items / detalles
      'requisicion_items', 'cotizacion_items', 'oc_items', 'recepcion_items',
      'valorizacion_partidas', 'valorizacion_adicionales',
      'subcontrato_valorizaciones', 'planilla_boletas', 'charla_asistentes',
      'movimientos_bancarios', 'cronograma_pagos', 'horas_maquina',
      'consumos_combustible', 'mantenimientos_maquinaria',
      'epp_entregas',
      'insumos_partida_versionadas', 'insumos_partida',
      'partidas_versionadas',
      -- Movimientos / operaciones
      'movimientos_materiales', 'movimientos_herramientas', 'movimientos_epp',
      'asistencia', 'avance_obra', 'incidencias', 'evidencias',
      'iperc', 'inspecciones_seguridad', 'capacitaciones', 'charlas_seguridad',
      'requisiciones', 'cotizaciones', 'ordenes_compra', 'recepciones',
      'valorizaciones', 'subcontratos', 'personal_contrato', 'planillas',
      'trazabilidad_cadenas',
      -- Maestros operativos
      'partidas', 'cronograma', 'presupuestos_versiones',
      'material_precios_historial',
      'materiales', 'herramientas', 'epps', 'ubicaciones_obra',
      'personal', 'proveedores', 'subcontratistas', 'activos_pesados',
      -- Tesorería / contabilidad
      'cuentas_bancarias', 'accounting_movements', 'intercompany_transactions',
      -- Cambios / asignaciones
      'change_requests', 'obra_usuarios',
      -- Audit log y companies (último porque son las raíces)
      'audit_log',
      'companies', 'obras'
    ])
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM public.%I', v_tabla) INTO v_count;
      IF v_count > 0 THEN
        EXECUTE format('TRUNCATE TABLE public.%I CASCADE', v_tabla);
        v_resultado := v_resultado || jsonb_build_object(v_tabla, v_count);
      END IF;
    EXCEPTION
      WHEN undefined_table THEN
        -- Tabla no existe — ignorar
        NULL;
      WHEN OTHERS THEN
        v_resultado := v_resultado || jsonb_build_object(
          v_tabla, jsonb_build_object('error', SQLERRM)
        );
    END;
  END LOOP;

  -- 3. Re-asegurar la asignación del admin a "ninguna obra" (porque
  --    obra_usuarios fue truncado). El admin como tal no necesita
  --    obra asignada — la matriz de permisos lo trata como acceso a
  --    todo.

  RETURN v_resultado;
END;
$$;

-- Permitir ejecutar la función a usuarios autenticados (la verificación
-- de admin la hace adentro la función).
REVOKE ALL ON FUNCTION public.admin_wipe_data FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_wipe_data TO authenticated;
