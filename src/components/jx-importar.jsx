import React from "react";
const { useState: uSI, useMemo: uMI, useEffect: uEI, useRef: uRI, useCallback: uCI } = React;

// ── Obra activa helper (poll Dexie) ──────────────────────────
function useObraActiva() {
  const [obraId, setObraId] = uSI(null);
  uEI(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); return; }
      if (cancelled || attempts >= 10) return;
      setTimeout(find, 500);
    };
    find();
    const onChange = () => { attempts = 0; find(); };
    window.addEventListener('jarvex_master_updated', onChange);
    window.addEventListener('obra_activa_change', onChange);
    return () => {
      cancelled = true;
      window.removeEventListener('jarvex_master_updated', onChange);
      window.removeEventListener('obra_activa_change', onChange);
    };
  }, []);
  return obraId;
}

// ── SOURCES ──────────────────────────────────────────────────
const SOURCES = [
  { id:'excel',     label:'Excel / CSV',     icon:'chart',  color:'#1E7145', desc:'Importa desde hojas de cálculo .xlsx, .xls o archivos .csv', ext:'.xlsx,.xls,.csv', badge:'Universal',  enabled:true  },
  { id:'s10',       label:'S10 Costos',      icon:'dollar', color:'#0070C0', desc:'Importa presupuestos, partidas e insumos directamente desde S10 Perú', ext:'.xlsx, .xls', badge:'Construcción Perú', enabled:true  },
  { id:'delfin',    label:'Delfín ERP',      icon:'users',  color:'#7030A0', desc:'Importa personal, planillas y asistencia desde Delfín / Delfín+', ext:'.xlsx, .csv', badge:'RRHH Perú', enabled:false },
  { id:'msproject', label:'MS Project',      icon:'gantt',  color:'#217346', desc:'Importa cronograma y tareas desde Microsoft Project', ext:'.mpp, .xml, .xlsx', badge:'Cronograma', enabled:false },
  { id:'autocad',   label:'AutoCAD / Revit', icon:'layers', color:'#E84142', desc:'Importa metrados desde planillas de cómputo en DXF/Excel', ext:'.xlsx, .csv', badge:'Metrados', enabled:false },
];

// ── MODULE DESTINATIONS (real ones for Excel) ────────────────
const MOD_META = [
  { id:'materiales',   label:'Materiales / Inventario', icon:'package', color:'#3498DB', desc:'Stock de almacén, unidades, precios estimados y categorías' },
  { id:'personal',     label:'Personal / Trabajadores', icon:'users',   color:'#2ECC71', desc:'DNI, cargo, área, fecha de ingreso del plantel' },
  { id:'partidas',     label:'Partidas de Obra',        icon:'list',    color:'#9B59B6', desc:'Códigos, metrados, precios unitarios y cronograma planificado' },
  { id:'proveedores',  label:'Proveedores',             icon:'truck',   color:'#1ABC9C', desc:'RUC, razón social, contacto y condiciones (global, sin obra)' },
  { id:'herramientas', label:'Herramientas y Equipos',  icon:'tool',    color:'#F28C28', desc:'Tipo, marca, modelo, serie, estado actual' },
];

const NEEDS_OBRA = (m) => m !== 'proveedores';

// ── UTILS ────────────────────────────────────────────────────
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const fmtDate = () => new Date().toLocaleString('es-PE');

function autoMap(fields, headers) {
  const map = {};
  const used = new Set();
  fields.forEach(f => {
    const nf = norm(f);
    const hit = headers.find(h => !used.has(h) && (norm(h) === nf || norm(h).includes(nf) || nf.includes(norm(h))));
    if (hit) { map[f] = hit; used.add(hit); }
    else map[f] = '';
  });
  return map;
}

function applyMapping(row, mapping) {
  const out = {};
  Object.entries(mapping).forEach(([field, col]) => {
    out[field] = col ? row[col] : null;
  });
  return out;
}

function validateRow(row, mod, modCfg) {
  const errors = [];
  modCfg.requiredFields.forEach(f => {
    const v = row[f];
    if (v === null || v === undefined || String(v).trim() === '') {
      errors.push(`Falta "${f}"`);
    }
  });
  if (mod === 'personal' && row.dni && !/^\d{8}$/.test(String(row.dni).trim())) {
    errors.push('DNI debe tener 8 dígitos');
  }
  if (mod === 'proveedores' && row.ruc && !/^\d{11}$/.test(String(row.ruc).trim())) {
    errors.push('RUC debe tener 11 dígitos');
  }
  const numFields = ['stock_inicial','stock_minimo','precio_unitario_estimado','metrado_contratado','precio_unitario_pres'];
  numFields.forEach(f => {
    if (row[f] !== null && row[f] !== undefined && row[f] !== '' && isNaN(parseFloat(row[f]))) {
      errors.push(`"${f}" debe ser numérico`);
    }
  });
  return errors;
}

// ── STEP INDICATOR ───────────────────────────────────────────
function Steps({ current, steps, onJump }) {
  return (
    <div style={{ display:'flex', alignItems:'center', marginBottom:28 }}>
      {steps.map((s, i) => {
        const done = i < current, active = i === current;
        const clickable = done;
        return (
          <React.Fragment key={i}>
            <div
              onClick={clickable ? () => onJump(i) : undefined}
              style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6, cursor:clickable?'pointer':'default' }}>
              <div style={{
                width:34, height:34, borderRadius:'50%',
                background: done ? 'var(--green)' : active ? 'var(--amber)' : 'rgba(255,255,255,0.07)',
                border: `2px solid ${done ? 'var(--green)' : active ? 'var(--amber)' : 'rgba(255,255,255,0.12)'}`,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:12, fontWeight:700,
                color: done||active ? '#0c1118' : 'var(--tm)',
                transition:'all .25s',
              }}>
                {done ? <JxIcon name="check" size={14} color="#0c1118"/> : i+1}
              </div>
              <span style={{ fontSize:10.5, fontWeight:active?700:400, color:active?'var(--amber)':done?'var(--green)':'var(--tm)', whiteSpace:'nowrap' }}>{s}</span>
            </div>
            {i < steps.length-1 && (
              <div style={{ flex:1, height:2, background:i < current?'var(--green)':'rgba(255,255,255,0.07)', margin:'0 8px', marginBottom:20, transition:'background .3s' }}/>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ── DROP ZONE ────────────────────────────────────────────────
function DropZone({ onFile, file, accept = '.xlsx,.xls,.csv' }) {
  const [drag, setDrag] = uSI(false);
  const ref = uRI(null);

  const handleDrop = uCI(e => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) onFile(f);
  }, [onFile]);

  if (file) return (
    <div style={{ border:'2px solid var(--green)', borderRadius:10, padding:'20px 24px', display:'flex', alignItems:'center', gap:14, background:'rgba(46,204,113,0.06)' }}>
      <div style={{ width:44, height:44, borderRadius:10, background:'rgba(46,204,113,0.15)', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <JxIcon name="file" size={20} color="var(--green)"/>
      </div>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:13, fontWeight:600, color:'var(--tp)' }}>{file.name}</div>
        <div style={{ fontSize:11.5, color:'var(--green)', marginTop:2 }}>✓ {(file.size/1024).toFixed(1)} KB · Listo para procesar</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={()=>onFile(null)}><JxIcon name="x" size={13}/>Quitar</button>
    </div>
  );

  return (
    <div
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={handleDrop}
      onClick={()=>ref.current?.click()}
      style={{
        border:`2px dashed ${drag?'var(--amber)':'var(--border-h)'}`,
        borderRadius:10, padding:'40px 24px', textAlign:'center', cursor:'pointer',
        background:drag?'rgba(242,183,5,0.05)':'transparent',
        transition:'all .2s',
      }}>
      <input ref={ref} type="file" accept={accept} style={{ display:'none' }}
        onChange={e=>{ if(e.target.files[0]) onFile(e.target.files[0]); }}/>
      <JxIcon name="upload" size={32} color={drag?'var(--amber)':'var(--tm)'}/>
      <div style={{ marginTop:10, fontSize:14, fontWeight:600, color:drag?'var(--amber)':'var(--ts)' }}>
        {drag ? 'Suelta el archivo aquí' : 'Arrastra tu archivo o haz clic para seleccionar'}
      </div>
      <div style={{ marginTop:6, fontSize:11.5, color:'var(--tm)' }}>Formatos: {accept} · Máximo 10MB</div>
    </div>
  );
}

// ── S10 (APU) IMPORT FLOW ────────────────────────────────────
// Flujo distinto al genérico: no requiere mapeo manual, importa
// partidas + insumos desde un export de "Análisis de Precios
// Unitarios" de S10. Sustituye TODO el contenido de partidas/
// insumos_partida de la obra activa.
function S10Flow({ obraId: defaultObraId, userId, userName, showToast, onReset, hist, setHist }) {
  const [step, setStep] = uSI(0); // 0 aviso, 1 archivo, 2 preview, 3 confirmar
  const [confirmed, setConfirmed] = uSI(false);
  const [file, setFile] = uSI(null);
  const [parsing, setParsing] = uSI(false);
  const [parsed, setParsed] = uSI(null); // { partidas, summary }
  const [parseErr, setParseErr] = uSI(null);
  const [importing, setImp] = uSI(false);
  const [progress, setProgress] = uSI({ phase:'', current:0, total:0 });
  const [result, setResult] = uSI(null);

  // Selector de obra destino — el usuario puede cambiarlo antes de importar
  const [obrasDisponibles, setObrasDisponibles] = uSI([]);
  const [obraId, setObraId] = uSI(defaultObraId || null);
  uEI(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const todas = await window.__db.obras.toArray();
        const visibles = (todas || []).filter(o => !o.deleted_at);
        if (cancelled) return;
        setObrasDisponibles(visibles);
        // Si no había obra seleccionada o la actual no existe, usa la primera
        if (!obraId || !visibles.find(o => o.id === obraId)) {
          if (visibles.length) setObraId(visibles[0].id);
        }
      } catch (e) {}
    };
    load();
    const t = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const obraDestino = obrasDisponibles.find(o => o.id === obraId);

  // ── Comparación APU (solo aplica a tipo 'apu') ─────────────
  const [comparing, setComparing] = uSI(false);
  const [compareErr, setCompareErr] = uSI(null);
  // comparison: { codigo, descripcion, costo_total, cantidad, unidad, existente, status, action }
  // status:  'nueva' | 'duplicada_igual' | 'duplicada_distinta'
  // action:  'importar' | 'reemplazar' | 'saltar'
  const [comparison, setComparison] = uSI([]);
  const [filterText, setFilterText] = uSI('');
  const [filterMode, setFilterMode] = uSI('todas'); // 'todas' | 'nuevas' | 'duplicadas'
  const [page, setPage] = uSI(0);
  const PAGE_SIZE = 100;

  // Cargar partidas existentes y comparar al entrar a step 2 con tipo apu
  uEI(() => {
    let cancelled = false;
    if (step !== 2 || !parsed || parsed.tipo !== 'apu' || !obraId) return;
    setComparing(true); setCompareErr(null);
    (async () => {
      try {
        const all = await window.__db.partidas.where('obra_id').equals(obraId).toArray();
        const vivas = all.filter(p => !p.deleted_at);
        const porCodigo = new Map(vivas.map(p => [p.codigo_delfin, p]));
        const eqNum = (a, b) => {
          const na = Number(a) || 0, nb = Number(b) || 0;
          return Math.abs(na - nb) < 0.01;
        };
        const cmp = parsed.data.map(p => {
          const cantidad = Number(p.cantidad) || 0;
          const total = Number(p.costo_total) || 0;
          const existente = porCodigo.get(p.codigo) || null;
          let status = 'nueva';
          if (existente) {
            const sameNombre = (existente.nombre_partida || '').trim() === (p.descripcion || p.codigo || '').trim();
            const sameTotal  = eqNum(existente.costo_total_presupuestado, total);
            const sameMetra  = eqNum(existente.metrado_contratado, cantidad);
            status = (sameNombre && sameTotal && sameMetra) ? 'duplicada_igual' : 'duplicada_distinta';
          }
          const action = status === 'nueva' ? 'importar'
                       : status === 'duplicada_igual' ? 'saltar'
                       : 'reemplazar';
          return {
            codigo: p.codigo,
            descripcion: p.descripcion || p.codigo,
            cantidad, costo_total: total, unidad: p.unidad || 'und',
            existente, status, action,
          };
        });
        if (!cancelled) { setComparison(cmp); setPage(0); }
      } catch (e) {
        if (!cancelled) setCompareErr(e.message || 'Error al comparar partidas');
      } finally {
        if (!cancelled) setComparing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [step, parsed, obraId]);

  // KPIs
  const kpis = uMI(() => {
    let nuevas = 0, iguales = 0, distintas = 0;
    comparison.forEach(c => {
      if (c.status === 'nueva') nuevas++;
      else if (c.status === 'duplicada_igual') iguales++;
      else distintas++;
    });
    return { nuevas, iguales, distintas, total: comparison.length };
  }, [comparison]);

  // Filtrado
  const filtered = uMI(() => {
    const q = filterText.trim().toLowerCase();
    return comparison.filter(c => {
      if (filterMode === 'nuevas' && c.status !== 'nueva') return false;
      if (filterMode === 'duplicadas' && c.status === 'nueva') return false;
      if (q) {
        const hay = (c.codigo + ' ' + c.descripcion).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [comparison, filterText, filterMode]);

  // Resumen de acciones
  const actionSummary = uMI(() => {
    let aImportar = 0, aReemplazar = 0, aSaltar = 0;
    comparison.forEach(c => {
      if (c.action === 'importar') aImportar++;
      else if (c.action === 'reemplazar') aReemplazar++;
      else aSaltar++;
    });
    return { aImportar, aReemplazar, aSaltar, aProcesar: aImportar + aReemplazar };
  }, [comparison]);

  const setActionForRow = (codigo, action) => {
    setComparison(prev => prev.map(c => c.codigo === codigo ? { ...c, action } : c));
  };
  const bulkAction = (predicate, action) => {
    setComparison(prev => prev.map(c => predicate(c) ? { ...c, action } : c));
  };

  // Reset paginación al cambiar filtro
  uEI(() => { setPage(0); }, [filterText, filterMode]);

  // Parse al subir archivo — auto-detecta si es APU, lista de insumos o Gantt
  uEI(() => {
    if (!file) { setParsed(null); setParseErr(null); return; }
    if (file.size > 25 * 1024 * 1024) {
      setParseErr('El archivo excede 25MB'); setParsed(null); return;
    }
    setParsing(true); setParseErr(null);
    const t0 = performance.now();
    window.__apu.parseS10File(file)
      .then(p => {
        if (p.tipo === 'desconocido') {
          setParseErr('No reconocí este archivo S10. Asegúrate que sea un APU completo, una lista de insumos o un cronograma Gantt.');
          setParsed(null);
          return;
        }
        setParsed({ ...p, parseMs: Math.round(performance.now() - t0) });
      })
      .catch(e => { setParseErr(e.message || 'Error al leer el archivo'); setParsed(null); })
      .finally(() => setParsing(false));
  }, [file]);

  // ── Import APU (partidas + insumos_partida) ──────────────────
  // Respeta las acciones elegidas por partida en el step Preview.
  async function importAPU() {
    const now = new Date().toISOString();
    const errorList = [];

    // Mapas auxiliares
    const accionPorCodigo = new Map(comparison.map(c => [c.codigo, c.action]));
    const existentePorCodigo = new Map(
      comparison.filter(c => c.existente).map(c => [c.codigo, c.existente])
    );

    // 1) Identificar las partidas a reemplazar (borrar existentes + sus insumos)
    const aReemplazar = comparison.filter(c => c.action === 'reemplazar' && c.existente);
    const aImportar   = comparison.filter(c => c.action === 'importar');

    // ── Fase 1: borrar partidas a reemplazar y sus insumos ─────
    if (aReemplazar.length) {
      setProgress({ phase:`Borrando ${aReemplazar.length} partidas a reemplazar…`, current:0, total: aReemplazar.length });
      const PCH_DEL = 50;
      for (let i = 0; i < aReemplazar.length; i += PCH_DEL) {
        const chunk = aReemplazar.slice(i, i + PCH_DEL);
        const ids = chunk.map(c => c.existente.id);
        try {
          await window.__db.partidas.bulkDelete(ids);
          await window.__db.insumos_partida.where('partida_id').anyOf(ids).delete();
        } catch (e) {
          errorList.push({ row: chunk[0].codigo, error: `Error borrando lote: ${e.message || e}` });
        }
        setProgress({ phase:`Borrando ${aReemplazar.length} partidas a reemplazar…`, current: Math.min(i + PCH_DEL, aReemplazar.length), total: aReemplazar.length });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ── Fase 2: construir registros a insertar (importar + reemplazar) ──
    const partidaRecords = [];
    const insumoRecords = [];
    // Map codigo->parsedRow para acceder a insumos
    const parsedPorCodigo = new Map(parsed.data.map(p => [p.codigo, p]));
    // Mantener orden global tomado del archivo
    const ordenPorCodigo = new Map();
    parsed.data.forEach((p, i) => ordenPorCodigo.set(p.codigo, i));

    const aInsertarCmps = [...aImportar, ...aReemplazar];
    aInsertarCmps.forEach(c => {
      const p = parsedPorCodigo.get(c.codigo);
      if (!p) return;
      const id = window.__newId();
      const cantidad = Number(p.cantidad) || 0;
      const total = Number(p.costo_total) || 0;
      const pu = cantidad > 0 ? +(total / cantidad).toFixed(6) : 0;
      partidaRecords.push({
        id, obra_id: obraId,
        codigo_delfin: p.codigo,
        nombre_partida: p.descripcion || p.codigo,
        unidad: p.unidad || 'und',
        metrado_contratado: cantidad,
        precio_unitario_pres: pu,
        costo_total_presupuestado: total,
        estado: 'pendiente',
        nivel: p.nivel ?? 1,
        parent_codigo: p.parent_codigo ?? null,
        orden: ordenPorCodigo.get(p.codigo) ?? 0,
        created_by: userId, updated_by: userId,
        created_at: now, updated_at: now,
        version: 1, sync_status: 'pending_create', last_synced_at: null,
        idempotency_key: `${userId}_partidas_${id}`,
      });
      (p.insumos || []).forEach(ins => {
        const insId = window.__newId();
        insumoRecords.push({
          id: insId, obra_id: obraId, partida_id: id,
          insumo_codigo: ins.codigo,
          nombre_insumo: ins.descripcion,
          tipo_insumo: ins.categoria,
          unidad: ins.unidad,
          cantidad_presupuestada: Number(ins.cantidad) || 0,
          precio_presupuestado: Number(ins.precio_unitario) || 0,
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_insumos_partida_${insId}`,
        });
      });
    });

    // ── Fase 3: insertar partidas (chunked) ─────────────────────
    const PCH = 50, ICH = 200;
    let partidasInsertadas = 0;
    if (partidaRecords.length) {
      const phaseLabel = aReemplazar.length
        ? `Insertando ${aImportar.length} nuevas + ${aReemplazar.length} reemplazadas…`
        : `Insertando ${aImportar.length} partidas nuevas…`;
      setProgress({ phase: phaseLabel, current:0, total: partidaRecords.length });
      for (let i = 0; i < partidaRecords.length; i += PCH) {
        const chunk = partidaRecords.slice(i, i + PCH);
        try {
          await window.__db.partidas.bulkAdd(chunk);
          partidasInsertadas += chunk.length;
        } catch (e) {
          errorList.push({ row: chunk[0]?.codigo_delfin || '-', error: `Error insertando partidas: ${e.message || e}` });
        }
        setProgress({ phase: phaseLabel, current: Math.min(i + PCH, partidaRecords.length), total: partidaRecords.length });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ── Fase 4: insertar insumos (chunked) ─────────────────────
    let insumosInsertados = 0;
    if (insumoRecords.length) {
      const phaseLabel = `Insertando ${insumoRecords.length} insumos…`;
      setProgress({ phase: phaseLabel, current:0, total: insumoRecords.length });
      for (let i = 0; i < insumoRecords.length; i += ICH) {
        const chunk = insumoRecords.slice(i, i + ICH);
        try {
          await window.__db.insumos_partida.bulkAdd(chunk);
          insumosInsertados += chunk.length;
        } catch (e) {
          errorList.push({ row: chunk[0]?.insumo_codigo || '-', error: `Error insertando insumos: ${e.message || e}` });
        }
        setProgress({ phase: phaseLabel, current: Math.min(i + ICH, insumoRecords.length), total: insumoRecords.length });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    const aSaltar = comparison.length - aImportar.length - aReemplazar.length;
    const detalle = `${aImportar.length} nuevas, ${aReemplazar.length} reemplazadas, ${aSaltar} saltadas, ${insumosInsertados} insumos${errorList.length ? `, ${errorList.length} errores` : ''}`;
    return {
      tipo: 'apu',
      ok: partidasInsertadas,
      detalle,
      errors: errorList.length,
      errorList: errorList.slice(0, 20),
    };
  }

  // ── Import Lista de Insumos (materiales del almacén) ─────────
  async function importInsumos() {
    const now = new Date().toISOString();
    // Solo importamos los de tipo 'material'. Mano de obra y equipo viven
    // en la tabla personal/herramientas y no se cargan desde aquí.
    const materialesNuevos = parsed.data.filter(i => i.categoria === 'material');
    if (!materialesNuevos.length) {
      throw new Error('No hay insumos de tipo "material" en el archivo.');
    }

    // Cargar materiales existentes de esta obra para upsert por codigo_s10
    const existentes = await window.__db.materiales.where('obra_id').equals(obraId).toArray();
    const porCodigo = new Map(existentes.filter(m => m.codigo_s10).map(m => [m.codigo_s10, m]));

    let creados = 0, actualizados = 0;
    setProgress({ phase:'Cargando insumos…', current:0, total: materialesNuevos.length });

    for (let i = 0; i < materialesNuevos.length; i++) {
      const ins = materialesNuevos[i];
      const existente = porCodigo.get(ins.codigo);
      if (existente) {
        // Actualizar precio y nombre, preservar stock_actual
        await window.__db.materiales.update(existente.id, {
          nombre_material: ins.descripcion,
          precio_unitario_estimado: Number(ins.precio_unitario) || 0,
          updated_at: now, updated_by: userId,
          version: (existente.version ?? 0) + 1,
          sync_status: existente.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
        });
        actualizados++;
      } else {
        const id = window.__newId();
        await window.__db.materiales.add({
          id, obra_id: obraId,
          nombre_material: ins.descripcion,
          codigo_s10: ins.codigo,
          categoria: 'General',
          unidad: ins.unidad || 'und',
          stock_inicial: 0,
          stock_actual: 0,
          stock_minimo: 0,
          precio_unitario_estimado: Number(ins.precio_unitario) || 0,
          alerta: 'sin_stock',
          estado: 'activo',
          created_by: userId, updated_by: userId,
          created_at: now, updated_at: now,
          version: 1, sync_status: 'pending_create', last_synced_at: null,
          idempotency_key: `${userId}_materiales_${id}`,
        });
        creados++;
      }
      if (i % 25 === 0) {
        setProgress({ phase:'Cargando insumos…', current: i+1, total: materialesNuevos.length });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return {
      tipo: 'insumos',
      ok: creados + actualizados,
      detalle: `${creados} materiales nuevos, ${actualizados} actualizados`,
      errors: 0, errorList: [],
    };
  }

  // ── Import Cronograma Gantt (actualiza partidas con fechas) ──
  async function importGantt() {
    const now = new Date().toISOString();
    const partidasObra = await window.__db.partidas.where('obra_id').equals(obraId).toArray();
    if (!partidasObra.length) {
      throw new Error('No hay partidas en esta obra. Importa primero el APU (presupuesto) antes del cronograma.');
    }
    const porCodigo = new Map(partidasObra.map(p => [p.codigo_delfin, p]));

    let actualizadas = 0;
    const noEncontradas = [];
    setProgress({ phase:'Aplicando cronograma…', current:0, total: parsed.data.length });

    for (let i = 0; i < parsed.data.length; i++) {
      const t = parsed.data[i];
      const p = porCodigo.get(t.codigo);
      if (!p) {
        noEncontradas.push({ row: t.codigo, error: `Tarea "${t.descripcion}" no encontrada en partidas` });
        continue;
      }
      await window.__db.partidas.update(p.id, {
        fecha_inicio_planificada: t.fecha_inicio,
        fecha_fin_planificada:    t.fecha_fin,
        duracion_dias: t.duracion_dias,
        predecesoras: t.predecesoras,
        // Si reportan avance > 0 y no tienen estado, marcar 'en_ejecucion'
        ...(t.porcentaje_avance > 0 && p.estado === 'pendiente' ? { estado: 'en_ejecucion' } : {}),
        updated_at: now, updated_by: userId,
        version: (p.version ?? 0) + 1,
        sync_status: p.sync_status === 'pending_create' ? 'pending_create' : 'pending_update',
      });
      actualizadas++;
      if (i % 25 === 0) {
        setProgress({ phase:'Aplicando cronograma…', current: i+1, total: parsed.data.length });
        await new Promise(r => setTimeout(r, 0));
      }
    }
    return {
      tipo: 'gantt',
      ok: actualizadas,
      detalle: `${actualizadas} partidas con fechas planificadas${noEncontradas.length ? ` · ${noEncontradas.length} no encontradas` : ''}`,
      errors: noEncontradas.length,
      errorList: noEncontradas.slice(0, 20),
    };
  }

  // ── Dispatcher de import según tipo ──────────────────────────
  const runImport = async () => {
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    if (!parsed) return;
    showToast('Importación iniciada — no cierres esta ventana', 'amber');
    setImp(true);
    setProgress({ phase:'Preparando…', current:0, total:0 });

    try {
      let res;
      if (parsed.tipo === 'apu') res = await importAPU();
      else if (parsed.tipo === 'insumos') res = await importInsumos();
      else if (parsed.tipo === 'gantt') res = await importGantt();
      else throw new Error('Tipo de archivo no soportado');

      setResult(res);

      const entry = {
        fecha: fmtDate(),
        modulo: `S10 ${parsed.tipo.toUpperCase()} · ${res.detalle}`,
        total: res.ok + (res.errors || 0),
        ok: res.ok,
        errores: res.errors || 0,
        user: userName,
      };
      const newHist = [entry, ...hist].slice(0, 50);
      setHist(newHist);
      localStorage.setItem('importaciones_historial', JSON.stringify(newHist));

      showToast(`Importación ${parsed.tipo}: ${res.detalle}`, res.errors ? 'amber' : 'green');
      try { window.dispatchEvent(new CustomEvent('obra_activa_change', { detail:{ obraId } })); } catch {}
    } catch (e) {
      console.error('[S10 import]', e);
      showToast(`Error en la importación: ${e.message || e}`, 'red');
      setResult({ tipo: parsed?.tipo || '?', ok:0, detalle: e.message, errors:1, errorList:[{ row:'-', error: e.message || String(e) }] });
    } finally {
      setImp(false);
    }
  };

  // ── RESULT SCREEN ──────────────────────────────────────────
  if (result) return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', padding:'30px 20px', gap:18, textAlign:'center' }}>
      <div style={{ width:72, height:72, borderRadius:'50%', background: result.errors ? 'rgba(231,76,60,0.15)' : 'rgba(46,204,113,0.15)', border:`2px solid ${result.errors ? 'var(--red)':'var(--green)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
        <JxIcon name={result.errors?'alert':'checkCircle'} size={32} color={result.errors?'var(--red)':'var(--green)'}/>
      </div>
      <div>
        <div style={{ fontSize:22, fontWeight:800, color:'var(--tp)', marginBottom:6 }}>
          {result.errors === 1 && result.ok === 0 ? 'Importación fallida' : '¡Importación completa!'}
        </div>
        <div style={{ fontSize:13, color:'var(--tm)', maxWidth:520 }}>
          {result.detalle || `Se procesaron ${result.ok} registros.`}
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:12, width:'100%', maxWidth:420 }}>
        <div className="card card-p" style={{ textAlign:'center' }}>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--green)' }}>{result.ok}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>
            {result.tipo === 'apu' ? 'Partidas' : result.tipo === 'insumos' ? 'Materiales' : result.tipo === 'gantt' ? 'Tareas aplicadas' : 'OK'}
          </div>
        </div>
        <div className="card card-p" style={{ textAlign:'center' }}>
          <div style={{ fontSize:24, fontWeight:800, color: result.errors?'var(--red)':'var(--tp)' }}>{result.errors || 0}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>
            {result.tipo === 'gantt' ? 'No encontradas' : 'Errores'}
          </div>
        </div>
      </div>
      {result.errorList.length > 0 && (
        <details style={{ width:'100%', maxWidth:560, textAlign:'left' }}>
          <summary style={{ cursor:'pointer', fontSize:12, color:'var(--red)', fontWeight:600 }}>Ver errores</summary>
          <div style={{ maxHeight:200, overflow:'auto', background:'var(--bg-c)', border:'1px solid var(--border)', borderRadius:8, padding:10, marginTop:6 }}>
            {result.errorList.map((e, i) => (
              <div key={i} style={{ fontSize:11.5, padding:'4px 0', color:'var(--ts)' }}>
                <strong style={{ color:'var(--red)' }}>{e.row}:</strong> {e.error}
              </div>
            ))}
          </div>
        </details>
      )}
      <div style={{ display:'flex', gap:10 }}>
        <button className="btn btn-ghost" onClick={onReset}><JxIcon name="arrowIn" size={13}/>Nueva Importación</button>
      </div>
    </div>
  );

  const STEPS = ['Aviso', 'Archivo', 'Preview', 'Confirmar'];

  return (
    <div>
      <Steps current={step} steps={STEPS} onJump={(i)=> i < step && !importing ? setStep(i) : null}/>

      {/* Step 0 — Aviso */}
      {step === 0 && (
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:6 }}>Importación nativa desde S10</div>
          <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
            Sube un Excel exportado de S10. La app detecta automáticamente el tipo de archivo:
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:10, marginBottom:14 }}>
            <div className="card card-p" style={{ borderLeft:'3px solid #0070C0' }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)', marginBottom:4, display:'flex', alignItems:'center', gap:6 }}>
                <JxIcon name="dollar" size={13} color="#0070C0"/> Presupuesto APU
              </div>
              <div style={{ fontSize:11.5, color:'var(--tm)' }}>
                "Análisis de Precios Unitarios" o "Consolidado de Materiales del Presupuesto" — partidas + insumos por partida.
                <strong style={{ color:'var(--amber)' }}> Reemplaza</strong> las partidas existentes de la obra.
              </div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--blue)' }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)', marginBottom:4, display:'flex', alignItems:'center', gap:6 }}>
                <JxIcon name="package" size={13} color="var(--blue)"/> Lista de Insumos
              </div>
              <div style={{ fontSize:11.5, color:'var(--tm)' }}>
                Listado consolidado con precios unitarios. Carga los <strong>materiales</strong> al almacén
                (upsert por código S10, stock inicial 0).
              </div>
            </div>
            <div className="card card-p" style={{ borderLeft:'3px solid var(--green)' }}>
              <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)', marginBottom:4, display:'flex', alignItems:'center', gap:6 }}>
                <JxIcon name="gantt" size={13} color="var(--green)"/> Cronograma Gantt
              </div>
              <div style={{ fontSize:11.5, color:'var(--tm)' }}>
                Tareas con fechas planificadas. Aplica <strong>fecha_inicio</strong>, <strong>fecha_fin</strong> y
                duración a las partidas existentes (matching por código). Requiere haber importado el APU primero.
              </div>
            </div>
          </div>

          {/* Selector de obra destino — el usuario decide a cuál importa */}
          <div className="card card-p" style={{ marginBottom:14, background:'rgba(52,152,219,0.06)', border:'1px solid rgba(52,152,219,0.25)' }}>
            <label className="flabel" style={{ marginBottom:6, display:'block' }}>
              <JxIcon name="building" size={12}/> Obra destino
            </label>
            {obrasDisponibles.length === 0 ? (
              <div style={{ fontSize:12, color:'var(--red)', marginTop:4 }}>
                ⚠ No hay obras creadas. Ve a <strong>Obras / Proyectos</strong> y crea una antes de importar.
              </div>
            ) : (
              <>
                <select className="fi" value={obraId || ''} onChange={e => setObraId(e.target.value || null)}>
                  {obrasDisponibles.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.nombre_obra || o.nombre || '(sin nombre)'}
                      {o.cliente ? ` — ${o.cliente}` : ''}
                    </option>
                  ))}
                </select>
                <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:6 }}>
                  Los datos importados se asociarán a esta obra. {obrasDisponibles.length} obra{obrasDisponibles.length === 1 ? '' : 's'} disponible{obrasDisponibles.length === 1 ? '' : 's'}.
                </div>
              </>
            )}
          </div>

          <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:12.5, color:'var(--ts)', cursor:'pointer', marginBottom:18 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            Entiendo el comportamiento de cada tipo y deseo continuar.
          </label>

          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <button className="btn btn-ghost" onClick={onReset}><JxIcon name="chevL" size={14}/>Cancelar</button>
            <button className="btn btn-amber" disabled={!confirmed || !obraId} onClick={()=>setStep(1)} style={{ opacity:(confirmed && obraId)?1:.4 }}>
              Siguiente <JxIcon name="chevR" size={14}/>
            </button>
          </div>
        </div>
      )}

      {/* Step 1 — Archivo */}
      {step === 1 && (
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:6 }}>Sube el Excel exportado por S10</div>
          <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
            Acepta el export de "Análisis de Precios Unitarios" o "Consolidado de Materiales" (.xlsx / .xls).
          </div>

          <DropZone onFile={setFile} file={file} accept=".xlsx,.xls"/>

          {parsing && (
            <div style={{ marginTop:14, background:'rgba(52,152,219,0.08)', border:'1px solid rgba(52,152,219,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--blue)' }}>
              <span style={{ display:'inline-block', width:12,height:12,borderRadius:'50%',border:'2px solid rgba(52,152,219,0.4)',borderTopColor:'var(--blue)',marginRight:8,animation:'spin .7s linear infinite', verticalAlign:'middle' }}/>
              Analizando estructura del archivo…
            </div>
          )}

          {parseErr && (
            <div style={{ marginTop:14, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--red)' }}>
              ⚠ {parseErr}
            </div>
          )}

          {parsed && !parsing && (
            <div style={{ marginTop:14, background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'12px 16px', fontSize:12.5, color:'var(--green)', display:'flex', gap:10, alignItems:'center' }}>
              <JxIcon name="checkCircle" size={14} color="var(--green)"/>
              <span>
                {parsed.tipo === 'apu' && <><strong>APU detectado:</strong> {parsed.summary.partidas} partidas · {parsed.summary.insumos} insumos</>}
                {parsed.tipo === 'insumos' && <><strong>Lista de insumos:</strong> {parsed.summary.total} ({parsed.summary.materiales} materiales · {parsed.summary.mano_obra} MO · {parsed.summary.equipo} equipo)</>}
                {parsed.tipo === 'gantt' && <><strong>Cronograma Gantt:</strong> {parsed.summary.total} tareas · {parsed.summary.fecha_inicio} → {parsed.summary.fecha_fin}</>}
                <span style={{ color:'var(--tm)' }}> · parseado en {parsed.parseMs}ms</span>
              </span>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', marginTop:20 }}>
            <button className="btn btn-ghost" onClick={()=>setStep(0)}><JxIcon name="chevL" size={14}/>Atrás</button>
            <button className="btn btn-amber" disabled={!parsed} onClick={()=>setStep(2)} style={{ opacity:parsed?1:.4 }}>Siguiente <JxIcon name="chevR" size={14}/></button>
          </div>
        </div>
      )}

      {/* Step 2 — Preview (UI por tipo) */}
      {step === 2 && parsed && (
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:6 }}>
            Preview — {parsed.tipo === 'apu' ? 'Presupuesto APU' : parsed.tipo === 'insumos' ? 'Lista de Insumos' : 'Cronograma Gantt'}
          </div>
          <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
            {parsed.tipo === 'apu' && 'Verifica las partidas y el detalle de insumos por categoría.'}
            {parsed.tipo === 'insumos' && 'Estos insumos se cargarán como Materiales del almacén (solo los de tipo material). El stock inicial será 0.'}
            {parsed.tipo === 'gantt' && 'Las fechas se aplicarán a las partidas existentes que coincidan en código. Las que no se encuentren se reportarán al final.'}
          </div>

          {/* === APU PREVIEW (wizard de comparación) === */}
          {parsed.tipo === 'apu' && (
            <>
              {comparing && (
                <div style={{ marginBottom:14, background:'rgba(52,152,219,0.08)', border:'1px solid rgba(52,152,219,0.25)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--blue)' }}>
                  <span style={{ display:'inline-block', width:12,height:12,borderRadius:'50%',border:'2px solid rgba(52,152,219,0.4)',borderTopColor:'var(--blue)',marginRight:8,animation:'spin .7s linear infinite', verticalAlign:'middle' }}/>
                  Comparando {parsed.summary.partidas} partidas con la obra…
                </div>
              )}
              {compareErr && (
                <div style={{ marginBottom:14, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--red)' }}>
                  ⚠ {compareErr}
                </div>
              )}

              {!comparing && !compareErr && (
                <>
                  {/* KPIs */}
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:14 }}>
                    <div className="card card-p" style={{ textAlign:'center', borderLeft:'3px solid var(--green)' }}>
                      <div style={{ fontSize:22, fontWeight:800, color:'var(--green)' }}>{kpis.nuevas}</div>
                      <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Nuevas</div>
                    </div>
                    <div className="card card-p" style={{ textAlign:'center', borderLeft:'3px solid var(--tm)' }}>
                      <div style={{ fontSize:22, fontWeight:800, color:'var(--ts)' }}>{kpis.iguales}</div>
                      <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Duplicadas iguales</div>
                    </div>
                    <div className="card card-p" style={{ textAlign:'center', borderLeft:'3px solid var(--amber)' }}>
                      <div style={{ fontSize:22, fontWeight:800, color:'var(--amber)' }}>{kpis.distintas}</div>
                      <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Duplicadas distintas</div>
                    </div>
                  </div>

                  {/* Filtros */}
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                    <div style={{ position:'relative', flex:'1 1 220px', minWidth:200 }}>
                      <span style={{ position:'absolute', left:10, top:'50%', transform:'translateY(-50%)' }}>
                        <JxIcon name="search" size={13} color="var(--tm)"/>
                      </span>
                      <input
                        className="fi"
                        placeholder="Buscar por código o descripción…"
                        value={filterText}
                        onChange={e=>setFilterText(e.target.value)}
                        style={{ paddingLeft:30, width:'100%' }}
                      />
                    </div>
                    <select className="fi" value={filterMode} onChange={e=>setFilterMode(e.target.value)} style={{ minWidth:160 }}>
                      <option value="todas">Mostrar: todas</option>
                      <option value="nuevas">Solo nuevas</option>
                      <option value="duplicadas">Solo duplicadas</option>
                    </select>
                  </div>

                  {/* Bulk actions */}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={()=>bulkAction(c => c.status === 'nueva', 'importar')}
                      title="Marcar todas las partidas nuevas como Importar"
                    >
                      <JxIcon name="plus" size={12}/> Importar todas las nuevas ({kpis.nuevas})
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={()=>bulkAction(c => c.status === 'duplicada_igual', 'saltar')}
                    >
                      <JxIcon name="x" size={12}/> Saltar todas las iguales ({kpis.iguales})
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={()=>bulkAction(c => c.status === 'duplicada_distinta', 'reemplazar')}
                    >
                      <JxIcon name="refresh" size={12}/> Reemplazar todas las distintas ({kpis.distintas})
                    </button>
                  </div>

                  {/* Resumen actual de acciones */}
                  <div style={{ fontSize:11.5, color:'var(--tm)', marginBottom:10 }}>
                    Acciones actuales: <strong style={{ color:'var(--green)' }}>{actionSummary.aImportar} importar</strong>
                    {' · '}<strong style={{ color:'var(--amber)' }}>{actionSummary.aReemplazar} reemplazar</strong>
                    {' · '}<strong style={{ color:'var(--ts)' }}>{actionSummary.aSaltar} saltar</strong>
                    {' · '}<span>{filtered.length} visibles tras filtro</span>
                  </div>

                  {/* Tabla paginada */}
                  <div className="card" style={{ overflow:'hidden', marginBottom:14 }}>
                    <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11.5, fontWeight:600, color:'var(--tm)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                      <div><JxIcon name="list" size={13}/> Partidas del archivo ({filtered.length})</div>
                      {filtered.length > PAGE_SIZE && (
                        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                          <button className="btn btn-ghost btn-sm" disabled={page === 0} onClick={()=>setPage(p=>Math.max(0, p-1))}>
                            <JxIcon name="chevL" size={12}/>
                          </button>
                          <span style={{ fontSize:11 }}>Pág {page+1} / {Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))}</span>
                          <button className="btn btn-ghost btn-sm" disabled={(page+1) * PAGE_SIZE >= filtered.length} onClick={()=>setPage(p=>p+1)}>
                            <JxIcon name="chevR" size={12}/>
                          </button>
                        </div>
                      )}
                    </div>
                    <div style={{ overflowX:'auto', maxHeight:480 }}>
                      <table className="tbl">
                        <thead><tr>
                          <th style={{ minWidth:130 }}>Estado</th>
                          <th style={{ minWidth:120 }}>Código</th>
                          <th>Descripción</th>
                          <th style={{ textAlign:'right' }}>Costo total</th>
                          <th style={{ minWidth:200 }}>Acción</th>
                        </tr></thead>
                        <tbody>
                          {filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map((c, i) => {
                            const badgeClass = c.status === 'nueva' ? 'b-green'
                                             : c.status === 'duplicada_igual' ? 'b-gray'
                                             : 'b-amber';
                            const badgeText = c.status === 'nueva' ? 'Nueva'
                                            : c.status === 'duplicada_igual' ? 'Duplicada igual'
                                            : 'Duplicada distinta';
                            return (
                              <tr key={c.codigo + '_' + i}>
                                <td>
                                  <span className={`badge ${badgeClass}`}>{badgeText}</span>
                                </td>
                                <td className="col-m" style={{ fontFamily:'monospace', fontSize:11 }}>{c.codigo}</td>
                                <td style={{ fontSize:11.5 }}>{c.descripcion}</td>
                                <td className="col-num" style={{ textAlign:'right' }}>
                                  <div>S/ {c.costo_total.toFixed(2)}</div>
                                  {c.existente && (
                                    <div style={{ fontSize:10, color: c.status === 'duplicada_distinta' ? 'var(--amber)' : 'var(--tm)' }}>
                                      actual: S/ {Number(c.existente.costo_total_presupuestado || 0).toFixed(2)}
                                    </div>
                                  )}
                                </td>
                                <td>
                                  <select
                                    className="fi"
                                    value={c.action}
                                    onChange={e=>setActionForRow(c.codigo, e.target.value)}
                                    style={{ fontSize:11.5, padding:'4px 6px' }}
                                  >
                                    <option value="importar" disabled={!!c.existente}>Importar como nueva</option>
                                    <option value="reemplazar" disabled={!c.existente}>Reemplazar existente</option>
                                    <option value="saltar">Saltar</option>
                                  </select>
                                </td>
                              </tr>
                            );
                          })}
                          {filtered.length === 0 && (
                            <tr><td colSpan={5} style={{ padding:'20px', textAlign:'center', color:'var(--tm)', fontSize:12 }}>No hay partidas que coincidan con el filtro.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* === INSUMOS PREVIEW === */}
          {parsed.tipo === 'insumos' && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 }}>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:22, fontWeight:800, color:'var(--tp)' }}>{parsed.summary.total}</div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Total</div>
                </div>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:22, fontWeight:800, color:'var(--blue)' }}>{parsed.summary.materiales}</div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Materiales</div>
                </div>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:22, fontWeight:800, color:'var(--green)' }}>{parsed.summary.mano_obra}</div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Mano de Obra</div>
                </div>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:22, fontWeight:800, color:'var(--orange)' }}>{parsed.summary.equipo}</div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Equipo</div>
                </div>
              </div>
              <div className="card" style={{ overflow:'hidden', marginBottom:14 }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11.5, fontWeight:600, color:'var(--tm)' }}>
                  <JxIcon name="eye" size={13}/> Primeros 15 materiales (lo que se importará al almacén)
                </div>
                <div style={{ overflowX:'auto', maxHeight:380 }}>
                  <table className="tbl">
                    <thead><tr>
                      <th>Código</th><th>Descripción</th>
                      <th style={{ textAlign:'right' }}>Cant. Total</th>
                      <th style={{ textAlign:'right' }}>Precio Unit.</th>
                      <th style={{ textAlign:'right' }}>Total Pres.</th>
                    </tr></thead>
                    <tbody>
                      {parsed.data.filter(i => i.categoria === 'material').slice(0, 15).map((ins, i) => (
                        <tr key={i}>
                          <td className="col-m" style={{ fontFamily:'monospace', fontSize:11 }}>{ins.codigo}</td>
                          <td style={{ fontSize:11.5 }}>{ins.descripcion}</td>
                          <td className="col-num" style={{ textAlign:'right' }}>{Number(ins.cantidad_total).toFixed(2)}</td>
                          <td className="col-num" style={{ textAlign:'right' }}>S/ {Number(ins.precio_unitario).toFixed(2)}</td>
                          <td className="col-num" style={{ textAlign:'right' }}>S/ {Number(ins.total).toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* === GANTT PREVIEW === */}
          {parsed.tipo === 'gantt' && (
            <>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, marginBottom:14 }}>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:22, fontWeight:800, color:'var(--tp)' }}>{parsed.summary.total}</div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Tareas</div>
                </div>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--blue)', marginTop:6 }}>{parsed.summary.fecha_inicio || '—'}</div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:6, textTransform:'uppercase' }}>Inicio</div>
                </div>
                <div className="card card-p" style={{ textAlign:'center' }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'var(--orange)', marginTop:6 }}>{parsed.summary.fecha_fin || '—'}</div>
                  <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:6, textTransform:'uppercase' }}>Fin</div>
                </div>
              </div>
              <div className="card" style={{ overflow:'hidden', marginBottom:14 }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11.5, fontWeight:600, color:'var(--tm)' }}>
                  <JxIcon name="eye" size={13}/> Primeras 12 tareas del cronograma
                </div>
                <div style={{ overflowX:'auto', maxHeight:380 }}>
                  <table className="tbl">
                    <thead><tr>
                      <th style={{ minWidth:120 }}>Código</th><th>Descripción</th>
                      <th style={{ textAlign:'right' }}>Días</th>
                      <th>Inicio</th><th>Fin</th>
                      <th style={{ textAlign:'right' }}>Avance</th>
                    </tr></thead>
                    <tbody>
                      {parsed.data.slice(0, 12).map((t, i) => (
                        <tr key={i}>
                          <td className="col-m" style={{ fontFamily:'monospace', fontSize:11 }}>{t.codigo}</td>
                          <td style={{ fontSize:11.5 }}>{t.descripcion}</td>
                          <td className="col-num" style={{ textAlign:'right' }}>{t.duracion_dias ?? '—'}</td>
                          <td className="col-m" style={{ fontSize:11 }}>{t.fecha_inicio || '—'}</td>
                          <td className="col-m" style={{ fontSize:11 }}>{t.fecha_fin || '—'}</td>
                          <td className="col-num" style={{ textAlign:'right' }}>{Number(t.porcentaje_avance || 0).toFixed(0)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <button className="btn btn-ghost" onClick={()=>setStep(1)}><JxIcon name="chevL" size={14}/>Atrás</button>
            <button
              className="btn btn-amber"
              disabled={parsed.tipo === 'apu' && comparing}
              style={{ opacity:(parsed.tipo === 'apu' && comparing)?0.4:1 }}
              onClick={()=>setStep(3)}
            >Siguiente <JxIcon name="chevR" size={14}/></button>
          </div>
        </div>
      )}

      {/* Step 3 — Confirmar e importar */}
      {step === 3 && parsed && (
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:6 }}>Confirmar y ejecutar importación</div>
          <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
            {parsed.tipo === 'apu' && (
              <>Al confirmar se aplicarán las acciones elegidas: <strong style={{ color:'var(--green)' }}>importar {actionSummary.aImportar} nuevas</strong> · <strong style={{ color:'var(--amber)' }}>reemplazar {actionSummary.aReemplazar}</strong> · <strong style={{ color:'var(--ts)' }}>saltar {actionSummary.aSaltar}</strong>.</>
            )}
            {parsed.tipo === 'insumos' && 'Al confirmar, se cargarán los materiales al almacén. Los que ya existan (mismo código S10) se actualizarán; los demás se crearán con stock 0.'}
            {parsed.tipo === 'gantt' && 'Al confirmar, se aplicarán las fechas planificadas a las partidas existentes que coincidan en código. No se crearán partidas nuevas.'}
          </div>

          <div className="card card-p" style={{ marginBottom:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {(() => {
                const filas = [
                  { label:'Origen', val: parsed.tipo === 'apu' ? 'S10 · Presupuesto APU'
                                       : parsed.tipo === 'insumos' ? 'S10 · Lista de Insumos'
                                       : 'S10 · Cronograma Gantt',
                    icon:'dollar', color:'#0070C0' },
                  { label:'Archivo', val:file?.name, icon:'file', color:'var(--green)' },
                  { label:'Obra destino', val: obraDestino ? (obraDestino.nombre_obra || obraDestino.nombre) : (obraId ? `${obraId.slice(0,8)}…` : '—'), icon:'building', color:'var(--orange)' },
                ];
                if (parsed.tipo === 'apu') {
                  filas.push(
                    { label:'Importar nuevas', val: actionSummary.aImportar, icon:'plus', color:'var(--green)' },
                    { label:'Reemplazar', val: actionSummary.aReemplazar, icon:'refresh', color:'var(--amber)' },
                    { label:'Saltar', val: actionSummary.aSaltar, icon:'x', color:'var(--ts)' },
                  );
                } else if (parsed.tipo === 'insumos') {
                  filas.push(
                    { label:'Materiales a cargar', val: parsed.summary.materiales, icon:'package', color:'var(--blue)' },
                    { label:'Mano de obra (no se importa)', val: parsed.summary.mano_obra, icon:'users', color:'var(--tm)' },
                    { label:'Modo', val:'Upsert por código S10', icon:'refresh', color:'var(--amber)' },
                  );
                } else if (parsed.tipo === 'gantt') {
                  filas.push(
                    { label:'Tareas', val: parsed.summary.total, icon:'gantt', color:'var(--tp)' },
                    { label:'Rango fechas', val: `${parsed.summary.fecha_inicio} → ${parsed.summary.fecha_fin}`, icon:'calendar', color:'var(--blue)' },
                    { label:'Modo', val:'Update partidas por código', icon:'refresh', color:'var(--amber)' },
                  );
                }
                return filas.map((r,i)=>(
                  <div key={i} style={{ display:'flex', gap:10, alignItems:'center' }}>
                    <div style={{ width:32, height:32, borderRadius:7, background:`${r.color}18`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <JxIcon name={r.icon} size={14} color={r.color}/>
                    </div>
                    <div>
                      <div style={{ fontSize:10, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em' }}>{r.label}</div>
                      <div style={{ fontSize:13, fontWeight:600, color:'var(--tp)' }}>{r.val}</div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>

          {importing && (
            <div className="card card-p" style={{ marginBottom:14, borderLeft:'3px solid var(--amber)' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'var(--tp)' }}>
                  <span style={{ display:'inline-block', width:12,height:12,borderRadius:'50%',border:'2px solid rgba(242,183,5,0.4)',borderTopColor:'var(--amber)',marginRight:8,animation:'spin .7s linear infinite', verticalAlign:'middle' }}/>
                  {progress.phase || 'Procesando…'}
                </div>
                <div style={{ fontSize:12, color:'var(--tm)', fontVariantNumeric:'tabular-nums' }}>
                  {progress.total > 0 ? `${progress.current} / ${progress.total}` : ''}
                </div>
              </div>
              <div style={{ width:'100%', height:10, background:'var(--bg-c)', borderRadius:5, overflow:'hidden' }}>
                <div style={{ width:`${progress.total?(progress.current/progress.total*100):0}%`, height:'100%', background:'var(--amber)', transition:'width .2s' }}/>
              </div>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:6 }}>
                No cierres esta ventana hasta que termine.
              </div>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <button className="btn btn-ghost" onClick={()=>setStep(2)} disabled={importing}><JxIcon name="chevL" size={14}/>Atrás</button>
            <button className="btn btn-amber" onClick={runImport} disabled={importing || (parsed.tipo === 'apu' && actionSummary.aProcesar === 0)} style={{ minWidth:240, justifyContent:'center', opacity: (parsed.tipo === 'apu' && actionSummary.aProcesar === 0) ? 0.4 : 1 }}>
              {importing
                ? <><span style={{ width:14,height:14,borderRadius:'50%',border:'2px solid rgba(0,0,0,0.3)',borderTopColor:'rgba(0,0,0,0.8)',display:'inline-block',animation:'spin .7s linear infinite' }}/>Importando…</>
                : <><JxIcon name="upload" size={14}/>{
                    parsed.tipo === 'apu' ? `Importar ${actionSummary.aProcesar} partidas`
                    : parsed.tipo === 'insumos' ? `Cargar ${parsed.summary.materiales} materiales`
                    : `Aplicar cronograma a ${parsed.summary.total} tareas`
                  }</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN PAGE ────────────────────────────────────────────────
function ImportarPage({ showToast }) {
  const auth = window.__useAuth?.();
  const userId = auth?.profile?.id || 'offline';
  const isAdmin = auth?.profile?.rol === 'admin';
  const obraId = useObraActiva();

  const [tab, setTab] = uSI('importar');
  const [step, setStep] = uSI(0);
  const [srcId, setSrc] = uSI(null);
  const [modId, setMod] = uSI(null);
  const [file, setFile] = uSI(null);
  const [parsed, setParsed] = uSI(null); // { headers, rows, sheetName }
  const [parseErr, setParseErr] = uSI(null);
  const [mapping, setMapping] = uSI({});
  const [importing, setImp] = uSI(false);
  const [progress, setProgress] = uSI({ current:0, total:0 });
  const [result, setResult] = uSI(null); // { ok, errors, errorList }
  const [hist, setHist] = uSI(() => {
    try { return JSON.parse(localStorage.getItem('importaciones_historial') || '[]'); }
    catch { return []; }
  });

  const STEPS = ['Origen','Módulo','Archivo','Mapeo','Confirmar'];
  const src = SOURCES.find(s => s.id === srcId);
  const modMeta = MOD_META.find(m => m.id === modId);
  const modCfg = modId && window.__excel?.MODULES?.[modId];

  const reset = () => {
    setStep(0); setSrc(null); setMod(null); setFile(null);
    setParsed(null); setParseErr(null); setMapping({});
    setImp(false); setProgress({ current:0, total:0 }); setResult(null);
  };

  // Parse on file change
  uEI(() => {
    if (!file) { setParsed(null); setParseErr(null); return; }
    if (file.size > 10 * 1024 * 1024) {
      setParseErr('El archivo excede 10MB'); setParsed(null); return;
    }
    setParseErr(null);
    window.__excel.parseExcelFile(file)
      .then(p => {
        setParsed(p);
        if (modCfg) setMapping(autoMap(modCfg.fields, p.headers));
      })
      .catch(e => { setParseErr(e.message || 'Error al leer archivo'); setParsed(null); });
  }, [file]);

  // Re-auto-map when module changes after file is parsed
  uEI(() => {
    if (parsed && modCfg) setMapping(autoMap(modCfg.fields, parsed.headers));
  }, [modId]);

  const requiredOk = uMI(() => {
    if (!modCfg) return false;
    return modCfg.requiredFields.every(f => mapping[f]);
  }, [mapping, modCfg]);

  const transformedRows = uMI(() => {
    if (!parsed || !modCfg) return [];
    return parsed.rows.map(r => modCfg.transform(applyMapping(r, mapping)));
  }, [parsed, mapping, modCfg]);

  const validation = uMI(() => {
    if (!parsed || !modCfg) return { ok:0, errors:0, errorList:[] };
    let ok = 0, errors = 0;
    const errorList = [];
    transformedRows.forEach((row, i) => {
      const errs = validateRow(row, modId, modCfg);
      if (errs.length) { errors++; errorList.push({ row:i+2, errs }); }
      else ok++;
    });
    return { ok, errors, errorList };
  }, [transformedRows, modId, modCfg, parsed]);

  // ── EXECUTE IMPORT ─────────────────────────────────────────
  const runImport = async () => {
    if (!modCfg) return;
    if (NEEDS_OBRA(modId) && !obraId) {
      showToast('No hay obra activa para asignar los registros', 'red');
      return;
    }
    setImp(true);
    setProgress({ current:0, total: transformedRows.length });
    let okCount = 0;
    const errorList = [];
    const now = new Date().toISOString();

    for (let i = 0; i < transformedRows.length; i++) {
      const row = transformedRows[i];
      const errs = validateRow(row, modId, modCfg);
      if (errs.length) {
        errorList.push({ row:i+2, error: errs.join('; ') });
      } else {
        try {
          const record = {
            ...row,
            id: window.__newId(),
            ...(NEEDS_OBRA(modId) ? { obra_id: obraId } : {}),
            created_by: userId,
            updated_by: userId,
            created_at: now,
            updated_at: now,
            version: 1,
            sync_status: 'pending_create',
            last_synced_at: null,
          };
          await window.__db[modCfg.table].add(record);
          okCount++;
        } catch (e) {
          errorList.push({ row:i+2, error: e.message || 'Error al insertar' });
        }
      }
      setProgress({ current:i+1, total: transformedRows.length });
      if (i % 25 === 0) await new Promise(r => setTimeout(r, 0));
    }

    const res = { ok: okCount, errors: errorList.length, errorList };
    setResult(res);
    setImp(false);

    // Save to history
    const entry = {
      fecha: fmtDate(),
      modulo: modMeta.label,
      total: transformedRows.length,
      ok: okCount,
      errores: errorList.length,
      user: auth?.profile?.nombre || auth?.profile?.email || 'offline',
    };
    const newHist = [entry, ...hist].slice(0, 50);
    setHist(newHist);
    localStorage.setItem('importaciones_historial', JSON.stringify(newHist));

    showToast(`Importación: ${okCount} OK · ${errorList.length} errores`, errorList.length ? 'amber' : 'green');
  };

  // ── RESULT SCREEN ──────────────────────────────────────────
  if (result) return (
    <div className="page-wrap">
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 20px', gap:18, textAlign:'center' }}>
        <div style={{ width:72, height:72, borderRadius:'50%', background: result.errors ? 'rgba(242,183,5,0.15)' : 'rgba(46,204,113,0.15)', border:`2px solid ${result.errors ? 'var(--amber)':'var(--green)'}`, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <JxIcon name={result.errors?'alert':'checkCircle'} size={32} color={result.errors?'var(--amber)':'var(--green)'}/>
        </div>
        <div>
          <div style={{ fontSize:22, fontWeight:800, color:'var(--tp)', marginBottom:6 }}>
            {result.errors ? 'Importación con advertencias' : '¡Importación exitosa!'}
          </div>
          <div style={{ fontSize:13, color:'var(--tm)', maxWidth:500 }}>
            Se procesaron {result.ok + result.errors} filas de <strong style={{ color:'var(--ts)' }}>{modMeta.label}</strong> hacia JARVEX.
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, width:'100%', maxWidth:480 }}>
          <div className="card card-p" style={{ textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:800, color:'var(--green)' }}>{result.ok}</div>
            <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Importados</div>
          </div>
          <div className="card card-p" style={{ textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:800, color:'var(--amber)' }}>{result.errors}</div>
            <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Con errores</div>
          </div>
          <div className="card card-p" style={{ textAlign:'center' }}>
            <div style={{ fontSize:24, fontWeight:800, color:'var(--tp)' }}>{result.ok + result.errors}</div>
            <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Total</div>
          </div>
        </div>
        {result.errorList.length > 0 && (
          <details style={{ width:'100%', maxWidth:560, textAlign:'left' }}>
            <summary style={{ cursor:'pointer', fontSize:12, color:'var(--amber)', fontWeight:600, padding:'8px 0' }}>
              Ver {result.errorList.length} errores
            </summary>
            <div style={{ maxHeight:240, overflow:'auto', background:'var(--bg-c)', border:'1px solid var(--border)', borderRadius:8, padding:10 }}>
              {result.errorList.map((e, i) => (
                <div key={i} style={{ fontSize:11.5, padding:'4px 0', borderBottom:'1px solid var(--border)', color:'var(--ts)' }}>
                  <strong style={{ color:'var(--red)' }}>Fila {e.row}:</strong> {e.error || (e.errs && e.errs.join('; '))}
                </div>
              ))}
            </div>
          </details>
        )}
        <div style={{ display:'flex', gap:10 }}>
          <button className="btn btn-ghost" onClick={reset}><JxIcon name="arrowIn" size={13}/>Nueva Importación</button>
          <button className="btn btn-amber" onClick={()=>setTab('historial')}><JxIcon name="eye" size={13}/>Ver Historial</button>
        </div>
      </div>
    </div>
  );

  // Banner informativo si el usuario no es admin (en lugar de bloquear).
  // Las RLS de Supabase rechazarán INSERTs si no tiene permiso, pero al
  // menos puede ver la pantalla.
  const showNoAdminBanner = auth?.profile && !isAdmin;

  return (
    <div className="page-wrap">
      {showNoAdminBanner && (
        <div className="alert-banner" style={{ marginBottom:14, background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.25)', color:'var(--amber)' }}>
          <JxIcon name="alert" size={14} color="var(--amber)"/>
          <span>Tu rol ({auth.profile.rol || '—'}) probablemente no tenga permiso para guardar la importación al servidor. Si falla, pide al admin que importe.</span>
        </div>
      )}
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Importar Datos</div>
          <div className="pg-sub">Importa Excel/CSV a Materiales, Personal, Partidas, Proveedores o Herramientas</div>
        </div>
        <div style={{ display:'flex', gap:4, background:'var(--bg-s)', padding:4, borderRadius:8 }}>
          {['importar','historial','plantillas'].map(t => (
            <button key={t} onClick={()=>setTab(t)} className={`btn ${tab===t?'btn-amber':'btn-ghost'} btn-sm`} style={{ border:'none', textTransform:'capitalize' }}>
              {t==='importar'?'Importar':t==='historial'?'Historial':'Plantillas'}
            </button>
          ))}
        </div>
      </div>

      {/* ───────── TAB: IMPORTAR ───────── */}
      {tab === 'importar' && srcId === 's10' && step >= 1 && (
        <div style={{ maxWidth:880, margin:'0 auto' }}>
          <S10Flow
            obraId={obraId}
            userId={userId}
            userName={auth?.profile?.nombre || auth?.profile?.email || 'offline'}
            showToast={showToast}
            onReset={reset}
            hist={hist}
            setHist={setHist}
          />
        </div>
      )}

      {tab === 'importar' && !(srcId === 's10' && step >= 1) && (
        <div style={{ maxWidth:880, margin:'0 auto' }}>
          <Steps current={step} steps={STEPS} onJump={(i)=>setStep(i)}/>

          {/* Step 0 — Origen */}
          {step === 0 && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:4 }}>¿Desde dónde quieres importar?</div>
              <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>Solo Excel/CSV está disponible. Las demás integraciones llegarán pronto.</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {SOURCES.map(s => (
                  <button key={s.id} onClick={()=>s.enabled && setSrc(s.id)} disabled={!s.enabled}
                    style={{ background:srcId===s.id?'rgba(242,183,5,0.1)':'var(--bg-c)', border:`2px solid ${srcId===s.id?'var(--amber)':'var(--border)'}`, borderRadius:10, padding:'18px 20px', cursor:s.enabled?'pointer':'not-allowed', textAlign:'left', transition:'all .18s', display:'flex', gap:14, alignItems:'flex-start', opacity:s.enabled?1:.5 }}>
                    <div style={{ width:44, height:44, borderRadius:10, background:`${s.color}20`, border:`1px solid ${s.color}40`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <JxIcon name={s.icon} size={20} color={s.color}/>
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                        <span style={{ fontSize:14, fontWeight:700, color:srcId===s.id?'var(--amber)':'var(--tp)' }}>{s.label}</span>
                        {s.enabled
                          ? <span className="badge b-amber" style={{ fontSize:9.5 }}>{s.badge}</span>
                          : <span className="badge b-gray" style={{ fontSize:9.5 }}>Próximamente</span>}
                      </div>
                      <div style={{ fontSize:12, color:'var(--tm)', lineHeight:1.5 }}>{s.desc}</div>
                      <div style={{ fontSize:11, color:'var(--tm)', marginTop:5 }}>Formatos: <span style={{ color:'var(--ts)' }}>{s.ext}</span></div>
                    </div>
                    {srcId===s.id && <JxIcon name="checkCircle" size={18} color="var(--amber)"/>}
                  </button>
                ))}
              </div>
              <div style={{ display:'flex', justifyContent:'flex-end', marginTop:20 }}>
                <button className="btn btn-amber" disabled={!srcId} onClick={()=>setStep(1)} style={{ opacity:srcId?1:.4 }}>
                  Siguiente <JxIcon name="chevR" size={14}/>
                </button>
              </div>
            </div>
          )}

          {/* Step 1 — Módulo */}
          {step === 1 && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:4 }}>¿Qué módulo destino?</div>
              <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>Selecciona dónde se cargarán los registros del Excel/CSV.</div>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {MOD_META.map(m => (
                  <div key={m.id}
                    style={{ background:modId===m.id?'rgba(242,183,5,0.1)':'var(--bg-c)', border:`1.5px solid ${modId===m.id?'var(--amber)':'var(--border)'}`, borderRadius:8, padding:'14px 18px', display:'flex', alignItems:'center', gap:12, transition:'all .15s' }}>
                    <button onClick={()=>setMod(m.id)} style={{ background:'none', border:'none', cursor:'pointer', display:'flex', alignItems:'center', gap:12, flex:1, textAlign:'left', padding:0 }}>
                      <div style={{ width:36, height:36, borderRadius:8, background:`${m.color}18`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <JxIcon name={m.icon} size={16} color={m.color}/>
                      </div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:modId===m.id?'var(--amber)':'var(--tp)' }}>{m.label}</div>
                        <div style={{ fontSize:11.5, color:'var(--tm)', marginTop:2 }}>{m.desc}</div>
                      </div>
                      {modId===m.id && <JxIcon name="check" size={16} color="var(--amber)"/>}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={(e)=>{ e.stopPropagation(); try { window.__excel.downloadTemplate(m.id); showToast('Plantilla descargada','green'); } catch(err) { showToast(err.message,'red'); } }}>
                      <JxIcon name="download" size={12}/>Plantilla
                    </button>
                  </div>
                ))}
              </div>
              {modId && NEEDS_OBRA(modId) && !obraId && (
                <div style={{ marginTop:14, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--red)' }}>
                  ⚠ No hay obra activa registrada. Crea una obra antes de importar este módulo.
                </div>
              )}
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:20 }}>
                <button className="btn btn-ghost" onClick={()=>setStep(0)}><JxIcon name="chevL" size={14}/>Atrás</button>
                <button className="btn btn-amber" disabled={!modId} onClick={()=>setStep(2)} style={{ opacity:modId?1:.4 }}>Siguiente <JxIcon name="chevR" size={14}/></button>
              </div>
            </div>
          )}

          {/* Step 2 — Subir archivo */}
          {step === 2 && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:4 }}>Sube tu archivo</div>
              <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
                Importando <strong style={{ color:'var(--ts)' }}>{modMeta?.label}</strong>. La primera fila debe contener los encabezados.
              </div>

              <DropZone onFile={setFile} file={file}/>

              {parseErr && (
                <div style={{ marginTop:14, background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--red)' }}>
                  ⚠ {parseErr}
                </div>
              )}

              {parsed && (
                <div style={{ marginTop:14, background:'rgba(46,204,113,0.08)', border:'1px solid rgba(46,204,113,0.25)', borderRadius:8, padding:'12px 16px', fontSize:12.5, color:'var(--green)', display:'flex', gap:10, alignItems:'center' }}>
                  <JxIcon name="checkCircle" size={14} color="var(--green)"/>
                  <span><strong>{parsed.rows.length}</strong> filas detectadas · <strong>{parsed.headers.length}</strong> columnas · Hoja: <strong>{parsed.sheetName}</strong></span>
                </div>
              )}

              <div style={{ marginTop:16, background:'rgba(52,152,219,0.08)', border:'1px solid rgba(52,152,219,0.2)', borderRadius:8, padding:'14px 16px' }}>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--blue)', marginBottom:8, display:'flex', gap:6, alignItems:'center' }}>
                  <JxIcon name="alertCircle" size={13} color="var(--blue)"/>Tips
                </div>
                <ul style={{ fontSize:12, color:'var(--ts)', lineHeight:1.8, paddingLeft:16 }}>
                  <li>La primera fila debe contener encabezados de columna</li>
                  <li>Evita celdas combinadas y filas vacías intermedias</li>
                  <li>Descarga la <strong>plantilla oficial</strong> en el paso anterior para garantizar compatibilidad</li>
                </ul>
              </div>

              <div style={{ display:'flex', justifyContent:'space-between', marginTop:20 }}>
                <button className="btn btn-ghost" onClick={()=>setStep(1)}><JxIcon name="chevL" size={14}/>Atrás</button>
                <button className="btn btn-amber" disabled={!parsed} onClick={()=>setStep(3)} style={{ opacity:parsed?1:.4 }}>Siguiente <JxIcon name="chevR" size={14}/></button>
              </div>
            </div>
          )}

          {/* Step 3 — Mapeo */}
          {step === 3 && parsed && modCfg && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:4 }}>Mapea las columnas</div>
              <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
                Asocia cada campo de JARVEX con la columna correspondiente del archivo. Los campos con <span style={{ color:'var(--red)' }}>*</span> son obligatorios.
              </div>

              <div className="card card-p" style={{ marginBottom:14 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  {modCfg.fields.map(f => {
                    const required = modCfg.requiredFields.includes(f);
                    return (
                      <div key={f} style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ flex:1, fontSize:12, color:'var(--ts)' }}>
                          {f} {required && <span style={{ color:'var(--red)' }}>*</span>}
                        </div>
                        <select className="fi" value={mapping[f] || ''} onChange={e => setMapping(m => ({ ...m, [f]: e.target.value }))}
                          style={{ flex:1, fontSize:11.5, padding:'4px 8px' }}>
                          <option value="">— Ignorar —</option>
                          {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                {requiredOk
                  ? <span className="badge b-green">✓ Mapeo listo</span>
                  : <span className="badge b-red">⚠ Faltan campos obligatorios</span>}
                <span style={{ fontSize:11.5, color:'var(--tm)' }}>
                  {validation.ok} válidas · {validation.errors} con errores
                </span>
              </div>

              <div className="card" style={{ overflow:'hidden', marginBottom:14 }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11.5, fontWeight:600, color:'var(--tm)' }}>
                  <JxIcon name="eye" size={13}/> Vista previa (3 primeras filas transformadas)
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table className="tbl">
                    <thead>
                      <tr>{modCfg.fields.map(f => <th key={f}>{f}</th>)}</tr>
                    </thead>
                    <tbody>
                      {transformedRows.slice(0,3).map((r, i) => (
                        <tr key={i}>
                          {modCfg.fields.map(f => <td key={f}>{r[f] === null || r[f] === undefined ? <span style={{ color:'var(--tm)' }}>—</span> : String(r[f])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <button className="btn btn-ghost" onClick={()=>setStep(2)}><JxIcon name="chevL" size={14}/>Atrás</button>
                <button className="btn btn-amber" disabled={!requiredOk} onClick={()=>setStep(4)} style={{ opacity:requiredOk?1:.4 }}>Siguiente <JxIcon name="chevR" size={14}/></button>
              </div>
            </div>
          )}

          {/* Step 4 — Confirmar */}
          {step === 4 && parsed && modCfg && (
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:4 }}>Confirmar importación</div>
              <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:20 }}>Revisa el resumen final antes de cargar los datos a JARVEX.</div>

              <div className="card card-p" style={{ marginBottom:16 }}>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
                  {[
                    { label:'Origen', val:src?.label, icon:src?.icon, color:src?.color },
                    { label:'Módulo destino', val:modMeta?.label, icon:modMeta?.icon, color:modMeta?.color },
                    { label:'Archivo', val:file?.name, icon:'file', color:'var(--green)' },
                    { label:NEEDS_OBRA(modId)?'Obra destino':'Alcance', val:NEEDS_OBRA(modId)?(obraId?`Obra activa (${obraId.slice(0,8)}…)`:'Sin obra'):'Global (sin obra)', icon:'building', color:'var(--orange)' },
                    { label:'Filas a importar', val:`${transformedRows.length}`, icon:'list', color:'var(--tp)' },
                    { label:'Validación', val:`${validation.ok} OK · ${validation.errors} con error`, icon:validation.errors?'alert':'checkCircle', color:validation.errors?'var(--amber)':'var(--green)' },
                  ].map((r,i)=>(
                    <div key={i} style={{ display:'flex', gap:10, alignItems:'center' }}>
                      <div style={{ width:32, height:32, borderRadius:7, background:`${r.color}18`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <JxIcon name={r.icon} size={14} color={r.color}/>
                      </div>
                      <div>
                        <div style={{ fontSize:10, color:'var(--tm)', textTransform:'uppercase', letterSpacing:'.06em' }}>{r.label}</div>
                        <div style={{ fontSize:13, fontWeight:600, color:'var(--tp)' }}>{r.val}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card" style={{ overflow:'hidden', marginBottom:14 }}>
                <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11.5, fontWeight:600, color:'var(--tm)' }}>
                  Vista previa — primeras 5 filas
                </div>
                <div style={{ overflowX:'auto' }}>
                  <table className="tbl">
                    <thead><tr>{modCfg.fields.map(f => <th key={f}>{f}</th>)}</tr></thead>
                    <tbody>
                      {transformedRows.slice(0,5).map((r, i) => (
                        <tr key={i}>
                          {modCfg.fields.map(f => <td key={f}>{r[f] === null || r[f] === undefined ? <span style={{ color:'var(--tm)' }}>—</span> : String(r[f])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {validation.errors > 0 && (
                <div style={{ background:'rgba(242,183,5,0.08)', border:'1px solid rgba(242,183,5,0.3)', borderRadius:8, padding:'12px 16px', marginBottom:14, fontSize:12.5, color:'var(--amber)' }}>
                  <strong>{validation.errors} filas tienen errores</strong> y serán omitidas. Las {validation.ok} restantes se importarán.
                  <details style={{ marginTop:6 }}>
                    <summary style={{ cursor:'pointer', fontSize:11.5 }}>Ver detalle</summary>
                    <div style={{ maxHeight:160, overflow:'auto', marginTop:6 }}>
                      {validation.errorList.slice(0,20).map((e,i)=>(
                        <div key={i} style={{ fontSize:11, color:'var(--ts)', padding:'2px 0' }}>
                          Fila {e.row}: {e.errs.join('; ')}
                        </div>
                      ))}
                    </div>
                  </details>
                </div>
              )}

              {importing && (
                <div style={{ marginBottom:14 }}>
                  <div style={{ fontSize:12, color:'var(--ts)', marginBottom:6 }}>
                    Importando {progress.current}/{progress.total}…
                  </div>
                  <div style={{ width:'100%', height:8, background:'var(--bg-c)', borderRadius:4, overflow:'hidden' }}>
                    <div style={{ width:`${progress.total?(progress.current/progress.total*100):0}%`, height:'100%', background:'var(--amber)', transition:'width .2s' }}/>
                  </div>
                </div>
              )}

              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <button className="btn btn-ghost" onClick={()=>setStep(3)} disabled={importing}><JxIcon name="chevL" size={14}/>Atrás</button>
                <button className="btn btn-amber" onClick={runImport} disabled={importing || transformedRows.length===0} style={{ minWidth:200, justifyContent:'center' }}>
                  {importing
                    ? <><span style={{ width:14,height:14,borderRadius:'50%',border:'2px solid rgba(0,0,0,0.3)',borderTopColor:'rgba(0,0,0,0.8)',display:'inline-block',animation:'spin .7s linear infinite' }}/>Importando…</>
                    : <><JxIcon name="upload" size={14}/>Importar {transformedRows.length} registros</>}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ───────── TAB: HISTORIAL ───────── */}
      {tab === 'historial' && (
        <div>
          {hist.length === 0 ? (
            <div className="card card-p" style={{ textAlign:'center', padding:'40px 20px', color:'var(--tm)' }}>
              <JxIcon name="clipboard" size={28} color="var(--tm)"/>
              <div style={{ marginTop:10, fontSize:13 }}>Aún no hay importaciones registradas en este dispositivo.</div>
            </div>
          ) : (
            <div className="card" style={{ overflow:'hidden' }}>
              <table className="tbl">
                <thead><tr><th>Fecha</th><th>Módulo</th><th style={{textAlign:'right'}}>Total</th><th style={{textAlign:'right'}}>OK</th><th style={{textAlign:'right'}}>Errores</th><th>Estado</th><th>Usuario</th></tr></thead>
                <tbody>
                  {hist.map((h,i)=>(
                    <tr key={i}>
                      <td className="col-m">{h.fecha}</td>
                      <td><span className="tag">{h.modulo}</span></td>
                      <td style={{textAlign:'right'}} className="col-num">{h.total}</td>
                      <td style={{textAlign:'right'}} className="col-num" >{h.ok}</td>
                      <td style={{textAlign:'right'}} className="col-num">{h.errores}</td>
                      <td><span className={`badge ${h.errores?'b-yellow':'b-green'}`}>{h.errores?'⚠ Parcial':'✓ Exitoso'}</span></td>
                      <td>{h.user}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hist.length > 0 && (
            <div style={{ marginTop:14, textAlign:'right' }}>
              <button className="btn btn-ghost btn-sm" onClick={()=>{ if(confirm('Borrar historial local?')) { setHist([]); localStorage.removeItem('importaciones_historial'); } }}>
                <JxIcon name="trash" size={12}/>Limpiar historial
              </button>
            </div>
          )}
        </div>
      )}

      {/* ───────── TAB: PLANTILLAS ───────── */}
      {tab === 'plantillas' && (
        <div>
          <div className="info-banner" style={{ marginBottom:18 }}>
            <JxIcon name="download" size={14} color="var(--amber)"/>
            <span>Descarga las plantillas oficiales JARVEX en formato Excel para asegurar una importación correcta.</span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14 }}>
            {MOD_META.map(m => (
              <div key={m.id} className="card card-p card-hover">
                <div style={{ display:'flex', gap:12, alignItems:'flex-start', marginBottom:12 }}>
                  <div style={{ width:40, height:40, borderRadius:10, background:`${m.color}18`, border:`1px solid ${m.color}28`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                    <JxIcon name={m.icon} size={18} color={m.color}/>
                  </div>
                  <div>
                    <div style={{ fontSize:12.5, fontWeight:700, color:'var(--tp)', lineHeight:1.3, marginBottom:4 }}>{m.label}</div>
                    <div style={{ fontSize:11, color:'var(--tm)' }}>{(window.__excel?.MODULES?.[m.id]?.fields?.length) || '—'} columnas</div>
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ width:'100%', justifyContent:'center' }}
                  onClick={()=>{ try { window.__excel.downloadTemplate(m.id); showToast(`Plantilla ${m.label} descargada`,'green'); } catch(e) { showToast(e.message,'red'); } }}>
                  <JxIcon name="download" size={13}/>Descargar .xlsx
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

Object.assign(window, { ImportarPage });
