// ═══════════════════════════════════════════════════════════════════
// JARVEX — Demo Seeder
// Genera un set completo de datos ficticios marcados con demo:true.
// Sirve para que el modo prueba tenga una empresa funcional con
// movimientos, alertas, valorizaciones, etc. para testear todas las
// pantallas sin tocar datos reales.
//
// USO:
//   await seedDemoData();    // crea ~3 obras + datos completos
//   await clearDemoData();   // borra TODO lo que tenga demo:true
// ═══════════════════════════════════════════════════════════════════

import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { MATERIALES_BASE } from './catalogos';

const DEMO_USER = 'demo-user';
const ts = (offsetDays = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString();
};
const dt = (offsetDays = 0) => ts(offsetDays).slice(0, 10);
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const baseFields = (extra = {}) => ({
  demo: true,
  created_by: DEMO_USER, updated_by: DEMO_USER,
  created_at: ts(0), updated_at: ts(0),
  version: 1,
  sync_status: SYNC_STATUS.SYNCED,
  last_synced_at: ts(0),
  idempotency_key: newIdempotencyKey(DEMO_USER, 'demo'),
  ...extra,
});

const obrasDemo = [
  {
    nombre_obra: '🧪 DEMO · Edificio Las Palmeras',
    cliente: 'Inmobiliaria Demo S.A.C.',
    ubicacion: 'San Isidro, Lima · Av. República 123',
    estado: 'en_ejecucion',
    fecha_inicio: dt(-90),
    fecha_fin_estimada: dt(180),
    presupuesto_total: 4_850_000,
    observaciones: 'Obra de prueba — multifamiliar 8 pisos',
  },
  {
    nombre_obra: '🧪 DEMO · Hospital San Martín',
    cliente: 'MINSA · Programa Nacional',
    ubicacion: 'Trujillo, La Libertad',
    estado: 'planificacion',
    fecha_inicio: dt(30),
    fecha_fin_estimada: dt(540),
    presupuesto_total: 12_300_000,
    observaciones: 'Obra de prueba — hospital II-1, 3 niveles',
  },
  {
    nombre_obra: '🧪 DEMO · Carretera Otuzco-Salpo',
    cliente: 'Gobierno Regional La Libertad',
    ubicacion: 'Otuzco, La Libertad',
    estado: 'finalizada',
    fecha_inicio: dt(-365),
    fecha_fin_estimada: dt(-30),
    presupuesto_total: 8_900_000,
    observaciones: 'Obra de prueba — pavimentación 12 km',
  },
];

const personasDemo = [
  ['Carlos', 'Quispe Mamani', '42158736', 'Operario Eléctrico', 'Instalaciones'],
  ['Juan', 'Flores Ramos', '38421567', 'Operario Civil', 'Estructura'],
  ['Pedro', 'Huamán Castro', '45123987', 'Maestro de Obra', 'Supervisión'],
  ['Luis', 'Mamani Quispe', '33215678', 'Peón', 'Almacén'],
  ['Miguel', 'Salas Mendoza', '43872156', 'Capataz', 'Estructura'],
  ['Alberto', 'Cruz Vargas', '40123456', 'Operario Plomero', 'Sanitario'],
  ['Roberto', 'Mendoza López', '41789012', 'Operador Maquinaria', 'Maquinaria'],
  ['Diego', 'Vásquez Torres', '44567890', 'Topógrafo', 'Topografía'],
];

const empresasDemo = [
  { name: '🧪 DEMO · Constructora Nova', legal_name: 'CONSTRUCTORA NOVA SAC', ruc: '20512345678', company_type: 'constructora', status: 'activa' },
  { name: '🧪 DEMO · Inmobiliaria Demo', legal_name: 'INMOBILIARIA DEMO SAC', ruc: '20512345001', company_type: 'inmobiliaria', status: 'activa' },
];

const proveedoresDemo = [
  ['Aceros Arequipa', '20100128056', 'aceros@arequipa.com.pe', '01-2225900'],
  ['Cementos Pacasmayo', '20419387244', 'ventas@pacasmayo.pe', '044-244222'],
  ['Sodimac Perú', '20536557858', 'corporativo@sodimac.com.pe', '01-2095000'],
  ['Distribuidora La Constancia', '20510123456', 'la.constancia@gmail.com', '999-111-222'],
];

export async function seedDemoData(progressCb) {
  const log = (msg) => { if (progressCb) progressCb(msg); console.log('[demoSeeder]', msg); };

  // 1. Empresas
  log('Sembrando empresas...');
  const empresaIds = [];
  for (const e of empresasDemo) {
    const id = newId();
    await db.companies.add({ ...baseFields(), id, ...e });
    empresaIds.push(id);
  }

  // 2. Obras
  log('Sembrando obras...');
  const obraIds = [];
  for (const o of obrasDemo) {
    const id = newId();
    await db.obras.add({ ...baseFields(), id, ...o, company_id: empresaIds[0] });
    obraIds.push(id);
  }
  const obraActiva = obraIds[0]; // la primera es la principal

  // 3. Personal
  log('Sembrando personal...');
  for (const [nombres, apellidos, dni, cargo, area] of personasDemo) {
    await db.personal.add({
      ...baseFields(),
      id: newId(),
      obra_id: obraActiva,
      nombres, apellidos, dni, cargo, area,
      fecha_ingreso: dt(rnd(-180, -10)),
      fecha_nacimiento: `${1980 + rnd(0, 30)}-${String(rnd(1,12)).padStart(2,'0')}-${String(rnd(1,28)).padStart(2,'0')}`,
      telefono: `9${rnd(10000000, 99999999)}`,
      estado: 'activo',
    });
  }

  // 4. Proveedores
  log('Sembrando proveedores...');
  for (const [razon, ruc, correo, tel] of proveedoresDemo) {
    await db.proveedores.add({
      ...baseFields(),
      id: newId(),
      razon_social: razon, ruc, correo, telefono: tel,
      estado: 'activo',
    });
  }

  // 5. Materiales (tomamos los primeros 30 del catálogo y los stockeamos)
  log('Sembrando materiales con stock...');
  for (const m of MATERIALES_BASE.slice(0, 35)) {
    const stockMin = rnd(5, 50);
    const stockActual = rnd(0, stockMin * 3);
    let alerta = 'ok';
    if (stockActual <= 0) alerta = 'agotado';
    else if (stockActual <= stockMin * 0.5) alerta = 'critico';
    else if (stockActual <= stockMin) alerta = 'reponer';
    else if (stockActual <= stockMin * 1.2) alerta = 'cerca';
    await db.materiales.add({
      ...baseFields(),
      id: newId(),
      obra_id: obraActiva,
      nombre_material: m.nombre,
      categoria: m.categoria,
      unidad: m.unidad,
      stock_inicial: stockActual,
      stock_actual: stockActual,
      stock_minimo: stockMin,
      precio_unitario_estimado: m.precio,
      alerta,
      estado: 'activo',
    });
  }

  // 6. Herramientas
  log('Sembrando herramientas...');
  const herrs = [
    ['Taladro percutor Bosch GBH 2-26', 'electrica', 'Bosch', 'GBH 2-26'],
    ['Amoladora 4 1/2"', 'electrica', 'Stanley', 'STGS 9115'],
    ['Sierra circular 7 1/4"', 'electrica', 'DeWalt', 'DWE575'],
    ['Compactadora plancha 90 kg', 'gasolina', 'Yamaha', 'MS-90'],
    ['Vibrador concreto', 'electrica', 'Honda', 'WX-15'],
    ['Nivel laser autonivelante', 'medicion', 'Bosch', 'GLL 3-80'],
    ['Carretilla buggy 100L', 'manual', 'Truper', '14127'],
    ['Pala recta', 'manual', 'Bellota', 'P-3'],
  ];
  for (const [nombre, tipo, marca, modelo] of herrs) {
    await db.herramientas.add({
      ...baseFields(),
      id: newId(),
      obra_id: obraActiva,
      nombre_herramienta: nombre,
      tipo_herramienta: tipo,
      marca, modelo,
      estado_actual: pick(['nuevo', 'bueno', 'regular']),
      ubicacion_actual: 'almacen',
      disponible: true,
    });
  }

  // 7. Movimientos contables (ingresos + costos + gastos)
  log('Sembrando movimientos contables...');
  for (let i = 0; i < 30; i++) {
    const tipo = pick(['income', 'cost', 'expense', 'cost', 'cost']);
    const monto = rnd(500, 25000);
    const subtotal = +(monto / 1.18).toFixed(2);
    const igv = +(monto - subtotal).toFixed(2);
    await db.accounting_movements.add({
      ...baseFields(),
      id: newId(),
      company_id: empresaIds[0],
      type: tipo,
      date: dt(rnd(-90, 0)),
      amount: monto,
      subtotal, igv_amount: igv,
      currency: 'PEN',
      payment_status: pick(['paid', 'paid', 'pending']),
      category: tipo === 'income' ? 'venta' : pick(['materiales', 'mano_obra', 'subcontrato', 'servicios']),
      description: tipo === 'income' ? `Valorización ${rnd(1,12)}` : `Compra ${pick(['materiales', 'concreto', 'fierro', 'cemento'])}`,
      third_party_name: pick(proveedoresDemo)[0],
      third_party_ruc: pick(proveedoresDemo)[1],
      document_type: pick(['factura', 'boleta', 'recibo']),
      document_number: `F001-${String(i+100).padStart(6, '0')}`,
    });
  }

  // 8. Cuentas bancarias
  log('Sembrando tesorería...');
  for (const cta of [
    { banco: 'BCP', nro: '194-1234567-0-12', currency: 'PEN', saldo_inicial: 250_000 },
    { banco: 'BBVA', nro: '0011-0123-4567', currency: 'PEN', saldo_inicial: 180_000 },
    { banco: 'Interbank', nro: '898-3000123456', currency: 'USD', saldo_inicial: 35_000 },
  ]) {
    await db.cuentas_bancarias.add({
      ...baseFields(),
      id: newId(),
      company_id: empresaIds[0],
      ...cta,
      estado: 'activa',
    });
  }

  // 9. Activos pesados (1 maquinaria con HM y mantenimiento)
  log('Sembrando maquinaria...');
  const activoId = newId();
  await db.activos_pesados.add({
    ...baseFields(),
    id: activoId,
    codigo: 'EXC-DEMO-001',
    nombre: 'Excavadora CAT 320 Demo',
    tipo: 'excavadora',
    marca: 'Caterpillar', modelo: '320', anio: 2020,
    placa: 'XAA-555', serie: 'CAT320DEMO',
    estado: 'operativo',
    obra_actual_id: obraActiva,
    company_id: empresaIds[0],
    hm_acumuladas: 0,
    costo_adquisicion: 480_000,
    vida_util_anios: 8,
  });
  for (let i = 0; i < 12; i++) {
    await db.horas_maquina.add({
      ...baseFields(),
      id: newId(),
      activo_id: activoId,
      obra_id: obraActiva,
      fecha: dt(rnd(-60, -1)),
      horas_trabajadas: rnd(4, 10),
      operador: pick(personasDemo)[0] + ' ' + pick(personasDemo)[1],
      notas: pick(['', 'movimiento de tierras', 'excavación zanjas', 'limpieza terreno']),
    });
  }
  for (let i = 0; i < 6; i++) {
    await db.consumos_combustible.add({
      ...baseFields(),
      id: newId(),
      activo_id: activoId,
      fecha: dt(rnd(-60, -1)),
      galones: rnd(15, 40),
      precio_galon: 18.5,
      total: 0,
      grifo: 'Grifo Repsol',
    });
  }
  await db.mantenimientos_maquinaria.add({
    ...baseFields(),
    id: newId(),
    activo_id: activoId,
    fecha: dt(-15),
    tipo: 'cambio_aceite',
    descripcion: 'Cambio aceite motor + filtros',
    hm_actuales: 250,
    costo_repuestos: 450,
    costo_mano_obra: 120,
    costo_total: 570,
    taller: 'Taller propio',
  });

  // 10. SSOMA
  log('Sembrando SSOMA...');
  for (let i = 0; i < 5; i++) {
    await db.charlas_seguridad.add({
      ...baseFields(),
      id: newId(),
      obra_id: obraActiva,
      fecha: dt(rnd(-30, -1)),
      tema: pick(['Trabajos en altura', 'Manejo de cargas', 'EPP correcto', 'Riesgos eléctricos', 'Orden y limpieza']),
      duracion_minutos: 5,
      expositor: pick(personasDemo)[0],
    });
  }
  for (const r of [
    { actividad: 'Excavación profunda', peligro: 'Caída a desnivel', clasificacion: 'importante' },
    { actividad: 'Trabajo eléctrico en tablero', peligro: 'Electrocución', clasificacion: 'intolerable' },
    { actividad: 'Manejo concreto', peligro: 'Lesión espalda', clasificacion: 'tolerable' },
  ]) {
    await db.iperc.add({
      ...baseFields(),
      id: newId(),
      obra_id: obraActiva,
      ...r,
      estado: r.clasificacion === 'intolerable' ? 'pendiente' : 'controlado',
      medidas_control: 'Charla previa + EPP completo + supervisión continua',
    });
  }

  // 11. Requisición de prueba
  log('Sembrando requisición demo...');
  const reqId = newId();
  await db.requisiciones.add({
    ...baseFields(),
    id: reqId,
    obra_id: obraActiva,
    codigo: `REQ-DEMO-${dt(0).slice(0, 7)}-001`,
    fecha: dt(-3),
    descripcion: 'Demo · Reposición materiales semana',
    prioridad: 'media',
    estado: 'pendiente_aprobacion',
    solicitante_id: DEMO_USER,
  });

  log('✓ Demo data sembrado');
  return { obras: obrasDemo.length, personas: personasDemo.length, materiales: 35 };
}

export async function clearDemoData(progressCb) {
  const log = (msg) => { if (progressCb) progressCb(msg); };
  const tablas = [
    'obras','personal','materiales','herramientas','proveedores','partidas',
    'insumos_partida','companies','accounting_movements','intercompany_transactions',
    'requisiciones','requisicion_items','cotizaciones','cotizacion_items',
    'ordenes_compra','oc_items','recepciones','recepcion_items',
    'valorizaciones','valorizacion_partidas','valorizacion_adicionales',
    'cuentas_bancarias','movimientos_bancarios','cronograma_pagos',
    'activos_pesados','horas_maquina','consumos_combustible','mantenimientos_maquinaria',
    'charlas_seguridad','charla_asistentes','iperc','epp_entregas','inspecciones_seguridad','capacitaciones',
    'subcontratistas','subcontratos','subcontrato_valorizaciones',
    'personal_contrato','planillas','planilla_boletas',
    'asistencia','movimientos_materiales','movimientos_herramientas',
    'avance_obra','incidencias','evidencias',
  ];
  let total = 0;
  for (const t of tablas) {
    try {
      const rows = await db[t].filter(r => r.demo === true).toArray();
      if (rows.length) {
        const ids = rows.map(r => r.id);
        await db[t].bulkDelete(ids);
        total += rows.length;
        log(`  ${t}: ${rows.length} eliminados`);
      }
    } catch (e) { /* tabla no existe → skip */ }
  }
  log(`✓ ${total} registros demo eliminados`);
  return { eliminados: total };
}

export async function countDemoRecords() {
  const tablas = ['obras', 'personal', 'materiales', 'herramientas', 'companies', 'accounting_movements'];
  let total = 0;
  for (const t of tablas) {
    try { total += await db[t].filter(r => r.demo === true).count(); } catch {}
  }
  return total;
}
