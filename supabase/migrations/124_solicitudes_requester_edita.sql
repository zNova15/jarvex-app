-- ═══════════════════════════════════════════════════════════════════
-- 124 — El solicitante puede EDITAR su propia solicitud pendiente.
--
-- Pedido de Gabriel (14 jul 2026): la almacenera (y todo rol que solicita
-- cambios) debe poder ver sus solicitudes, editarlas o anularlas. La página
-- ya tenía "Mis Solicitudes" + cancelar, pero el UPDATE de una solicitud
-- propia manteniendo status='pendiente' NO pasaba RLS para roles fuera de
-- rls033_update (ej. ingeniero): la policy "requester cancela" exige que el
-- status quede en 'cancelada'.
--
-- Esta policy permite al requester modificar SU solicitud mientras esté
-- pendiente (editar proposed_changes/reason, o cancelarla). El WITH CHECK
-- impide auto-aprobarse: el status solo puede quedar en pendiente/cancelada.
-- ═══════════════════════════════════════════════════════════════════

drop policy if exists "change_requests: requester edita su pendiente" on public.change_requests;
create policy "change_requests: requester edita su pendiente"
  on public.change_requests for update
  using (requester_id = auth.uid() and status = 'pendiente')
  with check (requester_id = auth.uid() and status in ('pendiente', 'cancelada'));
