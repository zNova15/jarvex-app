-- 117: ampliar el dominio de accounting_movements.recepcion_status para incluir
-- 'no_recepcionado' (el almacén NEGÓ la recepción: la contadora olvidó desmarcar
-- el envío, le reportaron que no ingresará, etc.). El CHECK de la migración 047
-- solo admitía no_aplica|pendiente_recepcion|parcial|recibido, así que negar una
-- factura REAL fallaba al sincronizar con 23514. El cliente ya trata el valor
-- (sale de compras pendientes en jx-almacen y en la página; tag en Contabilidad).

ALTER TABLE public.accounting_movements
  DROP CONSTRAINT IF EXISTS accounting_movements_recepcion_status_check;
ALTER TABLE public.accounting_movements
  ADD CONSTRAINT accounting_movements_recepcion_status_check
  CHECK (recepcion_status IS NULL OR recepcion_status IN
    ('no_aplica', 'pendiente_recepcion', 'parcial', 'recibido', 'no_recepcionado'));

NOTIFY pgrst, 'reload schema';
