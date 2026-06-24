-- 101: frente especial "Gastos Generales" por obra.
--
-- Hay insumos usados en oficina/generales (ej. bidón de agua de oficina) que NO
-- entran en las partidas de ejecución. En vez de dejar la salida SIN frente, la
-- almacenera la asigna a este frente "Gastos Generales" (uno por obra, marcado con
-- es_gastos_generales para distinguirlo y protegerlo en la UI).
ALTER TABLE public.frentes_obra
  ADD COLUMN IF NOT EXISTS es_gastos_generales boolean DEFAULT false;

-- Crear el frente "Gastos Generales" en cada obra que no lo tenga.
INSERT INTO public.frentes_obra (id, obra_id, nombre, descripcion, es_gastos_generales, orden, activo, version, created_at, updated_at, idempotency_key)
SELECT gen_random_uuid(), o.id, 'Gastos Generales',
       'Insumos de oficina / generales que no entran en partidas de ejecución (ej. agua de oficina).',
       true, 999, true, 1, now(), now(), 'gg_' || o.id::text
FROM public.obras o
WHERE o.deleted_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.frentes_obra f
    WHERE f.obra_id = o.id AND f.deleted_at IS NULL
      AND (f.es_gastos_generales = true OR lower(f.nombre) = 'gastos generales')
  );
