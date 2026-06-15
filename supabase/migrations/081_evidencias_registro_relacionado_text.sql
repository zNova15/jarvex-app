-- 081: evidencias.registro_relacionado_id es una referencia POLIMÓRFICA (apunta a
-- distintas tablas según modulo_relacionado) y a veces es una clave COMPUESTA
-- (ej. foto_estado usa '<item_id>:<estado>'). El tipo UUID rechazaba esos valores
-- con 22P02 → la metadata de esas evidencias nunca subía y no se veían en otros
-- equipos. No hay FK sobre la columna, así que pasarla a TEXT es seguro.
ALTER TABLE public.evidencias
  ALTER COLUMN registro_relacionado_id TYPE text USING registro_relacionado_id::text;
