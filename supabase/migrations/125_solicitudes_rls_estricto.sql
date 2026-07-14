-- ═══════════════════════════════════════════════════════════════════
-- 125 — RLS estricto en change_requests (acompaña a la mig 124).
--
-- Al abrir "Mis Solicitudes" a todos los roles quedaba más expuesto un
-- hueco preexistente de las policies rls033 (mig 033, permisivas por rol
-- sin ownership):
--   · rls033_select: USING(true) → cualquier autenticado leía TODAS las
--     solicitudes (motivos, emails) vía API directa.
--   · rls033_update: almacenero/supervisor/etc. podían actualizar CUALQUIER
--     solicitud — incluso auto-aprobarse la propia (status='aprobada') por
--     REST, saltándose al admin.
--
-- Queda: SELECT = propias, o todas para revisores (admin/contador — la
-- pestaña "Pendientes de Revisión" y el badge countPending). UPDATE = solo
-- las policies específicas: "admin revisa o requester cancela", "contador
-- aprueba" y "requester edita su pendiente" (124). INSERT = "autenticado
-- inserta propio" (requester_id = auth.uid() y status pendiente).
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists "rls033_select" on public.change_requests;
drop policy if exists "rls033_update" on public.change_requests;
drop policy if exists "rls033_insert" on public.change_requests;
-- Redundante con la nueva policy de SELECT (subset de ella):
drop policy if exists "change_requests: requester o admin lee" on public.change_requests;

create policy "change_requests: lee propio o revisor"
  on public.change_requests for select
  using (requester_id = auth.uid() or is_admin() or has_role(array['contador']::text[]));
