-- Habilitar Realtime para las tablas que necesitan notificaciones live
ALTER PUBLICATION supabase_realtime ADD TABLE incidencias;
ALTER PUBLICATION supabase_realtime ADD TABLE materiales;
ALTER PUBLICATION supabase_realtime ADD TABLE movimientos_materiales;
ALTER PUBLICATION supabase_realtime ADD TABLE avance_obra;
