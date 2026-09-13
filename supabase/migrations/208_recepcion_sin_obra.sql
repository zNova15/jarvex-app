-- 208 · Recepciones de almacén sin obra: cerrar las 5 que quedaron colgadas
--
-- SÍNTOMA (Gabriel, 13-set-2026): «el casillero de captura mágica para enviar
-- a que lo vea el almacén de obra solo debe estar disponible si elegimos una
-- obra activa, ese casillero siempre se activa así sea que lo queramos
-- vincular con gastos generales de la empresa u otra cosa. Arregla los que
-- existen.»
--
-- QUÉ PASABA: el casillero salía marcado y editable sin mirar el destino. Al
-- confirmar, el movimiento quedaba con recepcion_status='pendiente_recepcion'
-- pero con obra_id NULL (Gastos Generales / Contabilidad Neta / "No sé").
--
-- POR QUÉ IMPORTA: «Compras pendientes» (jx-compras-pendientes.jsx) filtra por
--   m.obra_id === obraId
-- así que una recepción pendiente SIN obra no le aparece a NINGÚN almacenero.
-- Queda pendiente para siempre, sin dueño y sin forma de cerrarla desde la UI:
-- no es un pendiente real, es basura que ensucia el semáforo de recepción de
-- la factura en Contabilidad.
--
-- MEDIDO ANTES DE APLICAR (13-set-2026): 5 filas, todas 'contabilidad_neta',
-- entre S/ 32,40 y S/ 3.305,00 (E001-11131 HOSH, E001-63 INVERSIONES LLANOS,
-- F778-102164 AMERICA EXPRESS, F020-2736 JOMA, E001-5607 VARGAS DCP).
-- Las 77 pendientes CON obra no se tocan: esas sí son trabajo real del almacén.
--
-- QUÉ HACE: las pasa a 'no_aplica', que es el valor que la app habría escrito
-- hoy con la regla nueva (src/lib/recepcion-almacen.js). NO toca importes, ni
-- fechas, ni la clasificación contable, ni el detalle de items_factura — solo
-- el semáforo de recepción. Es reversible: el estado viejo está en el
-- WHERE de esta migración.
--
-- Los triggers se dejan CORRER a propósito (al revés que la mig 204): son 5
-- filas, así que el bump de updated_at/version no mueve el egress, y en cambio
-- es lo que hace que los dispositivos se enteren del cambio en el próximo pull.

update accounting_movements
   set recepcion_status = 'no_aplica'
 where deleted_at is null
   and obra_id is null
   and recepcion_status in ('pendiente_recepcion', 'parcial');
