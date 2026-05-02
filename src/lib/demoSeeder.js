// ═══════════════════════════════════════════════════════════════════
// JARVEX — Demo Seeder COMPLETO
// Genera una obra "a mitad de ejecución" con TODOS los módulos
// poblados, marcados con demo:true. Permite testear cada pantalla
// como si fuera una operación real.
// ═══════════════════════════════════════════════════════════════════

import { db, newId, newIdempotencyKey, SYNC_STATUS } from '../db/jarvex.db';
import { MATERIALES_BASE } from './catalogos';

const DEMO_USER = 'demo-user';
const ts = (offsetDays = 0) => {
  const d = new Date(); d.setDate(d.getDate() + offsetDays); return d.toISOString();
};
const dt = (offsetDays = 0) => ts(offsetDays).slice(0, 10);
const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const rndF = (min, max, dec = 2) => +(Math.random() * (max - min) + min).toFixed(dec);
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

// ─── DATOS BASE ─────────────────────────────────────────────────────
const obrasDemo = [
  {
    nombre_obra: '🧪 DEMO · Edificio Las Palmeras',
    cliente: 'Inmobiliaria Demo S.A.C.',
    ubicacion: 'San Isidro, Lima · Av. República 123',
    estado: 'activo',
    fecha_inicio: dt(-90),
    fecha_fin_estimada: dt(180),
    presupuesto_total: 4_850_000,
    observaciones: 'Obra principal demo · multifamiliar 8 pisos · ~33% avance',
    avance_fisico: 33,
    avance_financiero: 30,
    avance_objetivo: 0.33,
    completa: true, // esta es la rica
  },
  {
    nombre_obra: '🧪 DEMO · Hospital San Martín',
    cliente: 'MINSA · Programa Nacional',
    ubicacion: 'Trujillo, La Libertad',
    estado: 'planificacion',
    fecha_inicio: dt(30),
    fecha_fin_estimada: dt(540),
    presupuesto_total: 12_300_000,
    observaciones: 'Obra II-1 hospital, 3 niveles · en planificación',
    avance_fisico: 0,
    avance_financiero: 0,
    avance_objetivo: 0,
    completa: false,
  },
  {
    nombre_obra: '🧪 DEMO · Carretera Otuzco-Salpo',
    cliente: 'Gobierno Regional La Libertad',
    ubicacion: 'Otuzco, La Libertad',
    estado: 'finalizada',
    fecha_inicio: dt(-365),
    fecha_fin_estimada: dt(-30),
    presupuesto_total: 8_900_000,
    observaciones: 'Pavimentación 12 km · finalizada, en liquidación',
    avance_fisico: 100,
    avance_financiero: 95,
    avance_objetivo: 1.0,
    completa: false,
  },
];

const personasDemo = [
  ['Carlos', 'Quispe Mamani', '42158736', 'Operario Eléctrico', 'Instalaciones', 1500],
  ['Juan', 'Flores Ramos', '38421567', 'Operario Civil', 'Estructura', 1450],
  ['Pedro', 'Huamán Castro', '45123987', 'Maestro de Obra', 'Supervisión', 2200],
  ['Luis', 'Mamani Quispe', '33215678', 'Peón', 'Almacén', 1100],
  ['Miguel', 'Salas Mendoza', '43872156', 'Capataz', 'Estructura', 1800],
  ['Alberto', 'Cruz Vargas', '40123456', 'Operario Plomero', 'Sanitario', 1500],
  ['Roberto', 'Mendoza López', '41789012', 'Operador Maquinaria', 'Maquinaria', 1700],
  ['Diego', 'Vásquez Torres', '44567890', 'Topógrafo', 'Topografía', 2000],
  ['Manuel', 'Rojas Pinto', '46789012', 'Almacenero', 'Almacén', 1400],
  ['José', 'Castro Ruiz', '47891234', 'Operario Encofrador', 'Estructura', 1500],
  ['Marco', 'Aguilar Soto', '48912345', 'Operario Fierrero', 'Estructura', 1500],
  ['Andrés', 'Vega Chávez', '49123456', 'Pintor', 'Acabados', 1500],
];

const empresasDemo = [
  { name: '🧪 DEMO · Constructora Nova', legal_name: 'CONSTRUCTORA NOVA SAC', ruc: '20512345678', company_type: 'constructora', status: 'activa', address: 'Av. Javier Prado 1234, San Isidro, Lima', ubigeo: '150131' },
  { name: '🧪 DEMO · Inmobiliaria Demo', legal_name: 'INMOBILIARIA DEMO SAC', ruc: '20512345001', company_type: 'inmobiliaria', status: 'activa', address: 'Av. Aviación 567, San Borja, Lima', ubigeo: '150130' },
];

const proveedoresDemo = [
  ['Aceros Arequipa S.A.', '20100128056', 'aceros@arequipa.com.pe', '01-2225900'],
  ['Cementos Pacasmayo S.A.A.', '20419387244', 'ventas@pacasmayo.pe', '044-244222'],
  ['Sodimac Perú S.A.', '20536557858', 'corporativo@sodimac.com.pe', '01-2095000'],
  ['Distribuidora La Constancia', '20510123456', 'la.constancia@gmail.com', '999-111-222'],
  ['Ferretería El Roble', '20512387645', 'roble@ferreteria.pe', '999-444-555'],
  ['Eléctricos Lima Norte', '20587654321', 'ventas@elec.lima.pe', '01-5557777'],
  ['Concretos Premezclados Selva', '20198234567', 'pedidos@concretos.pe', '999-666-777'],
];

// Partidas representativas de un edificio multifamiliar
const partidasDemo = [
  { codigo: '01.01.01', nombre: 'Limpieza de terreno manual', unidad: 'm²', metrado: 850, precio: 5.50, avance: 1.0 },
  { codigo: '01.01.02', nombre: 'Trazo y replanteo', unidad: 'm²', metrado: 850, precio: 8.20, avance: 1.0 },
  { codigo: '01.02.01', nombre: 'Excavación masiva con equipo', unidad: 'm³', metrado: 2400, precio: 28.50, avance: 1.0 },
  { codigo: '01.02.02', nombre: 'Excavación manual de zanjas', unidad: 'm³', metrado: 180, precio: 47.25, avance: 0.85 },
  { codigo: '01.02.03', nombre: 'Eliminación de material excedente', unidad: 'm³', metrado: 2580, precio: 35.00, avance: 0.92 },
  { codigo: '02.01.01', nombre: 'Concreto f\'c=140 kg/cm² en cimiento', unidad: 'm³', metrado: 240, precio: 539.04, avance: 1.0 },
  { codigo: '02.01.02', nombre: 'Concreto f\'c=210 kg/cm² en zapatas', unidad: 'm³', metrado: 180, precio: 698.46, avance: 1.0 },
  { codigo: '02.01.03', nombre: 'Concreto f\'c=210 kg/cm² en columnas', unidad: 'm³', metrado: 145, precio: 720.50, avance: 0.65 },
  { codigo: '02.01.04', nombre: 'Concreto f\'c=210 kg/cm² en losas', unidad: 'm³', metrado: 380, precio: 685.20, avance: 0.40 },
  { codigo: '02.02.01', nombre: 'Acero corrugado 1/2" Fy=4200', unidad: 'kg', metrado: 18500, precio: 4.20, avance: 0.55 },
  { codigo: '02.02.02', nombre: 'Acero corrugado 5/8" Fy=4200', unidad: 'kg', metrado: 12300, precio: 4.30, avance: 0.50 },
  { codigo: '02.03.01', nombre: 'Encofrado en columnas', unidad: 'm²', metrado: 920, precio: 76.36, avance: 0.62 },
  { codigo: '02.03.02', nombre: 'Encofrado en vigas', unidad: 'm²', metrado: 1450, precio: 76.36, avance: 0.40 },
  { codigo: '03.01.01', nombre: 'Muros de ladrillo King Kong', unidad: 'm²', metrado: 2400, precio: 95.00, avance: 0.15 },
  { codigo: '03.01.02', nombre: 'Tabiquería con drywall', unidad: 'm²', metrado: 850, precio: 78.00, avance: 0.05 },
  { codigo: '04.01.01', nombre: 'Tarrajeo en interiores', unidad: 'm²', metrado: 4800, precio: 38.31, avance: 0.10 },
  { codigo: '04.01.02', nombre: 'Tarrajeo en exteriores', unidad: 'm²', metrado: 2200, precio: 42.50, avance: 0.0 },
  { codigo: '05.01.01', nombre: 'Cerámico en pisos', unidad: 'm²', metrado: 1850, precio: 65.00, avance: 0.0 },
  { codigo: '05.01.02', nombre: 'Pintura latex 2 manos', unidad: 'm²', metrado: 7000, precio: 14.65, avance: 0.0 },
  { codigo: '06.01.01', nombre: 'Instalación tubería PVC sanitaria', unidad: 'ml', metrado: 850, precio: 18.50, avance: 0.30 },
  { codigo: '06.01.02', nombre: 'Aparatos sanitarios completos', unidad: 'pza', metrado: 48, precio: 480.00, avance: 0.0 },
  { codigo: '07.01.01', nombre: 'Cableado eléctrico THW', unidad: 'ml', metrado: 4200, precio: 3.80, avance: 0.45 },
  { codigo: '07.01.02', nombre: 'Tableros eléctricos completos', unidad: 'und', metrado: 16, precio: 145.00, avance: 0.20 },
  { codigo: '07.01.03', nombre: 'Tomacorrientes e interruptores', unidad: 'und', metrado: 320, precio: 18.00, avance: 0.0 },
];

// ─── SEED ───────────────────────────────────────────────────────────
export async function seedDemoData(progressCb) {
  const log = (msg) => { if (progressCb) progressCb(msg); console.log('[demoSeeder]', msg); };

  // 1. EMPRESAS
  log('Sembrando empresas...');
  const empresaIds = [];
  for (const e of empresasDemo) {
    const id = newId();
    await db.companies.add({ ...baseFields(), id, ...e });
    empresaIds.push(id);
  }

  // 2. OBRAS
  log('Sembrando obras...');
  const obraIds = [];
  for (const o of obrasDemo) {
    const id = newId();
    const { completa, avance_objetivo, ...rest } = o;
    await db.obras.add({ ...baseFields(), id, ...rest, company_id: empresaIds[0] });
    obraIds.push({ id, completa, avance_objetivo, fecha_inicio: o.fecha_inicio, fecha_fin: o.fecha_fin_estimada, presupuesto: o.presupuesto_total });
  }
  const obraPrincipal = obraIds[0]; // la rica
  const obraActivaId = obraPrincipal.id;

  // 3. PERSONAL — 12 trabajadores en obra principal, 4 en hospital, 0 en carretera
  log('Sembrando personal...');
  const personalIds = [];
  for (let i = 0; i < personasDemo.length; i++) {
    const [nombres, apellidos, dni, cargo, area, sueldo] = personasDemo[i];
    const obraId = i < 8 ? obraPrincipal.id : (i < 12 ? obraIds[1].id : obraPrincipal.id);
    const id = newId();
    await db.personal.add({
      ...baseFields(),
      id,
      obra_id: obraId,
      nombres, apellidos, dni, cargo, area,
      fecha_ingreso: dt(rnd(-180, -10)),
      fecha_nacimiento: `${1980 + rnd(0, 30)}-${String(rnd(1,12)).padStart(2,'0')}-${String(rnd(1,28)).padStart(2,'0')}`,
      telefono: `9${rnd(10000000, 99999999)}`,
      estado: 'activo',
    });
    personalIds.push({ id, nombres, apellidos, dni, cargo, sueldo, obra_id: obraId });
  }

  // 4. PROVEEDORES
  log('Sembrando proveedores...');
  const proveedorIds = [];
  for (const [razon, ruc, correo, tel] of proveedoresDemo) {
    const id = newId();
    await db.proveedores.add({
      ...baseFields(), id,
      razon_social: razon, ruc, correo, telefono: tel,
      estado: 'activo',
    });
    proveedorIds.push({ id, razon, ruc });
  }

  // 5. MATERIALES — 60 con stock variado en obra principal
  log('Sembrando materiales...');
  const materialIds = [];
  for (const m of MATERIALES_BASE.slice(0, 60)) {
    const stockMin = rnd(10, 80);
    // 20% en stock bajo/crítico, 70% en OK, 10% sin stock
    let stockActual;
    const r = Math.random();
    if (r < 0.10) stockActual = 0;
    else if (r < 0.20) stockActual = Math.floor(stockMin * 0.4);
    else if (r < 0.30) stockActual = Math.floor(stockMin * 0.95);
    else stockActual = Math.floor(stockMin * rndF(1.5, 4));

    let alerta = 'ok';
    if (stockActual <= 0) alerta = 'agotado';
    else if (stockActual <= stockMin * 0.5) alerta = 'critico';
    else if (stockActual <= stockMin) alerta = 'reponer';
    else if (stockActual <= stockMin * 1.2) alerta = 'cerca';

    const id = newId();
    await db.materiales.add({
      ...baseFields(), id,
      obra_id: obraPrincipal.id,
      nombre_material: m.nombre,
      categoria: m.categoria,
      unidad: m.unidad,
      stock_inicial: stockActual,
      stock_actual: stockActual,
      stock_minimo: stockMin,
      precio_unitario_estimado: m.precio,
      alerta,
      estado: 'activo',
      proveedor_principal_id: pick(proveedorIds).id,
    });
    materialIds.push({ id, nombre: m.nombre, unidad: m.unidad, stock: stockActual, precio: m.precio });
  }

  // 6. HERRAMIENTAS
  log('Sembrando herramientas...');
  const herrs = [
    ['Taladro percutor Bosch GBH 2-26', 'electrica', 'Bosch', 'GBH 2-26'],
    ['Amoladora 4 1/2" Stanley', 'electrica', 'Stanley', 'STGS 9115'],
    ['Sierra circular 7 1/4" DeWalt', 'electrica', 'DeWalt', 'DWE575'],
    ['Compactadora plancha 90 kg', 'gasolina', 'Yamaha', 'MS-90'],
    ['Vibrador concreto Honda', 'electrica', 'Honda', 'WX-15'],
    ['Nivel laser autonivelante', 'medicion', 'Bosch', 'GLL 3-80'],
    ['Carretilla buggy 100L', 'manual', 'Truper', '14127'],
    ['Pala recta', 'manual', 'Bellota', 'P-3'],
    ['Pico minero', 'manual', 'Truper', 'PIC-5'],
    ['Maquina de soldar 200A', 'electrica', 'Indura', 'INV-200'],
    ['Compresora aire 5HP', 'electrica', 'Power', 'CP-5'],
    ['Andamio metálico (juego)', 'manual', '—', '—'],
  ];
  const herrIds = [];
  for (const [nombre, tipo, marca, modelo] of herrs) {
    const id = newId();
    const enUso = Math.random() < 0.4;
    const respId = enUso ? pick(personalIds).id : null;
    await db.herramientas.add({
      ...baseFields(), id,
      obra_id: obraPrincipal.id,
      nombre_herramienta: nombre,
      tipo_herramienta: tipo,
      marca, modelo,
      estado_actual: pick(['nuevo', 'bueno', 'bueno', 'regular']),
      ubicacion_actual: enUso ? 'en_uso' : 'almacen',
      disponible: !enUso,
      ultimo_responsable_id: respId,
    });
    herrIds.push({ id, nombre, en_uso: enUso, resp: respId });
  }

  // 6b. MOVIMIENTOS DE HERRAMIENTAS — historial real
  log('Sembrando movimientos de herramientas...');
  for (const h of herrIds) {
    // Cada herramienta tiene 2-5 movimientos históricos (salidas y devoluciones)
    const numMovs = rnd(2, 5);
    let estaFuera = false;
    for (let i = 0; i < numMovs; i++) {
      const dia = -60 + i * rnd(7, 14);
      const fecha = dt(dia);
      const hora = `${String(rnd(7, 17)).padStart(2,'0')}:${String(rnd(0,59)).padStart(2,'0')}`;
      // Alternar entrada/salida, sumar mantenimiento ocasional
      const accion = !estaFuera
        ? (Math.random() < 0.05 ? 'mantenimiento' : 'salida')
        : 'entrada';
      const responsable = estaFuera ? h.resp || pick(personalIds).id : pick(personalIds).id;
      const estado = accion === 'entrada' ? pick(['bueno', 'bueno', 'regular', 'bueno', 'malo']) : null;
      await db.movimientos_herramientas.add({
        ...baseFields(), id: newId(),
        obra_id: obraPrincipal.id,
        herramienta_id: h.id,
        fecha,
        hora,
        accion,
        tipo_movimiento: accion,
        responsable_id: responsable,
        estado_salida: accion === 'salida' ? pick(['nuevo', 'bueno']) : null,
        estado_devolucion: accion === 'entrada' ? estado : null,
        observaciones: accion === 'salida'
          ? `Para ${pick(['vaciado', 'encofrado', 'instalación', 'movimiento de tierras'])}`
          : accion === 'entrada' && estado === 'malo'
            ? 'Devuelta con daño · enviada a mantenimiento'
            : '',
        idempotency_key: `${DEMO_USER}_mov_herr_${h.id}_${i}`,
      });
      estaFuera = accion === 'salida';
    }
    // Si la herramienta está marcada como en_uso, asegurar que el último mov sea una salida
    if (h.en_uso && !estaFuera) {
      const fechaUltima = dt(rnd(-3, -1));
      await db.movimientos_herramientas.add({
        ...baseFields(), id: newId(),
        obra_id: obraPrincipal.id,
        herramienta_id: h.id,
        fecha: fechaUltima,
        hora: '08:30',
        accion: 'salida',
        tipo_movimiento: 'salida',
        responsable_id: h.resp,
        estado_salida: 'bueno',
        observaciones: 'Salida actual · herramienta en uso',
        idempotency_key: `${DEMO_USER}_mov_herr_${h.id}_actual`,
      });
    }
  }

  // 7. PARTIDAS (presupuesto + avance)
  log('Sembrando partidas...');
  const partidaIds = [];
  for (const [idx, p] of partidasDemo.entries()) {
    const id = newId();
    const segs = p.codigo.split('.');
    await db.partidas.add({
      ...baseFields(), id,
      obra_id: obraPrincipal.id,
      codigo_delfin: p.codigo,
      nombre_partida: p.nombre,
      categoria: 'General',
      unidad: p.unidad,
      metrado_contratado: p.metrado,
      precio_unitario_pres: p.precio,
      costo_total_presupuestado: p.metrado * p.precio,
      porcentaje_avance: p.avance * 100,
      metrado_ejecutado: p.metrado * p.avance,
      costo_real_acumulado: p.metrado * p.avance * p.precio * rndF(0.92, 1.08),
      estado: p.avance >= 1.0 ? 'terminado' : p.avance > 0 ? 'en_ejecucion' : 'pendiente',
      fecha_inicio_planificada: dt(-90 + idx * 4),
      fecha_fin_planificada: dt(-30 + idx * 8),
      nivel: segs.length,
      parent_codigo: segs.length > 1 ? segs.slice(0, -1).join('.') : null,
      orden: idx,
    });
    partidaIds.push({ id, ...p });
  }

  // 8. ASISTENCIA — últimos 30 días, 80-95% asistencia
  log('Sembrando asistencia...');
  const personalObra = personalIds.filter(p => p.obra_id === obraPrincipal.id);
  for (let dia = -30; dia <= 0; dia++) {
    const date = new Date(); date.setDate(date.getDate() + dia);
    const dow = date.getDay();
    if (dow === 0) continue; // domingo
    for (const p of personalObra) {
      const r = Math.random();
      let estado_asistencia, horas;
      if (r < 0.85) { estado_asistencia = 'asistio'; horas = dow === 6 ? 4 : 8; }
      else if (r < 0.92) { estado_asistencia = 'tardanza'; horas = dow === 6 ? 3.5 : 7.5; }
      else if (r < 0.96) { estado_asistencia = 'permiso'; horas = 0; }
      else { estado_asistencia = 'falta'; horas = 0; }
      await db.asistencia.add({
        ...baseFields(), id: newId(),
        obra_id: obraPrincipal.id,
        personal_id: p.id,
        fecha: dt(dia),
        estado_asistencia,
        horas_trabajadas: horas,
        hora_entrada: estado_asistencia === 'asistio' ? '08:00' : (estado_asistencia === 'tardanza' ? '08:30' : null),
        hora_salida: horas > 0 ? '17:00' : null,
        idempotency_key: `${DEMO_USER}_asistencia_${p.id}_${dt(dia)}`,
      });
    }
  }

  // 9. MOVIMIENTOS DE MATERIALES — entradas y salidas variadas
  log('Sembrando movimientos materiales...');
  for (let i = 0; i < 80; i++) {
    const mat = pick(materialIds);
    const tipo = Math.random() < 0.4 ? 'ingreso' : 'salida';
    const cant = rndF(1, Math.max(2, mat.stock * 0.3), 1);
    await db.movimientos_materiales.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      material_id: mat.id,
      fecha: dt(rnd(-30, 0)),
      tipo_movimiento: tipo,
      cantidad: cant,
      precio_unitario: mat.precio,
      proveedor_id: tipo === 'ingreso' ? pick(proveedorIds).id : null,
      responsable_id: pick(personalObra).id,
      observaciones: tipo === 'ingreso' ? 'Compra OC' : 'Salida a obra',
      idempotency_key: `${DEMO_USER}_mov_mat_${i}`,
    });
  }

  // 10. REQUISICIONES + items
  log('Sembrando compras...');
  for (let i = 0; i < 5; i++) {
    const reqId = newId();
    const estado = pick(['solicitada', 'aprobada', 'cotizando', 'ordenada', 'recibida']);
    await db.requisiciones.add({
      ...baseFields(), id: reqId,
      obra_id: obraPrincipal.id,
      codigo: `REQ-2026-${String(i + 1).padStart(4, '0')}`,
      fecha: dt(rnd(-25, -1)),
      descripcion: pick([
        'Materiales para vaciado losa nivel 3',
        'Reposición acero estructural',
        'Cerámicos y acabados pisos',
        'Instalación eléctrica nivel 4-5',
        'Tubería sanitaria y sanitarios',
      ]),
      prioridad: pick(['alta', 'media', 'urgente']),
      estado,
      solicitante_id: pick(personalObra).id,
      idempotency_key: `${DEMO_USER}_req_${i}`,
    });
    // Items
    const items = rnd(2, 5);
    for (let j = 0; j < items; j++) {
      const m = pick(materialIds);
      await db.requisicion_items.add({
        ...baseFields(), id: newId(),
        requisicion_id: reqId,
        material_id: m.id,
        descripcion: m.nombre,
        unidad: m.unidad,
        cantidad: rndF(5, 50, 1),
        precio_estimado: m.precio,
        idempotency_key: `${DEMO_USER}_req_item_${i}_${j}`,
      });
    }
  }

  // 11. ÓRDENES DE COMPRA + items + recepciones
  log('Sembrando órdenes de compra...');
  for (let i = 0; i < 8; i++) {
    const ocId = newId();
    const prov = pick(proveedorIds);
    const fecha = dt(rnd(-45, -3));
    const estado = pick(['enviada', 'aceptada', 'recibida', 'recibida', 'recibida_parcial']);
    let total = 0;
    const items = [];
    const cantItems = rnd(2, 5);
    for (let j = 0; j < cantItems; j++) {
      const m = pick(materialIds);
      const cant = rndF(10, 100, 1);
      const precio = m.precio * rndF(0.95, 1.05);
      const subtotal = +(cant * precio).toFixed(2);
      total += subtotal;
      items.push({ id: newId(), material_id: m.id, descripcion: m.nombre, unidad: m.unidad, cantidad: cant, precio_unitario: precio, subtotal });
    }
    await db.ordenes_compra.add({
      ...baseFields(), id: ocId,
      obra_id: obraPrincipal.id,
      proveedor_id: prov.id,
      codigo: `OC-2026-${String(i + 1).padStart(4, '0')}`,
      numero_oc: `OC-${i + 1}`,
      fecha,
      fecha_entrega: dt(rnd(-30, 5)),
      estado,
      moneda: 'PEN',
      subtotal: +(total).toFixed(2),
      igv: +(total * 0.18).toFixed(2),
      total: +(total * 1.18).toFixed(2),
      proveedor_nombre: prov.razon,
      idempotency_key: `${DEMO_USER}_oc_${i}`,
    });
    for (const it of items) {
      await db.oc_items.add({
        ...baseFields(),
        ...it,
        orden_compra_id: ocId,
        idempotency_key: `${DEMO_USER}_oc_item_${i}_${it.id.slice(-4)}`,
      });
    }
    // Recepción si está recibida
    if (estado === 'recibida' || estado === 'recibida_parcial') {
      const recId = newId();
      await db.recepciones.add({
        ...baseFields(), id: recId,
        orden_compra_id: ocId,
        fecha: dt(rnd(-25, 0)),
        observaciones: 'Recibido conforme',
        idempotency_key: `${DEMO_USER}_rec_${i}`,
      });
    }
  }

  // 12. VALORIZACIONES
  log('Sembrando valorizaciones...');
  const valIds = [];
  for (let i = 0; i < 3; i++) {
    const valId = newId();
    const mes = new Date().getMonth() - 2 + i;
    const monto = +(obraPrincipal.presupuesto * 0.10 * rndF(0.8, 1.1)).toFixed(2);
    await db.valorizaciones.add({
      ...baseFields(), id: valId,
      obra_id: obraPrincipal.id,
      numero: i + 1,
      periodo_anio: new Date().getFullYear(),
      periodo_mes: ((mes + 12) % 12) + 1,
      estado: i === 0 ? 'aprobada' : (i === 1 ? 'aprobada' : 'presentada'),
      monto_neto: monto,
      monto_total: monto,
      observaciones: `Valorización mensual N° ${i + 1}`,
      idempotency_key: `${DEMO_USER}_val_${i}`,
    });
    valIds.push(valId);
  }

  // 13. CUENTAS BANCARIAS + movimientos + cronograma
  log('Sembrando tesorería...');
  const cuentas = [
    { banco: 'BCP', nro: '194-1234567-0-12', currency: 'PEN', saldo_inicial: 250_000 },
    { banco: 'BBVA', nro: '0011-0123-4567', currency: 'PEN', saldo_inicial: 180_000 },
    { banco: 'Interbank', nro: '898-3000123456', currency: 'USD', saldo_inicial: 35_000 },
  ];
  const cuentaIds = [];
  for (const cta of cuentas) {
    const id = newId();
    await db.cuentas_bancarias.add({
      ...baseFields(), id,
      company_id: empresaIds[0],
      ...cta,
      estado: 'activa',
    });
    cuentaIds.push({ id, ...cta });
  }
  // Movimientos bancarios
  for (let i = 0; i < 25; i++) {
    const cta = pick(cuentaIds);
    const tipo = pick(['ingreso', 'egreso', 'egreso']);
    const monto = rnd(500, 30000);
    await db.movimientos_bancarios.add({
      ...baseFields(), id: newId(),
      cuenta_id: cta.id,
      fecha: dt(rnd(-60, 0)),
      tipo,
      monto,
      descripcion: tipo === 'ingreso' ? `Cobro valorización ${i}` : `Pago ${pick(['proveedor', 'planilla', 'servicio', 'impuesto'])}`,
      conciliado: Math.random() < 0.7,
    });
  }
  // Cronograma de pagos
  for (let i = 0; i < 12; i++) {
    const fecha = dt(rnd(-15, 60));
    const estado = fecha < dt(0) ? pick(['pagado', 'vencido', 'pagado']) : 'programado';
    await db.cronograma_pagos.add({
      ...baseFields(), id: newId(),
      company_id: empresaIds[0],
      descripcion: pick(['Pago proveedor Aceros Arequipa', 'Planilla quincenal', 'Pago Pacasmayo', 'IGV mensual', 'Renta 5ta', 'Pago Sodimac']),
      monto: rnd(2500, 35000),
      fecha_programada: fecha,
      fecha_vencimiento: fecha,
      estado,
      beneficiario: pick(proveedoresDemo)[0],
    });
  }

  // 14. ACTIVOS PESADOS + HM + combustible + mantenimientos
  log('Sembrando maquinaria...');
  const activos = [
    { codigo: 'EXC-DEMO-001', nombre: 'Excavadora CAT 320', tipo: 'excavadora', marca: 'Caterpillar', modelo: '320', anio: 2020, placa: 'XAA-555', costo: 480_000 },
    { codigo: 'VOL-DEMO-001', nombre: 'Volquete Volvo FMX 12m³', tipo: 'volquete', marca: 'Volvo', modelo: 'FMX', anio: 2019, placa: 'YBC-321', costo: 320_000 },
    { codigo: 'CAR-DEMO-001', nombre: 'Cargador frontal CAT 950', tipo: 'cargador', marca: 'Caterpillar', modelo: '950', anio: 2018, placa: 'ZDE-987', costo: 410_000 },
  ];
  const activoIds = [];
  for (const a of activos) {
    const id = newId();
    await db.activos_pesados.add({
      ...baseFields(), id,
      ...a,
      estado: 'operativo',
      obra_actual_id: obraPrincipal.id,
      company_id: empresaIds[0],
      hm_acumuladas: 0,
      vida_util_anios: 8,
      costo_adquisicion: a.costo,
    });
    activoIds.push(id);
  }
  // HM, combustible, mantto por activo
  for (const activoId of activoIds) {
    for (let i = 0; i < 18; i++) {
      await db.horas_maquina.add({
        ...baseFields(), id: newId(),
        activo_id: activoId,
        obra_id: obraPrincipal.id,
        fecha: dt(rnd(-60, -1)),
        horas_trabajadas: rnd(4, 10),
        operador: pick(personalObra).nombres + ' ' + pick(personalObra).apellidos,
        notas: pick(['', 'movimiento de tierras', 'excavación zanjas', 'limpieza terreno', 'transporte material']),
      });
    }
    for (let i = 0; i < 8; i++) {
      const galones = rnd(15, 45);
      const precio = 18.5;
      await db.consumos_combustible.add({
        ...baseFields(), id: newId(),
        activo_id: activoId,
        fecha: dt(rnd(-60, -1)),
        galones,
        precio_galon: precio,
        total: galones * precio,
        grifo: pick(['Grifo Repsol', 'Grifo Primax', 'Grifo Petroperú']),
      });
    }
    await db.mantenimientos_maquinaria.add({
      ...baseFields(), id: newId(),
      activo_id: activoId,
      fecha: dt(rnd(-30, -5)),
      tipo: 'cambio_aceite',
      descripcion: 'Cambio aceite motor + filtros aire/aceite/combustible',
      hm_actuales: rnd(150, 250),
      costo_repuestos: 450,
      costo_mano_obra: 120,
      costo_total: 570,
      taller: 'Taller propio',
    });
  }

  // 15. SSOMA — Charlas, IPERC, EPP, Inspecciones, Capacitaciones
  log('Sembrando SSOMA...');
  for (let i = 0; i < 12; i++) {
    const charlaId = newId();
    await db.charlas_seguridad.add({
      ...baseFields(), id: charlaId,
      obra_id: obraPrincipal.id,
      fecha: dt(rnd(-30, -1)),
      tema: pick(['Trabajos en altura', 'Manejo de cargas', 'EPP correcto', 'Riesgos eléctricos', 'Orden y limpieza', 'Manejo defensivo', 'Trabajo en zanjas']),
      duracion_minutos: 5,
      expositor: pick(personalObra).nombres + ' ' + pick(personalObra).apellidos,
    });
    // Asistentes a la charla (4-8 personas)
    const asistentes = [...personalObra].sort(() => Math.random() - 0.5).slice(0, rnd(4, 8));
    for (const a of asistentes) {
      await db.charla_asistentes.add({
        ...baseFields(), id: newId(),
        charla_id: charlaId,
        personal_id: a.id,
      });
    }
  }
  for (const r of [
    { actividad: 'Excavación profunda en zanjas', peligro: 'Caída a desnivel y atrapamiento', clasificacion: 'importante', estado: 'controlado' },
    { actividad: 'Trabajo eléctrico en tablero general', peligro: 'Electrocución', clasificacion: 'intolerable', estado: 'pendiente' },
    { actividad: 'Manejo concreto fresco', peligro: 'Lesión espalda por carga manual', clasificacion: 'tolerable', estado: 'controlado' },
    { actividad: 'Soldadura con arco eléctrico', peligro: 'Quemaduras y radiación UV', clasificacion: 'importante', estado: 'controlado' },
    { actividad: 'Trabajo en altura piso 5', peligro: 'Caída de altura', clasificacion: 'intolerable', estado: 'controlado' },
    { actividad: 'Almacenamiento materiales', peligro: 'Aplastamiento por caída', clasificacion: 'tolerable', estado: 'controlado' },
  ]) {
    await db.iperc.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      ...r,
      medidas_control: 'Charla previa + EPP completo + supervisión continua + permisos firmados',
      probabilidad: rnd(2, 4),
      severidad: rnd(2, 4),
      nivel_riesgo: rnd(6, 16),
    });
  }
  // EPP entregas
  for (let i = 0; i < 18; i++) {
    await db.epp_entregas.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      personal_id: pick(personalObra).id,
      fecha: dt(rnd(-60, -1)),
      tipo_epp: pick(['casco', 'lentes', 'guantes', 'botas', 'arnés', 'mascarilla', 'chaleco']),
      cantidad: 1,
      observaciones: 'Entrega regular',
    });
  }
  // Inspecciones
  for (let i = 0; i < 5; i++) {
    await db.inspecciones_seguridad.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      fecha: dt(rnd(-25, -1)),
      tipo: pick(['rutina', 'preuso', 'mensual']),
      area_inspeccionada: pick(['Almacén', 'Estructura nivel 3', 'Instalaciones eléctricas', 'Andamios', 'Maquinaria']),
      resultado: pick(['conforme', 'conforme', 'observaciones', 'no_conforme']),
      observaciones: 'Inspección rutinaria · puntos menores corregidos',
      inspector: pick(personalObra).nombres + ' ' + pick(personalObra).apellidos,
    });
  }
  // Capacitaciones
  for (let i = 0; i < 4; i++) {
    await db.capacitaciones.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      fecha: dt(rnd(-90, -10)),
      tipo: pick(['induccion', 'refresher', 'especifica']),
      tema: pick(['Trabajos en altura · 4hs', 'Primeros auxilios', 'Manejo de extintores', 'IPERC y matriz de riesgo']),
      duracion_horas: rnd(2, 8),
      expositor: 'Capacitador externo certificado',
      participantes: rnd(8, 15),
    });
  }

  // 16. SUBCONTRATISTAS + subcontratos
  log('Sembrando subcontratos...');
  const subIds = [];
  for (let i = 0; i < 3; i++) {
    const id = newId();
    await db.subcontratistas.add({
      ...baseFields(), id,
      razon_social: pick(['Eléctricas Mendoza SAC', 'Pinturas y Acabados Lima EIRL', 'Drywall Pro SAC']),
      ruc: `205${rnd(10000000, 99999999)}`,
      contacto: pick(personasDemo)[0] + ' ' + pick(personasDemo)[1],
      telefono: `9${rnd(10000000, 99999999)}`,
      especialidad: pick(['Eléctrico', 'Pintura', 'Drywall', 'Cerámicos']),
      estado: 'activo',
    });
    subIds.push(id);
  }
  for (const subId of subIds) {
    await db.subcontratos.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      subcontratista_id: subId,
      codigo: `SC-2026-${rnd(1, 999).toString().padStart(3, '0')}`,
      objeto: pick(['Instalaciones eléctricas integrales', 'Pintura completa interior y exterior', 'Drywall en pisos 4-8']),
      monto: rnd(80000, 250000),
      fecha_inicio: dt(rnd(-60, -10)),
      fecha_fin: dt(rnd(30, 120)),
      estado: 'activo',
      retencion_pct: 5,
    });
  }

  // 17. PERSONAL CONTRATO + PLANILLAS + boletas
  log('Sembrando RRHH...');
  for (const p of personalIds) {
    await db.personal_contrato.add({
      ...baseFields(), id: newId(),
      personal_id: p.id,
      fecha_inicio: dt(rnd(-180, -10)),
      sueldo_basico: p.sueldo,
      asignacion_familiar: 102.50,
      bonificaciones_fijas: 0,
      regimen: 'construccion_civil',
      tipo_pension: pick(['ONP', 'AFP', 'AFP']),
      afp_nombre: pick(['Integra', 'Prima', 'Profuturo', 'Habitat']),
      afp_pct_aporte_obligatorio: 10,
      afp_pct_seguro: 1.49,
      afp_pct_comision: 1.55,
      tiene_essalud: true,
      cargo_planilla: p.cargo,
      estado: 'vigente',
    });
  }
  // 1 planilla del mes anterior con boletas
  const planId = newId();
  const mesAnt = new Date(); mesAnt.setMonth(mesAnt.getMonth() - 1);
  await db.planillas.add({
    ...baseFields(), id: planId,
    obra_id: obraPrincipal.id,
    periodo_anio: mesAnt.getFullYear(),
    periodo_mes: mesAnt.getMonth() + 1,
    estado: 'cerrada',
    fecha_cierre: dt(-5),
  });
  for (const p of personalObra) {
    const dias = rnd(20, 26);
    const basico = p.sueldo * dias / 30;
    const asig = 102.50;
    const bruto = basico + asig;
    const desc = bruto * 0.13;
    const neto = bruto - desc;
    await db.planilla_boletas.add({
      ...baseFields(), id: newId(),
      planilla_id: planId,
      personal_id: p.id,
      nombres: p.nombres, apellidos: p.apellidos, dni: p.dni, cargo: p.cargo,
      dias_trabajados: dias,
      sueldo_basico: p.sueldo,
      asignacion_familiar: asig,
      total_ingresos: +(bruto).toFixed(2),
      descuento_afp_onp: +(desc).toFixed(2),
      total_descuentos: +(desc).toFixed(2),
      neto_pagar: +(neto).toFixed(2),
    });
  }

  // 18. INCIDENCIAS Y MOVIMIENTOS CONTABLES
  log('Sembrando incidencias y contabilidad...');
  for (let i = 0; i < 5; i++) {
    await db.incidencias.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      titulo: pick(['Demora entrega cemento', 'Daño en encofrado', 'Inspector observó EPP', 'Lluvia paralizó vaciado', 'Cambio de diseño nivel 4']),
      descripcion: 'Incidente reportado por capataz',
      fecha: dt(rnd(-30, -1)),
      estado: pick(['abierta', 'en_proceso', 'resuelta', 'resuelta']),
      severidad: pick(['baja', 'media', 'alta']),
      reportado_por: pick(personalObra).id,
    });
  }
  for (let i = 0; i < 40; i++) {
    const tipo = pick(['income', 'cost', 'expense', 'cost', 'cost']);
    const monto = rnd(800, 35000);
    const subtotal = +(monto / 1.18).toFixed(2);
    const igv = +(monto - subtotal).toFixed(2);
    const prov = pick(proveedorIds);
    await db.accounting_movements.add({
      ...baseFields(), id: newId(),
      company_id: empresaIds[0],
      obra_id: obraPrincipal.id,
      type: tipo,
      date: dt(rnd(-90, 0)),
      amount: monto,
      subtotal, igv_amount: igv,
      currency: 'PEN',
      payment_status: pick(['paid', 'paid', 'paid', 'pending']),
      category: tipo === 'income' ? 'venta' : pick(['materiales', 'mano_obra', 'subcontrato', 'servicios']),
      description: tipo === 'income' ? `Valorización N°${rnd(1,3)}` : `Compra ${pick(['cemento', 'fierro', 'agregados', 'concreto', 'eléctrico', 'sanitario'])}`,
      third_party_name: prov.razon,
      third_party_ruc: prov.ruc,
      document_type: pick(['factura', 'factura', 'boleta']),
      document_number: `F001-${String(i + 100).padStart(6, '0')}`,
    });
  }

  // 19. AVANCE DE OBRA (registros de avance)
  log('Sembrando avance...');
  for (const part of partidaIds.filter(p => p.avance > 0)) {
    const ciclos = Math.min(8, Math.ceil(part.avance * 10));
    let acumulado = 0;
    for (let c = 0; c < ciclos; c++) {
      const inc = (part.metrado * part.avance) / ciclos;
      acumulado += inc;
      await db.avance_obra.add({
        ...baseFields(), id: newId(),
        obra_id: obraPrincipal.id,
        partida_id: part.id,
        fecha: dt(-90 + c * 10),
        metrado_ejecutado: +(inc).toFixed(2),
        acumulado: +(acumulado).toFixed(2),
        observaciones: '',
        responsable_id: pick(personalObra).id,
        idempotency_key: `${DEMO_USER}_avance_${part.codigo}_${c}`,
      });
    }
  }

  // 20. INSUMOS POR PARTIDA (APU detallado)
  log('Sembrando insumos por partida...');
  // Plantillas de insumos típicos por categoría de partida
  const insumosTpl = {
    concreto: [
      { categoria: 'material', nombre: 'Cemento Portland Tipo I', unidad: 'bls', cant: 9.7, precio: 28.50 },
      { categoria: 'material', nombre: 'Arena gruesa', unidad: 'm³', cant: 0.55, precio: 70.00 },
      { categoria: 'material', nombre: 'Piedra chancada 1/2"', unidad: 'm³', cant: 0.55, precio: 85.00 },
      { categoria: 'material', nombre: 'Agua potable', unidad: 'm³', cant: 0.18, precio: 12.00 },
      { categoria: 'mano_obra', nombre: 'Operario', unidad: 'hh', cant: 1.6, precio: 18.50 },
      { categoria: 'mano_obra', nombre: 'Peón', unidad: 'hh', cant: 8, precio: 14.20 },
      { categoria: 'equipo', nombre: 'Mezcladora 9 P3', unidad: 'hm', cant: 0.5, precio: 25.00 },
    ],
    acero: [
      { categoria: 'material', nombre: 'Acero corrugado Fy=4200', unidad: 'kg', cant: 1.05, precio: 4.20 },
      { categoria: 'material', nombre: 'Alambre N°16', unidad: 'kg', cant: 0.04, precio: 5.50 },
      { categoria: 'mano_obra', nombre: 'Fierrero', unidad: 'hh', cant: 0.04, precio: 18.50 },
    ],
    encofrado: [
      { categoria: 'material', nombre: 'Madera tornillo 2"x4"x10\'', unidad: 'und', cant: 0.30, precio: 22.00 },
      { categoria: 'material', nombre: 'Triplay fenólico 18mm', unidad: 'und', cant: 0.10, precio: 165.00 },
      { categoria: 'material', nombre: 'Clavo 3"', unidad: 'kg', cant: 0.20, precio: 5.50 },
      { categoria: 'mano_obra', nombre: 'Carpintero', unidad: 'hh', cant: 1.0, precio: 18.50 },
    ],
    excavacion: [
      { categoria: 'mano_obra', nombre: 'Peón', unidad: 'hh', cant: 1.5, precio: 14.20 },
      { categoria: 'equipo', nombre: 'Herramientas manuales', unidad: 'hm', cant: 0.05, precio: 5.00 },
    ],
    ladrillo: [
      { categoria: 'material', nombre: 'Ladrillo King Kong 18 huecos', unidad: 'mll', cant: 0.039, precio: 850.00 },
      { categoria: 'material', nombre: 'Cemento Portland Tipo I', unidad: 'bls', cant: 0.218, precio: 28.50 },
      { categoria: 'material', nombre: 'Arena gruesa', unidad: 'm³', cant: 0.030, precio: 70.00 },
      { categoria: 'mano_obra', nombre: 'Operario albañil', unidad: 'hh', cant: 0.80, precio: 18.50 },
      { categoria: 'mano_obra', nombre: 'Peón', unidad: 'hh', cant: 0.40, precio: 14.20 },
    ],
    default: [
      { categoria: 'mano_obra', nombre: 'Operario', unidad: 'hh', cant: 0.5, precio: 18.50 },
      { categoria: 'mano_obra', nombre: 'Peón', unidad: 'hh', cant: 0.5, precio: 14.20 },
    ],
  };
  const matchTpl = (nombre) => {
    const n = nombre.toLowerCase();
    if (n.includes('concreto')) return insumosTpl.concreto;
    if (n.includes('acero') || n.includes('refuerzo')) return insumosTpl.acero;
    if (n.includes('encofrado')) return insumosTpl.encofrado;
    if (n.includes('excavac') || n.includes('limpieza') || n.includes('movim. tierra')) return insumosTpl.excavacion;
    if (n.includes('ladrillo') || n.includes('muro')) return insumosTpl.ladrillo;
    return insumosTpl.default;
  };
  for (const part of partidaIds) {
    const tpl = matchTpl(part.nombre);
    for (const ins of tpl) {
      const cantPres = +(part.metrado * ins.cant).toFixed(2);
      const cantUsada = +(cantPres * (part.avance || 0) * rndF(0.92, 1.08)).toFixed(2);
      await db.insumos_partida.add({
        ...baseFields(), id: newId(),
        obra_id: obraPrincipal.id,
        partida_id: part.id,
        codigo_insumo: ins.nombre.slice(0, 12).toUpperCase().replace(/\s+/g, ''),
        nombre_insumo: ins.nombre,
        tipo_insumo: ins.categoria, // 'material' | 'mano_obra' | 'equipo'
        unidad: ins.unidad,
        cantidad_presupuestada: cantPres,
        cantidad_real_usada: cantUsada,
        precio_presupuestado: ins.precio,
        precio_real: ins.precio,
      });
    }
  }

  // 21. VERSIONES DE PRESUPUESTO (2 versiones de la obra principal)
  log('Sembrando versiones de presupuesto...');
  const totalPartidas = partidaIds.reduce((s, p) => s + (p.metrado * p.precio), 0);
  const versionId1 = newId();
  await db.presupuestos_versiones.add({
    ...baseFields(), id: versionId1,
    obra_id: obraPrincipal.id,
    numero: 1,
    nombre: 'V1 — Presupuesto Inicial Contractual',
    tipo: 'inicial',
    fecha: dt(-90),
    monto_total: totalPartidas,
    bloqueada: true,
    notas: 'Versión firmada con el cliente. Línea base contractual.',
  });
  const versionId2 = newId();
  await db.presupuestos_versiones.add({
    ...baseFields(), id: versionId2,
    obra_id: obraPrincipal.id,
    numero: 2,
    nombre: 'V2 — Adicional N° 1 (cambio en losas)',
    tipo: 'adicional',
    fecha: dt(-30),
    monto_total: +(totalPartidas * 1.045).toFixed(2),
    bloqueada: false,
    notas: 'Adicional aprobado: refuerzo en losas niveles 4-5 por cambio de uso a oficinas.',
  });
  // Snapshot de partidas en V1 (las primeras 12)
  for (const part of partidaIds.slice(0, 12)) {
    await db.partidas_versionadas.add({
      ...baseFields(), id: newId(),
      version_id: versionId1,
      obra_id: obraPrincipal.id,
      codigo: part.codigo,
      nombre: part.nombre,
      unidad: part.unidad,
      metrado: part.metrado,
      precio_unitario: part.precio,
      costo_total: part.metrado * part.precio,
    });
  }
  // V2: las mismas + 2 con monto modificado
  for (const part of partidaIds.slice(0, 12)) {
    const factor = part.codigo.startsWith('02.01.04') ? 1.45 : (part.codigo.startsWith('02.02') ? 1.20 : 1.0);
    await db.partidas_versionadas.add({
      ...baseFields(), id: newId(),
      version_id: versionId2,
      obra_id: obraPrincipal.id,
      codigo: part.codigo,
      nombre: part.nombre,
      unidad: part.unidad,
      metrado: part.metrado * factor,
      precio_unitario: part.precio,
      costo_total: part.metrado * part.precio * factor,
    });
  }

  // 22. COTIZACIONES (entre requisiciones y OC) — 2 por requisición aprobada
  log('Sembrando cotizaciones...');
  const reqsAprobadas = await db.requisiciones.where('obra_id').equals(obraPrincipal.id).filter(r => r.demo === true && (r.estado === 'cotizando' || r.estado === 'aprobada')).toArray();
  for (const req of reqsAprobadas) {
    const reqItems = await db.requisicion_items.where('requisicion_id').equals(req.id).filter(x => x.demo).toArray();
    if (!reqItems.length) continue;
    // 2 cotizaciones por requisición de 2 proveedores distintos
    const provsCot = [...proveedorIds].sort(() => Math.random() - 0.5).slice(0, 2);
    for (let pIdx = 0; pIdx < provsCot.length; pIdx++) {
      const cotId = newId();
      const factor = pIdx === 0 ? 1.0 : rndF(0.92, 1.12);
      let totalCot = 0;
      for (const it of reqItems) {
        const precio = +(Number(it.precio_estimado || 0) * factor).toFixed(2);
        totalCot += precio * Number(it.cantidad || 0);
      }
      await db.cotizaciones.add({
        ...baseFields(), id: cotId,
        requisicion_id: req.id,
        proveedor_id: provsCot[pIdx].id,
        codigo: `COT-${cotId.slice(0, 6).toUpperCase()}`,
        fecha: dt(rnd(-20, -3)),
        validez_dias: 15,
        moneda: 'PEN',
        subtotal: +(totalCot).toFixed(2),
        igv: +(totalCot * 0.18).toFixed(2),
        total: +(totalCot * 1.18).toFixed(2),
        estado: pIdx === 0 ? 'recibida' : 'recibida',
        notas: pIdx === 0 ? 'Mejor precio' : 'Alternativa',
      });
      for (const it of reqItems) {
        await db.cotizacion_items.add({
          ...baseFields(), id: newId(),
          cotizacion_id: cotId,
          requisicion_item_id: it.id,
          descripcion: it.descripcion,
          unidad: it.unidad,
          cantidad: it.cantidad,
          precio_unitario: +(Number(it.precio_estimado || 0) * factor).toFixed(2),
          subtotal: +(Number(it.cantidad || 0) * Number(it.precio_estimado || 0) * factor).toFixed(2),
        });
      }
    }
  }

  // 23. SUBCONTRATO VALORIZACIONES (1 por subcontrato)
  log('Sembrando valorizaciones de subcontratos...');
  const subcs = await db.subcontratos.where('obra_id').equals(obraPrincipal.id).filter(s => s.demo).toArray();
  for (const [idx, sc] of subcs.entries()) {
    const valSc = +(Number(sc.monto || 0) * 0.30).toFixed(2);
    const retencion = +(valSc * 0.05).toFixed(2);
    await db.subcontrato_valorizaciones.add({
      ...baseFields(), id: newId(),
      subcontrato_id: sc.id,
      numero: 1,
      periodo_anio: new Date().getFullYear(),
      periodo_mes: new Date().getMonth() + 1,
      monto_avance: valSc,
      retencion_acumulada: retencion,
      monto_neto: +(valSc - retencion).toFixed(2),
      estado: idx === 0 ? 'aprobada' : 'presentada',
      notas: 'Valorización mensual del subcontratista',
    });
  }

  // 24. EVIDENCIAS (fotos / observaciones por partida y obra)
  log('Sembrando evidencias...');
  const evidenciasTipo = [
    ['avance_obra', 'Vaciado columnas C1-C8 nivel 3', 'Vaciado completo realizado en jornada matutina'],
    ['avance_obra', 'Encofrado losa nivel 4 — 60% completo', 'Pendiente cierre lateral este'],
    ['incidencia', 'Demora entrega cemento Pacasmayo', 'Proveedor reporta 2 días de atraso'],
    ['ssoma', 'Charla seguridad inicio jornada', '12 trabajadores presentes'],
    ['avance_obra', 'Acero columnas listo para vaciado', 'Inspección OK por residente'],
    ['materiales', 'Recepción de fierro 1/2"', 'Conforme a OC-2026-0002'],
    ['ssoma', 'Inspección de andamios nivel 5', 'Todos en buenas condiciones'],
    ['evidencia_general', 'Foto general avance fachada', 'Mes 3 de obra'],
  ];
  for (const [modulo, titulo, descripcion] of evidenciasTipo) {
    await db.evidencias.add({
      ...baseFields(), id: newId(),
      obra_id: obraPrincipal.id,
      modulo_relacionado: modulo,
      titulo,
      descripcion,
      fecha: dt(rnd(-30, -1)),
      autor_id: pick(personalObra).id,
      tipo_archivo: 'imagen',
      tamano_bytes: rnd(150_000, 800_000),
      // No adjunta archivo binario — solo metadata
    });
  }

  // 25. RECEPCIONES con items (para OC recibidas)
  log('Sembrando recepciones detalladas...');
  const ocsRecibidas = await db.ordenes_compra.where('obra_id').equals(obraPrincipal.id).filter(o => o.demo && (o.estado === 'recibida' || o.estado === 'recibida_parcial')).toArray();
  for (const oc of ocsRecibidas) {
    const ocItems = await db.oc_items.where('orden_compra_id').equals(oc.id).filter(x => x.demo).toArray();
    if (!ocItems.length) continue;
    // Buscar la recepción ya creada o crear una si no existe
    const existing = await db.recepciones.where('orden_compra_id').equals(oc.id).filter(r => r.demo).toArray();
    let recId = existing[0]?.id;
    if (!recId) {
      recId = newId();
      await db.recepciones.add({
        ...baseFields(), id: recId,
        orden_compra_id: oc.id,
        fecha: dt(rnd(-25, 0)),
        observaciones: 'Recibido conforme · todos los items',
      });
    }
    // Crear recepcion_items
    for (const it of ocItems) {
      await db.recepcion_items.add({
        ...baseFields(), id: newId(),
        recepcion_id: recId,
        oc_item_id: it.id,
        material_id: it.material_id,
        cantidad_recibida: oc.estado === 'recibida_parcial' ? +(Number(it.cantidad) * 0.6).toFixed(2) : Number(it.cantidad),
        observaciones: '',
      });
    }
  }

  // 26. COMPROBANTES ELECTRÓNICOS (facturas demo)
  log('Sembrando comprobantes electrónicos...');
  const comprobantesDemo = [
    { tipo: '01', serie: 'F001', desc: 'Valorización de obra N°1', cliente: 'Inmobiliaria Demo S.A.C.', cliente_ruc: '20512345001', monto: 485000 },
    { tipo: '01', serie: 'F001', desc: 'Valorización de obra N°2', cliente: 'Inmobiliaria Demo S.A.C.', cliente_ruc: '20512345001', monto: 532000 },
    { tipo: '01', serie: 'F001', desc: 'Adicional N°1 — refuerzo losas', cliente: 'Inmobiliaria Demo S.A.C.', cliente_ruc: '20512345001', monto: 215000 },
    { tipo: '03', serie: 'B001', desc: 'Servicio de excavación adicional', cliente: 'María Pérez García', cliente_ruc: '42158736', monto: 4500 },
  ];
  for (let i = 0; i < comprobantesDemo.length; i++) {
    const c = comprobantesDemo[i];
    const subtotal = +(c.monto / 1.18).toFixed(2);
    const igv = +(c.monto - subtotal).toFixed(2);
    await db.accounting_movements.add({
      ...baseFields(), id: newId(),
      company_id: empresaIds[0],
      obra_id: obraPrincipal.id,
      type: 'income',
      date: dt(rnd(-60, -5)),
      amount: c.monto,
      subtotal, igv_amount: igv,
      currency: 'PEN',
      payment_status: i < 2 ? 'paid' : 'pending',
      category: 'comprobante_electronico',
      description: c.desc,
      third_party_name: c.cliente,
      third_party_ruc: c.cliente_ruc,
      document_type: c.tipo === '01' ? 'factura' : 'boleta',
      document_number: `${c.serie}-${String(i + 1).padStart(8, '0')}`,
      tipo_comprobante: c.tipo, // factura electrónica
      // Para que aparezcan en /comprobantes (filtra por type='income' generalmente)
      meta: JSON.stringify({ items: [{ desc: c.desc, cantidad: 1, precio_unitario: subtotal }] }),
    });
  }

  // 27. SETEAR OBRA ACTIVA al cargar el demo
  try {
    if (window.__setObraActivaId) window.__setObraActivaId(obraActivaId);
    window.dispatchEvent(new CustomEvent('obra_activa_change'));
  } catch {}

  log('✓ Demo data sembrado COMPLETO');
  return {
    obras: obrasDemo.length,
    personas: personasDemo.length,
    materiales: 60,
    partidas: partidasDemo.length,
    asistencias: personasDemo.filter((_, i) => i < 8).length * 26,
    movimientos: 40,
  };
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
  const tablas = [
    'obras', 'personal', 'materiales', 'herramientas', 'companies',
    'accounting_movements', 'partidas', 'asistencia', 'movimientos_materiales',
    'requisiciones', 'ordenes_compra', 'valorizaciones', 'activos_pesados',
    'iperc', 'planillas',
  ];
  let total = 0;
  for (const t of tablas) {
    try { total += await db[t].filter(r => r.demo === true).count(); } catch {}
  }
  return total;
}
