# JARVEX — Schema Supabase (auto-generado)

> Generado: 2026-05-09 con `node scripts/dump-schema.mjs`.
> NO editar a mano — re-correr el script para actualizar.

Tablas en `public`: **70**

## Índice
- [accounting_movements](#accounting_movements)
- [activos_pesados](#activos_pesados)
- [asistencia](#asistencia)
- [audit_log](#audit_log)
- [avance_obra](#avance_obra)
- [capacitaciones](#capacitaciones)
- [change_requests](#change_requests)
- [charla_asistentes](#charla_asistentes)
- [charlas_seguridad](#charlas_seguridad)
- [companies](#companies)
- [consumos_combustible](#consumos_combustible)
- [cotizacion_items](#cotizacion_items)
- [cotizaciones](#cotizaciones)
- [cronograma](#cronograma)
- [cronograma_pagos](#cronograma_pagos)
- [cuentas_bancarias](#cuentas_bancarias)
- [epp_entregas](#epp_entregas)
- [epps](#epps)
- [evidencias](#evidencias)
- [herramientas](#herramientas)
- [horas_maquina](#horas_maquina)
- [incidencias](#incidencias)
- [inspecciones_seguridad](#inspecciones_seguridad)
- [insumos_partida](#insumos_partida)
- [insumos_partida_versionadas](#insumos_partida_versionadas)
- [intercompany_transactions](#intercompany_transactions)
- [iperc](#iperc)
- [mantenimientos_maquinaria](#mantenimientos_maquinaria)
- [material_precios_historial](#material_precios_historial)
- [materiales](#materiales)
- [movimientos_bancarios](#movimientos_bancarios)
- [movimientos_epp](#movimientos_epp)
- [movimientos_herramientas](#movimientos_herramientas)
- [movimientos_materiales](#movimientos_materiales)
- [obra_usuarios](#obra_usuarios)
- [obras](#obras)
- [oc_items](#oc_items)
- [ordenes_compra](#ordenes_compra)
- [partidas](#partidas)
- [partidas_versionadas](#partidas_versionadas)
- [personal](#personal)
- [personal_contrato](#personal_contrato)
- [planilla_boletas](#planilla_boletas)
- [planillas](#planillas)
- [presupuestos_versiones](#presupuestos_versiones)
- [profiles](#profiles)
- [proveedores](#proveedores)
- [recepcion_items](#recepcion_items)
- [recepciones](#recepciones)
- [requisicion_items](#requisicion_items)
- [requisiciones](#requisiciones)
- [subcontratistas](#subcontratistas)
- [subcontrato_valorizaciones](#subcontrato_valorizaciones)
- [subcontratos](#subcontratos)
- [sync_log](#sync_log)
- [trazabilidad_cadenas](#trazabilidad_cadenas)
- [ubicaciones_obra](#ubicaciones_obra)
- [v_activos_costo_hora](#v_activos_costo_hora)
- [v_almacen_resumen](#v_almacen_resumen)
- [v_asistencia_resumen](#v_asistencia_resumen)
- [v_company_resumen](#v_company_resumen)
- [v_comparativo_partidas](#v_comparativo_partidas)
- [v_dashboard_obra](#v_dashboard_obra)
- [v_obras_avance_ponderado](#v_obras_avance_ponderado)
- [v_partidas_avance_consumo](#v_partidas_avance_consumo)
- [v_partidas_estado_cronograma](#v_partidas_estado_cronograma)
- [v_versiones_comparativa](#v_versiones_comparativa)
- [valorizacion_adicionales](#valorizacion_adicionales)
- [valorizacion_partidas](#valorizacion_partidas)
- [valorizaciones](#valorizaciones)

## `accounting_movements`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `company_id` | uuid | no | — | → `companies` |
| `date` | date | no | `CURRENT_DATE` |  |
| `type` | text | no | — |  |
| `category` | text | sí | — |  |
| `description` | text | sí | — |  |
| `amount` | numeric | no | — |  |
| `currency` | text | sí | `PEN` |  |
| `third_party_name` | text | sí | — |  |
| `third_party_ruc` | text | sí | — |  |
| `payment_status` | text | sí | `pending` |  |
| `document_type` | text | sí | — |  |
| `document_number` | text | sí | — |  |
| `file_url` | text | sí | — |  |
| `is_intercompany` | boolean | sí | `false` |  |
| `related_company_id` | uuid | sí | — | → `companies` |
| `related_movement_id` | uuid | sí | — | → `accounting_movements` |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `chain_id` | uuid | sí | — |  |
| `chain_step_index` | integer | sí | — |  |
| `factura_interna_meta` | jsonb | sí | — |  |
| `estado_factura` | text | sí | — |  |
| `orden_compra_id` | uuid | sí | — |  |
| `proveedor_id` | uuid | sí | — |  |

## `activos_pesados`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `codigo` | text | sí | — |  |
| `nombre` | text | no | — |  |
| `tipo` | text | sí | — |  |
| `marca` | text | sí | — |  |
| `modelo` | text | sí | — |  |
| `anio` | integer | sí | — |  |
| `placa` | text | sí | — |  |
| `serie` | text | sí | — |  |
| `costo_adquisicion` | numeric | sí | — |  |
| `fecha_adquisicion` | date | sí | — |  |
| `vida_util_anios` | integer | sí | `5` |  |
| `depreciacion_acumulada` | numeric | sí | `0` |  |
| `hm_acumuladas` | numeric | sí | `0` |  |
| `hm_proximo_mant` | numeric | sí | — |  |
| `estado` | text | sí | `operativo` |  |
| `obra_actual_id` | uuid | sí | — | → `obras` |
| `company_id` | uuid | sí | — | → `companies` |
| `operador_principal_id` | uuid | sí | — | → `personal` |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `ubicacion_id` | uuid | sí | — |  |

## `asistencia`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `personal_id` | uuid | no | — | → `personal` |
| `fecha` | date | no | — |  |
| `hora_ingreso` | time without time zone | sí | — |  |
| `hora_salida` | time without time zone | sí | — |  |
| `horas_trabajadas` | numeric | sí | — |  |
| `estado_asistencia` | text | no | — |  |
| `evidencia_id` | uuid | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |

## `audit_log`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `user_id` | uuid | sí | — | → `profiles` |
| `user_email` | text | sí | — |  |
| `action` | text | no | — |  |
| `table_name` | text | no | — |  |
| `record_id` | uuid | sí | — |  |
| `old_data` | jsonb | sí | — |  |
| `new_data` | jsonb | sí | — |  |
| `reason` | text | sí | — |  |

## `avance_obra`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `partida_id` | uuid | no | — | → `partidas` |
| `fecha` | date | no | — |  |
| `semana` | text | sí | — |  |
| `metrado_ejecutado` | numeric | sí | — |  |
| `porcentaje_avance_reportado` | numeric | sí | — |  |
| `responsable_id` | uuid | sí | — | → `profiles` |
| `personal_asignado` | integer | sí | — |  |
| `evidencia_id` | uuid | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |

## `capacitaciones`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | sí | — | → `obras` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `tema` | text | no | — |  |
| `tipo` | text | sí | `induccion` |  |
| `duracion_horas` | numeric | sí | — |  |
| `expositor` | text | sí | — |  |
| `total_asistentes` | integer | sí | `0` |  |
| `contenido` | text | sí | — |  |
| `evaluacion` | boolean | sí | `false` |  |
| `evidencia_id` | uuid | sí | — | → `evidencias` |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `change_requests`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `requester_id` | uuid | sí | — | → `profiles` |
| `requester_email` | text | sí | — |  |
| `target_table` | text | no | — |  |
| `target_record_id` | uuid | sí | — |  |
| `target_record_label` | text | sí | — |  |
| `proposed_changes` | jsonb | no | — |  |
| `reason` | text | no | — |  |
| `evidence_url` | text | sí | — |  |
| `status` | text | no | `pendiente` |  |
| `reviewer_id` | uuid | sí | — | → `profiles` |
| `reviewer_comment` | text | sí | — |  |
| `reviewed_at` | timestamp with time zone | sí | — |  |

## `charla_asistentes`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `charla_id` | uuid | no | — | → `charlas_seguridad` |
| `personal_id` | uuid | sí | — | → `personal` |
| `nombre` | text | sí | — |  |
| `dni` | text | sí | — |  |
| `firma_url` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `charlas_seguridad`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `hora` | text | sí | — |  |
| `tema` | text | no | — |  |
| `facilitador_id` | uuid | sí | — | → `personal` |
| `facilitador_nombre` | text | sí | — |  |
| `duracion_min` | integer | sí | `5` |  |
| `contenido` | text | sí | — |  |
| `total_asistentes` | integer | sí | `0` |  |
| `evidencia_id` | uuid | sí | — | → `evidencias` |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `companies`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `name` | text | no | — |  |
| `legal_name` | text | sí | — |  |
| `ruc` | text | sí | — |  |
| `company_type` | text | sí | `otro` |  |
| `status` | text | sí | `activa` |  |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `consumos_combustible`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `activo_id` | uuid | no | — | → `activos_pesados` |
| `obra_id` | uuid | sí | — | → `obras` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `galones` | numeric | no | — |  |
| `precio_galon` | numeric | sí | — |  |
| `total` | numeric | sí | — |  |
| `surtidor` | text | sí | — |  |
| `operador_id` | uuid | sí | — | → `personal` |
| `hm_actuales` | numeric | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `cotizacion_items`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `cotizacion_id` | uuid | no | — | → `cotizaciones` |
| `requisicion_item_id` | uuid | sí | — | → `requisicion_items` |
| `material_id` | uuid | sí | — | → `materiales` |
| `nombre_libre` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `cantidad` | numeric | sí | — |  |
| `precio_unitario` | numeric | no | — |  |
| `subtotal` | numeric | sí | — |  |
| `observacion` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `cotizaciones`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `requisicion_id` | uuid | no | — | → `requisiciones` |
| `proveedor_id` | uuid | sí | — | → `proveedores` |
| `proveedor_nombre` | text | sí | — |  |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `validez_dias` | integer | sí | `7` |  |
| `monto_total` | numeric | sí | `0` |  |
| `moneda` | text | sí | `PEN` |  |
| `condicion_pago` | text | sí | — |  |
| `plazo_entrega_dias` | integer | sí | — |  |
| `estado` | text | sí | `recibida` |  |
| `notas` | text | sí | — |  |
| `archivo_url` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `cronograma`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `partida_id` | uuid | no | — | → `partidas` |
| `fecha_inicio_planificada` | date | sí | — |  |
| `fecha_fin_planificada` | date | sí | — |  |
| `duracion_planificada` | integer | sí | — |  |
| `fecha_inicio_real` | date | sí | — |  |
| `fecha_fin_real` | date | sí | — |  |
| `duracion_real` | integer | sí | — |  |
| `avance_esperado` | numeric | sí | — |  |
| `avance_real` | numeric | sí | — |  |
| `estado` | text | sí | `a_tiempo` |  |
| `dependencias` | uuid[] | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `cronograma_pagos`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `accounting_movement_id` | uuid | sí | — | → `accounting_movements` |
| `company_id` | uuid | no | — | → `companies` |
| `cuenta_id` | uuid | sí | — | → `cuentas_bancarias` |
| `fecha_programada` | date | no | — |  |
| `monto` | numeric | no | — |  |
| `moneda` | text | sí | `PEN` |  |
| `beneficiario` | text | sí | — |  |
| `concepto` | text | sí | — |  |
| `documento_ref` | text | sí | — |  |
| `estado` | text | sí | `programado` |  |
| `fecha_pago_real` | date | sí | — |  |
| `movimiento_bancario_id` | uuid | sí | — | → `movimientos_bancarios` |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `cuentas_bancarias`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `company_id` | uuid | no | — | → `companies` |
| `banco` | text | no | — |  |
| `numero_cuenta` | text | sí | — |  |
| `cci` | text | sí | — |  |
| `tipo` | text | sí | `corriente` |  |
| `moneda` | text | sí | `PEN` |  |
| `saldo_inicial` | numeric | sí | `0` |  |
| `fecha_apertura` | date | sí | — |  |
| `estado` | text | sí | `activa` |  |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `epp_entregas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `personal_id` | uuid | no | — | → `personal` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `tipo_epp` | text | no | — |  |
| `marca` | text | sí | — |  |
| `cantidad` | integer | sí | `1` |  |
| `motivo` | text | sí | `inicial` |  |
| `costo_unitario` | numeric | sí | — |  |
| `costo_total` | numeric | sí | — |  |
| `firma_url` | text | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `epps`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | — | Note: |
| `obra_id` | uuid | sí | — | → `obras` |
| `ubicacion_id` | uuid | sí | — | → `ubicaciones_obra` |
| `nombre_epp` | text | no | — |  |
| `tipo_epp` | text | no | — |  |
| `marca` | text | sí | — |  |
| `modelo` | text | sí | — |  |
| `talla` | text | sí | — |  |
| `vida_util_dias` | integer | sí | — |  |
| `unidad` | text | sí | `Und` |  |
| `stock_inicial` | numeric | sí | `0` |  |
| `stock_actual` | numeric | sí | `0` |  |
| `stock_minimo` | numeric | sí | `0` |  |
| `precio_unitario_estimado` | numeric | sí | — |  |
| `proveedor_principal_id` | uuid | sí | — | → `proveedores` |
| `alerta` | text | sí | `ok` |  |
| `estado` | text | sí | `activo` |  |
| `observaciones` | text | sí | — |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `version` | integer | sí | `1` |  |
| `idempotency_key` | text | sí | — |  |
| `material_origen_id` | uuid | sí | — | → `materiales` |

## `evidencias`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `tipo_evidencia` | text | sí | — |  |
| `modulo_relacionado` | text | sí | — |  |
| `registro_relacionado_id` | uuid | sí | — |  |
| `nombre_archivo` | text | no | — |  |
| `url_archivo` | text | sí | — |  |
| `local_path_temporal` | text | sí | — |  |
| `mime_type` | text | sí | — |  |
| `tamano_bytes` | integer | sí | — |  |
| `subido_por` | uuid | sí | — |  |
| `fecha` | date | sí | — |  |
| `observaciones` | text | sí | — |  |
| `sync_status` | text | sí | `pending_upload` |  |
| `upload_retries` | integer | sí | `0` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `blob_ref` | uuid | sí | — |  |

## `herramientas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `nombre_herramienta` | text | no | — |  |
| `tipo_herramienta` | text | sí | — |  |
| `marca` | text | sí | — |  |
| `modelo` | text | sí | — |  |
| `serie` | text | sí | — |  |
| `estado_actual` | text | sí | `bueno` |  |
| `ubicacion_actual` | text | sí | `almacen` |  |
| `disponible` | boolean | sí | `true` |  |
| `ultimo_responsable_id` | uuid | sí | — | → `personal` |
| `fecha_ultimo_movimiento` | date | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `ubicacion_id` | uuid | sí | — |  |

## `horas_maquina`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `activo_id` | uuid | no | — | → `activos_pesados` |
| `obra_id` | uuid | no | — | → `obras` |
| `partida_id` | uuid | sí | — | → `partidas` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `horas_trabajadas` | numeric | no | — |  |
| `hm_inicial` | numeric | sí | — |  |
| `hm_final` | numeric | sí | — |  |
| `operador_id` | uuid | sí | — | → `personal` |
| `actividad` | text | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `incidencias`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `tipo_incidencia` | text | sí | — |  |
| `severidad` | text | sí | `media` |  |
| `modulo_origen` | text | sí | — |  |
| `registro_origen_id` | uuid | sí | — |  |
| `descripcion` | text | no | — |  |
| `responsable_id` | uuid | sí | — | → `personal` |
| `estado` | text | sí | `abierta` |  |
| `evidencia_id` | uuid | sí | — |  |
| `creado_por` | uuid | sí | — |  |
| `resuelto_en` | timestamp with time zone | sí | — |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `idempotency_key` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `inspecciones_seguridad`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `tipo` | text | sí | `general` |  |
| `inspector_id` | uuid | sí | — | → `personal` |
| `area_inspeccionada` | text | sí | — |  |
| `resultado` | text | sí | `conforme` |  |
| `hallazgos` | text | sí | — |  |
| `acciones_correctivas` | text | sí | — |  |
| `fecha_cierre` | date | sí | — |  |
| `responsable_cierre_id` | uuid | sí | — | → `personal` |
| `evidencia_id` | uuid | sí | — | → `evidencias` |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `insumos_partida`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `partida_id` | uuid | no | — | → `partidas` |
| `tipo_insumo` | text | sí | — |  |
| `recurso_id` | uuid | sí | — |  |
| `nombre_insumo` | text | no | — |  |
| `unidad` | text | sí | — |  |
| `cantidad_presupuestada` | numeric | sí | — |  |
| `precio_presupuestado` | numeric | sí | — |  |
| `costo_presupuestado` | numeric | sí | — |  |
| `cantidad_real_usada` | numeric | sí | `0` |  |
| `precio_real` | numeric | sí | `0` |  |
| `costo_real` | numeric | sí | `0` |  |
| `diferencia_cantidad` | numeric | sí | — |  |
| `estado` | text | sí | `dentro_presupuesto` |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `insumo_codigo` | text | sí | — |  |
| `notas` | text | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `insumos_partida_versionadas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `version_id` | uuid | no | — | → `presupuestos_versiones` |
| `partida_versionada_id` | uuid | no | — | → `partidas_versionadas` |
| `obra_id` | uuid | no | — | → `obras` |
| `insumo_codigo` | text | sí | — |  |
| `nombre_insumo` | text | no | — |  |
| `tipo_insumo` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `cantidad_presupuestada` | numeric | sí | `0` |  |
| `precio_presupuestado` | numeric | sí | `0` |  |
| `costo_total` | numeric | sí | `0` |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `intercompany_transactions`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `seller_company_id` | uuid | no | — | → `companies` |
| `buyer_company_id` | uuid | no | — | → `companies` |
| `date` | date | no | `CURRENT_DATE` |  |
| `operation_type` | text | sí | `otro` |  |
| `description` | text | sí | — |  |
| `amount` | numeric | no | — |  |
| `currency` | text | sí | `PEN` |  |
| `document_type` | text | sí | — |  |
| `document_number` | text | sí | — |  |
| `payment_status` | text | sí | `pending` |  |
| `seller_movement_id` | uuid | sí | — | → `accounting_movements` |
| `buyer_movement_id` | uuid | sí | — | → `accounting_movements` |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `chain_id` | uuid | sí | — |  |

## `iperc`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `actividad` | text | no | — |  |
| `proceso` | text | sí | — |  |
| `peligro` | text | no | — |  |
| `riesgo` | text | no | — |  |
| `consecuencia` | text | sí | — |  |
| `probabilidad` | integer | sí | — |  |
| `severidad` | integer | sí | — |  |
| `nivel_riesgo` | integer | sí | — |  |
| `clasificacion` | text | sí | — |  |
| `control_existente` | text | sí | — |  |
| `control_propuesto` | text | sí | — |  |
| `responsable_id` | uuid | sí | — | → `personal` |
| `fecha_implementacion` | date | sí | — |  |
| `estado` | text | sí | `identificado` |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `mantenimientos_maquinaria`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `activo_id` | uuid | no | — | → `activos_pesados` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `tipo` | text | sí | `preventivo` |  |
| `hm_actuales` | numeric | sí | — |  |
| `descripcion` | text | no | — |  |
| `costo_repuestos` | numeric | sí | `0` |  |
| `costo_mano_obra` | numeric | sí | `0` |  |
| `costo_total` | numeric | sí | `0` |  |
| `taller` | text | sí | — |  |
| `mecanico` | text | sí | — |  |
| `duracion_horas` | numeric | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `material_precios_historial`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `material_id` | uuid | no | — | → `materiales` |
| `obra_id` | uuid | no | — | → `obras` |
| `precio_anterior` | numeric | sí | `0` |  |
| `precio_nuevo` | numeric | no | — |  |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `motivo` | text | sí | — |  |
| `documento_ref` | text | sí | — |  |
| `fuente` | text | sí | `manual` |  |
| `origen_movimiento_id` | uuid | sí | — | → `movimientos_materiales` |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `materiales`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `nombre_material` | text | no | — |  |
| `categoria` | text | sí | — |  |
| `unidad` | text | no | — |  |
| `stock_inicial` | numeric | sí | `0` |  |
| `stock_actual` | numeric | sí | `0` |  |
| `stock_minimo` | numeric | sí | `0` |  |
| `total_entradas` | numeric | sí | `0` |  |
| `total_salidas` | numeric | sí | `0` |  |
| `precio_unitario_estimado` | numeric | sí | — |  |
| `precio_unitario_real_prom` | numeric | sí | — |  |
| `proveedor_principal_id` | uuid | sí | — | → `proveedores` |
| `alerta` | text | sí | `ok` |  |
| `estado` | text | sí | `activo` |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `codigo_s10` | text | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `ubicacion_id` | uuid | sí | — |  |

## `movimientos_bancarios`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `cuenta_id` | uuid | no | — | → `cuentas_bancarias` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `tipo` | text | sí | — |  |
| `monto` | numeric | no | — |  |
| `descripcion` | text | sí | — |  |
| `contraparte` | text | sí | — |  |
| `referencia` | text | sí | — |  |
| `conciliado` | boolean | sí | `false` |  |
| `fecha_conciliacion` | date | sí | — |  |
| `accounting_movement_id` | uuid | sí | — | → `accounting_movements` |
| `cuenta_destino_id` | uuid | sí | — | → `cuentas_bancarias` |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `movimientos_epp`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | — | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `epp_id` | uuid | no | — | → `epps` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `hora` | time without time zone | sí | — |  |
| `tipo_movimiento` | text | no | — |  |
| `cantidad` | numeric | no | — |  |
| `unidad` | text | sí | — |  |
| `personal_id` | uuid | sí | — | → `personal` |
| `proveedor_id` | uuid | sí | — | → `proveedores` |
| `documento_asociado` | text | sí | — |  |
| `precio_unitario_real` | numeric | sí | — |  |
| `motivo` | text | sí | — |  |
| `firma_url` | text | sí | — |  |
| `observaciones` | text | sí | — |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `version` | integer | sí | `1` |  |
| `idempotency_key` | text | sí | — |  |

## `movimientos_herramientas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `herramienta_id` | uuid | no | — | → `herramientas` |
| `fecha` | date | no | — |  |
| `hora` | time without time zone | sí | — |  |
| `responsable_id` | uuid | no | — | → `personal` |
| `accion` | text | no | — |  |
| `estado_salida` | text | sí | — |  |
| `estado_devolucion` | text | sí | — |  |
| `evidencia_id` | uuid | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |

## `movimientos_materiales`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `material_id` | uuid | no | — | → `materiales` |
| `fecha` | date | no | — |  |
| `hora` | time without time zone | sí | — |  |
| `tipo_movimiento` | text | no | — |  |
| `cantidad` | numeric | no | — |  |
| `unidad` | text | no | — |  |
| `responsable_id` | uuid | sí | — | → `personal` |
| `proveedor_id` | uuid | sí | — | → `proveedores` |
| `documento_asociado` | text | sí | — |  |
| `partida_id` | uuid | sí | — | → `partidas` |
| `frente_zona` | text | sí | — |  |
| `precio_unitario_real` | numeric | sí | — |  |
| `evidencia_id` | uuid | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |

## `obra_usuarios`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `usuario_id` | uuid | no | — | → `profiles` |
| `rol_obra` | text | sí | — |  |
| `activo` | boolean | sí | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

## `obras`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `nombre_obra` | text | no | — |  |
| `cliente` | text | sí | — |  |
| `ubicacion` | text | sí | — |  |
| `estado` | text | sí | `activo` |  |
| `fecha_inicio` | date | sí | — |  |
| `fecha_fin_estimada` | date | sí | — |  |
| `presupuesto_total` | numeric | sí | — |  |
| `costo_real_acumulado` | numeric | sí | `0` |  |
| `avance_fisico` | numeric | sí | `0` |  |
| `avance_financiero` | numeric | sí | `0` |  |
| `responsable_id` | uuid | sí | — | → `profiles` |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `oc_items`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `orden_compra_id` | uuid | no | — | → `ordenes_compra` |
| `material_id` | uuid | sí | — | → `materiales` |
| `nombre_libre` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `cantidad` | numeric | no | — |  |
| `cantidad_recibida` | numeric | sí | `0` |  |
| `precio_unitario` | numeric | no | — |  |
| `subtotal` | numeric | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `ordenes_compra`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `codigo` | text | sí | — |  |
| `obra_id` | uuid | no | — | → `obras` |
| `proveedor_id` | uuid | no | — | → `proveedores` |
| `cotizacion_id` | uuid | sí | — | → `cotizaciones` |
| `requisicion_id` | uuid | sí | — | → `requisiciones` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `fecha_entrega` | date | sí | — |  |
| `monto_subtotal` | numeric | sí | `0` |  |
| `monto_igv` | numeric | sí | `0` |  |
| `monto_total` | numeric | no | — |  |
| `moneda` | text | sí | `PEN` |  |
| `condicion_pago` | text | sí | — |  |
| `estado` | text | sí | `borrador` |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `partidas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `codigo_delfin` | text | sí | — |  |
| `nombre_partida` | text | no | — |  |
| `categoria` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `metrado_contratado` | numeric | sí | — |  |
| `metrado_ejecutado` | numeric | sí | `0` |  |
| `porcentaje_avance` | numeric | sí | `0` |  |
| `precio_unitario_pres` | numeric | sí | — |  |
| `costo_total_presupuestado` | numeric | sí | — |  |
| `costo_real_acumulado` | numeric | sí | `0` |  |
| `diferencia` | numeric | sí | — |  |
| `estado` | text | sí | `pendiente` |  |
| `fecha_inicio_planificada` | date | sí | — |  |
| `fecha_fin_planificada` | date | sí | — |  |
| `fecha_inicio_real` | date | sí | — |  |
| `fecha_fin_real` | date | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `nivel` | integer | sí | — |  |
| `parent_codigo` | text | sí | — |  |
| `orden` | integer | sí | — |  |
| `duracion_dias` | integer | sí | — |  |
| `predecesoras` | text | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `partidas_versionadas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `version_id` | uuid | no | — | → `presupuestos_versiones` |
| `obra_id` | uuid | no | — | → `obras` |
| `codigo` | text | no | — |  |
| `nombre_partida` | text | no | — |  |
| `unidad` | text | sí | — |  |
| `metrado` | numeric | sí | `0` |  |
| `precio_unitario` | numeric | sí | `0` |  |
| `costo_total` | numeric | sí | `0` |  |
| `nivel` | smallint | sí | `1` |  |
| `parent_codigo` | text | sí | — |  |
| `orden` | integer | sí | `0` |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `personal`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `nombres` | text | no | — |  |
| `apellidos` | text | no | — |  |
| `dni` | text | no | — |  |
| `cargo` | text | sí | — |  |
| `area` | text | sí | — |  |
| `fecha_ingreso` | date | sí | — |  |
| `estado` | text | sí | `activo` |  |
| `telefono` | text | sí | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `fecha_nacimiento` | date | sí | — | Fecha de nacimiento del trabajador. Requ |

## `personal_contrato`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `personal_id` | uuid | no | — | → `personal` |
| `fecha_inicio` | date | no | — |  |
| `fecha_fin` | date | sí | — |  |
| `sueldo_basico` | numeric | sí | `0` |  |
| `asignacion_familiar` | numeric | sí | `0` |  |
| `bonificaciones_fijas` | numeric | sí | `0` |  |
| `regimen` | text | sí | `construccion_civil` |  |
| `tipo_pension` | text | sí | `ONP` |  |
| `afp_nombre` | text | sí | — |  |
| `afp_pct_aporte_obligatorio` | numeric | sí | `10` |  |
| `afp_pct_seguro` | numeric | sí | `1.49` |  |
| `afp_pct_comision` | numeric | sí | `1.55` |  |
| `cargo_planilla` | text | sí | — |  |
| `tiene_essalud` | boolean | sí | `true` |  |
| `domicilio_fiscal` | text | sí | — |  |
| `cuenta_bancaria` | text | sí | — |  |
| `cci` | text | sí | — |  |
| `estado` | text | sí | `vigente` |  |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `planilla_boletas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `planilla_id` | uuid | no | — | → `planillas` |
| `personal_id` | uuid | no | — | → `personal` |
| `contrato_id` | uuid | sí | — | → `personal_contrato` |
| `nombres` | text | sí | — |  |
| `apellidos` | text | sí | — |  |
| `dni` | text | sí | — |  |
| `cargo` | text | sí | — |  |
| `dias_trabajados` | numeric | sí | `0` |  |
| `sueldo_basico` | numeric | sí | `0` |  |
| `remuneracion_basica` | numeric | sí | `0` |  |
| `asignacion_familiar` | numeric | sí | `0` |  |
| `horas_extras_25` | numeric | sí | `0` |  |
| `horas_extras_35` | numeric | sí | `0` |  |
| `horas_extras_100` | numeric | sí | `0` |  |
| `monto_horas_extras` | numeric | sí | `0` |  |
| `bonificaciones` | numeric | sí | `0` |  |
| `total_ingresos` | numeric | sí | `0` |  |
| `descuento_afp_onp` | numeric | sí | `0` |  |
| `descuento_ir_5ta` | numeric | sí | `0` |  |
| `descuento_otros` | numeric | sí | `0` |  |
| `total_descuentos` | numeric | sí | `0` |  |
| `neto_pagar` | numeric | sí | `0` |  |
| `essalud_empleador` | numeric | sí | `0` |  |
| `fecha_pago` | date | sí | — |  |
| `forma_pago` | text | sí | — |  |
| `cuenta_destino` | text | sí | — |  |
| `pagado` | boolean | sí | `false` |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `planillas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | sí | — | → `obras` |
| `company_id` | uuid | sí | — | → `companies` |
| `periodo_mes` | integer | no | — |  |
| `periodo_anio` | integer | no | — |  |
| `fecha_pago` | date | sí | — |  |
| `total_trabajadores` | integer | sí | `0` |  |
| `total_basico` | numeric | sí | `0` |  |
| `total_horas_extras` | numeric | sí | `0` |  |
| `total_asignaciones` | numeric | sí | `0` |  |
| `total_bonificaciones` | numeric | sí | `0` |  |
| `total_remuneraciones` | numeric | sí | `0` |  |
| `total_descuentos` | numeric | sí | `0` |  |
| `total_neto` | numeric | sí | `0` |  |
| `total_essalud` | numeric | sí | `0` |  |
| `estado` | text | sí | `borrador` |  |
| `accounting_movement_id` | uuid | sí | — | → `accounting_movements` |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `presupuestos_versiones`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `numero` | smallint | no | — |  |
| `nombre` | text | no | — |  |
| `tipo` | text | sí | — |  |
| `descripcion` | text | sí | — |  |
| `fecha` | date | sí | — |  |
| `monto_total` | numeric | sí | `0` |  |
| `bloqueado` | boolean | sí | `false` |  |
| `archivo_origen` | text | sí | — |  |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `profiles`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | — | Note: |
| `nombres` | text | no | — |  |
| `apellidos` | text | no | — |  |
| `email` | text | no | — |  |
| `avatar_url` | text | sí | — |  |
| `rol` | text | no | `solo_lectura` |  |
| `activo` | boolean | sí | `true` |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |

## `proveedores`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `razon_social` | text | no | — |  |
| `ruc` | text | sí | — |  |
| `contacto` | text | sí | — |  |
| `telefono` | text | sí | — |  |
| `correo` | text | sí | — |  |
| `tipo_proveedor` | text | sí | — |  |
| `direccion` | text | sí | — |  |
| `estado` | text | sí | `activo` |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `recepcion_items`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `recepcion_id` | uuid | no | — | → `recepciones` |
| `oc_item_id` | uuid | sí | — | → `oc_items` |
| `cantidad_recibida` | numeric | no | — |  |
| `observaciones` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `material_id` | uuid | sí | — |  |
| `precio_unitario_factura` | numeric | sí | — |  |
| `diferencia_precio_pct` | numeric | sí | — |  |

## `recepciones`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `orden_compra_id` | uuid | no | — | → `ordenes_compra` |
| `obra_id` | uuid | no | — | → `obras` |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `guia_remision` | text | sí | — |  |
| `factura_numero` | text | sí | — |  |
| `recibido_por` | uuid | sí | — | → `profiles` |
| `estado_recepcion` | text | sí | `completa` |  |
| `observaciones` | text | sí | — |  |
| `archivo_guia_url` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `factura_ref` | text | sí | — |  |
| `accounting_movement_id` | uuid | sí | — |  |

## `requisicion_items`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `requisicion_id` | uuid | no | — | → `requisiciones` |
| `material_id` | uuid | sí | — | → `materiales` |
| `nombre_libre` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `cantidad` | numeric | no | — |  |
| `observacion` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `requisiciones`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `codigo` | text | sí | — |  |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `fecha_requerida` | date | sí | — |  |
| `solicitante_id` | uuid | sí | — | → `profiles` |
| `partida_id` | uuid | sí | — | → `partidas` |
| `prioridad` | text | sí | `normal` |  |
| `estado` | text | sí | `borrador` |  |
| `notas` | text | sí | — |  |
| `motivo_rechazo` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `subcontratistas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `razon_social` | text | no | — |  |
| `ruc` | text | sí | — |  |
| `contacto` | text | sí | — |  |
| `telefono` | text | sí | — |  |
| `email` | text | sí | — |  |
| `direccion` | text | sí | — |  |
| `especialidad` | text | sí | — |  |
| `estado` | text | sí | `activo` |  |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `subcontrato_valorizaciones`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `subcontrato_id` | uuid | no | — | → `subcontratos` |
| `numero` | integer | no | — |  |
| `fecha` | date | no | `CURRENT_DATE` |  |
| `periodo_mes` | integer | sí | — |  |
| `periodo_anio` | integer | sí | — |  |
| `monto_avance` | numeric | no | — |  |
| `retencion_garantia` | numeric | sí | `0` |  |
| `penalidad` | numeric | sí | `0` |  |
| `adelanto_amortizado` | numeric | sí | `0` |  |
| `monto_subtotal` | numeric | sí | — |  |
| `monto_igv` | numeric | sí | — |  |
| `monto_total` | numeric | sí | — |  |
| `detraccion_monto` | numeric | sí | `0` |  |
| `monto_neto_pagar` | numeric | sí | — |  |
| `factura_serie` | text | sí | — |  |
| `factura_numero` | text | sí | — |  |
| `estado` | text | sí | `borrador` |  |
| `notas` | text | sí | — |  |
| `accounting_movement_id` | uuid | sí | — | → `accounting_movements` |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `subcontratos`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `codigo` | text | sí | — |  |
| `obra_id` | uuid | no | — | → `obras` |
| `subcontratista_id` | uuid | no | — | → `subcontratistas` |
| `alcance` | text | no | — |  |
| `fecha_inicio` | date | sí | — |  |
| `fecha_fin` | date | sí | — |  |
| `monto_contrato` | numeric | no | — |  |
| `moneda` | text | sí | `PEN` |  |
| `retencion_pct` | numeric | sí | `5` |  |
| `retencion_acumulada` | numeric | sí | `0` |  |
| `fianza_fiel_cumplimiento` | numeric | sí | — |  |
| `fianza_adelanto` | numeric | sí | — |  |
| `detraccion_pct` | numeric | sí | `12` |  |
| `igv_pct` | numeric | sí | `18` |  |
| `monto_valorizado` | numeric | sí | `0` |  |
| `saldo_pendiente` | numeric | sí | — |  |
| `estado` | text | sí | `borrador` |  |
| `observaciones` | text | sí | — |  |
| `archivo_contrato_url` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `sync_log`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `usuario_id` | uuid | sí | — |  |
| `tabla` | text | no | — |  |
| `registro_id` | uuid | no | — |  |
| `operacion` | text | sí | — |  |
| `datos_antes` | jsonb | sí | — |  |
| `datos_despues` | jsonb | sí | — |  |
| `resuelto` | boolean | sí | `true` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |

## `trazabilidad_cadenas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | — | Note: |
| `obra_id` | uuid | no | — |  |
| `fecha` | date | sí | — |  |
| `item_nombre` | text | sí | — |  |
| `cantidad` | numeric | sí | — |  |
| `unidad` | text | sí | — |  |
| `precio_real_unitario` | numeric | sí | — |  |
| `precio_referencial_contrato` | numeric | sí | — |  |
| `proveedor_externo_nombre` | text | sí | — |  |
| `proveedor_externo_ruc` | text | sí | — |  |
| `items` | jsonb | sí | — |  |
| `eslabones` | jsonb | sí | — |  |
| `ejecutora_company_id` | uuid | sí | — |  |
| `comprobante_origen_id` | uuid | sí | — |  |
| `estado` | text | sí | `borrador` |  |
| `notas` | text | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `created_at` | timestamp with time zone | sí | `now()` |  |
| `updated_at` | timestamp with time zone | sí | `now()` |  |
| `version` | integer | sí | `1` |  |
| `sync_status` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `demo` | boolean | sí | `false` |  |

## `ubicaciones_obra`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | — | Note: |
| `obra_id` | uuid | no | — |  |
| `nombre` | text | no | — |  |
| `descripcion` | text | sí | — |  |
| `orden` | integer | sí | `0` |  |
| `activo` | boolean | sí | `true` |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `created_at` | timestamp with time zone | sí | `now()` |  |
| `updated_at` | timestamp with time zone | sí | `now()` |  |
| `version` | integer | sí | `1` |  |
| `sync_status` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `demo` | boolean | sí | `false` |  |

## `v_activos_costo_hora`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `activo_id` | uuid | sí | — | Note: |
| `codigo` | text | sí | — |  |
| `nombre` | text | sí | — |  |
| `tipo` | text | sí | — |  |
| `estado` | text | sí | — |  |
| `hm_acumuladas` | numeric | sí | — |  |
| `combustible_total` | numeric | sí | — |  |
| `mantenimiento_total` | numeric | sí | — |  |
| `depreciacion` | numeric | sí | — |  |
| `costo_por_hora` | numeric | sí | — |  |

## `v_almacen_resumen`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `obra_id` | uuid | sí | — | → `obras` |
| `total_materiales` | bigint | sí | — |  |
| `materiales_ok` | bigint | sí | — |  |
| `materiales_reponer` | bigint | sí | — |  |
| `materiales_critico` | bigint | sí | — |  |
| `materiales_sin_stock` | bigint | sí | — |  |
| `valor_inventario_total` | numeric | sí | — |  |

## `v_asistencia_resumen`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `obra_id` | uuid | sí | — | → `obras` |
| `fecha` | date | sí | — |  |
| `total_registros` | bigint | sí | — |  |
| `asistieron` | bigint | sí | — |  |
| `tardanzas` | bigint | sí | — |  |
| `faltas` | bigint | sí | — |  |
| `permisos` | bigint | sí | — |  |
| `pct_asistencia` | numeric | sí | — |  |

## `v_company_resumen`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `company_id` | uuid | sí | — | Note: |
| `name` | text | sí | — |  |
| `company_type` | text | sí | — |  |
| `status` | text | sí | — |  |
| `ingresos` | numeric | sí | — |  |
| `costos` | numeric | sí | — |  |
| `gastos` | numeric | sí | — |  |
| `ingresos_internos` | numeric | sí | — |  |
| `costos_internos` | numeric | sí | — |  |
| `por_cobrar` | numeric | sí | — |  |
| `por_pagar` | numeric | sí | — |  |
| `movimientos` | bigint | sí | — |  |

## `v_comparativo_partidas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | sí | — | Note: |
| `obra_id` | uuid | sí | — | → `obras` |
| `nombre_partida` | text | sí | — |  |
| `categoria` | text | sí | — |  |
| `metrado_contratado` | numeric | sí | — |  |
| `metrado_ejecutado` | numeric | sí | — |  |
| `avance_real` | numeric | sí | — |  |
| `avance_esperado` | numeric | sí | — |  |
| `desviacion_avance` | numeric | sí | — |  |
| `costo_total_presupuestado` | numeric | sí | — |  |
| `costo_real_acumulado` | numeric | sí | — |  |
| `desviacion_costo` | numeric | sí | — |  |
| `estado_costo` | text | sí | — |  |
| `estado_cronograma` | text | sí | — |  |

## `v_dashboard_obra`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | sí | — | Note: |
| `nombre_obra` | text | sí | — |  |
| `estado` | text | sí | — |  |
| `avance_fisico` | numeric | sí | — |  |
| `avance_financiero` | numeric | sí | — |  |
| `presupuesto_total` | numeric | sí | — |  |
| `costo_real_acumulado` | numeric | sí | — |  |
| `pct_presupuesto_usado` | numeric | sí | — |  |
| `personal_activo` | bigint | sí | — |  |
| `herramientas_en_uso` | bigint | sí | — |  |
| `materiales_en_alerta` | bigint | sí | — |  |
| `partidas_atrasadas` | bigint | sí | — |  |
| `incidencias_abiertas` | bigint | sí | — |  |

## `v_obras_avance_ponderado`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `obra_id` | uuid | sí | — | Note: |
| `nombre_obra` | text | sí | — |  |
| `presupuesto_total` | numeric | sí | — |  |
| `costo_real_total` | numeric | sí | — |  |
| `avance_ponderado_pct` | numeric | sí | — |  |
| `total_partidas` | bigint | sí | — |  |
| `partidas_terminadas` | bigint | sí | — |  |
| `partidas_en_ejecucion` | bigint | sí | — |  |
| `partidas_atrasadas` | bigint | sí | — |  |

## `v_partidas_avance_consumo`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `partida_id` | uuid | sí | — | Note: |
| `obra_id` | uuid | sí | — | → `obras` |
| `codigo_delfin` | text | sí | — |  |
| `nombre_partida` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `metrado_contratado` | numeric | sí | — |  |
| `costo_total_presupuestado` | numeric | sí | — |  |
| `costo_real_acumulado` | numeric | sí | — |  |
| `avance_consumo_pct` | numeric | sí | — |  |
| `avance_financiero_pct` | numeric | sí | — |  |
| `avance_reportado_pct` | numeric | sí | — |  |

## `v_partidas_estado_cronograma`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `partida_id` | uuid | sí | — | Note: |
| `obra_id` | uuid | sí | — | → `obras` |
| `codigo_delfin` | text | sí | — |  |
| `nombre_partida` | text | sí | — |  |
| `fecha_inicio_planificada` | date | sí | — |  |
| `fecha_fin_planificada` | date | sí | — |  |
| `duracion_dias` | integer | sí | — |  |
| `porcentaje_avance` | numeric | sí | — |  |
| `estado` | text | sí | — |  |
| `estado_cronograma` | text | sí | — |  |
| `avance_esperado_pct` | numeric | sí | — |  |

## `v_versiones_comparativa`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `obra_id` | uuid | sí | — | → `obras` |
| `codigo` | text | sí | — |  |
| `nombre_partida` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `costo_v1` | numeric | sí | — |  |
| `costo_v2` | numeric | sí | — |  |
| `costo_v3` | numeric | sí | — |  |
| `costo_v4` | numeric | sí | — |  |
| `costo_v5` | numeric | sí | — |  |
| `metrado_v1` | numeric | sí | — |  |
| `metrado_v2` | numeric | sí | — |  |
| `metrado_v3` | numeric | sí | — |  |
| `metrado_v4` | numeric | sí | — |  |
| `metrado_v5` | numeric | sí | — |  |
| `orden_min` | integer | sí | — |  |

## `valorizacion_adicionales`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `valorizacion_id` | uuid | no | — | → `valorizaciones` |
| `tipo` | text | sí | — |  |
| `concepto` | text | no | — |  |
| `monto` | numeric | no | — |  |
| `signo` | text | sí | `-` |  |
| `notas` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `valorizacion_partidas`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `valorizacion_id` | uuid | no | — | → `valorizaciones` |
| `partida_id` | uuid | no | — | → `partidas` |
| `codigo` | text | sí | — |  |
| `nombre_partida` | text | sí | — |  |
| `unidad` | text | sí | — |  |
| `metrado_contratado` | numeric | sí | — |  |
| `precio_unitario` | numeric | sí | — |  |
| `metrado_anterior` | numeric | sí | `0` |  |
| `metrado_mes` | numeric | sí | `0` |  |
| `metrado_acumulado` | numeric | sí | `0` |  |
| `monto_mes` | numeric | sí | `0` |  |
| `monto_acumulado` | numeric | sí | `0` |  |
| `porcentaje_avance` | numeric | sí | `0` |  |
| `observacion` | text | sí | — |  |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |

## `valorizaciones`

| Columna | Tipo | Nullable | Default | Notas |
|---|---|---|---|---|
| `id` | uuid | no | `gen_random_uuid()` | Note: |
| `obra_id` | uuid | no | — | → `obras` |
| `numero` | integer | no | — |  |
| `periodo_mes` | integer | no | — |  |
| `periodo_anio` | integer | no | — |  |
| `fecha_corte` | date | no | — |  |
| `fecha_emision` | date | sí | — |  |
| `fecha_aprobacion` | date | sí | — |  |
| `cliente_nombre` | text | sí | — |  |
| `cliente_ruc` | text | sí | — |  |
| `monto_bruto` | numeric | sí | `0` |  |
| `adelantos` | numeric | sí | `0` |  |
| `retenciones` | numeric | sí | `0` |  |
| `monto_subtotal` | numeric | sí | `0` |  |
| `igv_pct` | numeric | sí | `18` |  |
| `monto_igv` | numeric | sí | `0` |  |
| `monto_total` | numeric | sí | `0` |  |
| `detraccion_pct` | numeric | sí | `12` |  |
| `detraccion_monto` | numeric | sí | `0` |  |
| `monto_neto_cobrar` | numeric | sí | `0` |  |
| `factura_serie` | text | sí | — |  |
| `factura_numero` | text | sí | — |  |
| `estado` | text | sí | `borrador` |  |
| `motivo_rechazo` | text | sí | — |  |
| `notas` | text | sí | — |  |
| `company_id` | uuid | sí | — | → `companies` |
| `accounting_movement_id` | uuid | sí | — | → `accounting_movements` |
| `version` | integer | no | `1` |  |
| `created_at` | timestamp with time zone | no | `now()` |  |
| `updated_at` | timestamp with time zone | no | `now()` |  |
| `deleted_at` | timestamp with time zone | sí | — |  |
| `created_by` | uuid | sí | — |  |
| `updated_by` | uuid | sí | — |  |
| `idempotency_key` | text | sí | — |  |
| `last_synced_at` | timestamp with time zone | sí | — |  |
