-- 147: DETRACCIÓN (SPOT) en comprobantes contables — compras y ventas
-- Pedido de Gabriel (23-jul-2026). La asistente de contabilidad (ayudante_contador)
-- registra la detracción de las facturas: la IA de Captura Mágica RECOMIENDA el
-- porcentaje / monto / código SPOT y ella lo CORRIGE (es contadora). Luego sube la
-- constancia del depósito en el Banco de la Nación y marca el estado 'depositada'.
-- Aplica a facturas de COMPRA y de VENTA, sobre el MISMO accounting_movement
-- (sin duplicar; los pares intercompany siguen vinculados por related_movement_id).
--
-- Columnas ADITIVAS y sin índice → NO requieren bump de Dexie ni cambios en
-- SyncEngine (el push manda todo el registro salvo props locales; el pull hace
-- select('*')). La única pieza server obligatoria son estas columnas.

-- ── 1) Columnas de detracción en accounting_movements ─────────────────────────
alter table public.accounting_movements
  add column if not exists detraccion_aplica boolean not null default false,
  add column if not exists detraccion_pct numeric(5,2),
  add column if not exists detraccion_monto numeric(14,2),
  add column if not exists detraccion_codigo text,
  add column if not exists detraccion_estado text,            -- null | 'pendiente' | 'depositada'
  add column if not exists detraccion_constancia_fecha date;

-- ── 2) La constancia de detracción es un documento CONTABLE ────────────────────
-- Solo la ven admin/contador/ayudante_contador + autor (espejo de
-- src/lib/evidencias-visibilidad.js → TIPOS_CONTABLES). Se agrega
-- 'constancia_detraccion' a la lista NOT IN de la policy de evidencias.
--
-- evidencias está publicada en Realtime → apply_migration deadlockea contra el
-- subscription manager al alterar su policy. Por eso se aplica con execute_sql
-- tomando lock explícito ANTES del DDL (ver HANDOFF-CONTINUACION.md §4).
lock table realtime.subscription in access exclusive mode;

drop policy if exists "evidencias: ver segun tipo" on public.evidencias;
create policy "evidencias: ver segun tipo" on public.evidencias
  for select to authenticated
  using (
    tipo_evidencia not in ('bancarizacion', 'comprobante_captura', 'factura',
                           'recibo_honorarios', 'pago_evidencia', 'guia_remision',
                           'sctr_cotizacion', 'sctr_pago', 'sctr_factura', 'sctr_otro',
                           'constancia_detraccion')
    or public.has_role(array['admin'::text, 'contador'::text, 'ayudante_contador'::text])
    or subido_por = auth.uid()
    or created_by = auth.uid()
  );

notify pgrst, 'reload schema';
