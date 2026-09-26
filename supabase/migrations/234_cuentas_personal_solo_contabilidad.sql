-- ═══════════════════════════════════════════════════════════════════
-- 234 — LAS CUENTAS BANCARIAS DEL PERSONAL, SOLO PARA CONTABILIDAD
-- (cierre de la tanda B de la revisión Ola 1, 25-set-2026)
--
-- Lo que quedó abierto en la 233: la 233 cerró la ESCRITURA de
-- `personal_cuentas_bancarias` a admin/contador/ayudante_contador, pero la
-- LECTURA seguía siendo la de siempre — `pcb: select autenticado`
-- (deleted_at IS NULL) más el cerco de obra: cualquier rol designado a la
-- obra (almacenera, residente, ingeniero, prevencionista…) veía los números
-- de cuenta y los CCI del personal.
--
-- La regla (Gabriel, 25-set-2026, respuesta a la pregunta que dejó la tanda
-- B): «Sí, déjalo para contabilidad». Son los mismos tres roles que ya
-- escriben la tabla: el admin, la contadora y las asistentes.
--
-- Cómo, igual que los otros cercos (155 campo, 177 obra, 178 módulo, 233
-- escritura): una policy RESTRICTIVE que se suma con AND a las que ya
-- existen. No se toca ninguna permisiva y se revierte con un DROP POLICY.
-- current_user_rol() NULL (JWT sin perfil) → COALESCE(false): no lee.
-- service_role no pasa por RLS: los respaldos y el SQL Editor siguen igual.
--
-- Lo que NO hace: borrar las filas que ya bajaron a los dispositivos de los
-- otros roles. El pull deja de traerlas, pero la copia local queda hasta que
-- se limpie el IndexedDB — eso es de la tanda E (logout que limpia y reset
-- de watermarks al cambiar de rol).
-- ═══════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS lectura_cerco_select ON public.personal_cuentas_bancarias;
CREATE POLICY lectura_cerco_select ON public.personal_cuentas_bancarias
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (COALESCE((SELECT public.current_user_rol()) = ANY (ARRAY['admin','contador','ayudante_contador']), false));

COMMENT ON POLICY lectura_cerco_select ON public.personal_cuentas_bancarias IS
  '234 (25-set-2026): solo admin, contador y ayudante_contador leen los números de cuenta del personal. Espejo de escritura en la 233.';

NOTIFY pgrst, 'reload schema';
