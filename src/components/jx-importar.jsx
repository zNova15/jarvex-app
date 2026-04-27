import React from "react";
const { useState: uSI, useMemo: uMI, useEffect: uEI, useRef: uRI, useCallback: uCI } = React;

// ── Obra activa helper (poll Dexie) ──────────────────────────
function useObraActiva() {
  const [obraId, setObraId] = uSI(null);
  uEI(() => {
    let cancelled = false;
    const find = async () => {
      const obras = await window.__db.obras.toArray();
      const stored = window.__getObraActivaId?.();
      const a = (stored && obras.find(o => o.id === stored && !o.deleted_at))
             || obras.find(o => !o.deleted_at);
      if (a) { if (!cancelled) setObraId(a.id); }
      else if (!cancelled) setTimeout(find, 500);
    };
    find();
    return () => { cancelled = true; };
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
function S10Flow({ obraId, userId, userName, showToast, onReset, hist, setHist }) {
  const [step, setStep] = uSI(0); // 0 aviso, 1 archivo, 2 preview, 3 confirmar
  const [confirmed, setConfirmed] = uSI(false);
  const [file, setFile] = uSI(null);
  const [parsing, setParsing] = uSI(false);
  const [parsed, setParsed] = uSI(null); // { partidas, summary }
  const [parseErr, setParseErr] = uSI(null);
  const [importing, setImp] = uSI(false);
  const [progress, setProgress] = uSI({ phase:'', current:0, total:0 });
  const [result, setResult] = uSI(null);

  // Parse al subir archivo
  uEI(() => {
    if (!file) { setParsed(null); setParseErr(null); return; }
    if (file.size > 25 * 1024 * 1024) {
      setParseErr('El archivo excede 25MB'); setParsed(null); return;
    }
    setParsing(true); setParseErr(null);
    const t0 = performance.now();
    window.__apu.parseAPUFile(file)
      .then(p => {
        const enriched = window.__apu.enrichJerarquia(p.partidas);
        setParsed({ ...p, partidas: enriched, parseMs: Math.round(performance.now() - t0) });
      })
      .catch(e => { setParseErr(e.message || 'Error al leer el archivo'); setParsed(null); })
      .finally(() => setParsing(false));
  }, [file]);

  // Importación masiva en chunks
  const runImport = async () => {
    if (!obraId) { showToast('No hay obra activa', 'red'); return; }
    if (!parsed) return;
    setImp(true);
    const now = new Date().toISOString();

    try {
      // 1) Borrar partidas e insumos previos de la obra
      setProgress({ phase:'Limpiando datos previos…', current:0, total:1 });
      await window.__db.partidas.where('obra_id').equals(obraId).delete();
      await window.__db.insumos_partida.where('obra_id').equals(obraId).delete();

      // 2) Construir registros
      const partidaRecords = [];
      const insumoRecords = [];
      const idByCodigo = new Map();

      parsed.partidas.forEach((p, i) => {
        const id = window.__newId();
        idByCodigo.set(p.codigo, id);
        const cantidad = Number(p.cantidad) || 0;
        const total = Number(p.costo_total) || 0;
        const pu = cantidad > 0 ? +(total / cantidad).toFixed(6) : 0;
        partidaRecords.push({
          id,
          obra_id: obraId,
          codigo_delfin: p.codigo,
          nombre_partida: p.descripcion || p.codigo,
          unidad: p.unidad || 'und',
          metrado_contratado: cantidad,
          precio_unitario_pres: pu,
          costo_total_presupuestado: total,
          estado: 'pendiente',
          nivel: p.nivel ?? 1,
          parent_codigo: p.parent_codigo ?? null,
          orden: i,
          created_by: userId,
          updated_by: userId,
          created_at: now,
          updated_at: now,
          version: 1,
          sync_status: 'pending_create',
          last_synced_at: null,
          idempotency_key: `${userId}_partidas_${id}`,
        });

        p.insumos.forEach(ins => {
          const insId = window.__newId();
          insumoRecords.push({
            id: insId,
            obra_id: obraId,
            partida_id: id,
            insumo_codigo: ins.codigo,
            nombre_insumo: ins.descripcion,
            tipo_insumo: ins.categoria,
            unidad: ins.unidad,
            cantidad_presupuestada: Number(ins.cantidad) || 0,
            precio_presupuestado: Number(ins.precio_unitario) || 0,
            // costo_presupuestado es columna GENERATED en SQL — no se setea
            created_by: userId,
            updated_by: userId,
            created_at: now,
            updated_at: now,
            version: 1,
            sync_status: 'pending_create',
            last_synced_at: null,
            idempotency_key: `${userId}_insumos_partida_${insId}`,
          });
        });
      });

      // 3) Insertar en chunks (50 partidas, 200 insumos por batch)
      const PARTIDA_CHUNK = 50;
      const INSUMO_CHUNK = 200;

      setProgress({ phase:'Insertando partidas…', current:0, total: partidaRecords.length });
      for (let i = 0; i < partidaRecords.length; i += PARTIDA_CHUNK) {
        const slice = partidaRecords.slice(i, i + PARTIDA_CHUNK);
        await window.__db.partidas.bulkAdd(slice);
        setProgress({ phase:'Insertando partidas…', current: Math.min(i + PARTIDA_CHUNK, partidaRecords.length), total: partidaRecords.length });
        await new Promise(r => setTimeout(r, 0));
      }

      setProgress({ phase:'Insertando insumos…', current:0, total: insumoRecords.length });
      for (let i = 0; i < insumoRecords.length; i += INSUMO_CHUNK) {
        const slice = insumoRecords.slice(i, i + INSUMO_CHUNK);
        await window.__db.insumos_partida.bulkAdd(slice);
        setProgress({ phase:'Insertando insumos…', current: Math.min(i + INSUMO_CHUNK, insumoRecords.length), total: insumoRecords.length });
        await new Promise(r => setTimeout(r, 0));
      }

      const res = { ok: partidaRecords.length, insumos: insumoRecords.length, errors: 0, errorList: [] };
      setResult(res);

      // Historial
      const entry = {
        fecha: fmtDate(),
        modulo: `S10 APU · ${partidaRecords.length} partidas / ${insumoRecords.length} insumos`,
        total: partidaRecords.length,
        ok: partidaRecords.length,
        errores: 0,
        user: userName,
      };
      const newHist = [entry, ...hist].slice(0, 50);
      setHist(newHist);
      localStorage.setItem('importaciones_historial', JSON.stringify(newHist));

      showToast(`Importadas ${partidaRecords.length} partidas y ${insumoRecords.length} insumos`, 'green');
      // Notificar a la app que la obra cambió (refresca listas)
      try { window.dispatchEvent(new CustomEvent('obra_activa_change', { detail:{ obraId } })); } catch {}
    } catch (e) {
      console.error('[S10 import]', e);
      showToast(`Error en la importación: ${e.message || e}`, 'red');
      setResult({ ok:0, insumos:0, errors:1, errorList:[{ row:'-', error: e.message || String(e) }] });
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
          {result.errors ? 'Importación fallida' : '¡Presupuesto S10 importado!'}
        </div>
        <div style={{ fontSize:13, color:'var(--tm)', maxWidth:520 }}>
          {result.errors
            ? 'Ocurrió un error durante la importación. Los datos pueden estar parcialmente cargados.'
            : `Se cargaron ${result.ok} partidas y ${result.insumos} insumos en la obra activa.`}
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, width:'100%', maxWidth:520 }}>
        <div className="card card-p" style={{ textAlign:'center' }}>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--green)' }}>{result.ok}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Partidas</div>
        </div>
        <div className="card card-p" style={{ textAlign:'center' }}>
          <div style={{ fontSize:24, fontWeight:800, color:'var(--blue)' }}>{result.insumos}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Insumos</div>
        </div>
        <div className="card card-p" style={{ textAlign:'center' }}>
          <div style={{ fontSize:24, fontWeight:800, color: result.errors?'var(--red)':'var(--tp)' }}>{result.errors}</div>
          <div style={{ fontSize:11, color:'var(--tm)', marginTop:2 }}>Errores</div>
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
            Vas a cargar TODAS las partidas y sus insumos directamente desde un Excel exportado por S10 — sin mapeo manual.
          </div>

          <div className="card card-p" style={{ background:'rgba(242,183,5,0.06)', border:'1px solid rgba(242,183,5,0.3)', marginBottom:14 }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'var(--amber)', marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
              <JxIcon name="alert" size={14} color="var(--amber)"/> Atención
            </div>
            <ul style={{ fontSize:12, color:'var(--ts)', lineHeight:1.7, paddingLeft:16, margin:0 }}>
              <li><strong>Las partidas existentes en esta obra serán reemplazadas.</strong></li>
              <li>Todos los insumos asociados a esas partidas también se borrarán.</li>
              <li>Esta operación es <strong>local</strong>: se sincronizará al servidor en el próximo sync.</li>
              <li>Se procesarán partidas, sub-partidas y todos sus insumos (mano de obra, materiales, equipos, etc).</li>
            </ul>
          </div>

          {!obraId && (
            <div style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--red)', marginBottom:14 }}>
              ⚠ No hay obra activa. Activa una obra antes de importar.
            </div>
          )}

          <label style={{ display:'flex', gap:8, alignItems:'center', fontSize:12.5, color:'var(--ts)', cursor:'pointer', marginBottom:18 }}>
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            Entiendo y deseo continuar — reemplazaré las partidas e insumos de la obra activa.
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
              <span><strong>{parsed.summary.total}</strong> partidas detectadas · <strong>{parsed.summary.totalInsumos}</strong> insumos · parseado en {parsed.parseMs}ms</span>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between', marginTop:20 }}>
            <button className="btn btn-ghost" onClick={()=>setStep(0)}><JxIcon name="chevL" size={14}/>Atrás</button>
            <button className="btn btn-amber" disabled={!parsed} onClick={()=>setStep(2)} style={{ opacity:parsed?1:.4 }}>Siguiente <JxIcon name="chevR" size={14}/></button>
          </div>
        </div>
      )}

      {/* Step 2 — Preview */}
      {step === 2 && parsed && (
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:6 }}>Preview de partidas detectadas</div>
          <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
            Verifica que los datos correspondan al presupuesto. Si todo se ve bien, continúa.
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:12, marginBottom:14 }}>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--tp)' }}>{parsed.summary.total}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Partidas</div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--green)' }}>{parsed.summary.conInsumos}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Con insumos</div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color:'var(--blue)' }}>{parsed.summary.totalInsumos}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Insumos</div>
            </div>
            <div className="card card-p" style={{ textAlign:'center' }}>
              <div style={{ fontSize:22, fontWeight:800, color: parsed.summary.errores ? 'var(--red)':'var(--tp)' }}>{parsed.summary.errores}</div>
              <div style={{ fontSize:10.5, color:'var(--tm)', marginTop:2, textTransform:'uppercase' }}>Errores</div>
            </div>
          </div>

          {parsed.summary.total < 5 && (
            <div style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', borderRadius:8, padding:'10px 14px', fontSize:12, color:'var(--red)', marginBottom:14 }}>
              ⚠ Solo se detectaron {parsed.summary.total} partidas. Verifica que el archivo sea un export de S10 válido.
            </div>
          )}

          <div className="card" style={{ overflow:'hidden', marginBottom:14 }}>
            <div style={{ padding:'10px 14px', borderBottom:'1px solid var(--border)', fontSize:11.5, fontWeight:600, color:'var(--tm)' }}>
              <JxIcon name="eye" size={13}/> Primeras 10 partidas
            </div>
            <div style={{ overflowX:'auto', maxHeight:380 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ minWidth:120 }}>Código</th>
                    <th>Descripción</th>
                    <th style={{ textAlign:'right' }}>Nivel</th>
                    <th style={{ textAlign:'right' }}>Metrado</th>
                    <th>Unid.</th>
                    <th style={{ textAlign:'right' }}>Costo Total</th>
                    <th style={{ textAlign:'right' }}>Insumos</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.partidas.slice(0, 10).map((p, i) => (
                    <tr key={i}>
                      <td className="col-m" style={{ fontFamily:'monospace', fontSize:11 }}>{p.codigo}</td>
                      <td style={{ fontSize:11.5 }}>{p.descripcion}</td>
                      <td className="col-num" style={{ textAlign:'right' }}>{p.nivel}</td>
                      <td className="col-num" style={{ textAlign:'right' }}>{p.cantidad ?? '—'}</td>
                      <td>{p.unidad ?? '—'}</td>
                      <td className="col-num" style={{ textAlign:'right' }}>{p.costo_total != null ? p.costo_total.toFixed(2) : '—'}</td>
                      <td className="col-num" style={{ textAlign:'right' }}>{p.insumos.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <button className="btn btn-ghost" onClick={()=>setStep(1)}><JxIcon name="chevL" size={14}/>Atrás</button>
            <button className="btn btn-amber" disabled={parsed.summary.total === 0} onClick={()=>setStep(3)}>Siguiente <JxIcon name="chevR" size={14}/></button>
          </div>
        </div>
      )}

      {/* Step 3 — Confirmar e importar */}
      {step === 3 && parsed && (
        <div>
          <div style={{ fontSize:15, fontWeight:700, color:'var(--tp)', marginBottom:6 }}>Confirmar y ejecutar importación</div>
          <div style={{ fontSize:12.5, color:'var(--tm)', marginBottom:18 }}>
            Al confirmar, se reemplazarán las partidas e insumos existentes en la obra activa.
          </div>

          <div className="card card-p" style={{ marginBottom:16 }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
              {[
                { label:'Origen', val:'S10 Costos · APU', icon:'dollar', color:'#0070C0' },
                { label:'Archivo', val:file?.name, icon:'file', color:'var(--green)' },
                { label:'Obra destino', val: obraId ? `${obraId.slice(0,8)}…` : '—', icon:'building', color:'var(--orange)' },
                { label:'Partidas', val: parsed.summary.total, icon:'list', color:'var(--tp)' },
                { label:'Insumos', val: parsed.summary.totalInsumos, icon:'package', color:'var(--blue)' },
                { label:'Modo', val:'Reemplazar (delete + bulkAdd)', icon:'refresh', color:'var(--amber)' },
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

          {importing && (
            <div style={{ marginBottom:14 }}>
              <div style={{ fontSize:12, color:'var(--ts)', marginBottom:6 }}>
                {progress.phase} {progress.total > 0 && `${progress.current}/${progress.total}`}
              </div>
              <div style={{ width:'100%', height:8, background:'var(--bg-c)', borderRadius:4, overflow:'hidden' }}>
                <div style={{ width:`${progress.total?(progress.current/progress.total*100):0}%`, height:'100%', background:'var(--amber)', transition:'width .2s' }}/>
              </div>
            </div>
          )}

          <div style={{ display:'flex', justifyContent:'space-between' }}>
            <button className="btn btn-ghost" onClick={()=>setStep(2)} disabled={importing}><JxIcon name="chevL" size={14}/>Atrás</button>
            <button className="btn btn-amber" onClick={runImport} disabled={importing} style={{ minWidth:240, justifyContent:'center' }}>
              {importing
                ? <><span style={{ width:14,height:14,borderRadius:'50%',border:'2px solid rgba(0,0,0,0.3)',borderTopColor:'rgba(0,0,0,0.8)',display:'inline-block',animation:'spin .7s linear infinite' }}/>Importando…</>
                : <><JxIcon name="upload" size={14}/>Importar {parsed.summary.total} partidas</>}
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

  return (
    <div className="page-wrap">
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
