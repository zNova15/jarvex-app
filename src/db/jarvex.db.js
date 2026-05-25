import Dexie from 'dexie';

export const db = new Dexie('JarvexDB');

// Nota: las tablas movimientos_materiales y movimientos_herramientas pueden contener
// además de los campos indexados, los siguientes (sin índice — Dexie los acepta como
// propiedades regulares):
//   - reverses_id: string | null    → id del movimiento original que este reverso cancela
//   - reversed_by_id: string | null → id del movimiento de reverso que cancela este movimiento
// Versión 15: EPPs como base separada de materiales.
// `epps`: catálogo/inventario de equipos de protección personal con vida útil,
//   stock, ubicación. Estructura paralela a `materiales` pero con campos
//   propios (tipo_epp, vida_util_dias, talla).
// `movimientos_epp`: ingreso/salida del inventario EPP. La salida lleva
//   firma_url del trabajador (registro físico exigido por SUNAFIL).
//   `epp_entregas` se mantiene para no romper datos viejos pero los flujos
//   nuevos usan movimientos_epp.
// Versión 16: Stock por ubicación (desglose) + traspasos entre almacenes.
// Tabla genérica para material/herramienta/epp. Patrón incremental: Dexie
// mergea esta tabla con el schema de v15 (las demás tablas se heredan).
db.version(16).stores({
  stock_ubicaciones: 'id, obra_id, item_tipo, item_id, ubicacion_id, deleted_at, sync_status, [item_tipo+item_id]',
});

db.version(15).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, ubicacion_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, ubicacion_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  companies:                 'id, ruc, status, rubro, rol_grupo, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, chain_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, chain_id, deleted_at, sync_status',
  trazabilidad_cadenas:      'id, obra_id, item_nombre, fecha, ejecutora_company_id, estado, deleted_at, sync_status',
  captura_magica_pending:    'id, status, created_at',

  requisiciones:             'id, obra_id, estado, fecha, deleted_at, sync_status',
  requisicion_items:         'id, requisicion_id, material_id, deleted_at, sync_status',
  cotizaciones:              'id, requisicion_id, proveedor_id, estado, deleted_at, sync_status',
  cotizacion_items:          'id, cotizacion_id, requisicion_item_id, deleted_at, sync_status',
  ordenes_compra:            'id, obra_id, proveedor_id, estado, fecha, deleted_at, sync_status',
  oc_items:                  'id, orden_compra_id, material_id, deleted_at, sync_status',
  recepciones:               'id, orden_compra_id, fecha, deleted_at, sync_status',
  recepcion_items:           'id, recepcion_id, oc_item_id, deleted_at, sync_status',

  valorizaciones:            'id, obra_id, numero, estado, periodo_anio, periodo_mes, deleted_at, sync_status',
  valorizacion_partidas:     'id, valorizacion_id, partida_id, deleted_at, sync_status',
  valorizacion_adicionales:  'id, valorizacion_id, deleted_at, sync_status',

  cuentas_bancarias:         'id, company_id, estado, deleted_at, sync_status',
  movimientos_bancarios:     'id, cuenta_id, fecha, conciliado, deleted_at, sync_status',
  cronograma_pagos:          'id, company_id, estado, fecha_programada, deleted_at, sync_status',

  activos_pesados:           'id, obra_actual_id, ubicacion_id, company_id, estado, placa, deleted_at, sync_status',
  horas_maquina:             'id, activo_id, obra_id, fecha, deleted_at, sync_status',
  consumos_combustible:      'id, activo_id, fecha, deleted_at, sync_status',
  mantenimientos_maquinaria: 'id, activo_id, fecha, deleted_at, sync_status',

  charlas_seguridad:         'id, obra_id, fecha, deleted_at, sync_status',
  charla_asistentes:         'id, charla_id, personal_id, deleted_at, sync_status',
  iperc:                     'id, obra_id, clasificacion, estado, deleted_at, sync_status',
  epp_entregas:              'id, obra_id, personal_id, fecha, deleted_at, sync_status',
  // EPPs (nuevo): catálogo de inventario + movimientos con firma
  epps:                      'id, obra_id, ubicacion_id, tipo_epp, alerta, deleted_at, sync_status',
  movimientos_epp:           'id, obra_id, epp_id, personal_id, fecha, sync_status, idempotency_key',
  inspecciones_seguridad:    'id, obra_id, fecha, resultado, deleted_at, sync_status',
  capacitaciones:            'id, obra_id, fecha, tipo, deleted_at, sync_status',

  subcontratistas:           'id, ruc, estado, deleted_at, sync_status',
  subcontratos:              'id, obra_id, subcontratista_id, estado, deleted_at, sync_status',
  subcontrato_valorizaciones:'id, subcontrato_id, numero, estado, deleted_at, sync_status',

  personal_contrato:         'id, personal_id, estado, deleted_at, sync_status',
  planillas:                 'id, obra_id, periodo_anio, periodo_mes, estado, deleted_at, sync_status',
  planilla_boletas:          'id, planilla_id, personal_id, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  ubicaciones_obra:         'id, obra_id, activo, deleted_at, sync_status',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:            '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 14: Trazabilidad — facturas internas vinculadas a cadenas.
// Añade índices `chain_id` y `chain_step_index` a accounting_movements para
// poder agrupar las facturas borrador generadas desde una cadena de
// trazabilidad. intercompany_transactions ya tenía chain_id pero se aclara su
// uso: ahora cada paso de la cadena puede generar un par de movimientos
// (income/cost) + 1 transacción intercompany ligados via chain_id.
db.version(14).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, ubicacion_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, ubicacion_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  companies:                 'id, ruc, status, rubro, rol_grupo, deleted_at, sync_status',
  // chain_id añadido a accounting_movements para enlazar facturas internas a una cadena.
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, chain_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, chain_id, deleted_at, sync_status',
  trazabilidad_cadenas:      'id, obra_id, item_nombre, fecha, ejecutora_company_id, estado, deleted_at, sync_status',
  captura_magica_pending:    'id, status, created_at',

  requisiciones:             'id, obra_id, estado, fecha, deleted_at, sync_status',
  requisicion_items:         'id, requisicion_id, material_id, deleted_at, sync_status',
  cotizaciones:              'id, requisicion_id, proveedor_id, estado, deleted_at, sync_status',
  cotizacion_items:          'id, cotizacion_id, requisicion_item_id, deleted_at, sync_status',
  ordenes_compra:            'id, obra_id, proveedor_id, estado, fecha, deleted_at, sync_status',
  oc_items:                  'id, orden_compra_id, material_id, deleted_at, sync_status',
  recepciones:               'id, orden_compra_id, fecha, deleted_at, sync_status',
  recepcion_items:           'id, recepcion_id, oc_item_id, deleted_at, sync_status',

  valorizaciones:            'id, obra_id, numero, estado, periodo_anio, periodo_mes, deleted_at, sync_status',
  valorizacion_partidas:     'id, valorizacion_id, partida_id, deleted_at, sync_status',
  valorizacion_adicionales:  'id, valorizacion_id, deleted_at, sync_status',

  cuentas_bancarias:         'id, company_id, estado, deleted_at, sync_status',
  movimientos_bancarios:     'id, cuenta_id, fecha, conciliado, deleted_at, sync_status',
  cronograma_pagos:          'id, company_id, estado, fecha_programada, deleted_at, sync_status',

  activos_pesados:           'id, obra_actual_id, ubicacion_id, company_id, estado, placa, deleted_at, sync_status',
  horas_maquina:             'id, activo_id, obra_id, fecha, deleted_at, sync_status',
  consumos_combustible:      'id, activo_id, fecha, deleted_at, sync_status',
  mantenimientos_maquinaria: 'id, activo_id, fecha, deleted_at, sync_status',

  charlas_seguridad:         'id, obra_id, fecha, deleted_at, sync_status',
  charla_asistentes:         'id, charla_id, personal_id, deleted_at, sync_status',
  iperc:                     'id, obra_id, clasificacion, estado, deleted_at, sync_status',
  epp_entregas:              'id, obra_id, personal_id, fecha, deleted_at, sync_status',
  inspecciones_seguridad:    'id, obra_id, fecha, resultado, deleted_at, sync_status',
  capacitaciones:            'id, obra_id, fecha, tipo, deleted_at, sync_status',

  subcontratistas:           'id, ruc, estado, deleted_at, sync_status',
  subcontratos:              'id, obra_id, subcontratista_id, estado, deleted_at, sync_status',
  subcontrato_valorizaciones:'id, subcontrato_id, numero, estado, deleted_at, sync_status',

  personal_contrato:         'id, personal_id, estado, deleted_at, sync_status',
  planillas:                 'id, obra_id, periodo_anio, periodo_mes, estado, deleted_at, sync_status',
  planilla_boletas:          'id, planilla_id, personal_id, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  ubicaciones_obra:         'id, obra_id, activo, deleted_at, sync_status',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:            '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 13: Ubicaciones de almacenaje por obra.
// Catálogo per-obra de zonas físicas (Patio, Bóveda, Almacén Central, etc.).
// Materiales, herramientas y activos pesados pueden referenciar una ubicación
// del catálogo de su obra mediante ubicacion_id.
db.version(13).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, ubicacion_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, ubicacion_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  companies:                 'id, ruc, status, rubro, rol_grupo, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, chain_id, deleted_at, sync_status',
  trazabilidad_cadenas:      'id, obra_id, item_nombre, fecha, ejecutora_company_id, estado, deleted_at, sync_status',
  captura_magica_pending:    'id, status, created_at',

  requisiciones:             'id, obra_id, estado, fecha, deleted_at, sync_status',
  requisicion_items:         'id, requisicion_id, material_id, deleted_at, sync_status',
  cotizaciones:              'id, requisicion_id, proveedor_id, estado, deleted_at, sync_status',
  cotizacion_items:          'id, cotizacion_id, requisicion_item_id, deleted_at, sync_status',
  ordenes_compra:            'id, obra_id, proveedor_id, estado, fecha, deleted_at, sync_status',
  oc_items:                  'id, orden_compra_id, material_id, deleted_at, sync_status',
  recepciones:               'id, orden_compra_id, fecha, deleted_at, sync_status',
  recepcion_items:           'id, recepcion_id, oc_item_id, deleted_at, sync_status',

  valorizaciones:            'id, obra_id, numero, estado, periodo_anio, periodo_mes, deleted_at, sync_status',
  valorizacion_partidas:     'id, valorizacion_id, partida_id, deleted_at, sync_status',
  valorizacion_adicionales:  'id, valorizacion_id, deleted_at, sync_status',

  cuentas_bancarias:         'id, company_id, estado, deleted_at, sync_status',
  movimientos_bancarios:     'id, cuenta_id, fecha, conciliado, deleted_at, sync_status',
  cronograma_pagos:          'id, company_id, estado, fecha_programada, deleted_at, sync_status',

  activos_pesados:           'id, obra_actual_id, ubicacion_id, company_id, estado, placa, deleted_at, sync_status',
  horas_maquina:             'id, activo_id, obra_id, fecha, deleted_at, sync_status',
  consumos_combustible:      'id, activo_id, fecha, deleted_at, sync_status',
  mantenimientos_maquinaria: 'id, activo_id, fecha, deleted_at, sync_status',

  charlas_seguridad:         'id, obra_id, fecha, deleted_at, sync_status',
  charla_asistentes:         'id, charla_id, personal_id, deleted_at, sync_status',
  iperc:                     'id, obra_id, clasificacion, estado, deleted_at, sync_status',
  epp_entregas:              'id, obra_id, personal_id, fecha, deleted_at, sync_status',
  inspecciones_seguridad:    'id, obra_id, fecha, resultado, deleted_at, sync_status',
  capacitaciones:            'id, obra_id, fecha, tipo, deleted_at, sync_status',

  subcontratistas:           'id, ruc, estado, deleted_at, sync_status',
  subcontratos:              'id, obra_id, subcontratista_id, estado, deleted_at, sync_status',
  subcontrato_valorizaciones:'id, subcontrato_id, numero, estado, deleted_at, sync_status',

  personal_contrato:         'id, personal_id, estado, deleted_at, sync_status',
  planillas:                 'id, obra_id, periodo_anio, periodo_mes, estado, deleted_at, sync_status',
  planilla_boletas:          'id, planilla_id, personal_id, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  ubicaciones_obra:         'id, obra_id, activo, deleted_at, sync_status',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:            '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 12: bandeja Captura Mágica persistente.
// Las facturas en proceso (pendientes/parsed/revisar) sobreviven cierre de pestaña,
// recarga y navegación a otras rutas hasta que el usuario las confirma o descarta.
// Guardamos el blob original del PDF/imagen junto con el JSON parseado y el state
// del review form.
db.version(12).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  companies:                 'id, ruc, status, rubro, rol_grupo, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, chain_id, deleted_at, sync_status',
  trazabilidad_cadenas:      'id, obra_id, item_nombre, fecha, ejecutora_company_id, estado, deleted_at, sync_status',
  // ── NUEVO en v12 ──
  // status: 'pendiente' | 'procesando' | 'revisar' | 'confirmado' | 'error' | 'duplicado'
  // Solo se persisten items NO confirmados; al confirmar se borra de aquí.
  captura_magica_pending:    'id, status, created_at',

  requisiciones:             'id, obra_id, estado, fecha, deleted_at, sync_status',
  requisicion_items:         'id, requisicion_id, material_id, deleted_at, sync_status',
  cotizaciones:              'id, requisicion_id, proveedor_id, estado, deleted_at, sync_status',
  cotizacion_items:          'id, cotizacion_id, requisicion_item_id, deleted_at, sync_status',
  ordenes_compra:            'id, obra_id, proveedor_id, estado, fecha, deleted_at, sync_status',
  oc_items:                  'id, orden_compra_id, material_id, deleted_at, sync_status',
  recepciones:               'id, orden_compra_id, fecha, deleted_at, sync_status',
  recepcion_items:           'id, recepcion_id, oc_item_id, deleted_at, sync_status',

  valorizaciones:            'id, obra_id, numero, estado, periodo_anio, periodo_mes, deleted_at, sync_status',
  valorizacion_partidas:     'id, valorizacion_id, partida_id, deleted_at, sync_status',
  valorizacion_adicionales:  'id, valorizacion_id, deleted_at, sync_status',

  cuentas_bancarias:         'id, company_id, estado, deleted_at, sync_status',
  movimientos_bancarios:     'id, cuenta_id, fecha, conciliado, deleted_at, sync_status',
  cronograma_pagos:          'id, company_id, estado, fecha_programada, deleted_at, sync_status',

  activos_pesados:           'id, obra_actual_id, company_id, estado, placa, deleted_at, sync_status',
  horas_maquina:             'id, activo_id, obra_id, fecha, deleted_at, sync_status',
  consumos_combustible:      'id, activo_id, fecha, deleted_at, sync_status',
  mantenimientos_maquinaria: 'id, activo_id, fecha, deleted_at, sync_status',

  charlas_seguridad:         'id, obra_id, fecha, deleted_at, sync_status',
  charla_asistentes:         'id, charla_id, personal_id, deleted_at, sync_status',
  iperc:                     'id, obra_id, clasificacion, estado, deleted_at, sync_status',
  epp_entregas:              'id, obra_id, personal_id, fecha, deleted_at, sync_status',
  inspecciones_seguridad:    'id, obra_id, fecha, resultado, deleted_at, sync_status',
  capacitaciones:            'id, obra_id, fecha, tipo, deleted_at, sync_status',

  subcontratistas:           'id, ruc, estado, deleted_at, sync_status',
  subcontratos:              'id, obra_id, subcontratista_id, estado, deleted_at, sync_status',
  subcontrato_valorizaciones:'id, subcontrato_id, numero, estado, deleted_at, sync_status',

  personal_contrato:         'id, personal_id, estado, deleted_at, sync_status',
  planillas:                 'id, obra_id, periodo_anio, periodo_mes, estado, deleted_at, sync_status',
  planilla_boletas:          'id, planilla_id, personal_id, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:            '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 11: Trazabilidad — cadenas de markups intercompany.
db.version(11).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  companies:                 'id, ruc, status, rubro, rol_grupo, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, chain_id, deleted_at, sync_status',
  // ── NUEVO en v11 ──
  trazabilidad_cadenas:      'id, obra_id, item_nombre, fecha, ejecutora_company_id, estado, deleted_at, sync_status',

  requisiciones:             'id, obra_id, estado, fecha, deleted_at, sync_status',
  requisicion_items:         'id, requisicion_id, material_id, deleted_at, sync_status',
  cotizaciones:              'id, requisicion_id, proveedor_id, estado, deleted_at, sync_status',
  cotizacion_items:          'id, cotizacion_id, requisicion_item_id, deleted_at, sync_status',
  ordenes_compra:            'id, obra_id, proveedor_id, estado, fecha, deleted_at, sync_status',
  oc_items:                  'id, orden_compra_id, material_id, deleted_at, sync_status',
  recepciones:               'id, orden_compra_id, fecha, deleted_at, sync_status',
  recepcion_items:           'id, recepcion_id, oc_item_id, deleted_at, sync_status',

  valorizaciones:            'id, obra_id, numero, estado, periodo_anio, periodo_mes, deleted_at, sync_status',
  valorizacion_partidas:     'id, valorizacion_id, partida_id, deleted_at, sync_status',
  valorizacion_adicionales:  'id, valorizacion_id, deleted_at, sync_status',

  cuentas_bancarias:         'id, company_id, estado, deleted_at, sync_status',
  movimientos_bancarios:     'id, cuenta_id, fecha, conciliado, deleted_at, sync_status',
  cronograma_pagos:          'id, company_id, estado, fecha_programada, deleted_at, sync_status',

  activos_pesados:           'id, obra_actual_id, company_id, estado, placa, deleted_at, sync_status',
  horas_maquina:             'id, activo_id, obra_id, fecha, deleted_at, sync_status',
  consumos_combustible:      'id, activo_id, fecha, deleted_at, sync_status',
  mantenimientos_maquinaria: 'id, activo_id, fecha, deleted_at, sync_status',

  charlas_seguridad:         'id, obra_id, fecha, deleted_at, sync_status',
  charla_asistentes:         'id, charla_id, personal_id, deleted_at, sync_status',
  iperc:                     'id, obra_id, clasificacion, estado, deleted_at, sync_status',
  epp_entregas:              'id, obra_id, personal_id, fecha, deleted_at, sync_status',
  inspecciones_seguridad:    'id, obra_id, fecha, resultado, deleted_at, sync_status',
  capacitaciones:            'id, obra_id, fecha, tipo, deleted_at, sync_status',

  subcontratistas:           'id, ruc, estado, deleted_at, sync_status',
  subcontratos:              'id, obra_id, subcontratista_id, estado, deleted_at, sync_status',
  subcontrato_valorizaciones:'id, subcontrato_id, numero, estado, deleted_at, sync_status',

  personal_contrato:         'id, personal_id, estado, deleted_at, sync_status',
  planillas:                 'id, obra_id, periodo_anio, periodo_mes, estado, deleted_at, sync_status',
  planilla_boletas:          'id, planilla_id, personal_id, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:            '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 10: SSOMA + Subcontratos + Planillas (RRHH).
db.version(10).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  companies:                 'id, ruc, status, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, deleted_at, sync_status',

  requisiciones:             'id, obra_id, estado, fecha, deleted_at, sync_status',
  requisicion_items:         'id, requisicion_id, material_id, deleted_at, sync_status',
  cotizaciones:              'id, requisicion_id, proveedor_id, estado, deleted_at, sync_status',
  cotizacion_items:          'id, cotizacion_id, requisicion_item_id, deleted_at, sync_status',
  ordenes_compra:            'id, obra_id, proveedor_id, estado, fecha, deleted_at, sync_status',
  oc_items:                  'id, orden_compra_id, material_id, deleted_at, sync_status',
  recepciones:               'id, orden_compra_id, fecha, deleted_at, sync_status',
  recepcion_items:           'id, recepcion_id, oc_item_id, deleted_at, sync_status',

  valorizaciones:            'id, obra_id, numero, estado, periodo_anio, periodo_mes, deleted_at, sync_status',
  valorizacion_partidas:     'id, valorizacion_id, partida_id, deleted_at, sync_status',
  valorizacion_adicionales:  'id, valorizacion_id, deleted_at, sync_status',

  cuentas_bancarias:         'id, company_id, estado, deleted_at, sync_status',
  movimientos_bancarios:     'id, cuenta_id, fecha, conciliado, deleted_at, sync_status',
  cronograma_pagos:          'id, company_id, estado, fecha_programada, deleted_at, sync_status',

  activos_pesados:           'id, obra_actual_id, company_id, estado, placa, deleted_at, sync_status',
  horas_maquina:             'id, activo_id, obra_id, fecha, deleted_at, sync_status',
  consumos_combustible:      'id, activo_id, fecha, deleted_at, sync_status',
  mantenimientos_maquinaria: 'id, activo_id, fecha, deleted_at, sync_status',

  // ── SSOMA — NUEVO en v10 ──
  charlas_seguridad:         'id, obra_id, fecha, deleted_at, sync_status',
  charla_asistentes:         'id, charla_id, personal_id, deleted_at, sync_status',
  iperc:                     'id, obra_id, clasificacion, estado, deleted_at, sync_status',
  epp_entregas:              'id, obra_id, personal_id, fecha, deleted_at, sync_status',
  inspecciones_seguridad:    'id, obra_id, fecha, resultado, deleted_at, sync_status',
  capacitaciones:            'id, obra_id, fecha, tipo, deleted_at, sync_status',

  // ── Subcontratos — NUEVO en v10 ──
  subcontratistas:           'id, ruc, estado, deleted_at, sync_status',
  subcontratos:              'id, obra_id, subcontratista_id, estado, deleted_at, sync_status',
  subcontrato_valorizaciones:'id, subcontrato_id, numero, estado, deleted_at, sync_status',

  // ── Planillas — NUEVO en v10 ──
  personal_contrato:         'id, personal_id, estado, deleted_at, sync_status',
  planillas:                 'id, obra_id, periodo_anio, periodo_mes, estado, deleted_at, sync_status',
  planilla_boletas:          'id, planilla_id, personal_id, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:            '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 9: compras + valorizaciones + tesorería + activos
db.version(9).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  companies:                 'id, ruc, status, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, deleted_at, sync_status',

  // ── Compras (Logística) — NUEVO en v9 ──
  requisiciones:             'id, obra_id, estado, fecha, deleted_at, sync_status',
  requisicion_items:         'id, requisicion_id, material_id, deleted_at, sync_status',
  cotizaciones:              'id, requisicion_id, proveedor_id, estado, deleted_at, sync_status',
  cotizacion_items:          'id, cotizacion_id, requisicion_item_id, deleted_at, sync_status',
  ordenes_compra:            'id, obra_id, proveedor_id, estado, fecha, deleted_at, sync_status',
  oc_items:                  'id, orden_compra_id, material_id, deleted_at, sync_status',
  recepciones:               'id, orden_compra_id, fecha, deleted_at, sync_status',
  recepcion_items:           'id, recepcion_id, oc_item_id, deleted_at, sync_status',

  // ── Valorizaciones — NUEVO en v9 ──
  valorizaciones:            'id, obra_id, numero, estado, periodo_anio, periodo_mes, deleted_at, sync_status',
  valorizacion_partidas:     'id, valorizacion_id, partida_id, deleted_at, sync_status',
  valorizacion_adicionales:  'id, valorizacion_id, deleted_at, sync_status',

  // ── Tesorería — NUEVO en v9 ──
  cuentas_bancarias:         'id, company_id, estado, deleted_at, sync_status',
  movimientos_bancarios:     'id, cuenta_id, fecha, conciliado, deleted_at, sync_status',
  cronograma_pagos:          'id, company_id, estado, fecha_programada, deleted_at, sync_status',

  // ── Activos pesados — NUEVO en v9 ──
  activos_pesados:           'id, obra_actual_id, company_id, estado, placa, deleted_at, sync_status',
  horas_maquina:             'id, activo_id, obra_id, fecha, deleted_at, sync_status',
  consumos_combustible:      'id, activo_id, fecha, deleted_at, sync_status',
  mantenimientos_maquinaria: 'id, activo_id, fecha, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 8: contabilidad
db.version(8).stores({
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  // ── Contabilidad (NUEVO en v8) ──
  companies:                 'id, ruc, status, deleted_at, sync_status',
  accounting_movements:      'id, company_id, type, date, payment_status, is_intercompany, related_movement_id, deleted_at, sync_status',
  intercompany_transactions: 'id, seller_company_id, buyer_company_id, date, deleted_at, sync_status',

  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 7: material_precios_historial
db.version(7).stores({
  // ── Maestras ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Presupuestos versionados ──
  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',

  // ── Historial de precios (NUEVO en v7) ──
  material_precios_historial:    'id, material_id, obra_id, fecha, deleted_at, sync_status',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 6: insumos_partida_versionadas
db.version(6).stores({
  // ── Maestras ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Presupuestos versionados ──
  presupuestos_versiones:        'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:          'id, version_id, obra_id, codigo, deleted_at, sync_status',
  insumos_partida_versionadas:   'id, version_id, partida_versionada_id, obra_id, deleted_at, sync_status',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 5: agregamos presupuestos_versiones y partidas_versionadas
db.version(5).stores({
  // ── Maestras ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Presupuestos versionados (NUEVO en v5) ──
  presupuestos_versiones:   'id, obra_id, numero, deleted_at, sync_status',
  partidas_versionadas:     'id, version_id, obra_id, codigo, deleted_at, sync_status',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

// Versión 4: agregamos sync_status como índice a TODAS las master tables.
db.version(4).stores({
  // ── Maestras (con índice sync_status para que el push las recorra) ──
  obras:                    'id, estado, deleted_at, sync_status',
  personal:                 'id, obra_id, dni, estado, deleted_at, sync_status',
  materiales:               'id, obra_id, categoria, alerta, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at, sync_status',
  proveedores:              'id, ruc, deleted_at, sync_status',
  partidas:                 'id, obra_id, estado, deleted_at, sync_status',
  insumos_partida:          'id, obra_id, partida_id, sync_status',
  cronograma:               'id, obra_id, partida_id, sync_status',
  profiles:                 'id, rol',

  // ── Transaccionales ──
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control + colas ──
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',
  auth_cache:               'key',
});

db.version(3).stores({
  // ── Maestras (sync periódico, solo lectura offline) ──────────────────
  obras:                    'id, estado, deleted_at',
  personal:                 'id, obra_id, dni, estado, deleted_at',
  materiales:               'id, obra_id, categoria, alerta, deleted_at',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at',
  proveedores:              'id, ruc, deleted_at',
  partidas:                 'id, obra_id, estado, deleted_at',
  insumos_partida:          'id, obra_id, partida_id',
  cronograma:               'id, obra_id, partida_id',
  profiles:                 'id, rol',

  // ── Transaccionales (escritura offline + cola de sync) ───────────────
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',

  // ── Evidencias (blob local + metadata) ──────────────────────────────
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control de sincronización ────────────────────────────────────────
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',

  // ── Auditoría (cola offline) ─────────────────────────────────────────
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',

  // ── Solicitudes de cambio (cola offline) ─────────────────────────────
  change_requests_pending:  'id, target_table, target_record_id, requester_id, synced, created_at',

  // ── Auth offline ─────────────────────────────────────────────────────
  auth_cache:               'key',
});

db.version(2).stores({
  // ── Maestras (sync periódico, solo lectura offline) ──────────────────
  obras:                    'id, estado, deleted_at',
  personal:                 'id, obra_id, dni, estado, deleted_at',
  materiales:               'id, obra_id, categoria, alerta, deleted_at',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at',
  proveedores:              'id, ruc, deleted_at',
  partidas:                 'id, obra_id, estado, deleted_at',
  insumos_partida:          'id, obra_id, partida_id',
  cronograma:               'id, obra_id, partida_id',
  profiles:                 'id, rol',

  // ── Transaccionales (escritura offline + cola de sync) ───────────────
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',

  // ── Evidencias (blob local + metadata) ──────────────────────────────
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control de sincronización ────────────────────────────────────────
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',

  // ── Auditoría (cola offline) ─────────────────────────────────────────
  audit_log_pending:        'id, table_name, record_id, user_id, synced, created_at',

  // ── Auth offline ─────────────────────────────────────────────────────
  auth_cache:               'key',
});

db.version(1).stores({
  // ── Maestras (sync periódico, solo lectura offline) ──────────────────
  obras:                    'id, estado, deleted_at',
  personal:                 'id, obra_id, dni, estado, deleted_at',
  materiales:               'id, obra_id, categoria, alerta, deleted_at',
  herramientas:             'id, obra_id, estado_actual, disponible, deleted_at',
  proveedores:              'id, ruc, deleted_at',
  partidas:                 'id, obra_id, estado, deleted_at',
  insumos_partida:          'id, obra_id, partida_id',
  cronograma:               'id, obra_id, partida_id',
  profiles:                 'id, rol',

  // ── Transaccionales (escritura offline + cola de sync) ───────────────
  asistencia:               'id, obra_id, personal_id, fecha, sync_status, idempotency_key',
  movimientos_materiales:   'id, obra_id, material_id, fecha, sync_status, idempotency_key',
  movimientos_herramientas: 'id, obra_id, herramienta_id, fecha, sync_status, idempotency_key',
  avance_obra:              'id, obra_id, partida_id, fecha, sync_status, idempotency_key',
  incidencias:              'id, obra_id, estado, sync_status',

  // ── Evidencias (blob local + metadata) ──────────────────────────────
  evidencias:               'id, obra_id, modulo_relacionado, registro_relacionado_id, sync_status',
  evidencias_blobs:         'id',

  // ── Control de sincronización ────────────────────────────────────────
  sync_queue:               '++local_seq, tabla, registro_id, operacion, sync_status, created_at',
  sync_conflicts:           '++local_seq, tabla, registro_id, estado, created_at',
  sync_metadata:            'tabla',

  // ── Auth offline ─────────────────────────────────────────────────────
  auth_cache:               'key',
});

// ── Helpers ──────────────────────────────────────────────────────────────

export const SYNC_STATUS = {
  SYNCED:          'synced',
  PENDING_CREATE:  'pending_create',
  PENDING_UPDATE:  'pending_update',
  PENDING_DELETE:  'pending_delete',
  CONFLICT:        'conflict',
  FAILED:          'failed',
};

export const UPLOAD_STATUS = {
  PENDING:  'pending_upload',
  UPLOADED: 'uploaded',
  FAILED:   'failed',
};

export function newId() {
  return crypto.randomUUID();
}

export function newIdempotencyKey(userId, tabla) {
  return `${userId}_${tabla}_${crypto.randomUUID()}`;
}

export async function getLastSync(tabla) {
  const meta = await db.sync_metadata.get(tabla);
  return meta?.last_synced_at ?? null;
}

export async function setLastSync(tabla, ts) {
  await db.sync_metadata.put({ tabla, last_synced_at: ts });
}
