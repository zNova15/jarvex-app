-- 153 — Mejora 1b (sep-2026): dimensión PROVEEDOR en el historial de precios.
-- Hasta hoy el historial registraba cuánto cambió el precio pero no A QUIÉN se
-- le compró en cada cambio — imposible responder "¿qué proveedor me lo vende
-- más barato?" hacia adelante. Columnas NULLABLE y aditivas: las filas viejas
-- quedan intactas y el cliente las manda solo cuando las conoce (recepción de
-- comprobantes). FK-less en insumo_precios_historial siguiendo su propio
-- patrón anti-23503 (mig 077); en material_precios_historial también FK-less
-- por consistencia (la fusión de proveedores re-apunta por id igual).

ALTER TABLE material_precios_historial ADD COLUMN IF NOT EXISTS proveedor_id uuid;
ALTER TABLE insumo_precios_historial  ADD COLUMN IF NOT EXISTS proveedor_id uuid;

-- Saneo de datos (mejora 1a): Captura Mágica estampaba tipo_proveedor
-- 'proveedor' (valor basura fuera del select de la UI). Normalizar a 'Otro'
-- (el valor neutro del formulario); el código del cliente deja de estamparlo
-- en el mismo deploy.
UPDATE proveedores SET tipo_proveedor = 'Otro'
 WHERE tipo_proveedor = 'proveedor' AND deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
