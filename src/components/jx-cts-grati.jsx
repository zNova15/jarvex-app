import React from "react";
const { useState: uS, useMemo: uM, useEffect: uE, useCallback: uCb } = React;

// ─── HELPERS ────────────────────────────────────────────
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

const LS_KEY = 'jarvex_cts_grati_pagados';

// Lee/escribe los registros de pagos de CTS y Gratificaciones desde localStorage.
function loadPagados() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function savePagados(list) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list || [])); } catch {}
}

// Calcula los meses computables (regla: ≥15 días en el mes => mes completo).
// rango = { startYear, startMonth (1-12), endYear, endMonth (1-12) }
// fechaIngreso: 'YYYY-MM-DD'
function calcMesesComputables(fechaIngreso, rango) {
  if (!fechaIngreso) return 0;
  const ing = new Date(fechaIngreso + 'T00:00:00');
  if (Number.isNaN(ing.getTime())) return 0;
  let meses = 0;
  for (let y = rango.startYear, m = rango.startMonth; ; ) {
    const cy = y, cm = m; // mes evaluado
    const inicioMes = new Date(cy, cm - 1, 1);
    const finMes    = new Date(cy, cm, 0); // último día
    // Si el ingreso es posterior al fin de mes, el mes no cuenta.
    // Si el ingreso es anterior o igual al inicio del mes, cuenta entero.
    if (ing <= inicioMes) {
      meses += 1;
    } else if (ing > finMes) {
      // No cuenta nada
    } else {
      // Ingreso dentro del mes: contar días desde el ingreso hasta finMes
      const dias = Math.floor((finMes - ing) / (1000*60*60*24)) + 1;
      if (dias >= 15) meses += 1;
    }
    if (cy === rango.endYear && cm === rango.endMonth) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    // Salvaguarda contra bucles infinitos
    if (y > rango.endYear + 2) break;
  }
  return meses;
}

// Obtiene rango de un periodo de CTS o Grati.
// tipo: 'cts' | 'grati'  periodo: 'mayo'|'noviembre'|'julio'|'diciembre'
function rangoPeriodo(tipo, periodo, anio) {
  if (tipo === 'cts') {
    if (periodo === 'mayo')      return { startYear: anio - 1, startMonth: 11, endYear: anio,     endMonth: 4 };
    if (periodo === 'noviembre') return { startYear: anio,     startMonth: 5,  endYear: anio,     endMonth: 10 };
  } else {
    if (periodo === 'julio')     return { startYear: anio,     startMonth: 1,  endYear: anio,     endMonth: 6 };
    if (periodo === 'diciembre') return { startYear: anio,     startMonth: 7,  endYear: anio,     endMonth: 12 };
  }
  return { startYear: anio, startMonth: 1, endYear: anio, endMonth: 12 };
}

// Remuneración computable = sueldo básico + asignación familiar + bonificaciones permanentes
// Para CTS suma además 1/6 de la última gratificación
function calcRemuneracionComputable(contrato, opts = {}) {
  const basico = Number(contrato?.sueldo_basico || 0);
  const asig   = Number(contrato?.asignacion_familiar || 0);
  const bonos  = Number(contrato?.bonificaciones_fijas || 0);
  let base = basico + asig + bonos;
  if (opts.incluirSextoGrati) {
    const grati = Number(contrato?.ultima_gratificacion || (basico + asig));
    base += grati / 6;
  }
  return +base.toFixed(2);
}

// Descarga un archivo Excel usando el helper global del proyecto.
function exportarExcel({ sheetName, columnas, filas, filename }) {
  try {
    if (window.__reports?.generateExcel) {
      window.__reports.generateExcel({ sheetName, columnas, filas, filename });
      return true;
    }
    if (window.XLSX) {
      const X = window.XLSX;
      const ws = X.utils.aoa_to_sheet([columnas, ...filas]);
      const wb = X.utils.book_new();
      X.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
      X.writeFile(wb, filename);
      return true;
    }
  } catch (e) { console.error('[exportarExcel]', e); }
  return false;
}

// Hook compartido para obtener la obra activa (mismo patrón que jx-planillas)
function useObraActiva() {
  const [obraId, setObraId] = uS(null);
  uE(() => {
    let cancelled = false;
    let attempts = 0;
    const find = async () => {
      attempts++;
      try {
        const obras = await window.__db.obras.toArray();
        const stored = window.__getObraActivaId?.();
        const a = (stored && obras.find(o => o.id === stored && !o.deleted_at)) || obras.find(o => !o.deleted_at);
        if (a) { if (!cancelled) setObraId(a.id); return; }
      } catch (_) {}
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

// Hook que carga el contrato vigente de cada trabajador activo en la obra.
function useTrabajadoresConContratos(obraId) {
  const { data: personal } = window.__hooks.usePersonal(obraId);
  const [rows, setRows] = uS([]);
  const [loading, setLoading] = uS(false);

  const cargar = uCb(async () => {
    if (!personal || personal.length === 0) { setRows([]); return; }
    setLoading(true);
    try {
      const out = [];
      const activos = personal.filter(p => p.estado === 'activo');
      for (const p of activos) {
        const list = await window.__db.personal_contrato
          .where('personal_id').equals(p.id)
          .filter(c => !c.deleted_at)
          .toArray();
        const vigente = list.find(c => c.estado === 'vigente');
        if (!vigente) continue; // saltar si no hay contrato activo
        out.push({ personal: p, contrato: vigente });
      }
      setRows(out);
    } catch (e) {
      console.error('[useTrabajadoresConContratos]', e);
    } finally { setLoading(false); }
  }, [personal]);

  uE(() => { cargar(); }, [cargar]);
  uE(() => {
    const onChange = () => { cargar(); };
    window.addEventListener('jx_data_changed', onChange);
    return () => window.removeEventListener('jx_data_changed', onChange);
  }, [cargar]);

  return { rows, loading };
}

// ─── CTS PAGE ────────────────────────────────────────────
function CTSPage({ showToast }) {
  const obraId = useObraActiva();
  const { rows, loading } = useTrabajadoresConContratos(obraId);

  const hoy = new Date();
  const [anio, setAnio] = uS(hoy.getFullYear());
  const [periodo, setPeriodo] = uS(hoy.getMonth() < 5 ? 'mayo' : 'noviembre');
  const [calculados, setCalculados] = uS({}); // { personal_id: { meses, remComp, cts } }
  const [pagados, setPagados] = uS(loadPagados());
  const [overrides, setOverrides] = uS({}); // { personal_id: { remComp?: number } }

  const rango = uM(() => rangoPeriodo('cts', periodo, anio), [periodo, anio]);

  // Verifica si el trabajador ya tiene registrado un pago para este periodo y año.
  const isPagado = (personalId) => pagados.some(x =>
    x.trabajador_id === personalId && x.tipo === 'cts' && x.periodo === periodo && x.año === anio
  );

  const calcular = () => {
    const result = {};
    rows.forEach(({ personal, contrato }) => {
      const fechaIng = contrato.fecha_inicio || personal.fecha_ingreso || null;
      const meses = calcMesesComputables(fechaIng, rango);
      const remCompAuto = calcRemuneracionComputable(contrato, { incluirSextoGrati: true });
      const remComp = overrides[personal.id]?.remComp ?? remCompAuto;
      const cts = +(remComp * (meses / 12)).toFixed(2);
      result[personal.id] = { meses, remComp, cts, fechaIngreso: fechaIng };
    });
    setCalculados(result);
    const total = Object.values(result).reduce((acc, r) => acc + r.cts, 0);
    showToast?.(`CTS calculada para ${Object.keys(result).length} trabajador(es) · Total ${fmtS(total)}`, 'green');
  };

  const marcarPagado = (personal, contrato) => {
    const calc = calculados[personal.id];
    if (!calc) { showToast?.('Calcula primero el periodo', 'amber'); return; }
    const reg = {
      trabajador_id: personal.id,
      tipo: 'cts',
      periodo,
      año: anio,
      fecha: new Date().toISOString().slice(0, 10),
      monto: calc.cts,
      banco_cts: contrato.banco_cts || contrato.banco || null,
      cuenta_cts: contrato.cuenta_cts || contrato.cts_cuenta || null,
    };
    const next = [...pagados.filter(x => !(x.trabajador_id === personal.id && x.tipo === 'cts' && x.periodo === periodo && x.año === anio)), reg];
    setPagados(next);
    savePagados(next);
    showToast?.(`CTS depositada · ${personal.nombres} ${personal.apellidos} · ${fmtS(calc.cts)}`, 'green');
  };

  const desmarcarPagado = (personalId) => {
    const next = pagados.filter(x => !(x.trabajador_id === personalId && x.tipo === 'cts' && x.periodo === periodo && x.año === anio));
    setPagados(next);
    savePagados(next);
  };

  const totalCTS = uM(
    () => rows.reduce((acc, r) => acc + (calculados[r.personal.id]?.cts || 0), 0),
    [calculados, rows]
  );

  const exportar = () => {
    const columnas = [
      'Trabajador','DNI','Cargo','Fecha Ingreso','Sueldo Básico','Asig. Familiar',
      'Rem. Computable','Meses (de 6)','CTS Calculada','Depositado','Banco CTS','Cuenta CTS'
    ];
    const filas = rows.map(({ personal, contrato }) => {
      const c = calculados[personal.id] || {};
      const pagadoFlag = isPagado(personal.id) ? 'Sí' : 'No';
      return [
        `${personal.nombres||''} ${personal.apellidos||''}`.trim(),
        personal.dni || '',
        personal.cargo || '',
        c.fechaIngreso || contrato.fecha_inicio || '',
        Number(contrato.sueldo_basico || 0),
        Number(contrato.asignacion_familiar || 0),
        Number(c.remComp || 0),
        Number(c.meses || 0),
        Number(c.cts || 0),
        pagadoFlag,
        contrato.banco_cts || contrato.banco || '',
        contrato.cuenta_cts || contrato.cts_cuenta || '',
      ];
    });
    const filename = `JARVEX_CTS_${periodo}_${anio}.xlsx`;
    const ok = exportarExcel({ sheetName: `CTS ${periodo} ${anio}`, columnas, filas, filename });
    showToast?.(ok ? 'Excel descargado' : 'No se pudo exportar (XLSX no disponible)', ok ? 'green' : 'red');
  };

  const setRemOverride = (personalId, val) => {
    const num = val === '' ? null : Number(val);
    setOverrides(prev => {
      const next = { ...prev };
      if (num == null || Number.isNaN(num)) delete next[personalId];
      else next[personalId] = { ...(next[personalId]||{}), remComp: num };
      return next;
    });
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><p>Selecciona una obra.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">CTS — Compensación por Tiempo de Servicios</div>
          <div className="pg-sub">{rows.length} trabajadores con contrato vigente · Total CTS calculada: <strong>{fmtS(totalCTS)}</strong></div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <select className="fi" value={periodo} onChange={e=>setPeriodo(e.target.value)} style={{ minWidth:130 }}>
            <option value="mayo">Periodo Mayo (Nov–Abr)</option>
            <option value="noviembre">Periodo Noviembre (May–Oct)</option>
          </select>
          <input className="fi" type="number" value={anio} onChange={e=>setAnio(Number(e.target.value)||hoy.getFullYear())} style={{ width:90 }}/>
          <button className="btn btn-primary btn-sm" onClick={calcular}>Calcular CTS Periodo</button>
          <button className="btn btn-ghost btn-sm" onClick={exportar}>Exportar Excel</button>
        </div>
      </div>

      {loading ? (
        <div className="card card-p empty-state"><p>Cargando contratos…</p></div>
      ) : rows.length === 0 ? (
        <div className="card card-p empty-state">
          <p style={{maxWidth:480}}>
            No hay trabajadores con contrato vigente.<br/>
            <small style={{ color:'var(--tm)' }}>Registra contratos en el módulo Personal antes de calcular CTS.</small>
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Trabajador</th>
              <th>Fecha ingreso</th>
              <th style={{ textAlign:'right' }}>Básico</th>
              <th style={{ textAlign:'right' }}>Asig. Fam.</th>
              <th style={{ textAlign:'right' }}>Rem. Comp.</th>
              <th style={{ textAlign:'center' }}>Meses</th>
              <th style={{ textAlign:'right' }}>CTS Calculada</th>
              <th style={{ textAlign:'center' }}>Depositado</th>
              <th>Banco / Cuenta CTS</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {rows.map(({ personal, contrato }) => {
                const c = calculados[personal.id] || {};
                const pagadoFlag = isPagado(personal.id);
                const banco = contrato.banco_cts || contrato.banco || '—';
                const cuenta = contrato.cuenta_cts || contrato.cts_cuenta || '—';
                const ingresoVis = c.fechaIngreso || contrato.fecha_inicio || '—';
                return (
                  <tr key={personal.id}>
                    <td className="col-p">
                      <strong>{personal.nombres} {personal.apellidos}</strong>
                      <div style={{ fontSize:11, color:'var(--tm)' }}>{personal.dni} · {personal.cargo}</div>
                    </td>
                    <td>{ingresoVis}</td>
                    <td style={{ textAlign:'right' }}>{fmtS(contrato.sueldo_basico)}</td>
                    <td style={{ textAlign:'right' }}>{fmtS(contrato.asignacion_familiar)}</td>
                    <td style={{ textAlign:'right' }}>
                      <input
                        className="fi"
                        type="number"
                        step="0.01"
                        value={overrides[personal.id]?.remComp ?? (c.remComp ?? '')}
                        placeholder={c.remComp != null ? String(c.remComp) : 'Calcular…'}
                        onChange={e => setRemOverride(personal.id, e.target.value)}
                        style={{ fontSize:11, padding:'2px 4px', textAlign:'right', width:100 }}
                      />
                    </td>
                    <td style={{ textAlign:'center' }}>{c.meses != null ? `${c.meses}/6` : '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--green)' }}>
                      {c.cts != null ? fmtS(c.cts) : '—'}
                    </td>
                    <td style={{ textAlign:'center' }}>
                      <span className={`badge ${pagadoFlag ? 'b-green' : 'b-gray'}`}>{pagadoFlag ? 'Sí' : 'No'}</span>
                    </td>
                    <td style={{ fontSize:11 }}>
                      <div>{banco}</div>
                      <div style={{ color:'var(--tm)' }}>{cuenta}</div>
                    </td>
                    <td style={{ textAlign:'center' }}>
                      {pagadoFlag ? (
                        <button className="btn btn-ghost btn-xs" onClick={()=>desmarcarPagado(personal.id)}>Desmarcar</button>
                      ) : (
                        <button className="btn btn-primary btn-xs" onClick={()=>marcarPagado(personal, contrato)} disabled={c.cts == null}>Marcar depositado</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background:'rgba(242,183,5,0.15)', fontWeight:700 }}>
                <td colSpan={6} style={{ padding:'8px 12px' }}>TOTAL CTS · {periodo} {anio}</td>
                <td style={{ textAlign:'right', color:'var(--green)' }}>{fmtS(totalCTS)}</td>
                <td colSpan={3}/>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── GRATIFICACIONES PAGE ────────────────────────────────
function GratificacionesPage({ showToast }) {
  const obraId = useObraActiva();
  const { rows, loading } = useTrabajadoresConContratos(obraId);

  const hoy = new Date();
  const [anio, setAnio] = uS(hoy.getFullYear());
  const [periodo, setPeriodo] = uS(hoy.getMonth() < 6 ? 'julio' : 'diciembre');
  const [calculados, setCalculados] = uS({}); // { id: { meses, remComp, grati, bonif, total } }
  const [pagados, setPagados] = uS(loadPagados());
  const [overrides, setOverrides] = uS({});

  const rango = uM(() => rangoPeriodo('grati', periodo, anio), [periodo, anio]);

  const isPagado = (personalId) => pagados.some(x =>
    x.trabajador_id === personalId && x.tipo === 'grati' && x.periodo === periodo && x.año === anio
  );

  const calcular = () => {
    const result = {};
    rows.forEach(({ personal, contrato }) => {
      const fechaIng = contrato.fecha_inicio || personal.fecha_ingreso || null;
      const meses = calcMesesComputables(fechaIng, rango);
      const remCompAuto = calcRemuneracionComputable(contrato, { incluirSextoGrati: false });
      const remComp = overrides[personal.id]?.remComp ?? remCompAuto;
      const grati = +(remComp * (meses / 6)).toFixed(2);
      // Bonif. extraordinaria EsSalud 9% (Ley 30334) — solo régimen general,
      // NO aplica a construcción civil ni regímenes especiales
      const regimen = String(contrato.regimen_laboral || 'general').toLowerCase();
      const aplicaBonif = regimen === 'general' || regimen === '';
      const bonif = aplicaBonif ? +(grati * 0.09).toFixed(2) : 0;
      const total = +(grati + bonif).toFixed(2);
      result[personal.id] = { meses, remComp, grati, bonif, total, fechaIngreso: fechaIng };
    });
    setCalculados(result);
    const totalGrati = Object.values(result).reduce((acc, r) => acc + r.total, 0);
    showToast?.(`Gratificación calculada para ${Object.keys(result).length} trabajador(es) · Total ${fmtS(totalGrati)}`, 'green');
  };

  const marcarPagado = (personal) => {
    const calc = calculados[personal.id];
    if (!calc) { showToast?.('Calcula primero el periodo', 'amber'); return; }
    const reg = {
      trabajador_id: personal.id,
      tipo: 'grati',
      periodo,
      año: anio,
      fecha: new Date().toISOString().slice(0, 10),
      monto: calc.total,
      grati: calc.grati,
      bonif_essalud_9: calc.bonif,
    };
    const next = [...pagados.filter(x => !(x.trabajador_id === personal.id && x.tipo === 'grati' && x.periodo === periodo && x.año === anio)), reg];
    setPagados(next);
    savePagados(next);
    showToast?.(`Gratificación pagada · ${personal.nombres} ${personal.apellidos} · ${fmtS(calc.total)}`, 'green');
  };

  const desmarcarPagado = (personalId) => {
    const next = pagados.filter(x => !(x.trabajador_id === personalId && x.tipo === 'grati' && x.periodo === periodo && x.año === anio));
    setPagados(next);
    savePagados(next);
  };

  const totales = uM(() => {
    let grati = 0, bonif = 0, total = 0;
    rows.forEach(r => {
      const c = calculados[r.personal.id]; if (!c) return;
      grati += c.grati; bonif += c.bonif; total += c.total;
    });
    return { grati, bonif, total };
  }, [calculados, rows]);

  const exportar = () => {
    const columnas = [
      'Trabajador','DNI','Cargo','Fecha Ingreso','Sueldo Básico','Asig. Familiar',
      'Rem. Computable','Meses (de 6)','Gratificación','Bonif. Extraord. 9%','Total a pagar','Pagado'
    ];
    const filas = rows.map(({ personal, contrato }) => {
      const c = calculados[personal.id] || {};
      return [
        `${personal.nombres||''} ${personal.apellidos||''}`.trim(),
        personal.dni || '',
        personal.cargo || '',
        c.fechaIngreso || contrato.fecha_inicio || '',
        Number(contrato.sueldo_basico || 0),
        Number(contrato.asignacion_familiar || 0),
        Number(c.remComp || 0),
        Number(c.meses || 0),
        Number(c.grati || 0),
        Number(c.bonif || 0),
        Number(c.total || 0),
        isPagado(personal.id) ? 'Sí' : 'No',
      ];
    });
    const filename = `JARVEX_Gratificaciones_${periodo}_${anio}.xlsx`;
    const ok = exportarExcel({ sheetName: `Grati ${periodo} ${anio}`, columnas, filas, filename });
    showToast?.(ok ? 'Excel descargado' : 'No se pudo exportar (XLSX no disponible)', ok ? 'green' : 'red');
  };

  const setRemOverride = (personalId, val) => {
    const num = val === '' ? null : Number(val);
    setOverrides(prev => {
      const next = { ...prev };
      if (num == null || Number.isNaN(num)) delete next[personalId];
      else next[personalId] = { ...(next[personalId]||{}), remComp: num };
      return next;
    });
  };

  if (!obraId) return <div className="page-wrap"><div className="empty-state"><p>Selecciona una obra.</p></div></div>;

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Gratificaciones — Julio / Diciembre</div>
          <div className="pg-sub">
            {rows.length} trabajadores con contrato vigente · Grati: <strong>{fmtS(totales.grati)}</strong> · Bonif. 9%: <strong>{fmtS(totales.bonif)}</strong> · Total: <strong style={{ color:'var(--green)' }}>{fmtS(totales.total)}</strong>
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          <select className="fi" value={periodo} onChange={e=>setPeriodo(e.target.value)} style={{ minWidth:130 }}>
            <option value="julio">Periodo Julio (Ene–Jun)</option>
            <option value="diciembre">Periodo Diciembre (Jul–Dic)</option>
          </select>
          <input className="fi" type="number" value={anio} onChange={e=>setAnio(Number(e.target.value)||hoy.getFullYear())} style={{ width:90 }}/>
          <button className="btn btn-primary btn-sm" onClick={calcular}>Calcular Gratificación Periodo</button>
          <button className="btn btn-ghost btn-sm" onClick={exportar}>Exportar Excel</button>
        </div>
      </div>

      {loading ? (
        <div className="card card-p empty-state"><p>Cargando contratos…</p></div>
      ) : rows.length === 0 ? (
        <div className="card card-p empty-state">
          <p style={{maxWidth:480}}>
            No hay trabajadores con contrato vigente.<br/>
            <small style={{ color:'var(--tm)' }}>Registra contratos en el módulo Personal antes de calcular gratificaciones.</small>
          </p>
        </div>
      ) : (
        <div className="card" style={{ overflow:'hidden' }}>
          <table className="tbl">
            <thead><tr>
              <th>Trabajador</th>
              <th>Fecha ingreso</th>
              <th style={{ textAlign:'right' }}>Básico</th>
              <th style={{ textAlign:'right' }}>Asig. Fam.</th>
              <th style={{ textAlign:'right' }}>Rem. Comp.</th>
              <th style={{ textAlign:'center' }}>Meses</th>
              <th style={{ textAlign:'right' }}>Gratificación</th>
              <th style={{ textAlign:'right' }}>Bonif. 9%</th>
              <th style={{ textAlign:'right' }}>Total</th>
              <th style={{ textAlign:'center' }}>Pagado</th>
              <th style={{ textAlign:'center' }}>Acciones</th>
            </tr></thead>
            <tbody>
              {rows.map(({ personal, contrato }) => {
                const c = calculados[personal.id] || {};
                const pagadoFlag = isPagado(personal.id);
                const ingresoVis = c.fechaIngreso || contrato.fecha_inicio || '—';
                return (
                  <tr key={personal.id}>
                    <td className="col-p">
                      <strong>{personal.nombres} {personal.apellidos}</strong>
                      <div style={{ fontSize:11, color:'var(--tm)' }}>{personal.dni} · {personal.cargo}</div>
                    </td>
                    <td>{ingresoVis}</td>
                    <td style={{ textAlign:'right' }}>{fmtS(contrato.sueldo_basico)}</td>
                    <td style={{ textAlign:'right' }}>{fmtS(contrato.asignacion_familiar)}</td>
                    <td style={{ textAlign:'right' }}>
                      <input
                        className="fi"
                        type="number"
                        step="0.01"
                        value={overrides[personal.id]?.remComp ?? (c.remComp ?? '')}
                        placeholder={c.remComp != null ? String(c.remComp) : 'Calcular…'}
                        onChange={e => setRemOverride(personal.id, e.target.value)}
                        style={{ fontSize:11, padding:'2px 4px', textAlign:'right', width:100 }}
                      />
                    </td>
                    <td style={{ textAlign:'center' }}>{c.meses != null ? `${c.meses}/6` : '—'}</td>
                    <td style={{ textAlign:'right' }}>{c.grati != null ? fmtS(c.grati) : '—'}</td>
                    <td style={{ textAlign:'right', color:'var(--blue)' }}>{c.bonif != null ? fmtS(c.bonif) : '—'}</td>
                    <td style={{ textAlign:'right', fontWeight:700, color:'var(--green)' }}>{c.total != null ? fmtS(c.total) : '—'}</td>
                    <td style={{ textAlign:'center' }}>
                      <span className={`badge ${pagadoFlag ? 'b-green' : 'b-gray'}`}>{pagadoFlag ? 'Sí' : 'No'}</span>
                    </td>
                    <td style={{ textAlign:'center' }}>
                      {pagadoFlag ? (
                        <button className="btn btn-ghost btn-xs" onClick={()=>desmarcarPagado(personal.id)}>Desmarcar</button>
                      ) : (
                        <button className="btn btn-primary btn-xs" onClick={()=>marcarPagado(personal)} disabled={c.total == null}>Marcar pagado</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ background:'rgba(242,183,5,0.15)', fontWeight:700 }}>
                <td colSpan={6} style={{ padding:'8px 12px' }}>TOTAL · {periodo} {anio}</td>
                <td style={{ textAlign:'right' }}>{fmtS(totales.grati)}</td>
                <td style={{ textAlign:'right', color:'var(--blue)' }}>{fmtS(totales.bonif)}</td>
                <td style={{ textAlign:'right', color:'var(--green)' }}>{fmtS(totales.total)}</td>
                <td colSpan={2}/>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── REGISTRO GLOBAL ────────────────────────────────────
window.CTSPage = CTSPage;
window.GratificacionesPage = GratificacionesPage;

export { CTSPage, GratificacionesPage };
