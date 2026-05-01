-- ╔════════════════════════════════════════════════════════════════════╗
-- ║  Migración 028 — fecha_nacimiento en personal                     ║
-- ║                                                                    ║
-- ║  Agrega fecha_nacimiento al perfil del trabajador. Necesario      ║
-- ║  para PLAME / T-Registro SUNAT (campo obligatorio) y para         ║
-- ║  cálculos de cumpleaños / edad / conformidad legal.               ║
-- ╚════════════════════════════════════════════════════════════════════╝

ALTER TABLE personal
  ADD COLUMN IF NOT EXISTS fecha_nacimiento DATE;

COMMENT ON COLUMN personal.fecha_nacimiento
  IS 'Fecha de nacimiento del trabajador. Requerido por SUNAT T-Registro.';
