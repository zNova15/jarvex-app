-- ═══════════════════════════════════════════════════════════════════
-- JARVEX — Datos de prueba (ejecutar DESPUÉS de las migraciones)
-- ═══════════════════════════════════════════════════════════════════
-- ⚠️  ANTES de ejecutar, REEMPLAZA 'TU_EMAIL_AQUI@gmail.com' por tu email real
--     (el que usaste para crear el usuario admin en Authentication)
-- ═══════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_admin_id UUID;
  v_obra_id UUID;
  v_personal_capataz UUID;
  v_personal_op1 UUID;
  v_personal_op2 UUID;
  v_personal_alm UUID;
  v_personal_seg UUID;
  v_proveedor1 UUID;
  v_proveedor2 UUID;
BEGIN
  -- ── 1. Encontrar tu user ID y promoverte a admin ──────────────────
  SELECT id INTO v_admin_id FROM profiles
  WHERE LOWER(email) = LOWER('grabieljesusjulcasalazar@gmail.com');   -- ← tu email

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró usuario con email grabieljesusjulcasalazar@gmail.com en profiles. Verifica que creaste el usuario en Authentication > Users con ese email exacto.';
  END IF;

  UPDATE profiles
  SET rol = 'admin', nombres = 'Gabriel', apellidos = 'Julca'
  WHERE id = v_admin_id;

  -- Limpiar datos previos del seed (idempotente)
  DELETE FROM asistencia;
  DELETE FROM movimientos_materiales;
  DELETE FROM movimientos_herramientas;
  DELETE FROM avance_obra;
  DELETE FROM insumos_partida;
  DELETE FROM cronograma;
  DELETE FROM partidas;
  DELETE FROM materiales;
  DELETE FROM herramientas;
  DELETE FROM personal;
  DELETE FROM obra_usuarios;
  DELETE FROM obras;
  DELETE FROM proveedores;
  DELETE FROM evidencias;
  DELETE FROM incidencias;

  -- ── 2. Crear proveedores ──────────────────────────────────────────
  INSERT INTO proveedores (id, razon_social, ruc, contacto, telefono, tipo_proveedor, created_by)
  VALUES (gen_random_uuid(), 'Cementos Pacasmayo S.A.A.', '20419387658', 'Juan Pérez', '987654321', 'cemento', v_admin_id)
  RETURNING id INTO v_proveedor1;

  INSERT INTO proveedores (id, razon_social, ruc, contacto, telefono, tipo_proveedor, created_by)
  VALUES (gen_random_uuid(), 'Aceros Arequipa S.A.', '20370146994', 'María Torres', '987111222', 'acero', v_admin_id)
  RETURNING id INTO v_proveedor2;

  -- ── 3. Crear obra de prueba ───────────────────────────────────────
  INSERT INTO obras (
    id, nombre_obra, cliente, ubicacion, estado,
    fecha_inicio, fecha_fin_estimada, presupuesto_total,
    avance_fisico, avance_financiero, responsable_id, created_by
  )
  VALUES (
    gen_random_uuid(),
    'Torres del Sur — Edificio A',
    'Inmobiliaria Lima Sur S.A.C.',
    'Av. El Sol 1234, San Juan de Miraflores, Lima',
    'activo',
    '2026-01-15', '2027-06-30', 4500000.00,
    32.5, 28.7, v_admin_id, v_admin_id
  )
  RETURNING id INTO v_obra_id;

  -- ── 4. Asignarte a la obra como admin ─────────────────────────────
  INSERT INTO obra_usuarios (obra_id, usuario_id, rol_obra, activo)
  VALUES (v_obra_id, v_admin_id, 'admin', true);

  -- ── 5. Crear personal de obra (5 personas) ────────────────────────
  INSERT INTO personal (id, obra_id, nombres, apellidos, dni, cargo, area, fecha_ingreso, telefono, created_by)
  VALUES (gen_random_uuid(), v_obra_id, 'Carlos', 'Mendoza', '40123456', 'Capataz', 'Estructuras', '2026-01-20', '987111111', v_admin_id)
  RETURNING id INTO v_personal_capataz;

  INSERT INTO personal (id, obra_id, nombres, apellidos, dni, cargo, area, fecha_ingreso, telefono, created_by)
  VALUES (gen_random_uuid(), v_obra_id, 'José', 'Quispe', '70234567', 'Operario', 'Acabados', '2026-01-22', '987222222', v_admin_id)
  RETURNING id INTO v_personal_op1;

  INSERT INTO personal (id, obra_id, nombres, apellidos, dni, cargo, area, fecha_ingreso, telefono, created_by)
  VALUES (gen_random_uuid(), v_obra_id, 'Pedro', 'Ramírez', '45345678', 'Operario', 'Estructuras', '2026-01-25', '987333333', v_admin_id)
  RETURNING id INTO v_personal_op2;

  INSERT INTO personal (id, obra_id, nombres, apellidos, dni, cargo, area, fecha_ingreso, telefono, created_by)
  VALUES (gen_random_uuid(), v_obra_id, 'Sofía', 'Ríos', '46456789', 'Almacenera', 'Almacén', '2026-01-15', '987444444', v_admin_id)
  RETURNING id INTO v_personal_alm;

  INSERT INTO personal (id, obra_id, nombres, apellidos, dni, cargo, area, fecha_ingreso, telefono, created_by)
  VALUES (gen_random_uuid(), v_obra_id, 'Luis', 'Vargas', '47567890', 'Supervisor SST', 'Seguridad', '2026-01-15', '987555555', v_admin_id)
  RETURNING id INTO v_personal_seg;

  -- ── 6. Crear materiales (8 items) ─────────────────────────────────
  INSERT INTO materiales (obra_id, nombre_material, categoria, unidad, stock_inicial, stock_actual, stock_minimo, precio_unitario_estimado, proveedor_principal_id, created_by) VALUES
    (v_obra_id, 'Cemento Sol Tipo I',           'Cemento',      'bolsa', 500, 320, 100, 28.50, v_proveedor1, v_admin_id),
    (v_obra_id, 'Fierro corrugado 1/2"',        'Acero',        'varilla', 800, 540, 200, 42.00, v_proveedor2, v_admin_id),
    (v_obra_id, 'Fierro corrugado 5/8"',        'Acero',        'varilla', 600, 380, 150, 65.00, v_proveedor2, v_admin_id),
    (v_obra_id, 'Ladrillo King Kong 18 huecos', 'Albañilería',  'unidad', 5000, 1200, 500, 1.20, NULL, v_admin_id),
    (v_obra_id, 'Arena gruesa',                 'Agregados',    'm³', 80, 25, 20, 65.00, NULL, v_admin_id),
    (v_obra_id, 'Piedra chancada 1/2"',         'Agregados',    'm³', 60, 18, 15, 75.00, NULL, v_admin_id),
    (v_obra_id, 'Alambre N°16',                 'Acero',        'kg', 200, 45, 50, 6.50, v_proveedor2, v_admin_id),
    (v_obra_id, 'Clavos 3"',                    'Ferretería',   'kg', 80, 12, 25, 7.80, NULL, v_admin_id);

  -- Recalcular alertas según stock vs mínimo
  UPDATE materiales
  SET alerta = CASE
    WHEN stock_actual <= 0 THEN 'sin_stock'
    WHEN stock_actual <= stock_minimo * 0.5 THEN 'critico'
    WHEN stock_actual <= stock_minimo THEN 'reponer'
    ELSE 'ok'
  END
  WHERE obra_id = v_obra_id;

  -- ── 7. Crear herramientas (5 items) ───────────────────────────────
  INSERT INTO herramientas (obra_id, nombre_herramienta, tipo_herramienta, marca, modelo, serie, estado_actual, ubicacion_actual, created_by) VALUES
    (v_obra_id, 'Mezcladora de concreto 9p³', 'maquinaria_liviana', 'Toyama',   'CM9',     'TY-2024-001', 'bueno',  'en_uso',   v_admin_id),
    (v_obra_id, 'Vibrador de concreto',       'electrica',         'Bosch',    'GVB-25',  'BS-2024-118', 'bueno',  'almacen',  v_admin_id),
    (v_obra_id, 'Amoladora 7"',               'electrica',         'Makita',   'GA7020',  'MK-2023-445', 'bueno',  'en_uso',   v_admin_id),
    (v_obra_id, 'Taladro percutor',           'electrica',         'DeWalt',   'DCD996',  'DW-2024-089', 'nuevo',  'almacen',  v_admin_id),
    (v_obra_id, 'Nivel láser autonivelante',  'medicion',          'Bosch',    'GLL-3X',  'BS-2024-220', 'bueno',  'almacen',  v_admin_id);

  -- ── 8. Crear partidas (3 partidas básicas) ────────────────────────
  INSERT INTO partidas (obra_id, codigo_delfin, nombre_partida, categoria, unidad, metrado_contratado, precio_unitario_pres, costo_total_presupuestado, fecha_inicio_planificada, fecha_fin_planificada, created_by) VALUES
    (v_obra_id, '02.01.01', 'Excavación masiva con maquinaria',     'Movimiento de tierras', 'm³', 850.00, 18.50, 15725.00, '2026-01-15', '2026-02-10', v_admin_id),
    (v_obra_id, '03.01.01', 'Concreto en zapatas f''c=210 kg/cm²', 'Concreto',              'm³', 120.00, 380.00, 45600.00, '2026-02-15', '2026-03-30', v_admin_id),
    (v_obra_id, '03.02.01', 'Acero corrugado fy=4200 kg/cm²',      'Acero',                 'kg', 8500.00, 4.20, 35700.00, '2026-02-20', '2026-04-15', v_admin_id);

  -- ── 9. Registrar algunos movimientos de almacén ───────────────────
  -- Esto disparará el trigger automático que actualiza stock
  INSERT INTO movimientos_materiales (
    obra_id, material_id, fecha, tipo_movimiento, cantidad, unidad,
    responsable_id, documento_asociado, created_by, idempotency_key
  )
  SELECT
    v_obra_id, m.id, CURRENT_DATE - 2, 'salida', 50, m.unidad,
    v_personal_capataz, 'VALE-001', v_admin_id, gen_random_uuid()::text
  FROM materiales m WHERE m.obra_id = v_obra_id AND m.nombre_material LIKE 'Cemento%';

  INSERT INTO movimientos_materiales (
    obra_id, material_id, fecha, tipo_movimiento, cantidad, unidad,
    responsable_id, proveedor_id, documento_asociado, precio_unitario_real, created_by, idempotency_key
  )
  SELECT
    v_obra_id, m.id, CURRENT_DATE - 1, 'entrada', 100, m.unidad,
    v_personal_alm, v_proveedor1, 'GR-2026-0042', 28.20, v_admin_id, gen_random_uuid()::text
  FROM materiales m WHERE m.obra_id = v_obra_id AND m.nombre_material LIKE 'Cemento%';

  -- ── 10. Registrar asistencia de hoy ───────────────────────────────
  INSERT INTO asistencia (obra_id, personal_id, fecha, hora_ingreso, hora_salida, horas_trabajadas, estado_asistencia, created_by, idempotency_key)
  VALUES
    (v_obra_id, v_personal_capataz, CURRENT_DATE, '07:00', '17:00', 9.00, 'asistio',  v_admin_id, gen_random_uuid()::text),
    (v_obra_id, v_personal_op1,     CURRENT_DATE, '07:15', '17:00', 8.75, 'tardanza', v_admin_id, gen_random_uuid()::text),
    (v_obra_id, v_personal_op2,     CURRENT_DATE, '07:00', '17:00', 9.00, 'asistio',  v_admin_id, gen_random_uuid()::text),
    (v_obra_id, v_personal_alm,     CURRENT_DATE, '06:45', '16:30', 9.00, 'asistio',  v_admin_id, gen_random_uuid()::text),
    (v_obra_id, v_personal_seg,     CURRENT_DATE, NULL,    NULL,    0,    'falta',    v_admin_id, gen_random_uuid()::text);

  RAISE NOTICE '✅ Datos de prueba creados exitosamente.';
  RAISE NOTICE '   Obra: Torres del Sur — Edificio A';
  RAISE NOTICE '   Personal: 5 trabajadores';
  RAISE NOTICE '   Materiales: 8 items';
  RAISE NOTICE '   Herramientas: 5 items';
  RAISE NOTICE '   Partidas: 3';
  RAISE NOTICE '   Movimientos: 2 (1 salida, 1 entrada de cemento)';
  RAISE NOTICE '   Asistencia de hoy: 5 registros';
  RAISE NOTICE '';
  RAISE NOTICE 'Ya puedes iniciar sesión en JARVEX con tu email y password.';
END $$;
