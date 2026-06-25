-- 105: deduplica los frentes "Gastos Generales" y previene la recurrencia con un trigger.
-- El auto-ensure del cliente (jx-frentes) corría en cada device antes de que sincronizara
-- el GG de la mig 101 -> generaba duplicados. Aquí: (1) consolidar a un GG por obra,
-- (2) crear el GG vía TRIGGER en `obras` (server-side, race-free) para las obras nuevas.

-- (1) Dedup: por cada obra con >1 GG vivo, conservar el canónico (idempotency_key
--     'gg_'||obra_id de la mig 101; si no, el más antiguo) y soft-deletear los demás,
--     repuntando referencias por si las hubiera.
CREATE TEMP TABLE _gg_dups ON COMMIT DROP AS
WITH ggs AS (
  SELECT id, obra_id,
    first_value(id) OVER (
      PARTITION BY obra_id
      ORDER BY (idempotency_key = 'gg_' || obra_id::text) DESC, created_at
    ) AS keep_id
  FROM public.frentes_obra
  WHERE deleted_at IS NULL
    AND (es_gastos_generales = true OR lower(nombre) = 'gastos generales')
)
SELECT id AS dup_id, keep_id FROM ggs WHERE id <> keep_id;

UPDATE public.movimientos_materiales m SET frente_id = d.keep_id FROM _gg_dups d WHERE m.frente_id = d.dup_id;
UPDATE public.movimientos_epp m SET frente_id = d.keep_id FROM _gg_dups d WHERE m.frente_id = d.dup_id;
UPDATE public.movimientos_herramientas m SET frente_id = d.keep_id FROM _gg_dups d WHERE m.frente_id = d.dup_id;
UPDATE public.movimientos_insumos_emergencia m SET frente_id = d.keep_id FROM _gg_dups d WHERE m.frente_id = d.dup_id;
UPDATE public.movimientos_maquinaria m SET frente_id = d.keep_id FROM _gg_dups d WHERE m.frente_id = d.dup_id;
UPDATE public.frente_partidas fp SET frente_id = d.keep_id FROM _gg_dups d WHERE fp.frente_id = d.dup_id;
UPDATE public.frentes_obra f SET deleted_at = now(), updated_at = now() FROM _gg_dups d WHERE f.id = d.dup_id;

-- (2) Trigger: crear el frente "Gastos Generales" al insertar una obra (si no existe).
CREATE OR REPLACE FUNCTION public.crear_gastos_generales_obra()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.deleted_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM public.frentes_obra f
    WHERE f.obra_id = NEW.id AND f.deleted_at IS NULL
      AND (f.es_gastos_generales = true OR lower(f.nombre) = 'gastos generales')
  ) THEN
    INSERT INTO public.frentes_obra
      (id, obra_id, nombre, descripcion, es_gastos_generales, orden, activo, version, created_at, updated_at, idempotency_key)
    VALUES
      (gen_random_uuid(), NEW.id, 'Gastos Generales',
       'Insumos de oficina / generales que no entran en partidas de ejecución (ej. agua de oficina).',
       true, 999, true, 1, now(), now(), 'gg_' || NEW.id::text);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_crear_gastos_generales ON public.obras;
CREATE TRIGGER trg_crear_gastos_generales
  AFTER INSERT ON public.obras
  FOR EACH ROW EXECUTE FUNCTION public.crear_gastos_generales_obra();
