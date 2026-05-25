// ═══════════════════════════════════════════════════════════════════
// JARVEX — Migración histórica (SuperAdmin)
//
// Sub-flujo del wizard de Importar. La obra arrancó antes de tener JARVEX,
// así que meses de movimientos quedaron en Excel. Acá se cargan masivamente
// respetando las fechas reales. Solo visible/activo con SuperAdmin ON.
//
// Maneja los 5 formatos (ver migracion-parser.js):
//   • Insumos Totales  → crea Materiales/Herramientas/Maquinaria/EPP (catálogo,
//                        sin stock ni movimientos)
//   • Mov. Materiales  → movimientos con fecha histórica + stock por ubicación
//   • Mov. EPP         → movimientos EPP con fecha histórica
//   • Mov. Herramientas / Maquinaria → requieren unificar el modelo a stock
//                        por cantidad (fase siguiente); por ahora informa.
//
// Local-first: escribe a Dexie con created_at controlado (SuperAdmin permite
// fechas pasadas) y deja que el SyncEngine pushee al server.
// ═══════════════════════════════════════════════════════════════════

import React from "react";
import { getCurrentMode } from "../hooks/useAppMode.js";
import { detectarEPP } from "../lib/epp-utils.js";
import { calcAlerta } from "../lib/stock-utils.js";
import { aplicarDelta } from "../lib/stock-ubicaciones.js";
import {
  detectFormato, FORMATOS,
  parseInsumosTotales, parseMovimientos, resumenMovimientos,
  normTxt,
} from "../lib/migracion-parser.js";

const { useState: uS, useMemo: uM, useCallback: uC } = React;

const STEPS_MIG = ['Aviso', 'Archivo', 'Revisar', 'Resultado'];

// ── Creación local-first con control de created_at + demo ───────────────
function buildRecord(tabla, fields, userId, createdAtISO) {
  const now = new Date().toISOString();
  const id = window.__newId();
  const isPrueba = getCurrentMode() === 'prueba';
  // created_at es timestamptz; la fecha del Excel es YYYY-MM-DD → mediodía UTC.
  const createdAt = createdAtISO ? `${createdAtISO}T12:00:00.000Z` : now;
  return {
    ...fields,
    id,
    created_by: userId, updated_by: userId,
    created_at: createdAt, updated_at: now,
    version: 1,
    sync_status: isPrueba ? 'synced' : 'pending_create',
    last_synced_at: null,
    idempotency_key: fields.idempotency_key ?? `${userId || 'x'}_${tabla}_${id}`,
    ...(isPrueba ? { demo: true } : {}),
  };
}
async function addRecord(tabla, fields, userId, createdAtISO) {
  const rec = buildRecord(tabla, fields, userId, createdAtISO);
  await window.__db[tabla].add(rec);
  return rec;
}

const fireChanged = (...tablas) => {
  for (const t of tablas) {
    try { window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla: t } })); } catch {}
  }
};

// ── Índices en memoria (para resolver/crear sin requery por fila) ───────
async function cargarIndice(tabla, obraId, campoNombre, { porObra = true } = {}) {
  const q = window.__db[tabla];
  const rows = porObra && obraId
    ? await q.where('obra_id').equals(obraId).filter(r => !r.deleted_at).toArray()
    : await q.filter(r => !r.deleted_at).toArray();
  const map = new Map();
  for (const r of rows) {
    const k = normTxt(r[campoNombre]);
    if (k && !map.has(k)) map.set(k, r);
  }
  return { rows, map };
}

// Match best-effort de un nombre de persona contra el padrón de personal.
function matchPersonal(termino, personal) {
  const t = normTxt(termino);
  if (!t) return null;
  for (const p of personal) {
    const full = normTxt(`${p.nombres || ''} ${p.apellidos || ''}`);
    if (full && (full === t || full.includes(t) || t.includes(full))) return p.id;
  }
  // overlap por palabra
  const words = t.match(/[a-z0-9]+/gi) || [];
  for (const p of personal) {
    const full = normTxt(`${p.nombres || ''} ${p.apellidos || ''}`);
    if (words.some(w => w.length >= 4 && full.includes(w))) return p.id;
  }
  return null;
}
function matchProveedor(termino, proveedores) {
  const t = normTxt(termino);
  if (!t) return null;
  for (const p of proveedores) {
    const rs = normTxt(p.razon_social);
    if (rs && (rs === t || rs.includes(t) || t.includes(rs))) return p.id;
  }
  return null;
}

// ════════════════════════════════════════════════════════════════════
export function MigracionFlow({ obraId, userId, showToast, onReset, superAdmin }) {
  const [step, setStep] = uS(0);
  const [file, setFile] = uS(null);
  const [parsed, setParsed] = uS(null);   // { headers, rows }
  const [parseErr, setParseErr] = uS(null);
  const [formato, setFormato] = uS(null);  // id detectado (editable)
  const [importing, setImp] = uS(false);
  const [progress, setProgress] = uS({ current: 0, total: 0 });
  const [result, setResult] = uS(null);

  const fmtMeta = formato ? FORMATOS[formato] : null;
  const esInsumos = formato === 'insumos_totales';
  const esMov = formato && formato.startsWith('mov_');
  const movHabilitado = formato === 'mov_materiales' || formato === 'mov_epp';
  const movProximaFase = formato === 'mov_herramientas' || formato === 'mov_maquinaria';

  // Preview derivado del parse
  const preview = uM(() => {
    if (!parsed || !formato) return null;
    if (esInsumos) {
      const items = parseInsumosTotales(parsed.rows);
      const porTipo = { materiales: 0, herramientas: 0, activos_pesados: 0, epps: 0, desconocido: 0 };
      for (const it of items) porTipo[it.tipo || 'desconocido']++;
      return { tipo: 'insumos', items, porTipo, total: items.length };
    }
    const movs = parseMovimientos(parsed.rows, formato);
    return { tipo: 'mov', movs, resumen: resumenMovimientos(movs) };
  }, [parsed, formato, esInsumos]);

  const onFile = uC((f) => {
    setFile(f); setParsed(null); setParseErr(null); setFormato(null); setResult(null);
    if (!f) return;
    if (f.size > 10 * 1024 * 1024) { setParseErr('El archivo excede 10 MB'); return; }
    window.__excel.parseExcelFile(f)
      .then(p => {
        setParsed(p);
        const det = detectFormato(p.headers);
        setFormato(det);
        if (!det) setParseErr('No reconozco el formato. Revisá que sea uno de los 5 formatos de migración.');
      })
      .catch(e => setParseErr(e.message || 'Error al leer el archivo'));
  }, []);

  // ── Cargas ────────────────────────────────────────────────────────
  const runInsumos = async () => {
    const items = preview.items;
    let creados = 0, saltados = 0, errores = 0;
    const errorList = [];
    const idx = {
      materiales: (await cargarIndice('materiales', obraId, 'nombre_material')).map,
      herramientas: (await cargarIndice('herramientas', obraId, 'nombre_herramienta')).map,
      epps: (await cargarIndice('epps', obraId, 'nombre_epp')).map,
      activos_pesados: (await cargarIndice('activos_pesados', obraId, 'nombre', { porObra: false })).map,
    };
    setProgress({ current: 0, total: items.length });
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      try {
        if (!it.tipo) { errores++; errorList.push({ row: it.idx, error: `Tipo desconocido: "${it.tipoRaw}"` }); }
        else if (idx[it.tipo].has(normTxt(it.nombre))) { saltados++; }
        else {
          let rec;
          if (it.tipo === 'materiales') {
            rec = await addRecord('materiales', {
              obra_id: obraId, nombre_material: it.nombre, categoria: null,
              unidad: it.unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
              total_entradas: 0, total_salidas: 0, alerta: 'ok', estado: 'activo',
            }, userId, it.fechaCreacion);
          } else if (it.tipo === 'herramientas') {
            rec = await addRecord('herramientas', {
              obra_id: obraId, nombre_herramienta: it.nombre, tipo_herramienta: 'manual',
              estado_actual: 'bueno', ubicacion_actual: 'almacen', disponible: true,
              observaciones: it.unidad ? `Unidad: ${it.unidad}` : null,
            }, userId, it.fechaCreacion);
          } else if (it.tipo === 'epps') {
            rec = await addRecord('epps', {
              obra_id: obraId, nombre_epp: it.nombre, tipo_epp: detectarEPP(it.nombre) || 'Otro',
              unidad: it.unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
              alerta: 'ok', estado: 'activo',
            }, userId, it.fechaCreacion);
          } else if (it.tipo === 'activos_pesados') {
            rec = await addRecord('activos_pesados', {
              nombre: it.nombre, tipo: (it.tipoRaw || 'equipo').toLowerCase(),
              estado: 'operativo', obra_actual_id: obraId,
              notas: it.unidad ? `Unidad: ${it.unidad} · Migración histórica` : 'Migración histórica',
            }, userId, it.fechaCreacion);
          }
          if (rec) { idx[it.tipo].set(normTxt(it.nombre), rec); creados++; }
        }
      } catch (e) { errores++; errorList.push({ row: it.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: items.length }); await new Promise(r => setTimeout(r, 0)); }
    }
    fireChanged('materiales', 'herramientas', 'epps', 'activos_pesados');
    return { ok: creados, saltados, errors: errores, errorList,
      detalle: `${creados} insumos creados · ${saltados} ya existían · ${errores} con error` };
  };

  const runMovMateriales = async () => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const matIdx = await cargarIndice('materiales', obraId, 'nombre_material');
    const ubicIdx = await cargarIndice('ubicaciones_obra', obraId, 'nombre');
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const proveedores = (await window.__db.proveedores.filter(p => !p.deleted_at).toArray());

    const resolverMaterial = async (nombre, unidad) => {
      const k = normTxt(nombre);
      if (matIdx.map.has(k)) return matIdx.map.get(k);
      const rec = await addRecord('materiales', {
        obra_id: obraId, nombre_material: String(nombre).trim(), categoria: null,
        unidad: unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0,
        total_entradas: 0, total_salidas: 0, alerta: 'ok', estado: 'activo',
      }, userId);
      matIdx.map.set(k, rec); return rec;
    };
    const resolverUbic = async (nombre) => {
      const k = normTxt(nombre);
      if (!k) return null;
      if (ubicIdx.map.has(k)) return ubicIdx.map.get(k).id;
      const rec = await addRecord('ubicaciones_obra', {
        obra_id: obraId, nombre: String(nombre).trim(), descripcion: 'Creada en migración histórica',
        orden: ubicIdx.map.size + 1, activo: true,
      }, userId);
      ubicIdx.map.set(k, rec); return rec.id;
    };

    let okCount = 0, errores = 0, itemsCreados = 0, ubicCreadas = 0;
    const errorList = [];
    const afectados = new Set();
    const prevMat = matIdx.map.size, prevUbic = ubicIdx.map.size;
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error(`Tipo de movimiento no reconocido`);
        if (!(m.cantidad > 0)) throw new Error(`Cantidad inválida`);
        const mat = await resolverMaterial(m.nombreItem, m.unidad);
        afectados.add(mat.id);
        const obsExtra = [];
        let proveedor_id = null, responsable_id = null, frente = null, ubicId = null;

        if (m.tipo === 'entrada') {
          if (m.origen) { proveedor_id = matchProveedor(m.origen, proveedores); if (!proveedor_id) obsExtra.push(`Proveedor: ${m.origen}`); }
          if (m.lugar) ubicId = await resolverUbic(m.lugar);
        } else {
          if (m.origen) ubicId = await resolverUbic(m.origen);
          if (m.responsable) { responsable_id = matchPersonal(m.responsable, personal); if (!responsable_id) obsExtra.push(`Responsable: ${m.responsable}`); }
          if (m.lugar) frente = m.lugar;
        }
        const obs = ['Migración histórica', ...obsExtra].join(' · ');
        await addRecord('movimientos_materiales', {
          obra_id: obraId, material_id: mat.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, tipo_movimiento: m.tipo, cantidad: m.cantidad,
          unidad: m.unidad || mat.unidad || 'Und',
          responsable_id, proveedor_id, frente_zona: frente, partida_id: null,
          documento_asociado: null, precio_unitario_real: null, observaciones: obs,
        }, userId);

        if (ubicId) {
          try { await aplicarDelta({ obraId, itemTipo: 'material', itemId: mat.id, ubicacionId: ubicId, delta: m.tipo === 'entrada' ? m.cantidad : -m.cantidad, userId }); } catch {}
        }
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    itemsCreados = matIdx.map.size - prevMat;
    ubicCreadas = ubicIdx.map.size - prevUbic;
    await recalcularStockMateriales(obraId, afectados, userId);
    fireChanged('materiales', 'movimientos_materiales', 'ubicaciones_obra', 'stock_ubicaciones');
    return { ok: okCount, errors: errores, errorList,
      detalle: `${okCount} movimientos cargados · ${itemsCreados} materiales nuevos · ${ubicCreadas} ubicaciones creadas · ${errores} con error` };
  };

  const runMovEpp = async () => {
    const movs = [...preview.movs].sort((a, b) => (a.fecha || '') < (b.fecha || '') ? -1 : 1);
    const eppIdx = await cargarIndice('epps', obraId, 'nombre_epp');
    const ubicIdx = await cargarIndice('ubicaciones_obra', obraId, 'nombre');
    const personal = (await window.__db.personal.where('obra_id').equals(obraId).filter(p => !p.deleted_at).toArray());
    const proveedores = (await window.__db.proveedores.filter(p => !p.deleted_at).toArray());

    const resolverEpp = async (nombre, unidad) => {
      const k = normTxt(nombre);
      if (eppIdx.map.has(k)) return eppIdx.map.get(k);
      const rec = await addRecord('epps', {
        obra_id: obraId, nombre_epp: String(nombre).trim(), tipo_epp: detectarEPP(nombre) || 'Otro',
        unidad: unidad || 'Und', stock_inicial: 0, stock_actual: 0, stock_minimo: 0, alerta: 'ok', estado: 'activo',
      }, userId);
      eppIdx.map.set(k, rec); return rec;
    };
    const resolverUbic = async (nombre) => {
      const k = normTxt(nombre);
      if (!k) return null;
      if (ubicIdx.map.has(k)) return ubicIdx.map.get(k).id;
      const rec = await addRecord('ubicaciones_obra', {
        obra_id: obraId, nombre: String(nombre).trim(), descripcion: 'Creada en migración histórica',
        orden: ubicIdx.map.size + 1, activo: true,
      }, userId);
      ubicIdx.map.set(k, rec); return rec.id;
    };

    let okCount = 0, errores = 0;
    const errorList = [];
    const afectados = new Set();
    const prevEpp = eppIdx.map.size;
    setProgress({ current: 0, total: movs.length });

    for (let i = 0; i < movs.length; i++) {
      const m = movs[i];
      try {
        if (!m.tipo) throw new Error('Tipo de movimiento no reconocido');
        if (!(m.cantidad > 0)) throw new Error('Cantidad inválida');
        const epp = await resolverEpp(m.nombreItem, m.unidad);
        afectados.add(epp.id);
        const obsExtra = [];
        let proveedor_id = null, personal_id = null, ubicId = null;

        if (m.tipo === 'entrada') {
          if (m.origen) { proveedor_id = matchProveedor(m.origen, proveedores); if (!proveedor_id) obsExtra.push(`Proveedor: ${m.origen}`); }
          if (m.lugar) ubicId = await resolverUbic(m.lugar);
        } else {
          const quien = m.responsable || m.origen;
          if (quien) { personal_id = matchPersonal(quien, personal); if (!personal_id) obsExtra.push(`Entregado a: ${quien}`); }
          if (m.lugar) obsExtra.push(`Lugar: ${m.lugar}`);
          ubicId = epp.ubicacion_id || (ubicIdx.rows[0]?.id ?? null);
        }
        const obs = ['Migración histórica', ...obsExtra].join(' · ');
        await addRecord('movimientos_epp', {
          obra_id: obraId, epp_id: epp.id, fecha: m.fecha || new Date().toISOString().slice(0, 10),
          hora: null, tipo_movimiento: m.tipo, cantidad: m.cantidad, unidad: m.unidad || epp.unidad || 'Und',
          personal_id, proveedor_id, motivo: m.tipo === 'entrada' ? 'reposicion' : 'dotacion', observaciones: obs,
        }, userId);

        if (ubicId) {
          try { await aplicarDelta({ obraId, itemTipo: 'epp', itemId: epp.id, ubicacionId: ubicId, delta: m.tipo === 'entrada' ? m.cantidad : -m.cantidad, userId }); } catch {}
        }
        okCount++;
      } catch (e) { errores++; errorList.push({ row: m.idx, error: e.message || String(e) }); }
      if (i % 20 === 0) { setProgress({ current: i + 1, total: movs.length }); await new Promise(r => setTimeout(r, 0)); }
    }

    await recalcularStockEpp(obraId, afectados, userId);
    fireChanged('epps', 'movimientos_epp', 'ubicaciones_obra', 'stock_ubicaciones');
    return { ok: okCount, errors: errores, errorList,
      detalle: `${okCount} movimientos EPP cargados · ${eppIdx.map.size - prevEpp} EPP nuevos · ${errores} con error` };
  };

  const ejecutar = async () => {
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    if (!superAdmin) { showToast('Activá Super Admin para migrar históricos', 'red'); return; }
    setImp(true);
    try {
      let res;
      if (esInsumos) res = await runInsumos();
      else if (formato === 'mov_materiales') res = await runMovMateriales();
      else if (formato === 'mov_epp') res = await runMovEpp();
      else { setImp(false); return; }
      setResult(res);
      setStep(3);
      showToast(res.detalle, res.errors ? 'amber' : 'green');
    } catch (e) {
      showToast('Error en la migración: ' + (e.message || e), 'red');
    } finally { setImp(false); }
  };

  const reiniciar = () => {
    setStep(0); setFile(null); setParsed(null); setParseErr(null); setFormato(null); setResult(null);
    setProgress({ current: 0, total: 0 });
  };

  // ── RENDER ──────────────────────────────────────────────────────────
  return (
    <div>
      <Steps current={step} steps={STEPS_MIG} onJump={(i) => i < step && !importing ? setStep(i) : null} />

      {/* Step 0 — Aviso */}
      {step === 0 && (
        <div>
          <div className="card card-p" style={{ background: 'rgba(155,89,182,0.08)', border: '1px solid rgba(155,89,182,0.3)', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <JxIcon name="alert" size={18} color="#9B59B6" />
              <span style={{ fontSize: 15, fontWeight: 800, color: '#9B59B6' }}>Migración histórica (Super Admin)</span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ts)', lineHeight: 1.65 }}>
              Carga masiva de los movimientos que la obra registró en papel/Excel antes de usar JARVEX, <strong>respetando las fechas reales</strong>.
              <br /><br />
              <strong>Orden recomendado:</strong>
              <ol style={{ margin: '6px 0 0 18px', padding: 0 }}>
                <li>Primero <strong>Insumos Totales</strong> (crea el catálogo de Materiales / Herramientas / Maquinaria / EPP, sin stock).</li>
                <li>Luego cada archivo de <strong>Movimientos</strong> (ingresos/salidas con su fecha). Si un insumo no existe, se crea solo.</li>
              </ol>
            </div>
          </div>
          {!superAdmin && (
            <div className="alert-banner" style={{ marginBottom: 14, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--red)' }}>
              <JxIcon name="alert" size={14} color="var(--red)" />
              <span>Super Admin está <strong>desactivado</strong>. Activalo (engranaje → Super Admin) para poder cargar fechas históricas.</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={onReset}><JxIcon name="chevL" size={14} />Volver al inicio</button>
            <button className="btn btn-amber" disabled={!superAdmin} onClick={() => setStep(1)} style={{ opacity: superAdmin ? 1 : .4 }}>
              Empezar <JxIcon name="chevR" size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Step 1 — Archivo */}
      {step === 1 && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tp)', marginBottom: 4 }}>Subí el archivo Excel</div>
          <div style={{ fontSize: 12.5, color: 'var(--tm)', marginBottom: 16 }}>Detecto automáticamente cuál de los 5 formatos es por sus columnas.</div>
          <label style={{ display: 'block', border: '2px dashed var(--border)', borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer', background: 'var(--bg-c)' }}>
            <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0] || null)} />
            <JxIcon name="file" size={28} color="var(--amber)" />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--tp)', marginTop: 8 }}>{file ? file.name : 'Elegí un archivo .xlsx / .xls'}</div>
            <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 4 }}>Máx. 10 MB</div>
          </label>

          {parseErr && <div className="alert-banner" style={{ marginTop: 12, background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', color: 'var(--red)' }}><JxIcon name="alert" size={14} color="var(--red)" /><span>{parseErr}</span></div>}

          {parsed && formato && (
            <div className="card card-p" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--tm)', marginBottom: 6 }}>Formato detectado</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <JxIcon name={fmtMeta.icon} size={18} color="var(--amber)" />
                <select value={formato} onChange={(e) => setFormato(e.target.value)} className="fi" style={{ fontWeight: 700, width: 'auto', flex: 1 }}>
                  {Object.values(FORMATOS).map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 12, color: 'var(--tm)' }}>{fmtMeta.desc}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ts)', marginTop: 8 }}>{parsed.rows.length} filas · columnas: {parsed.headers.join(' · ')}</div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18 }}>
            <button className="btn btn-ghost" onClick={() => setStep(0)}><JxIcon name="chevL" size={14} />Atrás</button>
            <button className="btn btn-amber" disabled={!parsed || !formato} onClick={() => setStep(2)} style={{ opacity: (parsed && formato) ? 1 : .4 }}>Revisar <JxIcon name="chevR" size={14} /></button>
          </div>
        </div>
      )}

      {/* Step 2 — Revisar */}
      {step === 2 && preview && (
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tp)', marginBottom: 12 }}>Revisá antes de cargar</div>

          {preview.tipo === 'insumos' && (
            <div className="card card-p" style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                {[['Materiales', preview.porTipo.materiales, '#3498DB'], ['Herramientas', preview.porTipo.herramientas, '#F28C28'], ['Maquinaria', preview.porTipo.activos_pesados, '#8E44AD'], ['EPP', preview.porTipo.epps, '#2ECC71']].map(([lbl, n, c]) => (
                  <div key={lbl} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: c }}>{n}</div>
                    <div style={{ fontSize: 11, color: 'var(--tm)' }}>{lbl}</div>
                  </div>
                ))}
              </div>
              {preview.porTipo.desconocido > 0 && (
                <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>⚠️ {preview.porTipo.desconocido} fila(s) con Tipo no reconocido (no se crearán).</div>
              )}
              <div style={{ fontSize: 12, color: 'var(--tm)', marginTop: 10 }}>Se crea el catálogo sin stock ni movimientos. Los insumos que ya existan (por nombre) se saltan.</div>
            </div>
          )}

          {preview.tipo === 'mov' && (
            <div className="card card-p" style={{ marginBottom: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>{preview.resumen.entradas}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Ingresos</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--red)' }}>{preview.resumen.salidas}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Salidas</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--tp)' }}>{preview.resumen.itemsUnicos}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>Insumos distintos</div></div>
                <div style={{ textAlign: 'center' }}><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--amber)' }}>{preview.resumen.sinTipo + preview.resumen.sinFecha + preview.resumen.sinCantidad}</div><div style={{ fontSize: 11, color: 'var(--tm)' }}>A revisar</div></div>
              </div>
              {(preview.resumen.sinTipo || preview.resumen.sinFecha || preview.resumen.sinCantidad) > 0 && (
                <div style={{ fontSize: 12, color: 'var(--amber)', marginTop: 10 }}>
                  ⚠️ {preview.resumen.sinTipo} sin tipo · {preview.resumen.sinFecha} sin fecha (usan hoy) · {preview.resumen.sinCantidad} sin cantidad válida.
                </div>
              )}
            </div>
          )}

          {movProximaFase && (
            <div className="alert-banner" style={{ marginBottom: 14, background: 'rgba(242,183,5,0.08)', border: '1px solid rgba(242,183,5,0.3)', color: 'var(--amber)' }}>
              <JxIcon name="alert" size={14} color="var(--amber)" />
              <span>{fmtMeta.label}: hoy {formato === 'mov_herramientas' ? 'Herramientas' : 'Maquinaria'} no maneja stock por cantidad. Esta carga se habilita al unificar el modelo (fase siguiente). Por ahora podés crear el catálogo desde <strong>Insumos Totales</strong>.</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <button className="btn btn-ghost" onClick={() => setStep(1)} disabled={importing}><JxIcon name="chevL" size={14} />Atrás</button>
            <button className="btn btn-amber" disabled={importing || (esMov && !movHabilitado)} onClick={ejecutar}>
              {importing ? `Cargando… ${progress.current}/${progress.total}` : <>Cargar a JARVEX <JxIcon name="chevR" size={14} /></>}
            </button>
          </div>
          {importing && progress.total > 0 && (
            <div style={{ height: 6, background: 'var(--bg-s)', borderRadius: 4, marginTop: 12, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.round(progress.current / progress.total * 100)}%`, background: 'var(--amber)', transition: 'width .2s' }} />
            </div>
          )}
        </div>
      )}

      {/* Step 3 — Resultado */}
      {step === 3 && result && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px 20px', gap: 16, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: result.errors ? 'rgba(242,183,5,0.15)' : 'rgba(46,204,113,0.15)', border: `2px solid ${result.errors ? 'var(--amber)' : 'var(--green)'}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <JxIcon name={result.errors ? 'alert' : 'checkCircle'} size={28} color={result.errors ? 'var(--amber)' : 'var(--green)'} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--tp)', marginBottom: 6 }}>{result.errors ? 'Migración con advertencias' : 'Migración completada'}</div>
            <div style={{ fontSize: 13, color: 'var(--ts)' }}>{result.detalle}</div>
          </div>
          {result.errorList?.length > 0 && (
            <details style={{ width: '100%', maxWidth: 560, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--amber)', fontWeight: 600, padding: '8px 0' }}>Ver {result.errorList.length} con error</summary>
              <div style={{ maxHeight: 240, overflow: 'auto', background: 'var(--bg-c)', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                {result.errorList.map((e, i) => (
                  <div key={i} style={{ fontSize: 11.5, padding: '4px 0', borderBottom: '1px solid var(--border)', color: 'var(--ts)' }}>
                    <strong style={{ color: 'var(--red)' }}>Fila {e.row}:</strong> {e.error}
                  </div>
                ))}
              </div>
            </details>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={reiniciar}><JxIcon name="arrowIn" size={13} />Migrar otro archivo</button>
            <button className="btn btn-amber" onClick={onReset}><JxIcon name="check" size={13} />Terminar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Indicador de pasos local (mismo look que el wizard principal).
function Steps({ current, steps, onJump }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        return (
          <React.Fragment key={i}>
            <div onClick={done ? () => onJump(i) : undefined} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, cursor: done ? 'pointer' : 'default' }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700,
                background: active ? 'var(--amber)' : done ? 'rgba(46,204,113,0.18)' : 'var(--bg-s)',
                color: active ? '#0c1118' : done ? 'var(--green)' : 'var(--tm)',
                border: `1.5px solid ${active ? 'var(--amber)' : done ? 'var(--green)' : 'var(--border)'}` }}>
                {done ? <JxIcon name="check" size={14} color="var(--green)" /> : i + 1}
              </div>
              <span style={{ fontSize: 11, color: active ? 'var(--tp)' : 'var(--tm)', fontWeight: active ? 700 : 500 }}>{s}</span>
            </div>
            {i < steps.length - 1 && <div style={{ flex: 1, height: 2, background: i < current ? 'var(--green)' : 'var(--border)', margin: '0 8px', marginBottom: 18 }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── Recálculo de stock desde movimientos (igual que el botón "Recalcular") ──
async function recalcularStockMateriales(obraId, idsAfectados, userId) {
  if (!idsAfectados?.size) return;
  const movs = await window.__db.movimientos_materiales.where('obra_id').equals(obraId).toArray();
  const sums = new Map(); const ent = new Map(); const sal = new Map();
  for (const mv of movs) {
    if (mv.reverses_id || mv.reversed_by_id || mv.deleted_at) continue;
    if (!idsAfectados.has(mv.material_id)) continue;
    const c = Number(mv.cantidad || 0);
    if (mv.tipo_movimiento === 'entrada') { sums.set(mv.material_id, (sums.get(mv.material_id) || 0) + c); ent.set(mv.material_id, (ent.get(mv.material_id) || 0) + c); }
    else if (mv.tipo_movimiento === 'salida') { sums.set(mv.material_id, (sums.get(mv.material_id) || 0) - c); sal.set(mv.material_id, (sal.get(mv.material_id) || 0) + c); }
  }
  const now = new Date().toISOString();
  for (const id of idsAfectados) {
    const mat = await window.__db.materiales.get(id);
    if (!mat) continue;
    const stock = Math.max(0, sums.get(id) || 0);
    await window.__db.materiales.update(id, {
      stock_actual: stock, total_entradas: ent.get(id) || 0, total_salidas: sal.get(id) || 0,
      alerta: calcAlerta(stock, Number(mat.stock_minimo || 0)),
      updated_at: now, updated_by: userId,
      version: (mat.version ?? 0) + 1,
      sync_status: mat.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
}

async function recalcularStockEpp(obraId, idsAfectados, userId) {
  if (!idsAfectados?.size) return;
  const movs = await window.__db.movimientos_epp.where('obra_id').equals(obraId).toArray();
  const sums = new Map();
  for (const mv of movs) {
    if (mv.deleted_at) continue;
    if (!idsAfectados.has(mv.epp_id)) continue;
    const c = Number(mv.cantidad || 0);
    if (mv.tipo_movimiento === 'entrada') sums.set(mv.epp_id, (sums.get(mv.epp_id) || 0) + c);
    else if (mv.tipo_movimiento === 'salida') sums.set(mv.epp_id, (sums.get(mv.epp_id) || 0) - c);
  }
  const now = new Date().toISOString();
  for (const id of idsAfectados) {
    const epp = await window.__db.epps.get(id);
    if (!epp) continue;
    const stock = Math.max(0, sums.get(id) || 0);
    await window.__db.epps.update(id, {
      stock_actual: stock, alerta: calcAlerta(stock, Number(epp.stock_minimo || 0)),
      updated_at: now, updated_by: userId,
      version: (epp.version ?? 0) + 1,
      sync_status: epp.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
    });
  }
}

Object.assign(window, { MigracionFlow });
