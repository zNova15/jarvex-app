-- ═══════════════════════════════════════════════════════════════════
-- 233 — CERCO DE ESCRITURA CONTABLE (tanda B de la revisión Ola 1)
--
-- El hueco (medido el 26-set): las policies de escritura de
-- accounting_movements, companies, proveedores, obras, activos_fijos,
-- transformaciones y personal_cuentas_bancarias eran `auth.uid() IS NOT
-- NULL` (o `true`). La almacenera, la residente o la asistente admin podían
-- modificar o soft-borrar por REST los 1.273 movimientos del grupo, las 30
-- empresas y los 555 proveedores; un ingeniero, poner deleted_at a su obra.
-- La pantalla lo impedía; el servidor no.
--
-- La regla (Gabriel, 25-set): la contabilidad la modifican el admin y los
-- roles de contabilidad (contador = jefa, ayudante_contador = asistentes);
-- las obras, solo el admin.
--
-- Cómo, igual que los otros cercos (155 campo, 177 obra, 178 módulo):
-- policies RESTRICTIVE que se suman con AND a las que ya existen. No se
-- toca ninguna permisiva y se revierte con DROP POLICY.
--
-- Lo que se midió ANTES de escribir esto, y por eso las listas son así:
--   · Las asistentes crean el 88 % de los movimientos (1.758 de 1.976) y son
--     las últimas en editar 577. Casi todo sale de Captura Mágica,
--     detracciones, vínculos de NC y el Libro Diario, no del formulario de
--     edición. «Las asistentes solicitan el cambio» ya vive en la pantalla
--     (jx-contabilidad.jsx: el botón Editar es «Solicitar» para ellas);
--     cortarles el UPDATE en el servidor rompía su trabajo diario.
--   · La almacenera ESCRIBE accounting_movements al registrar recepciones
--     (13 en la auditoría; las del 9, 14 y 16-set llegaron al servidor).
--     Se le deja UPDATE, pero un trigger le rechaza cualquier cambio fuera
--     de la recepción (sección 3).
--   · Ninguna función del servidor escribe estas tablas: el cerco no
--     frena a ningún trigger.
--   · El borrado FÍSICO ya era solo admin en las siete tablas: no cambia.
--   · La LECTURA no cambia (eso fue la 178 y sigue igual).
--
-- ESPEJO en el cliente: src/lib/escritura-contable.js (CERCO_ESCRITURA,
-- COLUMNAS_RECEPCION, CLAVES_ITEM_RECEPCION). El test
-- escritura-contable.test.js lee ESTE archivo y falla si difieren.
-- ═══════════════════════════════════════════════════════════════════


-- ── 1) Cerco de escritura por rol ────────────────────────────────────
-- current_user_rol() NULL (JWT sin perfil) → COALESCE(false): no escribe.
-- service_role no pasa por RLS: los scripts y el SQL Editor siguen igual.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('accounting_movements',       'insert', ARRAY['admin','contador','ayudante_contador']),
    ('accounting_movements',       'update', ARRAY['admin','contador','ayudante_contador','almacenero','supervisor','maestro_obra','jefe_compras','gerente']),
    ('companies',                  'insert', ARRAY['admin','contador','ayudante_contador']),
    ('companies',                  'update', ARRAY['admin','contador','ayudante_contador']),
    ('proveedores',                'insert', ARRAY['admin','contador','ayudante_contador']),
    ('proveedores',                'update', ARRAY['admin','contador','ayudante_contador']),
    ('activos_fijos',              'insert', ARRAY['admin','contador','ayudante_contador']),
    ('activos_fijos',              'update', ARRAY['admin','contador','ayudante_contador']),
    ('transformaciones',           'insert', ARRAY['admin','contador','ayudante_contador']),
    ('transformaciones',           'update', ARRAY['admin','contador','ayudante_contador']),
    ('personal_cuentas_bancarias', 'insert', ARRAY['admin','contador','ayudante_contador']),
    ('personal_cuentas_bancarias', 'update', ARRAY['admin','contador','ayudante_contador']),
    ('obras',                      'insert', ARRAY['admin']),
    ('obras',                      'update', ARRAY['admin'])
  ) v(tabla, op, roles)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'escritura_cerco_' || r.op, r.tabla);
    IF r.op = 'insert' THEN
      EXECUTE format(
        'CREATE POLICY escritura_cerco_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
           WITH CHECK (COALESCE((SELECT public.current_user_rol()) = ANY (%L::text[]), false))',
        r.tabla, r.roles);
    ELSE
      EXECUTE format(
        'CREATE POLICY escritura_cerco_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
           USING (COALESCE((SELECT public.current_user_rol()) = ANY (%L::text[]), false))
           WITH CHECK (COALESCE((SELECT public.current_user_rol()) = ANY (%L::text[]), false))',
        r.tabla, r.roles, r.roles);
    END IF;
  END LOOP;
END $$;


-- ── 2) notas sin lo que escribe la recepción ─────────────────────────
-- `notas` es texto con JSON: lleva subtotal, IGV e items_factura con precios.
-- La recepción solo agrega marcas por ítem (recibido, vínculo, rechazo) y
-- `recepcion_rechazo`. Esta función devuelve el JSON SIN esas marcas: si el
-- de antes y el de después coinciden, el cambio fue solo de recepción.
-- NULL / vacío / no-JSON se normalizan para no rechazar una primera
-- recepción sobre una factura sin notas.
CREATE OR REPLACE FUNCTION public.jx_notas_sin_recepcion(p text)
RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE j jsonb;
BEGIN
  IF p IS NULL OR btrim(p) = '' THEN RETURN '{}'::jsonb; END IF;
  BEGIN
    j := p::jsonb;
  EXCEPTION WHEN others THEN
    RETURN to_jsonb(p);
  END;
  IF jsonb_typeof(j) <> 'object' THEN RETURN j; END IF;
  j := j - 'recepcion_rechazo';
  IF jsonb_typeof(j -> 'items_factura') = 'array' THEN
    IF jsonb_array_length(j -> 'items_factura') = 0 THEN
      j := j - 'items_factura';
    ELSE
      j := jsonb_set(j, '{items_factura}', (
        SELECT coalesce(jsonb_agg(
                 CASE WHEN jsonb_typeof(e) = 'object'
                      THEN e - ARRAY['recibido','material_id','tipo_insumo','factor_conv','recepcion_modo','mov_vinculado_id','rechazado','rechazo_motivo','rechazo_por','rechazo_fecha']
                      ELSE e END
                 ORDER BY o), '[]'::jsonb)
          FROM jsonb_array_elements(j -> 'items_factura') WITH ORDINALITY AS t(e, o)));
    END IF;
  END IF;
  RETURN j;
END $$;
REVOKE EXECUTE ON FUNCTION public.jx_notas_sin_recepcion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.jx_notas_sin_recepcion(text) TO authenticated, service_role;


-- ── 3) La recepción solo toca la recepción ───────────────────────────
-- Un rol de recepción (almacenera y afines) pasa el cerco de UPDATE de
-- accounting_movements. Este trigger le rechaza todo cambio que no sea:
-- las columnas recepcion_*, las marcas de recepción dentro de notas y los
-- sellos (updated_*, version, last_synced_at). El push del SyncEngine manda
-- la fila COMPLETA: las columnas que no cambiaron vienen iguales y pasan.
-- Contabilidad y el service_role (auth.uid() NULL) no se revisan.
CREATE OR REPLACE FUNCTION public.accounting_movements_solo_recepcion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  libres constant text[] := ARRAY[
    'recepcion_status','recepcion_movimiento_id','recepcion_fecha','recepcion_por',
    'recepcion_observaciones','recepcion_completada_at','recepcion_completada_por',
    'notas','updated_at','updated_by','version','last_synced_at'];
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(public.current_user_rol() = ANY (ARRAY['admin','contador','ayudante_contador']), false) THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - libres) IS DISTINCT FROM (to_jsonb(OLD) - libres)
     OR public.jx_notas_sin_recepcion(NEW.notas) IS DISTINCT FROM public.jx_notas_sin_recepcion(OLD.notas) THEN
    RAISE EXCEPTION 'Tu rol solo puede registrar la recepción de esta factura; el resto lo cambia contabilidad (%)', NEW.document_number
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.accounting_movements_solo_recepcion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_accounting_movements_solo_recepcion ON public.accounting_movements;
CREATE TRIGGER trg_accounting_movements_solo_recepcion
  BEFORE UPDATE ON public.accounting_movements
  FOR EACH ROW EXECUTE FUNCTION public.accounting_movements_solo_recepcion();


NOTIFY pgrst, 'reload schema';
