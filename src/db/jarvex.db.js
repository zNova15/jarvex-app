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
// Versión 18: Caja Chica (Almacén) + Insumos de Emergencia (SSOMA).
// caja_chica_movimientos: libro de entradas (fondo) / salidas (gastos).
// insumos_emergencia + movimientos_insumos_emergencia: inventario propio
// de emergencia con stock por cantidad (igual patrón que materiales).
// Versión 20: Stock por estado/condición (buckets) para herramientas.
// Subdivide el stock_actual por estado (nuevo/bueno/reparacion/baja) con foto
// por bucket. Genérica vía item_tipo+item_id. Aditivo.
// Versión 21: Personal agrupado bajo subcontratista (cuadrilla). Se indexa
// subcontratista_id para listar "el personal de este subcontrato". Los campos
// es_jefe_subcontrato y seguro_a_cargo son props sin índice (Dexie los acepta).
// Aditivo: el personal existente queda con subcontratista_id undefined = directo.
// Versión 23: Cuentas bancarias del PERSONAL (trabajadores). Tabla propia —
// `cuentas_bancarias` es de empresas (saldo → flujo de caja en Tesorería) y
// mezclar trabajadores contaminaría esas agregaciones. Una persona puede tener
// varias cuentas (sueldo, CTS). Los campos banco/cci/moneda/principal son props
// sin índice. Los campos nuevos de personal (email, direccion, contacto_emergencia,
// telefono_emergencia, regimen_pension) también son props sin índice. Aditivo.
// Versión 24: ubicacion_id en movimientos de emergencia — paridad con
// mat/epp/herr/maquinaria (mig 074). Permite desglosar el stock de emergencia
// por almacén y hacer traspasos. Aditivo (las demás tablas se heredan).
// Versión 25: historial de precios UNIFICADO para herramienta/epp/emergencia
// (los materiales conservan material_precios_historial). Genérico por
// (item_tipo,item_id), igual que stock_ubicaciones. Aditivo.
// Versión 26: vínculo frente↔partida (F1). Guarda el NODO asignado (codigo_delfin);
// la expansión a las partidas hijas se calcula al leer (src/lib/frente-partidas.js).
// Muchos-a-muchos; un capítulo = 1 fila. Aditivo.
// Versión 28: solicitudes de reporte de frente AJENO. Un ingeniero pide permiso
// al admin/gerente para reportar un frente que no es suyo (titular ausente);
// tras la aprobación carga el reporte en reporte_payload (jsonb, prop sin índice)
// y lo envía; el admin acepta y recién ahí se aplican los avances. Aditivo.
// Versión 37: "Solicitud de Insumos" — catálogo SEPARADO de nombres de insumo
// solicitados que aún no existen en las tablas reales de la obra (evita
// ensuciar materiales/herramientas/... con nombres que quizá nunca se usen).
// Las columnas nuevas de requisiciones/requisicion_items/oc_items son aditivas
// (Dexie no las indexa; no requieren bump de esas tablas). Aditivo.
db.version(37).stores({
  insumos_pendientes: 'id, obra_id, tipo_insumo, nombre_norm, deleted_at, sync_status',
});

// Versión 36: guías de remisión (detectadas por Captura Mágica) con vínculo
// bidireccional a la factura (accounting_movement_id). Aditivo.
db.version(36).stores({
  guias_remision: 'id, obra_id, accounting_movement_id, serie_correlativo, deleted_at, sync_status',
});

// Versión 35: pagos de personal/subcontratos (compromiso con monto acordado) +
// partes de pago (transferencias parciales, también para bancarizaciones en
// partes de facturas vía accounting_movement_id). Aditivo.
db.version(35).stores({
  pagos: 'id, obra_id, personal_id, subcontrato_id, estado, deleted_at, sync_status',
  pagos_partes: 'id, pago_id, accounting_movement_id, obra_id, deleted_at, sync_status',
});

// Versión 34: reporte "día sin avance" del ingeniero (motivo + foto; la foto va
// como evidencia tipo foto_sin_avance). Base del recordatorio de días sin
// reportar. Aditivo.
db.version(34).stores({
  reportes_dia: 'id, obra_id, fecha, responsable_id, deleted_at, sync_status',
});

// Versión 33: órdenes de compra/servicio intercompany (Fase 4). Borrador de la
// contadora jefe → aprobación del admin → lista para emitir. Aditivo.
db.version(33).stores({
  ordenes_intercompany: 'id, obra_id, company_id, estado, deleted_at, sync_status',
});

// Versión 32: reglas de designación de empresa emisora por subcategoría
// (Fase 3 del clasificador: "las compras de <subcategoría> las factura
// <empresa del grupo>"). Global, chica. Aditivo.
db.version(32).stores({
  emision_reglas: 'id, subcategoria, company_id, deleted_at, sync_status',
});

// Versión 31: catálogo de aprendizaje del clasificador de ítems de factura
// (Conciliación → Insumos Comprados). Mapea descripción normalizada →
// categoría/subcategoría; fuente 'manual' (corrección de la contadora) pisa
// a 'ia'. Global (sin obra_id), compartido entre devices. Aditivo.
db.version(31).stores({
  clasificacion_catalogo: 'id, descripcion_normalizada, categoria, fuente, deleted_at, sync_status',
});

// Versión 30: Conciliación Tripartita (Feature 4) — Vinculación 2 (Facturas↔Presupuesto).
// conciliacion_vinculos: junction N-a-M que enlaza un ítem de factura
// (accounting_movements.notas.items_factura[idx]) con un insumo presupuestado
// (insumos_partida consolidado por insumo_codigo de Delfín). Aditivo.
db.version(30).stores({
  conciliacion_vinculos: 'id, obra_id, insumo_codigo, accounting_movement_id, deleted_at, sync_status',
});

// Versión 29: solicitudes de creación de frente desde una partida huérfana (sin
// frente). El admin/gerente las aprueba creando/oficializando un frente. Aditivo.
db.version(29).stores({
  solicitudes_frente: 'id, obra_id, partida_id, estado, deleted_at, sync_status',
});

db.version(28).stores({
  solicitudes_reporte: 'id, obra_id, frente_id, estado, fecha, deleted_at, sync_status',
});

// Versión 27: metas de metrado del ingeniero (O3 / plan-vs-real). El ingeniero
// proyecta cuánto avanzar de una partida en una fecha. Aditivo. (avance_obra
// suma descripcion+frente_id como campos sueltos, sin índice.)
db.version(27).stores({
  avance_metas: 'id, obra_id, partida_id, fecha, deleted_at, sync_status',
});

db.version(26).stores({
  frente_partidas: 'id, obra_id, frente_id, codigo_delfin, deleted_at, sync_status',
});

db.version(25).stores({
  insumo_precios_historial: 'id, obra_id, item_id, fecha, deleted_at, sync_status, idempotency_key, [item_tipo+item_id]',
});

db.version(24).stores({
  movimientos_insumos_emergencia: 'id, obra_id, insumo_emergencia_id, ubicacion_id, fecha, sync_status, idempotency_key',
});

db.version(23).stores({
  personal_cuentas_bancarias: 'id, obra_id, personal_id, deleted_at, sync_status',
});

// Versión 22: Frentes de trabajo (catálogo per-obra, espejo de ubicaciones_obra)
// + historial individual de personal (timeline de cambios de cargo/frente/estado).
// personal.frente_id es prop sin índice (Dexie la acepta). Aditivo.
db.version(22).stores({
  frentes_obra:       'id, obra_id, activo, deleted_at, sync_status',
  personal_historial: 'id, personal_id, obra_id, fecha, tipo, deleted_at, sync_status',
});

db.version(21).stores({
  personal: 'id, obra_id, dni, estado, subcontratista_id, deleted_at, sync_status',
});

db.version(20).stores({
  stock_estados: 'id, obra_id, item_tipo, item_id, estado, deleted_at, sync_status, [item_tipo+item_id]',
});

// Versión 19: Variantes padre-hijo (SKU). Un insumo genérico ("Guantes") se
// divide en variantes concretas. padre_id apunta al grupo; es_grupo marca la
// fila padre (rollup sin stock propio). Se indexa padre_id para listar hijos.
// Aplica a los 4 inventarios. Aditivo (no se borran datos).
db.version(19).stores({
  materiales:               'id, obra_id, ubicacion_id, categoria, alerta, padre_id, deleted_at, sync_status',
  epps:                     'id, obra_id, ubicacion_id, tipo_epp, alerta, padre_id, deleted_at, sync_status',
  herramientas:             'id, obra_id, estado_actual, disponible, padre_id, deleted_at, sync_status',
  insumos_emergencia:       'id, obra_id, estado, alerta, padre_id, deleted_at, sync_status',
});

db.version(18).stores({
  caja_chica_movimientos:          'id, obra_id, fecha, tipo_movimiento, sync_status, idempotency_key',
  insumos_emergencia:              'id, obra_id, estado, alerta, deleted_at, sync_status',
  movimientos_insumos_emergencia:  'id, obra_id, insumo_emergencia_id, fecha, sync_status, idempotency_key',
});

// Versión 17: Maquinaria por cantidad — movimientos_maquinaria (espejo de
// movimientos_materiales) para equipos menores que se mueven por cantidad.
// stock_ubicaciones ahora también admite item_tipo 'maquinaria' (el índice
// no cambia; el CHECK vive en el server, migración 052).
db.version(17).stores({
  movimientos_maquinaria: 'id, obra_id, activo_id, fecha, sync_status, idempotency_key',
});

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
