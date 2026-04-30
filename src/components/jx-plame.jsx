import React from "react";
import {
  generatePLAMETxt,
  generateTRegistroAltaTxt,
  downloadTxt,
  generateBoletasPDF,
} from '../lib/plame.js';

const { useState: uS, useMemo: uM, useEffect: uE } = React;

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
const MESES_LARGOS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];

const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function pad2(n) { return String(n || 0).padStart(2, '0'); }
function pad4(n) { return String(n || 0).padStart(4, '0'); }

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
    return () => { cancelled = true; };
  }, []);
  return obraId;
}

function PlamePage({ showToast }) {
  const obraId = useObraActiva();
  const { data: planillas } = window.__hooks.usePlanillas(obraId);
  const { data: companies } = window.__hooks.useCompanies();

  const [selectedId, setSelectedId] = uS('');
  const [boletas, setBoletas] = uS([]);
  const [loading, setLoading] = uS(false);
  const [busy, setBusy] = uS(false);

  const sorted = uM(() => [...(planillas || [])].sort((a, b) => {
    const da = (a.periodo_anio || 0) * 100 + (a.periodo_mes || 0);
    const db = (b.periodo_anio || 0) * 100 + (b.periodo_mes || 0);
    return db - da;
  }), [planillas]);

  const planilla = uM(() => sorted.find(p => p.id === selectedId) || null, [selectedId, sorted]);

  const company = uM(() => {
    if (!planilla) return null;
    return (companies || []).find(c => c.id === planilla.company_id) || null;
  }, [planilla, companies]);

  uE(() => {
    let cancelled = false;
    if (!selectedId) { setBoletas([]); return; }
    setLoading(true);
    (async () => {
      try {
        const bols = await window.__db.planilla_boletas
          .where('planilla_id').equals(selectedId)
          .filter(b => !b.deleted_at)
          .toArray();
        if (!cancelled) setBoletas(bols);
      } catch (e) {
        console.error('[plame] cargar boletas', e);
        if (!cancelled) setBoletas([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  const totales = uM(() => {
    let ingresos = 0, descuentos = 0, neto = 0, essalud = 0;
    boletas.forEach(b => {
      ingresos += Number(b.total_ingresos || 0);
      descuentos += Number(b.total_descuentos || 0);
      neto += Number(b.neto_pagar || 0);
      essalud += Number(b.essalud_empleador || 0);
    });
    return {
      count: boletas.length,
      validas: boletas.filter(b => Number(b.neto_pagar || 0) > 0).length,
      ingresos, descuentos, neto, essalud,
    };
  }, [boletas]);

  const cargarContextoExport = async () => {
    if (!planilla) return null;
    try {
      // personal asociado a la obra
      let personalList = [];
      try {
        personalList = await window.__db.personal
          .where('obra_id').equals(planilla.obra_id || obraId)
          .filter(p => !p.deleted_at)
          .toArray();
      } catch (_) {
        personalList = await window.__db.personal.filter(p => !p.deleted_at).toArray();
      }

      const personalIds = personalList.map(p => p.id);
      const contratos = [];
      for (const pid of personalIds) {
        try {
          const cs = await window.__db.personal_contrato
            .where('personal_id').equals(pid)
            .filter(c => !c.deleted_at)
            .toArray();
          contratos.push(...cs);
        } catch (_) {}
      }

      const comp = company || ((companies || []).find(c => c.id === planilla.company_id)) || {};
      let obra = null;
      try {
        obra = await window.__db.obras.get(planilla.obra_id || obraId);
      } catch (_) {}

      return { personal: personalList, contratos, company: comp, obra: obra || {} };
    } catch (e) {
      console.error('[plame] cargarContexto', e);
      return null;
    }
  };

  const handleExportPlame = async () => {
    if (!planilla) return;
    setBusy(true);
    try {
      const ctx = await cargarContextoExport();
      if (!ctx) throw new Error('No se pudo cargar contexto');
      const txt = generatePLAMETxt(planilla, boletas, ctx.contratos, ctx.personal, ctx.company);
      const filename = `PLAME_${pad4(planilla.periodo_anio)}_${pad2(planilla.periodo_mes)}.txt`;
      downloadTxt(filename, txt);
      showToast?.(`PLAME exportado: ${filename}`, 'green');
    } catch (e) {
      console.error('[plame export]', e);
      showToast?.('Error al exportar PLAME: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  const handleExportTRegistro = async () => {
    if (!planilla) return;
    setBusy(true);
    try {
      const ctx = await cargarContextoExport();
      if (!ctx) throw new Error('No se pudo cargar contexto');
      const txt = generateTRegistroAltaTxt(ctx.personal, ctx.contratos, ctx.company);
      const filename = `TREGISTRO_ALTA_${pad4(planilla.periodo_anio)}_${pad2(planilla.periodo_mes)}.txt`;
      downloadTxt(filename, txt);
      showToast?.(`T-Registro exportado: ${filename}`, 'green');
    } catch (e) {
      console.error('[treg export]', e);
      showToast?.('Error al exportar T-Registro: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  const handleExportBoletas = async () => {
    if (!planilla) return;
    setBusy(true);
    try {
      const ctx = await cargarContextoExport();
      if (!ctx) throw new Error('No se pudo cargar contexto');
      generateBoletasPDF(planilla, boletas, ctx.personal, ctx.company, ctx.obra);
      showToast?.(`Boletas PDF generadas (${totales.validas})`, 'green');
    } catch (e) {
      console.error('[boletas pdf]', e);
      showToast?.('Error al generar boletas: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  if (!obraId) {
    return (
      <div className="page-wrap">
        <div className="empty-state"><p>Selecciona una obra.</p></div>
      </div>
    );
  }

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">PLAME / T-Registro</div>
          <div className="pg-sub">Exportación SUNAT — Planilla Mensual Electrónica y T-Registro</div>
        </div>
      </div>

      <div className="card card-p" style={{ marginBottom: 16 }}>
        <label className="flabel">Selecciona planilla</label>
        <select
          className="fi"
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          style={{ maxWidth: 460 }}
        >
          <option value="">— elige una planilla —</option>
          {sorted.map(p => (
            <option key={p.id} value={p.id}>
              {MESES_LARGOS[(p.periodo_mes || 1) - 1]} {p.periodo_anio} · {p.total_trabajadores || 0} trab. · {fmtS(p.total_neto)} neto
            </option>
          ))}
        </select>
        {sorted.length === 0 && (
          <div style={{ color: 'var(--tm)', fontSize: 12, marginTop: 8 }}>
            No hay planillas registradas. Crea una en el módulo Planillas.
          </div>
        )}
      </div>

      {planilla && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Boletas</div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{totales.count}</div>
              {totales.validas !== totales.count && (
                <div style={{ fontSize: 10, color: 'var(--orange)' }}>{totales.validas} válidas para PLAME</div>
              )}
            </div>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Total Ingresos</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--blue)' }}>{fmtS(totales.ingresos)}</div>
            </div>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Total Descuentos</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--orange)' }}>{fmtS(totales.descuentos)}</div>
            </div>
            <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
              <div style={{ color: 'var(--tm)', fontSize: 11 }}>Neto a Pagar</div>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>{fmtS(totales.neto)}</div>
            </div>
          </div>

          {company && (
            <div className="card card-p" style={{ marginBottom: 16, padding: 12, fontSize: 12 }}>
              <strong>Empresa empleadora:</strong> {company.legal_name || company.name}
              {company.ruc && <span style={{ marginLeft: 12, color: 'var(--tm)' }}>RUC {company.ruc}</span>}
            </div>
          )}

          <div className="card card-p" style={{ padding: 16 }}>
            <div style={{ marginBottom: 12, fontWeight: 600, fontSize: 13 }}>Exportar</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button
                className="btn btn-amber"
                onClick={handleExportPlame}
                disabled={busy || loading || totales.validas === 0}
              >
                Descargar PLAME (.txt)
              </button>
              <button
                className="btn btn-blue"
                onClick={handleExportTRegistro}
                disabled={busy || loading}
              >
                Descargar T-Registro Alta (.txt)
              </button>
              <button
                className="btn btn-primary"
                onClick={handleExportBoletas}
                disabled={busy || loading || totales.validas === 0}
              >
                Descargar Boletas (PDF)
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--tm)' }}>
              Los archivos .txt usan formato pipe-delimited compatible con PDT 601 SUNAT.
              Las boletas excluyen registros con neto ≤ 0.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

window.PlamePage = PlamePage;

export default PlamePage;
