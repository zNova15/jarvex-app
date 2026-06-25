-- 103: amplía el CHECK de obra_usuarios.rol_obra a TODOS los roles de la app.
-- El CHECK viejo solo permitía admin/gerente/ingeniero_residente/supervisor/almacenero/
-- asistente_admin/solo_lectura, así que asignar una obra a un contador, ayudante_contador,
-- tesorero, jefe_compras, rrhh, prevencionista, maestro_obra o ingeniero fallaba con
-- check_violation (la UI escribe rol_obra = rol de la app). Sin esto, NO se puede asignar
-- obras al Contador Jefe ni al Ayudante de Contabilidad.
ALTER TABLE public.obra_usuarios DROP CONSTRAINT IF EXISTS obra_usuarios_rol_obra_check;
ALTER TABLE public.obra_usuarios ADD CONSTRAINT obra_usuarios_rol_obra_check CHECK (
  rol_obra = ANY (ARRAY[
    'admin','gerente','ingeniero_residente','ingeniero','supervisor','almacenero',
    'asistente_admin','contador','ayudante_contador','tesorero','jefe_compras','rrhh',
    'prevencionista','maestro_obra','solo_lectura'
  ]::text[])
);
