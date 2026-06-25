-- 108: re-sincroniza obra_usuarios.rol_obra = profiles.rol (idempotente).
-- El heal de la mig 106 corrió ANTES de que se asignaran nuevos usuarios (ej. el
-- Ayudante de Contabilidad quedó con rol_obra='solo_lectura' vía el panel de asignación
-- por obra, que defaulteaba a 'solo_lectura'). Esto los re-sincroniza para que la RLS de
-- Storage les permita subir evidencias. El default del panel ya se corrigió en la app
-- (al elegir el usuario, rol_obra toma su rol de perfil).
UPDATE public.obra_usuarios ou
SET rol_obra = p.rol
FROM public.profiles p
WHERE ou.usuario_id = p.id
  AND ou.rol_obra <> p.rol;
