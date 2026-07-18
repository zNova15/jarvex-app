// ═══════════════════════════════════════════════════════════════════
// JARVEX — Builder de los reportes por email (diario / semanal / mensual).
//
// Genera HTML RESPONSIVE (mobile-first: una columna, máx 640px, tipografía
// ≥13px, "gráficas" como barras CSS que funcionan en Gmail/Outlook móvil).
// Corre en Node (GitHub Actions) sin dependencias; consulta Supabase por
// PostgREST con service_role y devuelve { subject, html } listo para el
// outbox. n8n solo envía.
// ═══════════════════════════════════════════════════════════════════
import { rangoDe } from '../../src/lib/reporte-email-programacion.js';

// ── Cliente PostgREST mínimo (con paginación de a 1000) ─────────────
export function clientePg(url, serviceKey) {
  const base = String(url).replace(/\/+$/, '');
  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };
  const pagina = async (path, desde, hasta) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers: { ...headers, Range: `${desde}-${hasta}`, Prefer: 'count=none' } });
    if (!r.ok) throw new Error(`PostgREST ${r.status} en ${path.split('?')[0]}: ${(await r.text()).slice(0, 200)}`);
    return r.json();
  };
  return {
    // Todas las filas (paginado). Usar con queries ya filtradas por fecha.
    all: async (path) => {
      const out = [];
      for (let i = 0; ; i += 1000) {
        const lote = await pagina(path, i, i + 999);
        out.push(...lote);
        if (lote.length < 1000) break;
      }
      return out;
    },
    post: async (path, body) => {
      const r = await fetch(`${base}/rest/v1/${path}`, { method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`POST ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    },
    patch: async (path, body) => {
      const r = await fetch(`${base}/rest/v1/${path}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`PATCH ${path} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
    },
  };
}

// ── Helpers de formato y HTML ───────────────────────────────────────
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n) => Number(n || 0).toLocaleString('es-PE', { maximumFractionDigits: 1 });
const soles = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fFecha = (f) => { const [y, m, d] = String(f).split('-'); return `${d}/${m}/${y}`; };

const C = {
  fondo: '#eef1f5', tarjeta: '#ffffff', borde: '#e3e8ee', texto: '#1c2733',
  suave: '#5a6b7c', titulo: '#0d1520', amarillo: '#f2b705', verde: '#1e9e5a',
  rojo: '#d64541', azul: '#2f7fd1', morado: '#8e5eb8', naranja: '#e07b26',
};

// Barra CSS (la "gráfica" que sí se ve en todos los correos, incluido el teléfono).
const barra = (valor, max, color, etiqueta, detalle) => {
  const pct = max > 0 ? Math.max(2, Math.round((valor / max) * 100)) : 0;
  return `<div style="margin:6px 0">
    <div style="display:flex;justify-content:space-between;font-size:13px;color:${C.texto};margin-bottom:2px">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">${esc(etiqueta)}</span>
      <span style="color:${C.suave};white-space:nowrap;padding-left:8px">${esc(detalle)}</span>
    </div>
    <div style="background:#e8ecf1;border-radius:4px;height:10px;overflow:hidden">
      <div style="width:${pct}%;height:10px;background:${color};border-radius:4px"></div>
    </div>
  </div>`;
};

const tarjeta = (titulo, contenido, color = C.amarillo) => `
  <div style="background:${C.tarjeta};border:1px solid ${C.borde};border-left:4px solid ${color};border-radius:10px;padding:14px 16px;margin:0 0 12px">
    <div style="font-size:15px;font-weight:700;color:${C.titulo};margin-bottom:8px">${titulo}</div>
    ${contenido}
  </div>`;

const chip = (etiqueta, valor, color) => `
  <td style="padding:4px" width="50%">
    <div style="background:${C.tarjeta};border:1px solid ${C.borde};border-radius:10px;padding:10px 12px;text-align:center">
      <div style="font-size:11px;color:${C.suave};letter-spacing:.04em;text-transform:uppercase">${etiqueta}</div>
      <div style="font-size:19px;font-weight:800;color:${color};margin-top:2px">${valor}</div>
    </div>
  </td>`;

const filaDato = (etiqueta, valor) => `
  <div style="display:flex;justify-content:space-between;font-size:13.5px;padding:5px 0;border-bottom:1px solid ${C.borde}">
    <span style="color:${C.suave}">${esc(etiqueta)}</span><span style="color:${C.texto};font-weight:600;text-align:right">${valor}</span>
  </div>`;

// ── Carga de datos del rango ────────────────────────────────────────
async function cargarDatos(pg, tipo, hoy) {
  const { desde, hasta } = rangoDe(tipo, hoy);
  const [obras, movs, mats, avances, repEsp, contab, banc, cfgProfiles] = await Promise.all([
    pg.all(`obras?select=id,nombre_obra,fecha_inicio&deleted_at=is.null`),
    pg.all(`movimientos_materiales?select=obra_id,fecha,tipo_movimiento,cantidad,material_id&deleted_at=is.null&fecha=gte.${desde}&fecha=lte.${hasta}`),
    pg.all(`materiales?select=id,obra_id,nombre_material,unidad,alerta&deleted_at=is.null`),
    pg.all(`avance_obra?select=obra_id,fecha,partida_id,metrado_ejecutado,responsable_id&deleted_at=is.null&fecha=gte.${desde}&fecha=lte.${hasta}`),
    pg.all(`reportes_especialidad?select=obra_id,area,fecha,responsable_id,descripcion&deleted_at=is.null&fecha=gte.${desde}&fecha=lte.${hasta}`),
    pg.all(`accounting_movements?select=date,clase,type,amount,currency,payment_status,destino_contable,is_intercompany,third_party_name,category&deleted_at=is.null&date=gte.${desde}&date=lte.${hasta}`),
    pg.all(`v_reporte_email_banc?select=*`),
    pg.all(`profiles?select=id,nombres,apellidos`),
  ]);
  const extras = {};
  if (tipo !== 'diario') {
    const en30 = new Date(new Date(hoy + 'T00:00:00Z').getTime() + 30 * 86400000).toISOString().slice(0, 10);
    extras.sctr = await pg.all(`personal?select=nombres,apellidos,sctr_vencimiento&deleted_at=is.null&estado=eq.activo&sctr_vencimiento=lte.${en30}&sctr_vencimiento=not.is.null`);
    extras.sinClasificar = await pg.all(`accounting_movements?select=id&deleted_at=is.null&destino_contable=eq.sin_clasificar`);
  }
  if (tipo === 'mensual') {
    extras.partidas = await pg.all(`partidas?select=obra_id,codigo_delfin,costo_total_presupuestado,porcentaje_avance&deleted_at=is.null`);
  }
  return { desde, hasta, obras, movs, mats, avances, repEsp, contab, banc: banc[0] || {}, profiles: cfgProfiles, ...extras };
}

// ── Secciones ───────────────────────────────────────────────────────
function seccionResumen(d, tipo) {
  const salidas = d.movs.filter(m => m.tipo_movimiento === 'salida').reduce((t, m) => t + (+m.cantidad || 0), 0);
  const entradas = d.movs.filter(m => m.tipo_movimiento === 'entrada').reduce((t, m) => t + (+m.cantidad || 0), 0);
  const comprasPen = d.contab.filter(m => (m.clase || (m.type === 'income' ? 'venta' : 'compra')) === 'compra' && (m.currency || 'PEN') === 'PEN').reduce((t, m) => t + (+m.amount || 0), 0);
  const ventasPen = d.contab.filter(m => (m.clase || (m.type === 'income' ? 'venta' : 'compra')) === 'venta' && (m.currency || 'PEN') === 'PEN').reduce((t, m) => t + (+m.amount || 0), 0);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px"><tr>
    ${chip('Salidas almacén', num(salidas), C.naranja)}
    ${chip('Entradas', num(entradas), C.verde)}
  </tr><tr>
    ${chip('Reportes ingenieros', String(d.avances.length), C.azul)}
    ${chip('Facturas registradas', String(d.contab.length), C.morado)}
  </tr><tr>
    ${chip('Compras (PEN)', soles(comprasPen), C.rojo)}
    ${chip('Ventas (PEN)', soles(ventasPen), C.verde)}
  </tr></table>`;
}

function seccionObras(d, tipo) {
  const porObra = new Map();
  for (const m of d.movs) {
    const o = porObra.get(m.obra_id) || { salidas: 0, entradas: 0, movs: 0, top: new Map() };
    o.movs++;
    if (m.tipo_movimiento === 'salida') { o.salidas += (+m.cantidad || 0); o.top.set(m.material_id, (o.top.get(m.material_id) || 0) + (+m.cantidad || 0)); }
    if (m.tipo_movimiento === 'entrada') o.entradas += (+m.cantidad || 0);
    porObra.set(m.obra_id, o);
  }
  const matById = new Map(d.mats.map(x => [x.id, x]));
  const criticoPorObra = new Map();
  for (const mt of d.mats) if (mt.alerta === 'critico' || mt.alerta === 'sin_stock') criticoPorObra.set(mt.obra_id, (criticoPorObra.get(mt.obra_id) || 0) + 1);
  if (!porObra.size) return tarjeta('🏗 Movimientos de almacén', `<div style="font-size:13px;color:${C.suave}">Sin movimientos en el período.</div>`);
  let html = '';
  for (const [obraId, o] of porObra) {
    const obra = d.obras.find(x => x.id === obraId);
    const nTop = tipo === 'diario' ? 5 : 8;
    const tops = [...o.top.entries()].sort((a, b) => b[1] - a[1]).slice(0, nTop);
    const maxTop = tops[0]?.[1] || 0;
    const critico = criticoPorObra.get(obraId) || 0;
    html += tarjeta(`🏗 ${esc(obra?.nombre_obra || 'Obra')}`, `
      ${filaDato('Salidas', num(o.salidas))}${filaDato('Entradas', num(o.entradas))}${filaDato('Movimientos', String(o.movs))}
      ${critico ? filaDato('⚠ Stock crítico', `<span style="color:${C.rojo}">${critico} insumo(s)</span>`) : ''}
      ${tops.length ? `<div style="font-size:12px;color:${C.suave};margin-top:8px;font-weight:600">TOP INSUMOS (salidas)</div>` : ''}
      ${tops.map(([mid, cant]) => { const mt = matById.get(mid); return barra(cant, maxTop, C.naranja, mt?.nombre_material || '(insumo)', `${num(cant)} ${mt?.unidad || ''}`); }).join('')}
    `, C.naranja);
  }
  return html;
}

function seccionIngenieros(d) {
  if (!d.avances.length) return tarjeta('👷 Reportes de ingenieros', `<div style="font-size:13px;color:${C.suave}">Sin reportes de avance en el período.</div>`, C.azul);
  const porIng = new Map();
  for (const a of d.avances) {
    const k = a.responsable_id || 'sin';
    const r = porIng.get(k) || { n: 0, metrado: 0, partidas: new Set() };
    r.n++; r.metrado += (+a.metrado_ejecutado || 0); if (a.partida_id) r.partidas.add(a.partida_id);
    porIng.set(k, r);
  }
  const nombre = (id) => { const p = d.profiles.find(x => x.id === id); return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : '(sin responsable)'; };
  const filas = [...porIng.entries()].sort((a, b) => b[1].n - a[1].n);
  const max = filas[0]?.[1].n || 0;
  return tarjeta('👷 Reportes de ingenieros', filas.map(([id, r]) =>
    barra(r.n, max, C.azul, nombre(id), `${r.n} reporte(s) · ${r.partidas.size} partida(s)`)
  ).join(''), C.azul);
}

const AREA_LBL = { seguridad: '🦺 Seguridad', ambiental: '🌱 Ambiental', calidad: '✅ Calidad', social: '🤝 Social' };
function seccionEspecialidades(d, tipo) {
  if (!d.repEsp.length) return tarjeta('🦺 Especialidades (SSOMA · Ambiental · Calidad · Social)', `<div style="font-size:13px;color:${C.suave}">Sin reportes de especialidad en el período.</div>`, C.morado);
  const porArea = new Map();
  for (const r of d.repEsp) { const a = porArea.get(r.area) || []; a.push(r); porArea.set(r.area, a); }
  const nombre = (id) => { const p = d.profiles.find(x => x.id === id); return p ? `${p.nombres || ''} ${p.apellidos || ''}`.trim() : ''; };
  let html = '';
  for (const [area, arr] of porArea) {
    html += filaDato(AREA_LBL[area] || area, `${arr.length} reporte(s)`);
    if (tipo === 'diario') {
      for (const r of arr.slice(0, 3)) {
        html += `<div style="font-size:12.5px;color:${C.suave};padding:3px 0 3px 12px">· ${esc(nombre(r.responsable_id))}: ${esc(String(r.descripcion || '').slice(0, 110))}${String(r.descripcion || '').length > 110 ? '…' : ''}</div>`;
      }
    }
  }
  return tarjeta('🦺 Especialidades (SSOMA · Ambiental · Calidad · Social)', html, C.morado);
}

function seccionContabilidad(d, tipo) {
  const clase = (m) => m.clase || (m.type === 'income' ? 'venta' : 'compra');
  const compras = d.contab.filter(m => clase(m) === 'compra' && (m.currency || 'PEN') === 'PEN');
  const ventas = d.contab.filter(m => clase(m) === 'venta' && (m.currency || 'PEN') === 'PEN');
  const tCompras = compras.reduce((t, m) => t + (+m.amount || 0), 0);
  const tVentas = ventas.reduce((t, m) => t + (+m.amount || 0), 0);
  const maxCV = Math.max(tCompras, tVentas);
  const pendPago = d.contab.filter(m => m.payment_status === 'pending').length;
  let html = `
    ${barra(tCompras, maxCV, C.rojo, `Compras (${compras.length})`, soles(tCompras))}
    ${barra(tVentas, maxCV, C.verde, `Ventas (${ventas.length})`, soles(tVentas))}
    ${filaDato('Pendientes de pago', String(pendPago))}
  `;
  const nB = +d.banc?.n_pendientes || 0;
  if (nB > 0) {
    html += `<div style="background:#fdf3e0;border:1px solid #f0d9a8;border-radius:8px;padding:9px 11px;margin-top:10px;font-size:13px;color:#8a6100">
      ⚠ <strong>Bancarización pendiente:</strong> ${nB} factura(s) por <strong>${soles(d.banc?.monto_pendiente)}</strong> (PEN &gt; S/2,000 sin bancarizar).
    </div>`;
  }
  if (tipo !== 'diario' && d.sinClasificar?.length) {
    html += `<div style="background:#f3ecf9;border:1px solid #ddc8ef;border-radius:8px;padding:9px 11px;margin-top:8px;font-size:13px;color:#6b3d99">
      🤔 <strong>${d.sinClasificar.length} factura(s) sin clasificar</strong> ("No sé") esperando a la Contadora Jefe.
    </div>`;
  }
  return tarjeta('💰 Contabilidad', html, C.verde);
}

function seccionSctr(d) {
  if (!d.sctr?.length) return '';
  const hoy = new Date().toISOString().slice(0, 10);
  const vencidos = d.sctr.filter(p => p.sctr_vencimiento < hoy);
  const porVencer = d.sctr.filter(p => p.sctr_vencimiento >= hoy);
  let html = '';
  if (vencidos.length) html += filaDato('⛔ SCTR vencidos', `<span style="color:${C.rojo}">${vencidos.length}</span>`);
  if (porVencer.length) html += filaDato('⚠ Por vencer (30 días)', `<span style="color:${C.naranja}">${porVencer.length}</span>`);
  const lista = [...vencidos, ...porVencer].slice(0, 6);
  html += lista.map(p => `<div style="font-size:12.5px;color:${C.suave};padding:3px 0 3px 12px">· ${esc(`${p.nombres || ''} ${p.apellidos || ''}`.trim())} — vence ${fFecha(p.sctr_vencimiento)}</div>`).join('');
  return tarjeta('🛡 SCTR del personal', html, C.rojo);
}

function seccionMensualExtra(d) {
  let html = '';
  // Top proveedores del mes (compras PEN).
  const clase = (m) => m.clase || (m.type === 'income' ? 'venta' : 'compra');
  const porProv = new Map();
  for (const m of d.contab) {
    if (clase(m) !== 'compra' || (m.currency || 'PEN') !== 'PEN') continue;
    const k = (m.third_party_name || '(sin proveedor)').trim();
    porProv.set(k, (porProv.get(k) || 0) + (+m.amount || 0));
  }
  const provs = [...porProv.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (provs.length) {
    const maxP = provs[0][1];
    html += tarjeta('🏪 Top proveedores (compras del período)', provs.map(([n, v]) => barra(v, maxP, C.rojo, n, soles(v))).join(''), C.rojo);
  }
  // Avance físico por obra (rollup de partidas HOJA ponderado por costo — mismo criterio que el Inicio).
  if (d.partidas?.length) {
    const porObra = new Map();
    for (const p of d.partidas) { const a = porObra.get(p.obra_id) || []; a.push(p); porObra.set(p.obra_id, a); }
    let filas = '';
    for (const [obraId, ps] of porObra) {
      const folders = new Set();
      for (const p of ps) { const s = String(p.codigo_delfin || '').trim().split('.'); for (let i = 1; i < s.length; i++) folders.add(s.slice(0, i).join('.')); }
      let sumPres = 0, sumAv = 0;
      for (const p of ps) {
        if (!p.codigo_delfin || folders.has(String(p.codigo_delfin).trim())) continue;
        const pres = +p.costo_total_presupuestado || 0;
        sumPres += pres; sumAv += (+p.porcentaje_avance || 0) * pres;
      }
      if (sumPres <= 0) continue;
      const pct = sumAv / sumPres;
      const obra = d.obras.find(x => x.id === obraId);
      filas += barra(pct, 100, C.azul, obra?.nombre_obra || 'Obra', `${pct.toFixed(1)}% físico`);
    }
    if (filas) html += tarjeta('📐 Avance físico por obra', filas, C.azul);
  }
  return html;
}

// ── Ensamble ────────────────────────────────────────────────────────
const TITULO = { diario: 'Reporte diario', semanal: 'Reporte semanal', mensual: 'Reporte mensual' };

export async function buildReporte({ pg, tipo, hoy }) {
  const d = await cargarDatos(pg, tipo, hoy);
  const rango = tipo === 'diario' ? fFecha(hoy) : `${fFecha(d.desde)} — ${fFecha(d.hasta)}`;
  const cuerpo = [
    seccionResumen(d, tipo),
    seccionObras(d, tipo),
    seccionIngenieros(d),
    seccionEspecialidades(d, tipo),
    seccionContabilidad(d, tipo),
    tipo !== 'diario' ? seccionSctr(d) : '',
    tipo === 'mensual' ? seccionMensualExtra(d) : '',
  ].join('');

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JARVEX · ${TITULO[tipo]}</title></head>
<body style="margin:0;padding:0;background:${C.fondo}">
  <div style="background:${C.fondo};padding:14px 10px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto">
      <div style="background:${C.titulo};border-radius:10px 10px 0 0;padding:14px 16px">
        <span style="color:${C.amarillo};font-weight:800;font-size:16px">JARVEX</span>
        <span style="color:#cfd8e3;font-size:14px"> · ${TITULO[tipo]} — ${rango}</span>
      </div>
      <div style="padding:12px 0 0">
        ${cuerpo}
      </div>
      <div style="text-align:center;font-size:11px;color:${C.suave};padding:6px 0 14px">
        Generado automáticamente por JARVEX. El detalle completo y los PDF están en la app → Reportes.
      </div>
    </div>
  </div>
</body></html>`;

  return { subject: `JARVEX · ${TITULO[tipo]} ${rango}`, html };
}
