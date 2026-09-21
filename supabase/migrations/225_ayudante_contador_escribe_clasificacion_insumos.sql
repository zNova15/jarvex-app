-- ═══════════════════════════════════════════════════════════════════
-- 225 — La AYUDANTE DE CONTABILIDAD también clasifica insumos (21-set-2026)
--
-- POR QUÉ. Pedido de Gabriel: «quiero que habilites accesos a las asistentes
-- de contabilidad. Dales acceso a más áreas para que nos puedan apoyar […] y
-- a la sección de Base de Insumos».
--
-- Es exactamente la misma migración que la 211, un rol más tarde. La 211
-- (14-sep) se escribió porque la pantalla dejaba entrar a la contadora y el
-- server no la dejaba escribir: clasificaba, la fila se guardaba en Dexie y el
-- push le rebotaba con «sin permiso». La pantalla decía que había funcionado y
-- el dato no llegaba nunca. Abrirle la pantalla a la ayudante sin tocar esto
-- sería repetir ese error con otra persona, así que las dos cosas van juntas:
-- `ROLES_BASE_INSUMOS` en `jx-analisis-insumos.jsx` y estas políticas son
-- espejo, y el comentario de las dos puntas lo dice.
--
-- QUÉ GANA Y QUÉ NO. Gana lo que la pantalla ofrece: dar de alta un insumo en
-- el catálogo, corregir su clasificación, reconocer un nombre de factura,
-- mapear al presupuesto, editar el diccionario. NO gana el DELETE físico, que
-- se deja en admin como lo dejó la 211 — la pantalla no ofrece ningún botón de
-- borrado físico, solo baja lógica (`activo=false`), que es un UPDATE.
--
-- 🔴 LO QUE ESTO SIGNIFICA DE VERDAD, dicho para que nadie lo descubra
-- después: clasificar un insumo CAMBIA LA CUENTA DEL PCGE de todas las
-- facturas que lo traen, en todas las empresas del grupo si el insumo es
-- global (ver la regla 8 del CLAUDE.md y el hallazgo de la tanda 4 del
-- destino). O sea que este permiso alcanza el Libro Diario que se declara. Se
-- da igual, porque es literalmente el trabajo que se le está pidiendo apoyar y
-- porque toda escritura queda firmada en `audit_log` con quién y cuándo; pero
-- es un permiso de contabilidad, no de data entry, y conviene que la contadora
-- jefe sepa que lo tiene.
--
-- `insumo_correlaciones` no se toca: su RLS ya es «cualquier autenticado»,
-- igual que cuando se escribió la 211.
-- ═══════════════════════════════════════════════════════════════════

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
      'CREATE POLICY %I ON %I FOR INSERT TO authenticated WITH CHECK '
      || '(has_role(ARRAY[''admin'',''gerente'',''contador'',''ayudante_contador'']))',
      t || ': gerencia inserta', t
    );
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || ': gerencia actualiza', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE TO authenticated USING '
      || '(has_role(ARRAY[''admin'',''gerente'',''contador'',''ayudante_contador'']))',
      t || ': gerencia actualiza', t
    );
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
