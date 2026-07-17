-- 138: Categoría de PERSONAL (pedido de Gabriel, jul 2026).
-- Ordena el personal en Obrero / Profesionales / Subcontratos / Otros para el
-- filtro de la página, el scope de gestión de la ing. de seguridad + almacenera
-- (gestionan las 3 primeras, NO "Otros") y la sección SCTR. La categoría se
-- DERIVA del cargo + vínculo en el cliente (src/lib/personal-categoria.js); esta
-- columna guarda el OVERRIDE manual del admin cuando la derivación no acierta.
-- Aditiva y nullable (null = usar la categoría derivada).
ALTER TABLE public.personal ADD COLUMN IF NOT EXISTS categoria text;

-- CHECK laxo: solo las 4 categorías válidas o null (el override lo setea la app,
-- no los imports, así que el CHECK es seguro).
ALTER TABLE public.personal DROP CONSTRAINT IF EXISTS personal_categoria_check;
ALTER TABLE public.personal ADD CONSTRAINT personal_categoria_check
  CHECK (categoria IS NULL OR categoria = ANY (ARRAY['obrero','profesionales','subcontratos','otros']::text[]));

NOTIFY pgrst, 'reload schema';
