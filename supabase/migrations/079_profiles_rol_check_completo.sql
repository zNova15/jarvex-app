-- 079: el CHECK de profiles.rol estaba desfasado del menú de roles de la app
-- (ROL_KEYS en jx-admin.jsx). Faltaban: ingeniero, contador, tesorero,
-- jefe_compras, rrhh, prevencionista, maestro_obra. Por eso crear/cambiar a esos
-- roles tiraba "profiles_rol_check violation" y el rol caía a solo_lectura.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_rol_check CHECK (
  rol = ANY (ARRAY[
    'admin','gerente','ingeniero_residente','ingeniero','supervisor',
    'almacenero','asistente_admin','contador','tesorero','jefe_compras',
    'rrhh','prevencionista','maestro_obra','solo_lectura'
  ])
);
