import React from "react";
import {
  generateLibroDiarioPLE,
  generateLibroMayorPLE,
  generateRegistroComprasPLE,
  generateRegistroVentasPLE,
  downloadPLE,
} from '../lib/sunat-ple.js';
import { generatePDT601, buildPDT601Filename } from '../lib/sunat-pdt601.js';
import { generarAsientosBatch } from '../lib/asientos.js';

const { useState: uS, useMemo: uM, useEffect: uE } = React;

const MESES_LARGOS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
const fmtS = (n) => 'S/ ' + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function pad2(n) { return String(n || 0).padStart(2, '0'); }

function isInPeriodo(fecha, anio, mes) {
  if (!fecha) return false;
  const d = (fecha instanceof Date) ? fecha : new Date(fecha);
  if (isNaN(d.getTime())) return false;
  return d.getFullYear() === Number(anio) && (d.getMonth() + 1) === Number(mes);
}

function LibrosElectronicosPage({ showToast }) {
  const today = new Date();
  const [anio, setAnio] = uS(today.getFullYear());
  const [mes,  setMes]  = uS(today.getMonth() + 1);
  const [companyId, setCompanyId] = uS('');
  const [busy, setBusy] = uS(false);

  const { data: companies = [] } = window.__hooks.useCompanies();
  const { data: movs       = [] } = window.__hooks.useAccountingMovements();
  const { data: planillas  = [] } = window.__hooks.usePlanillas
    ? window.__hooks.usePlanillas()
    : { data: [] };

  // selección por defecto: primera empresa
  uE(() => {
    if (!companyId && companies.length > 0) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const company = uM(
    () => companies.find(c => c.id === companyId) || null,
    [companies, companyId]
  );

  // Filtro de movimientos por período + empresa
  const movsPeriodo = uM(() => {
    return (movs || []).filter(m => {
      if (!m || m.deleted_at) return false;
      if (m.payment_status === 'cancelled') return false;
      if (companyId && m.company_id && m.company_id !== companyId) return false;
      return isInPeriodo(m.date || m.created_at, anio, mes);
    });
  }, [movs, anio, mes, companyId]);

  const movsCompras = uM(
    () => movsPeriodo.filter(m => m.type === 'cost' || m.type === 'expense'),
    [movsPeriodo]
  );
  const movsVentas = uM(
    () => movsPeriodo.filter(m => m.type === 'income'),
    [movsPeriodo]
  );

  // Asientos (Libro Diario / Mayor)
  const asientos = uM(
    () => generarAsientosBatch(movsPeriodo),
    [movsPeriodo]
  );

  // Totales para card resumen
  const resumen = uM(() => {
    const totVentas = movsVentas.reduce((s, m) => s + Number(m.amount || 0), 0);
    const totCompras = movsCompras.reduce((s, m) => s + Number(m.amount || 0), 0);
    return {
      registros: movsPeriodo.length,
      ventas:    totVentas,
      compras:   totCompras,
      asientos:  asientos.length,
    };
  }, [movsPeriodo, movsVentas, movsCompras, asientos]);

  // Planilla del período seleccionado
  const planillaPeriodo = uM(() => {
    return (planillas || []).find(p =>
      p && !p.deleted_at
      && Number(p.periodo_anio) === Number(anio)
      && Number(p.periodo_mes)  === Number(mes)
      && (!companyId || p.company_id === companyId)
    ) || null;
  }, [planillas, anio, mes, companyId]);

  const periodo = { anio: Number(anio), mes: Number(mes) };
  const ruc = company?.ruc || '';
  const rucValid = String(ruc).length === 11;

  // ─── Descargas ──────────────────────────────────────────────
  const handleLibroDiario = () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    const out = generateLibroDiarioPLE(asientos, periodo, ruc);
    if (!out.content) return showToast?.('Sin asientos en el período', 'orange');
    downloadPLE(out.filename, out.content);
    showToast?.(`Libro Diario PLE: ${out.registros} asientos`, 'green');
  };

  const handleLibroMayor = () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    const out = generateLibroMayorPLE(asientos, periodo, ruc);
    if (!out.content) return showToast?.('Sin asientos en el período', 'orange');
    downloadPLE(out.filename, out.content);
    showToast?.(`Libro Mayor PLE: ${out.registros} cuentas`, 'green');
  };

  const handleRegistroCompras = () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    const out = generateRegistroComprasPLE(movsCompras, periodo, ruc);
    if (!out.content) return showToast?.('Sin compras en el período', 'orange');
    downloadPLE(out.filename, out.content);
    showToast?.(`Registro Compras PLE: ${out.registros} comprobantes`, 'green');
  };

  const handleRegistroVentas = () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    const out = generateRegistroVentasPLE(movsVentas, periodo, ruc);
    if (!out.content) return showToast?.('Sin ventas en el período', 'orange');
    downloadPLE(out.filename, out.content);
    showToast?.(`Registro Ventas PLE: ${out.registros} comprobantes`, 'green');
  };

  const handlePDT601 = async () => {
    if (!rucValid) return showToast?.('La empresa no tiene RUC válido', 'red');
    if (!planillaPeriodo) return showToast?.('No hay planilla cerrada para este período', 'red');
    setBusy(true);
    try {
      // Cargar boletas + personal + contratos
      const boletas = await window.__db.planilla_boletas
        .where('planilla_id').equals(planillaPeriodo.id)
        .filter(b => !b.deleted_at)
        .toArray();
      let personalList = [];
      try {
        personalList = await window.__db.personal
          .filter(p => !p.deleted_at)
          .toArray();
      } catch (_) {}
      const contratos = [];
      for (const p of personalList) {
        try {
          const cs = await window.__db.personal_contrato
            .where('personal_id').equals(p.id)
            .filter(c => !c.deleted_at)
            .toArray();
          contratos.push(...cs);
        } catch (_) {}
      }
      const txt = generatePDT601(planillaPeriodo, boletas, contratos, personalList, company);
      const filename = buildPDT601Filename(ruc, periodo);
      downloadPLE(filename, txt);
      showToast?.(`PDT 601 generado: ${boletas.length} trabajadores`, 'green');
    } catch (e) {
      console.error('[PDT601]', e);
      showToast?.('Error al generar PDT 601: ' + e.message, 'red');
    } finally {
      setBusy(false);
    }
  };

  // ─── Definición de cards ────────────────────────────────────
  const cards = [
    {
      key: 'diario',
      titulo: 'Libro Diario',
      formato: 'PLE 5.1.0 — código 050100',
      color: 'var(--blue)',
      registros: asientos.length,
      warning: !rucValid ? 'Empresa sin RUC válido' : (asientos.length === 0 ? 'No hay asientos en el período' : null),
      onDownload: handleLibroDiario,
      label: 'Asientos contables del período',
    },
    {
      key: 'mayor',
      titulo: 'Libro Mayor',
      formato: 'PLE 6.1.0 — código 060100',
      color: 'var(--purple, #8b5cf6)',
      registros: asientos.length,
      warning: !rucValid ? 'Empresa sin RUC válido' : (asientos.length === 0 ? 'No hay asientos en el período' : null),
      onDownload: handleLibroMayor,
      label: 'Acumulados por cuenta contable',
    },
    {
      key: 'compras',
      titulo: 'Registro de Compras',
      formato: 'PLE 8.1.0 — código 080100',
      color: 'var(--orange)',
      registros: movsCompras.length,
      warning: !rucValid ? 'Empresa sin RUC válido' : (movsCompras.length === 0 ? 'No hay compras en el período' : null),
      onDownload: handleRegistroCompras,
      label: 'Comprobantes de costos y gastos',
    },
    {
      key: 'ventas',
      titulo: 'Registro de Ventas',
      formato: 'PLE 14.1.0 — código 140100',
      color: 'var(--green)',
      registros: movsVentas.length,
      warning: !rucValid ? 'Empresa sin RUC válido' : (movsVentas.length === 0 ? 'No hay ventas en el período' : null),
      onDownload: handleRegistroVentas,
      label: 'Comprobantes de ingresos',
    },
  ];

  return (
    <div className="page-wrap">
      <div className="pg-hd frow-sb">
        <div>
          <div className="pg-title">Libros Electrónicos / PDT 601</div>
          <div className="pg-sub">Exportación SUNAT — PLE 5.x y Planilla Mensual</div>
        </div>
      </div>

      {/* Selector empresa + período */}
      <div className="card card-p" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
        <div>
          <label className="flabel">Empresa</label>
          <select
            className="fi"
            value={companyId}
            onChange={e => setCompanyId(e.target.value)}
          >
            {companies.length === 0 && <option value="">— sin empresas —</option>}
            {companies.map(c => (
              <option key={c.id} value={c.id}>
                {c.legal_name || c.name} {c.ruc ? `· RUC ${c.ruc}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="flabel">Año</label>
          <select className="fi" value={anio} onChange={e => setAnio(Number(e.target.value))}>
            {[anio + 1, anio, anio - 1, anio - 2, anio - 3].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="flabel">Mes</label>
          <select className="fi" value={mes} onChange={e => setMes(Number(e.target.value))}>
            {MESES_LARGOS.map((m, i) => (
              <option key={i} value={i + 1}>{m}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Card resumen */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 16 }}>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Movimientos del período</div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>{resumen.registros}</div>
        </div>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Total Ventas</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--green)' }}>{fmtS(resumen.ventas)}</div>
        </div>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Total Compras</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--orange)' }}>{fmtS(resumen.compras)}</div>
        </div>
        <div className="card card-p" style={{ padding: 12, textAlign: 'center' }}>
          <div style={{ color: 'var(--tm)', fontSize: 11 }}>Asientos generados</div>
          <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--blue)' }}>{resumen.asientos}</div>
        </div>
      </div>

      {company && !rucValid && (
        <div className="card card-p" style={{ padding: 12, marginBottom: 16, background: '#fee', border: '1px solid #f99' }}>
          <strong style={{ color: '#a00' }}>Atención:</strong>
          <span style={{ marginLeft: 8 }}>
            La empresa "{company.legal_name || company.name}" no tiene RUC de 11 dígitos. SUNAT no aceptará los archivos.
          </span>
        </div>
      )}

      {/* Cards de descarga PLE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 16 }}>
        {cards.map(c => (
          <div key={c.key} className="card card-p" style={{ padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{
                width: 8, height: 28, background: c.color, borderRadius: 4
              }} />
              <div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.titulo}</div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{c.formato}</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--tm)' }}>{c.label}</div>
                <div style={{ fontWeight: 700, fontSize: 22, color: c.color }}>{c.registros}</div>
              </div>
              <button
                className="btn btn-amber"
                onClick={c.onDownload}
                disabled={busy || !!c.warning}
              >
                Descargar PLE (.txt)
              </button>
            </div>
            {c.warning && (
              <div style={{
                marginTop: 10, padding: 8,
                background: '#fee', border: '1px solid #f99', borderRadius: 6,
                color: '#a00', fontSize: 12
              }}>
                {c.warning}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Card PDT 601 */}
      <div className="card card-p" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <div style={{
            width: 8, height: 28, background: 'var(--gold, #f2b705)', borderRadius: 4
          }} />
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>PDT 601 — Planilla Mensual</div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              Formato txt importable a SUNAT Operaciones en Línea (PLAME).
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 10 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>Trabajadores en planilla del período</div>
            <div style={{ fontWeight: 700, fontSize: 22, color: 'var(--gold, #f2b705)' }}>
              {planillaPeriodo?.total_trabajadores ?? '—'}
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={handlePDT601}
            disabled={busy || !rucValid || !planillaPeriodo}
          >
            Descargar PDT 601 (.txt)
          </button>
        </div>
        {!planillaPeriodo && (
          <div style={{
            marginTop: 10, padding: 8,
            background: '#fee', border: '1px solid #f99', borderRadius: 6,
            color: '#a00', fontSize: 12
          }}>
            No existe una planilla cerrada para {MESES_LARGOS[mes - 1]} {anio}.
            Crea una en el módulo Planillas y asóciala a la empresa.
          </div>
        )}
        {planillaPeriodo && (
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--tm)' }}>
            Período: {MESES_LARGOS[mes - 1]} {anio} · Planilla: {planillaPeriodo.id?.slice(0, 8)} · Neto {fmtS(planillaPeriodo.total_neto)}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, fontSize: 11, color: 'var(--tm)' }}>
        Los archivos se generan en formato pipe-delimited UTF-8 con terminación CRLF, según especificación PLE 5.x.
        Si tu validador detecta errores, revisa el RUC, la consistencia de fechas y el cuadre Debe/Haber.
      </div>
    </div>
  );
}

window.LibrosElectronicosPage = LibrosElectronicosPage;

export default LibrosElectronicosPage;
