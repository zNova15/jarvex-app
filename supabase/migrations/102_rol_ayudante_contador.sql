-- 102: agrega el rol 'ayudante_contador' (Ayudante de Contabilidad) al CHECK de profiles.rol.
-- El rol 'contador' existente pasa a representar al "Contador Jefe" (relabel en la app),
-- por eso NO se renombra la key en la BD: el usuario contador actual queda como Contador Jefe.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_rol_check CHECK (
  rol = ANY (ARRAY[
    'admin','gerente','ingeniero_residente','ingeniero','supervisor','almacenero',
    'asistente_admin','contador','ayudante_contador','tesorero','jefe_compras','rrhh',
    'prevencionista','maestro_obra','solo_lectura'
  ]::text[])
);
