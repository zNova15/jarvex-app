// Lazy load de xlsx (~700 KB). Solo se carga al primer parseExcel/downloadTemplate.
let _XLSX = null;
async function loadXLSX() {
  if (_XLSX) return _XLSX;
  _XLSX = await import('xlsx');
  return _XLSX;
}

export async function parseExcelFile(file) {
  const XLSX = await loadXLSX();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        // Todas las hojas (para re-importar un workbook de backup multi-hoja).
        const sheets = (workbook.SheetNames || []).map((name) => {
          const ws = workbook.Sheets[name];
          const rows = XLSX.utils.sheet_to_json(ws, { defval: null, raw: false });
          const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
          return { name, headers, rows };
        });
        const first = sheets[0] || { name: workbook.SheetNames[0], headers: [], rows: [] };
        // Backward-compatible: headers/rows = primera hoja (como antes) + sheets.
        resolve({ headers: first.headers, rows: first.rows, sheetName: first.name, sheets });
      } catch (e) { reject(e); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function downloadTemplate(modulo) {
  const XLSX = await loadXLSX();
  const templates = {
    materiales: {
      headers: ['nombre_material','categoria','unidad','stock_inicial','stock_minimo','precio_unitario_estimado'],
      sample: [
        ['Cemento Sol Tipo I','Cemento','bolsa',500,100,28.50],
        ['Fierro corrugado 1/2"','Acero','varilla',800,200,42.00],
      ],
    },
    personal: {
      // Plantilla COMPLETA: datos de la persona + sus cuentas bancarias en la
      // misma fila. Al importar, el sistema separa: los datos personales van a
      // Personal y las columnas de banco crean las cuentas en "Cuentas
      // Bancarias → Personal" enlazadas por DNI.
      headers: ['nombres','apellidos','alias','tipo_documento','dni','cargo','area','fecha_nacimiento','fecha_ingreso','telefono','email','direccion','contacto_emergencia','telefono_emergencia','regimen_pension','banco','tipo_cuenta','numero_cuenta','cci','moneda','banco_cts','cuenta_cts'],
      sample: [
        ['Carlos','Mendoza Quispe','Calo','dni','40123456','Capataz','Estructuras','1985-04-12','2026-01-15','987111111','carlos.mendoza@gmail.com','Jr. Los Pinos 123, Cajamarca','María Quispe','976222333','AFP Integra','BCP','ahorros','19112345678012','00219111234567801299','PEN','Banco de la Nación','04-123-456789'],
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
    // Cronograma Gantt: layout POSICIONAL que lee parseGantt (col 0 código, 1 desc,
    // 2 duración, 3 inicio, 4 fin, 5 predecesoras, 6 % avance, 7 días). El encabezado
    // "Numeracion" hace que el parser salte esta fila. El % de avance fija el ESTADO al
    // importar (100 = terminada, >0 = en ejecución); NO pisa el avance de los reportes.
    // El código debe coincidir con las partidas ya importadas (APU primero).
    gantt: {
      headers: ['Numeracion','Descripcion','Duración (días)','Fecha inicio','Fecha fin','Predecesoras','% Avance (0-100)','Días calendario'],
      sample: [
        ['02.01.01.01.01','Cerco de malla HDP 1m de altura',10,'2026-06-02','2026-06-11','',100,10],
        ['02.01.01.01.02.02','Trazo y replanteo preliminar',5,'2026-06-12','2026-06-16','02.01.01.01.01',60,5],
        ['02.01.01.01.03.01','Excavación manual de terreno',8,'2026-06-17','2026-06-24','',0,8],
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
    fields: ['nombres','apellidos','alias','tipo_documento','dni','cargo','area','fecha_nacimiento','fecha_ingreso','telefono',
             'email','direccion','contacto_emergencia','telefono_emergencia','regimen_pension',
             'banco','tipo_cuenta','numero_cuenta','cci','moneda','banco_cts','cuenta_cts'],
    transform: (row) => {
      const txt = (v) => (v == null ? null : String(v).trim() || null);
      // Las columnas de BANCO no van a la tabla personal: se separan en
      // `__cuentas` y el importador las crea en personal_cuentas_bancarias
      // (sección Cuentas Bancarias → Personal) enlazadas a la persona.
      const cuentas = [];
      if (txt(row.banco) || txt(row.numero_cuenta) || txt(row.cci)) {
        cuentas.push({
          banco: txt(row.banco) || 'Banco',
          tipo_cuenta: (txt(row.tipo_cuenta) || 'ahorros').toLowerCase(),
          numero_cuenta: txt(row.numero_cuenta),
          cci: txt(row.cci)?.replace(/[\s-]/g, '') || null,
          moneda: (txt(row.moneda) || 'PEN').toUpperCase(),
          principal: true,
        });
      }
      if (txt(row.banco_cts) || txt(row.cuenta_cts)) {
        cuentas.push({
          banco: txt(row.banco_cts) || 'Banco de la Nación',
          tipo_cuenta: 'cts',
          numero_cuenta: txt(row.cuenta_cts),
          cci: null, moneda: 'PEN', principal: false,
        });
      }
      // Tipo de documento: dni (default) | ce | pasaporte. El número se
      // sanitiza según el tipo (un CE/pasaporte puede llevar letras).
      const tdRaw = String(row.tipo_documento || 'dni').toLowerCase();
      const tipoDoc = tdRaw.includes('extranjer') || tdRaw === 'ce' ? 'ce' : tdRaw.includes('pasaporte') ? 'pasaporte' : 'dni';
      return {
        nombres: String(row.nombres || '').trim(),
        apellidos: String(row.apellidos || '').trim(),
        alias: txt(row.alias),
        tipo_documento: tipoDoc,
        dni: tipoDoc === 'dni' ? String(row.dni || '').trim() : String(row.dni || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase(),
        cargo: txt(row.cargo),
        area: txt(row.area),
        fecha_nacimiento: row.fecha_nacimiento || null,
        fecha_ingreso: row.fecha_ingreso || null,
        telefono: row.telefono ? String(row.telefono) : null,
        email: txt(row.email),
        direccion: txt(row.direccion),
        contacto_emergencia: txt(row.contacto_emergencia),
        telefono_emergencia: row.telefono_emergencia ? String(row.telefono_emergencia) : null,
        regimen_pension: txt(row.regimen_pension),
        estado: 'activo',
        ...(cuentas.length ? { __cuentas: cuentas } : {}),
      };
    },
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
    requiredFields: ['marca'],
    fields: ['nombre','placa','marca','modelo','tipo','año','año_fabricacion','propietario','estado'],
    transform: (row) => ({
      // La maquinaria menor (la que se mueve por cantidad) se identifica por
      // `nombre`, no por placa. Toleramos placa/marca vacíos sin romper.
      nombre: row.nombre ? String(row.nombre).trim() : null,
      placa: row.placa ? String(row.placa).trim().toUpperCase() : null,
      marca: row.marca ? String(row.marca).trim() : null,
      modelo: row.modelo || null,
      tipo: row.tipo || 'volquete',
      año_fabricacion: parseInt(row.año || row.año_fabricacion, 10) || null,
      propietario: row.propietario || null,
      estado: row.estado || 'operativo',
    }),
  },
};
