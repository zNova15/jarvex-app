import * as XLSX from 'xlsx';

export function parseExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(firstSheet, { defval: null, raw: false });
        const headers = json.length > 0 ? Object.keys(json[0]) : [];
        resolve({ headers, rows: json, sheetName: workbook.SheetNames[0] });
      } catch (e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function downloadTemplate(modulo) {
  const templates = {
    materiales: {
      headers: ['nombre_material','categoria','unidad','stock_inicial','stock_minimo','precio_unitario_estimado'],
      sample: [
        ['Cemento Sol Tipo I','Cemento','bolsa',500,100,28.50],
        ['Fierro corrugado 1/2"','Acero','varilla',800,200,42.00],
      ],
    },
    personal: {
      headers: ['nombres','apellidos','dni','cargo','area','fecha_ingreso','telefono'],
      sample: [
        ['Carlos','Mendoza','40123456','Capataz','Estructuras','2026-01-15','987111111'],
      ],
    },
    partidas: {
      headers: ['codigo_delfin','nombre_partida','categoria','unidad','metrado_contratado','precio_unitario_pres','fecha_inicio_planificada','fecha_fin_planificada'],
      sample: [
        ['02.01.01','Excavación masiva con maquinaria','Movimiento de tierras','m³',850,18.50,'2026-01-15','2026-02-10'],
      ],
    },
    proveedores: {
      headers: ['razon_social','ruc','contacto','telefono','correo','tipo_proveedor','direccion'],
      sample: [
        ['Cementos Pacasmayo S.A.A.','20419387658','Juan Pérez','987654321','ventas@pacasmayo.com.pe','cemento','Av. Industrial 100, Lima'],
      ],
    },
    herramientas: {
      headers: ['nombre_herramienta','tipo_herramienta','marca','modelo','serie','estado_actual'],
      sample: [
        ['Amoladora 7"','electrica','Bosch','GA7020','BS-2024-001','bueno'],
      ],
    },
  };
  const t = templates[modulo];
  if (!t) throw new Error('Módulo no soportado');
  const ws = XLSX.utils.aoa_to_sheet([t.headers, ...t.sample]);
  ws['!cols'] = t.headers.map(h => ({ wch: Math.max(15, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, modulo);
  XLSX.writeFile(wb, `JARVEX_plantilla_${modulo}.xlsx`);
}

// Module config: target table + required fields + transformations
export const MODULES = {
  materiales: {
    table: 'materiales',
    requiredFields: ['nombre_material','unidad'],
    fields: ['nombre_material','categoria','unidad','stock_inicial','stock_minimo','precio_unitario_estimado','observaciones'],
    transform: (row) => ({
      nombre_material: String(row.nombre_material || '').trim(),
      categoria: row.categoria ? String(row.categoria).trim() : null,
      unidad: String(row.unidad || '').trim(),
      stock_inicial: parseFloat(row.stock_inicial) || 0,
      stock_actual: parseFloat(row.stock_inicial) || 0,
      stock_minimo: parseFloat(row.stock_minimo) || 0,
      precio_unitario_estimado: row.precio_unitario_estimado ? parseFloat(row.precio_unitario_estimado) : null,
      observaciones: row.observaciones || null,
      alerta: 'ok',
      estado: 'activo',
    }),
  },
  personal: {
    table: 'personal',
    requiredFields: ['nombres','apellidos','dni'],
    fields: ['nombres','apellidos','dni','cargo','area','fecha_ingreso','telefono'],
    transform: (row) => ({
      nombres: String(row.nombres || '').trim(),
      apellidos: String(row.apellidos || '').trim(),
      dni: String(row.dni || '').trim(),
      cargo: row.cargo || null,
      area: row.area || null,
      fecha_ingreso: row.fecha_ingreso || null,
      telefono: row.telefono ? String(row.telefono) : null,
      estado: 'activo',
    }),
  },
  partidas: {
    table: 'partidas',
    requiredFields: ['nombre_partida'],
    fields: ['codigo_delfin','nombre_partida','categoria','unidad','metrado_contratado','precio_unitario_pres','fecha_inicio_planificada','fecha_fin_planificada'],
    transform: (row) => {
      const cantidad = parseFloat(row.metrado_contratado) || 0;
      const precio = parseFloat(row.precio_unitario_pres) || 0;
      return {
        codigo_delfin: row.codigo_delfin || null,
        nombre_partida: String(row.nombre_partida).trim(),
        categoria: row.categoria || 'General',
        unidad: row.unidad || 'und',
        metrado_contratado: cantidad,
        precio_unitario_pres: precio,
        costo_total_presupuestado: cantidad * precio,
        fecha_inicio_planificada: row.fecha_inicio_planificada || null,
        fecha_fin_planificada: row.fecha_fin_planificada || null,
        estado: 'pendiente',
      };
    },
  },
  proveedores: {
    table: 'proveedores',
    requiredFields: ['razon_social'],
    fields: ['razon_social','ruc','contacto','telefono','correo','tipo_proveedor','direccion'],
    transform: (row) => ({
      razon_social: String(row.razon_social).trim(),
      ruc: row.ruc ? String(row.ruc).trim() : null,
      contacto: row.contacto || null,
      telefono: row.telefono ? String(row.telefono) : null,
      correo: row.correo || null,
      tipo_proveedor: row.tipo_proveedor || null,
      direccion: row.direccion || null,
      estado: 'activo',
    }),
  },
  herramientas: {
    table: 'herramientas',
    requiredFields: ['nombre_herramienta'],
    fields: ['nombre_herramienta','tipo_herramienta','marca','modelo','serie','estado_actual'],
    transform: (row) => ({
      nombre_herramienta: String(row.nombre_herramienta).trim(),
      tipo_herramienta: row.tipo_herramienta || 'manual',
      marca: row.marca || null,
      modelo: row.modelo || null,
      serie: row.serie ? String(row.serie) : null,
      estado_actual: row.estado_actual || 'bueno',
      ubicacion_actual: 'almacen',
      disponible: true,
    }),
  },
  subcontratistas: {
    table: 'subcontratistas',
    requiredFields: ['razon_social'],
    fields: ['razon_social','ruc','contacto','telefono','correo','direccion','especialidad'],
    transform: (row) => ({
      razon_social: String(row.razon_social).trim(),
      ruc: row.ruc ? String(row.ruc).trim() : null,
      contacto: row.contacto || null,
      telefono: row.telefono ? String(row.telefono) : null,
      correo: row.correo || null,
      direccion: row.direccion || null,
      especialidad: row.especialidad || null,
      estado: 'activo',
    }),
  },
  companies: {
    table: 'companies',
    requiredFields: ['name','ruc'],
    fields: ['name','legal_name','ruc','address','ubigeo','telefono','email'],
    transform: (row) => ({
      name: String(row.name).trim(),
      legal_name: row.legal_name ? String(row.legal_name).trim() : String(row.name).trim(),
      ruc: String(row.ruc).trim(),
      address: row.address || null,
      ubigeo: row.ubigeo ? String(row.ubigeo).trim() : null,
      telefono: row.telefono ? String(row.telefono) : null,
      email: row.email || null,
      status: 'activa',
    }),
  },
  activos_pesados: {
    table: 'activos_pesados',
    requiredFields: ['placa','marca'],
    fields: ['placa','marca','modelo','tipo','año','año_fabricacion','propietario','estado'],
    transform: (row) => ({
      placa: String(row.placa).trim().toUpperCase(),
      marca: String(row.marca).trim(),
      modelo: row.modelo || null,
      tipo: row.tipo || 'volquete',
      año_fabricacion: parseInt(row.año || row.año_fabricacion, 10) || null,
      propietario: row.propietario || null,
      estado: row.estado || 'operativo',
    }),
  },
};
