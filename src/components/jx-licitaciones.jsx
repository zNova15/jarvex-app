// ═══════════════════════════════════════════════════════════════════
// JARVEX — POSTULACIONES (tanda 15, entrega 1).
//
// El bloque "Licitaciones" prometía desde la tanda 2 "el plantel profesional
// Y LOS TRABAJOS A LOS QUE NOS PRESENTAMOS". Esta es la segunda mitad.
//
// QUÉ CAMBIA RESPECTO DE LO QUE YA HABÍA. El verificador de requisitos
// mínimos ya existía (Registro Profesional › Buscar plantel, mig 171), pero
// los requisitos se tipeaban de cero cada vez y se perdían al cerrar la
// pestaña. Servía para una consulta suelta, no para trabajar: nadie podía
// volver mañana a ver contra qué proceso se había evaluado, ni qué se decidió.
// Acá los requisitos son de UNA postulación y quedan guardados, con el nombre
// del candidato que se eligió para cada puesto.
//
// LA PANTALLA CONTESTA UNA PREGUNTA, NO MUESTRA UNA TABLA: "¿calificamos?".
// Por eso el veredicto va en la tarjeta de la lista, antes de abrir nada — el
// costo real no es preparar mal una propuesta, es invertir una semana en un
// proceso que nunca calificaba.
//
// EL PASO A TRABAJOS ES UN BOTÓN, NO UN AUTOMATISMO. Al ganar se prellena el
// borrador de la obra (src/lib/licitaciones.js → prefillObraDesde) y una
// persona confirma. Prellenar no es crear.
//
// LA POSTULACIÓN NACE DEL DOCUMENTO, NO AL REVÉS (entrega 4, 8-set-2026).
// Gabriel: «esa herramienta para leer las bases y las fechas de inscripción me
// debería ayudar a crear una nueva postulación, no al revés». En la entrega 3
// el lector vivía DENTRO de una postulación ya creada a mano. Ahora la puerta
// principal es «Leer bases o convocatoria»: se sube el aviso de El Peruano o
// las bases, se revisa lo que salió y recién ahí se crea la postulación con
// sus datos, su calendario, sus puestos y sus requisitos de empresa. El
// lector sigue disponible adentro para COMPLEMENTAR (primero la convocatoria,
// después las bases integradas).
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  ETAPAS, ETAPA_LBL, ETAPA_BADGE, ETAPA_DEFAULT, esCerrada,
  TIPOS_PROCESO, TIPO_PROCESO_LBL, TIPO_PROCESO_DEFAULT, ORIGENES,
  requisitosDePersonal, veredictoPlantel, resumenVeredicto,
  urgencia, prefillObraDesde, puedePasarATrabajos, destinoAlGanar,
} from "../lib/licitaciones.js";
import { buscarPlantel, formatearMeses } from "../lib/experiencia-profesional.js";
import { TIPO_GARANTIA_LBL, TIPO_CONDICION_LBL } from "../lib/bases-extraccion.js";
import { getCurrentMode } from "../lib/app-mode-core.js";

const { useState: uS, useMemo: uM, useRef: uR } = React;

const nombreDe = (p) => `${p?.nombres || ''} ${p?.apellidos || ''}`.trim() || '(sin nombre)';
const hoyLocal = () => (window.__fecha?.hoyLocal?.() || new Date().toISOString().slice(0, 10));
const money = (n, mon = 'PEN') => n == null || n === ''
  ? '—'
  : `${mon === 'USD' ? 'US$' : 'S/'} ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MECANISMO_LBL = {
  oxi: 'Obras por Impuestos (Ley 29230)',
  ley_contrataciones: 'Ley de Contrataciones del Estado',
  privado: 'Privado',
  otro: 'Otro',
};
const MECANISMOS = Object.entries(MECANISMO_LBL).map(([v, label]) => ({ v, label }));
const dias = (n) => (n == null ? '—' : `${n} días`);

const URG_COLOR = {
  vencida: 'var(--red)', hoy: 'var(--red)', alta: 'var(--amber)',
  normal: 'var(--tm)', sin_fecha: 'var(--tm)', ninguna: 'var(--tm)',
};

function LicitacionesPage({ showToast }) {
  const toast = showToast || (() => {});
  const auth = window.__useAuth?.();
  const rol = auth?.profile?.rol;
  const userId = auth?.profile?.id ?? 'offline';
  const canWrite = rol === 'admin' || (window.__hasPerm?.(rol, 'Licitaciones', 'w') ?? false);

  const { data: licitaciones } = window.__hooks.useLicitaciones();
  const { data: requisitos } = window.__hooks.useLicitacionRequisitos();
  const { data: personal } = window.__hooks.usePersonal();
  const { data: fichas } = window.__hooks.usePersonalProfesional();
  const { data: experiencias } = window.__hooks.usePersonalExperiencia();
  const { data: rubros } = window.__hooks.useRubrosObra();
  const { data: companies } = window.__hooks.useCompanies();

  const [q, setQ] = uS('');
  const [filtroEtapa, setFiltroEtapa] = uS('abiertas');
  const [abierta, setAbierta] = uS(null);      // id de la postulación abierta
  const [creando, setCreando] = uS(false);     // alta a mano
  const [leyendoNueva, setLeyendoNueva] = uS(false);   // alta desde el documento
  const [busy, setBusy] = uS(false);
  // Regla crítica 2: el guard por estado llega tarde (se activa recién tras el
  // await a Dexie). El ref corta el segundo click en el mismo tick.
  const enCursoRef = uR(false);

  const hoy = hoyLocal();
  const esPrueba = getCurrentMode() === 'prueba';
  const marcaModo = esPrueba
    ? { demo: true, sync_status: 'synced' }
    : { sync_status: 'pending_create' };

  // ── Candidatos: mismo armado que Registro Profesional ────────────
  const fichaPorPersona = uM(() => {
    const m = new Map();
    for (const f of (fichas || [])) if (!f.deleted_at) m.set(f.personal_id, f);
    return m;
  }, [fichas]);
  const expsPorPersona = uM(() => {
    const m = new Map();
    for (const e of (experiencias || [])) {
      if (e.deleted_at) continue;
      if (!m.has(e.personal_id)) m.set(e.personal_id, []);
      m.get(e.personal_id).push(e);
    }
    return m;
  }, [experiencias]);
  const candidatos = uM(() => (personal || [])
    .filter(p => !p.deleted_at)
    .map(p => ({
      persona: p,
      ficha: fichaPorPersona.get(p.id) || null,
      experiencias: expsPorPersona.get(p.id) || [],
    })), [personal, fichaPorPersona, expsPorPersona]);

  const vivas = uM(() => (licitaciones || []).filter(l => !l.deleted_at), [licitaciones]);

  // El veredicto de CADA postulación, para poder mostrarlo en la lista sin
  // abrir nada. Es la razón de ser de la pantalla.
  const veredictos = uM(() => {
    const m = new Map();
    for (const l of vivas) {
      const reqs = requisitosDePersonal(requisitos, l.id);
      m.set(l.id, veredictoPlantel(buscarPlantel(candidatos, reqs, { hoy })));
    }
    return m;
  }, [vivas, requisitos, candidatos, hoy]);

  const listado = uM(() => {
    const t = q.trim().toLowerCase();
    return vivas
      .filter(l => filtroEtapa === 'todas'
        || (filtroEtapa === 'abiertas' ? !esCerrada(l.etapa) : l.etapa === filtroEtapa))
      .filter(l => !t
        || String(l.objeto || '').toLowerCase().includes(t)
        || String(l.nomenclatura || '').toLowerCase().includes(t)
        || String(l.entidad_convocante || '').toLowerCase().includes(t))
      .sort((a, b) => {
        // Lo que corre primero: las abiertas con fecha más próxima arriba.
        const ca = esCerrada(a.etapa), cb = esCerrada(b.etapa);
        if (ca !== cb) return ca ? 1 : -1;
        const fa = a.fecha_presentacion || '9999-12-31';
        const fb = b.fecha_presentacion || '9999-12-31';
        return fa.localeCompare(fb) || String(a.objeto || '').localeCompare(String(b.objeto || ''));
      });
  }, [vivas, q, filtroEtapa]);

  const conteoAbiertas = uM(() => vivas.filter(l => !esCerrada(l.etapa)).length, [vivas]);

  // ── Escrituras ───────────────────────────────────────────────────
  const avisar = (tabla) => {
    window.dispatchEvent(new CustomEvent('jx_data_changed', { detail: { tabla } }));
    try { window.dispatchEvent(new Event('online')); } catch {}
  };

  const guardarLicitacion = async (campos, id = null) => {
    if (enCursoRef.current) return null;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      if (id) {
        const prev = vivas.find(l => l.id === id);
        await window.__db.licitaciones.update(id, {
          ...campos, updated_at: ahora, updated_by: userId,
          version: (prev?.version ?? 0) + 1,
          sync_status: prev?.demo === true ? 'synced'
            : (prev?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
        avisar('licitaciones');
        toast('Postulación guardada', 'green');
        return id;
      }
      const nid = window.__newId();
      await window.__db.licitaciones.add({
        id: nid, etapa: ETAPA_DEFAULT, moneda: 'PEN',
        tipo_trabajo: TIPO_PROCESO_DEFAULT, origen: 'publico',
        ...campos,
        created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
        idempotency_key: `lic_${nid}`,
        ...marcaModo,
      });
      avisar('licitaciones');
      toast('Postulación creada', 'green');
      return nid;
    } catch (e) {
      toast('No se pudo guardar: ' + (e?.message || e), 'red');
      return null;
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  const guardarRequisito = async (licitacionId, campos, id = null) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      if (id) {
        const prev = (requisitos || []).find(r => r.id === id);
        await window.__db.licitacion_requisitos.update(id, {
          ...campos, updated_at: ahora, updated_by: userId,
          version: (prev?.version ?? 0) + 1,
          sync_status: prev?.demo === true ? 'synced'
            : (prev?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
      } else {
        const nid = window.__newId();
        await window.__db.licitacion_requisitos.add({
          id: nid, licitacion_id: licitacionId, clase: 'personal', fuente: 'manual',
          orden: ((requisitos || []).filter(r => r.licitacion_id === licitacionId && !r.deleted_at).length + 1) * 10,
          meses_minimos: 0, exige_colegiatura: true, exige_sustento: true,
          ...campos,
          created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
          idempotency_key: `licreq_${nid}`,
          ...marcaModo,
        });
      }
      avisar('licitacion_requisitos');
    } catch (e) {
      toast('No se pudo guardar el requisito: ' + (e?.message || e), 'red');
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  /**
   * Lo que aprobó el análisis de bases, guardado de una sola vez.
   *
   * NO se reusa `guardarRequisito` en un bucle: tiene un guard síncrono
   * (`enCursoRef`) que corta la segunda llamada mientras la primera está en
   * vuelo, así que un for-loop guardaría el primer puesto y descartaría los
   * otros ocho EN SILENCIO. Un lote es una escritura, con un guard, y avisa
   * una vez al final.
   */
  /** Las filas de requisitos (personal Y empresa) listas para bulkAdd. */
  const filasParaInsertar = (licitacionId, requisitos, base, ahora) => requisitos.map((campos, i) => {
    const nid = window.__newId();
    // `verificada` y su motivo son de la pantalla, no columnas de la tabla:
    // si viajan al insert, Dexie los guarda y el push a Supabase falla.
    const { verificada, verificacion_motivo, ...fila } = campos;
    void verificada; void verificacion_motivo;
    return {
      id: nid, licitacion_id: licitacionId,
      ...fila,
      orden: (base + i + 1) * 10,
      created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora,
      version: 1, idempotency_key: `licreq_${nid}`,
      ...marcaModo,
    };
  });

  /** La entrada de la bitácora `licitaciones.analisis` de esta lectura. */
  const entradaBitacora = ({ archivo, costo, modelos, paginasOcr, requisitos }) => ({
    fecha: new Date().toISOString(),
    archivo: archivo || null,
    costo: costo?.total ?? null,
    modelos: modelos || [],
    paginasOcr: paginasOcr ?? null,
    requisitos: requisitos ?? 0,
  });

  /** Las listas de la mig 200 que traiga la lectura, solo si hay algo. */
  const parcheDeExtras = (extras, previo = null) => {
    const patch = {};
    for (const clave of ['factores_evaluacion', 'garantias', 'penalidades', 'documentos_presentacion', 'condiciones']) {
      const lista = extras?.[clave];
      if (!Array.isArray(lista) || !lista.length) continue;
      // No se pisa lo que ya había: una segunda lectura SUMA lo que la
      // primera no encontró (la convocatoria primero, las bases después).
      const previas = Array.isArray(previo?.[clave]) ? previo[clave] : [];
      if (!previas.length) { patch[clave] = lista; continue; }
      const vistos = new Set(previas.map(x => JSON.stringify([x.factor, x.titulo, x.documento, x.tipo, x.detalle])));
      const nuevas = lista.filter(x => !vistos.has(JSON.stringify([x.factor, x.titulo, x.documento, x.tipo, x.detalle])));
      if (nuevas.length) patch[clave] = [...previas, ...nuevas];
    }
    return patch;
  };

  const aplicarAnalisis = async (licitacionId, {
    requisitos = [], requisitosEmpresa = [], cabecera = null, cronograma = null,
    extras = null, alertas = null, costo = null, bitacora = null,
  }) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      // Desde qué número siguen los puestos nuevos: los que ya estaban cargados
      // no se tocan ni se renumeran.
      const base = (await window.__db.licitacion_requisitos
        .where('licitacion_id').equals(licitacionId).toArray())
        .filter(r => !r.deleted_at).length;
      const filas = filasParaInsertar(licitacionId, [...requisitos, ...requisitosEmpresa], base, ahora);
      if (filas.length) await window.__db.licitacion_requisitos.bulkAdd(filas);
      const prev = vivas.find(l => l.id === licitacionId);
      const patch = { ...(cabecera || {}) };
      // El calendario se guarda solo si la postulación todavía no tiene uno:
      // pisar uno cargado a mano con una lectura automática es peor que no leer.
      if (Array.isArray(cronograma) && cronograma.length && !(Array.isArray(prev?.cronograma) && prev.cronograma.length)) {
        patch.cronograma = cronograma;
      }
      Object.assign(patch, parcheDeExtras(extras, prev));
      // Lo que el lector marcó para revisar se guarda: en la prueba del 8-set
      // el modelo avisó que una fecha venía truncada, y eso se perdía al cerrar.
      if (Array.isArray(alertas) && alertas.length) {
        const previas = Array.isArray(prev?.alertas) ? prev.alertas : [];
        patch.alertas = [...new Set([...previas, ...alertas])].slice(0, 60);
      }
      if (bitacora) patch.analisis = [...(Array.isArray(prev?.analisis) ? prev.analisis : []), entradaBitacora({ ...bitacora, costo, requisitos: filas.length })];
      if (Object.keys(patch).length) {
        await window.__db.licitaciones.update(licitacionId, {
          ...patch, updated_at: ahora, updated_by: userId,
          version: (prev?.version ?? 0) + 1,
          sync_status: prev?.demo === true ? 'synced'
            : (prev?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
        });
        avisar('licitaciones');
      }
      avisar('licitacion_requisitos');
      const plata = costo?.total ? ` · costó USD ${Number(costo.total).toFixed(3)}` : '';
      toast(`✓ ${requisitos.length} puesto(s) y ${requisitosEmpresa.length} requisito(s) de empresa cargados desde el documento${plata}`, 'green');
    } catch (e) {
      toast('No se pudieron guardar los requisitos: ' + (e?.message || e), 'red');
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  /**
   * La postulación que NACE del documento (entrega 4). Una sola escritura con
   * un guard: la cabecera ya revisada, el calendario, los puestos y los
   * requisitos de empresa que la persona tildó.
   */
  const crearDesdeAnalisis = async ({
    cabecera = {}, requisitos = [], requisitosEmpresa = [], cronograma = [],
    extras = null, alertas = null, costo = null, bitacora = null,
  }) => {
    if (enCursoRef.current) return null;
    enCursoRef.current = true;
    setBusy(true);
    try {
      const ahora = new Date().toISOString();
      const nid = window.__newId();
      const filas = filasParaInsertar(nid, [...requisitos, ...requisitosEmpresa], 0, ahora);
      await window.__db.licitaciones.add({
        id: nid, etapa: 'requisitos', moneda: 'PEN',
        tipo_trabajo: TIPO_PROCESO_DEFAULT, origen: 'publico',
        ...cabecera,
        cronograma: Array.isArray(cronograma) ? cronograma : [],
        consorcio: [],
        ...parcheDeExtras(extras),
        alertas: Array.isArray(alertas) ? alertas.slice(0, 60) : [],
        analisis: bitacora ? [entradaBitacora({ ...bitacora, costo, requisitos: filas.length })] : [],
        fuente: 'extraccion',
        created_by: userId, updated_by: userId, created_at: ahora, updated_at: ahora, version: 1,
        idempotency_key: `lic_${nid}`,
        ...marcaModo,
      });
      if (filas.length) await window.__db.licitacion_requisitos.bulkAdd(filas);
      avisar('licitaciones'); avisar('licitacion_requisitos');
      const plata = costo?.total ? ` · la lectura costó USD ${Number(costo.total).toFixed(3)}` : '';
      toast(`✓ Postulación creada desde el documento con ${filas.length} requisito(s)${plata}`, 'green');
      return nid;
    } catch (e) {
      toast('No se pudo crear la postulación: ' + (e?.message || e), 'red');
      return null;
    } finally { setBusy(false); enCursoRef.current = false; }
  };

  /** Cambios sueltos de una postulación abierta (consorcio, notas) sin toast. */
  const patchLicitacion = async (id, campos) => {
    try {
      const prev = vivas.find(l => l.id === id);
      const ahora = new Date().toISOString();
      await window.__db.licitaciones.update(id, {
        ...campos, updated_at: ahora, updated_by: userId,
        version: (prev?.version ?? 0) + 1,
        sync_status: prev?.demo === true ? 'synced'
          : (prev?.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      avisar('licitaciones');
    } catch (e) { toast('No se pudo guardar: ' + (e?.message || e), 'red'); }
  };

  const borrarRequisito = async (row) => {
    if (!window.confirm(`¿Quitar el puesto "${row.cargo || 'sin cargo'}"?`)) return;
    try {
      const ahora = new Date().toISOString();
      await window.__db.licitacion_requisitos.update(row.id, {
        deleted_at: ahora, updated_at: ahora, updated_by: userId,
        version: (row.version ?? 0) + 1,
        sync_status: row.demo === true ? 'synced'
          : (row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      avisar('licitacion_requisitos');
    } catch (e) { toast('No se pudo quitar: ' + (e?.message || e), 'red'); }
  };

  const borrarLicitacion = async (lic) => {
    if (!window.confirm(`¿Eliminar la postulación "${lic.objeto}"? Se van también sus requisitos.`)) return;
    try {
      const ahora = new Date().toISOString();
      const patch = (row) => ({
        deleted_at: ahora, updated_at: ahora, updated_by: userId,
        version: (row.version ?? 0) + 1,
        sync_status: row.demo === true ? 'synced'
          : (row.sync_status === 'pending_create' ? 'pending_create' : 'pending_update'),
      });
      for (const r of (requisitos || []).filter(r => r.licitacion_id === lic.id && !r.deleted_at)) {
        await window.__db.licitacion_requisitos.update(r.id, patch(r));
      }
      await window.__db.licitaciones.update(lic.id, patch(lic));
      avisar('licitacion_requisitos'); avisar('licitaciones');
      setAbierta(null);
      toast('Postulación eliminada', 'green');
    } catch (e) { toast('No se pudo eliminar: ' + (e?.message || e), 'red'); }
  };

  const licAbierta = vivas.find(l => l.id === abierta) || null;

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>Postulaciones</h2>
          <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>
            Los procesos a los que nos presentamos, y si calificamos — antes de invertir una semana en el expediente.
          </div>
        </div>
        {canWrite && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {/* LA PUERTA PRINCIPAL (entrega 4): la postulación nace del
                documento. El alta a mano queda para lo que no tiene papel. */}
            <button className="btn btn-blue btn-sm" onClick={() => setLeyendoNueva(true)}
              title="Sube el aviso de El Peruano o las bases: se leen y la postulación se crea con sus datos, su calendario y sus requisitos">
              🔎 Leer bases o convocatoria
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setCreando(true)}>+ A mano</button>
          </div>
        )}
      </div>

      <div className="card card-p" style={{ marginBottom: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="fi" placeholder="Buscar por objeto, nomenclatura o entidad…" value={q}
          onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
        <select className="fi" value={filtroEtapa} onChange={e => setFiltroEtapa(e.target.value)} style={{ width: 220 }}>
          <option value="abiertas">En juego ({conteoAbiertas})</option>
          <option value="todas">Todas ({vivas.length})</option>
          {ETAPAS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
        </select>
      </div>

      {listado.length === 0 ? (
        <div className="card card-p empty-state" style={{ padding: '34px 0', textAlign: 'center' }}>
          {vivas.length === 0
            ? <>Todavía no hay postulaciones. Sube la <b>convocatoria</b> (el aviso de El Peruano) o las <b>bases</b> con
              «Leer bases o convocatoria»: la postulación se crea desde ahí, con su calendario y sus requisitos.</>
            : 'Ninguna postulación coincide con el filtro.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {listado.map(l => {
            const v = veredictos.get(l.id);
            const u = urgencia(l, hoy);
            return (
              <div key={l.id} className="card card-p" style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '2 1 320px', minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{l.objeto}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                    {l.nomenclatura ? `${l.nomenclatura} · ` : ''}
                    {l.entidad_convocante || 'sin entidad'}
                    {' · '}{TIPO_PROCESO_LBL[l.tipo_trabajo] || l.tipo_trabajo}
                  </div>
                  <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>
                    Valor referencial {money(l.valor_referencial, l.moneda)}
                  </div>
                </div>

                <div style={{ flex: '1 1 170px' }}>
                  <span className={`badge ${ETAPA_BADGE[l.etapa] || 'b-gray'}`} style={{ fontSize: 9 }}>
                    {ETAPA_LBL[l.etapa] || l.etapa}
                  </span>
                  <div style={{ fontSize: 10.5, marginTop: 3, color: URG_COLOR[u.nivel] }}>
                    {u.texto || (l.fecha_presentacion ? `Presentación ${l.fecha_presentacion}` : '')}
                  </div>
                </div>

                <div style={{ flex: '1 1 190px' }}>
                  <div style={{ fontSize: 15, lineHeight: 1.1 }} title="Veredicto del plantel">
                    {!v?.total ? '❓' : (v.limpio ? '✅' : (v.califica ? '⚠️' : '⛔'))}
                    <span style={{
                      fontSize: 11.5, marginLeft: 6,
                      color: !v?.total ? 'var(--tm)' : (v.califica ? (v.limpio ? 'var(--green)' : 'var(--amber)') : 'var(--red)'),
                    }}>
                      {resumenVeredicto(v)}
                    </span>
                  </div>
                </div>

                <div style={{ flex: '0 0 auto' }}>
                  <button className="btn btn-ghost btn-xs" onClick={() => setAbierta(l.id)}>Abrir ›</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creando && (
        <PostulacionModal
          lic={null} rubros={rubros || []} companies={companies || []}
          canWrite={canWrite} busy={busy}
          onClose={() => setCreando(false)}
          onGuardar={async (campos) => {
            const id = await guardarLicitacion(campos);
            if (id) { setCreando(false); setAbierta(id); }
          }}
        />
      )}

      {leyendoNueva && (
        <AnalisisBasesModal
          lic={null} rubros={rubros || []} companies={companies || []} toast={toast}
          onClose={() => setLeyendoNueva(false)}
          onCrear={async (payload) => {
            const id = await crearDesdeAnalisis(payload);
            if (id) { setLeyendoNueva(false); setAbierta(id); }
            return id;
          }}
        />
      )}

      {licAbierta && (
        <DetalleModal
          lic={licAbierta}
          requisitos={(requisitos || []).filter(r => r.licitacion_id === licAbierta.id && !r.deleted_at)}
          veredicto={veredictos.get(licAbierta.id)}
          candidatos={candidatos} rubros={rubros || []} companies={companies || []}
          hoy={hoy} canWrite={canWrite} busy={busy}
          onClose={() => setAbierta(null)}
          onGuardarLic={(campos) => guardarLicitacion(campos, licAbierta.id)}
          onPatchLic={(campos) => patchLicitacion(licAbierta.id, campos)}
          onGuardarReq={(campos, id) => guardarRequisito(licAbierta.id, campos, id)}
          onBorrarReq={borrarRequisito}
          onAplicarAnalisis={(payload) => aplicarAnalisis(licAbierta.id, payload)}
          onBorrarLic={() => borrarLicitacion(licAbierta)}
          toast={toast}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ALTA — los datos mínimos del proceso
// ═══════════════════════════════════════════════════════════════════
function PostulacionModal({ lic, rubros, companies, canWrite, busy, onClose, onGuardar }) {
  const Modal = window.Modal;
  const [f, setF] = uS(() => ({
    objeto: lic?.objeto || '',
    nomenclatura: lic?.nomenclatura || '',
    entidad_convocante: lic?.entidad_convocante || '',
    tipo_trabajo: lic?.tipo_trabajo || TIPO_PROCESO_DEFAULT,
    origen: lic?.origen || 'publico',
    rubro_id: lic?.rubro_id || '',
    valor_referencial: lic?.valor_referencial ?? '',
    moneda: lic?.moneda || 'PEN',
    fecha_presentacion: lic?.fecha_presentacion || '',
    postulante_company_id: lic?.postulante_company_id || '',
    // Entrega 4: lo que la convocatoria dice del proyecto.
    nombre_inversion: lic?.nombre_inversion || '',
    cui: lic?.cui || '',
    mecanismo: lic?.mecanismo || '',
    plazo_ejecucion_dias: lic?.plazo_ejecucion_dias ?? '',
    lugar: lic?.lugar || '',
  }));
  const up = (patch) => setF(x => ({ ...x, ...patch }));
  if (!Modal) return null;

  const puedeGuardar = canWrite && !busy && f.objeto.trim().length > 2;

  return (
    <Modal title={lic ? 'Editar postulación' : 'Nueva postulación'} onClose={onClose} size="lg">
      <div style={{ display: 'grid', gap: 10 }}>
        <div>
          <label className="flabel">Objeto del proceso *</label>
          <input className="fi" value={f.objeto} onChange={e => up({ objeto: e.target.value })}
            placeholder="Mejoramiento del servicio de agua potable — Chilete" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label className="flabel">Nomenclatura</label>
            <input className="fi" value={f.nomenclatura} onChange={e => up({ nomenclatura: e.target.value })}
              placeholder="LP-SM-1-2026-MDCH-1" />
          </div>
          <div style={{ flex: '2 1 240px' }}>
            <label className="flabel">Entidad convocante</label>
            <input className="fi" value={f.entidad_convocante} onChange={e => up({ entidad_convocante: e.target.value })}
              placeholder="Municipalidad Distrital de Chilete" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label className="flabel">Tipo de proceso</label>
            <select className="fi" value={f.tipo_trabajo} onChange={e => up({ tipo_trabajo: e.target.value })}>
              {TIPOS_PROCESO.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px' }}>
            <label className="flabel">Origen</label>
            <select className="fi" value={f.origen} onChange={e => up({ origen: e.target.value })}>
              {ORIGENES.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label className="flabel">Rubro</label>
            <select className="fi" value={f.rubro_id} onChange={e => up({ rubro_id: e.target.value })}>
              <option value="">Sin rubro</option>
              {rubros.filter(r => r.activo !== false).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 160px' }}>
            <label className="flabel">Valor referencial</label>
            <input className="fi" type="number" step="0.01" value={f.valor_referencial}
              onChange={e => up({ valor_referencial: e.target.value })} />
          </div>
          <div style={{ flex: '0 1 100px' }}>
            <label className="flabel">Moneda</label>
            <select className="fi" value={f.moneda} onChange={e => up({ moneda: e.target.value })}>
              <option value="PEN">S/ (soles)</option>
              <option value="USD">US$ (dólares)</option>
            </select>
          </div>
          <div style={{ flex: '1 1 160px' }}>
            <label className="flabel">Presentación de ofertas</label>
            <input className="fi" type="date" value={f.fecha_presentacion}
              onChange={e => up({ fecha_presentacion: e.target.value })} />
          </div>
        </div>
        <div>
          <label className="flabel">Nombre de la inversión (como lo escribe la entidad)</label>
          <textarea className="fi" rows={2} value={f.nombre_inversion} onChange={e => up({ nombre_inversion: e.target.value })}
            placeholder="«MEJORAMIENTO Y AMPLIACION DEL SERVICIO DE … DE LA LOCALIDAD DE CHILETE …»" />
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
            Las cartas y anexos del expediente lo citan textual, con su CUI.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: '0 1 130px' }}>
            <label className="flabel">CUI</label>
            <input className="fi" value={f.cui} onChange={e => up({ cui: e.target.value.replace(/\D/g, '').slice(0, 8) })} placeholder="2611946" />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label className="flabel">Mecanismo</label>
            <select className="fi" value={f.mecanismo} onChange={e => up({ mecanismo: e.target.value })}>
              <option value="">Sin definir</option>
              {MECANISMOS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 130px' }}>
            <label className="flabel">Plazo (días)</label>
            <input className="fi" type="number" min="0" value={f.plazo_ejecucion_dias}
              onChange={e => up({ plazo_ejecucion_dias: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label className="flabel">Lugar</label>
            <input className="fi" value={f.lugar} onChange={e => up({ lugar: e.target.value })} placeholder="Chilete, Contumazá, Cajamarca" />
          </div>
        </div>
        <div>
          <label className="flabel">Postulamos con</label>
          <select className="fi" value={f.postulante_company_id} onChange={e => up({ postulante_company_id: e.target.value })}>
            <option value="">Sin definir</option>
            {companies.filter(c => !c.deleted_at).map(c => <option key={c.id} value={c.id}>{c.name || c.nombre}</option>)}
          </select>
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 3 }}>
            La empresa del grupo que lleva el RUC. Si va en consorcio, la que lo lidera; los socios se arman abajo, en «Cómo participar».
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancelar</button>
          <button className="btn btn-amber btn-sm" disabled={!puedeGuardar}
            onClick={() => onGuardar({
              ...f,
              rubro_id: f.rubro_id || null,
              postulante_company_id: f.postulante_company_id || null,
              fecha_presentacion: f.fecha_presentacion || null,
              valor_referencial: f.valor_referencial === '' ? null : Number(f.valor_referencial),
              nombre_inversion: f.nombre_inversion.trim() || null,
              cui: f.cui || null,
              mecanismo: f.mecanismo || null,
              plazo_ejecucion_dias: f.plazo_ejecucion_dias === '' ? null : Number(f.plazo_ejecucion_dias),
              lugar: f.lugar.trim() || null,
            })}>
            {lic ? 'Guardar' : 'Crear postulación'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// DETALLE — requisitos del proceso y el veredicto del plantel
// ═══════════════════════════════════════════════════════════════════
function DetalleModal({
  lic, requisitos, veredicto, candidatos, rubros, companies, hoy, canWrite, busy,
  onClose, onGuardarLic, onPatchLic, onGuardarReq, onBorrarReq, onBorrarLic, onAplicarAnalisis, toast,
}) {
  const Modal = window.Modal;
  const [editando, setEditando] = uS(false);
  const [nuevo, setNuevo] = uS(null);          // borrador del puesto nuevo
  const [analizando, setAnalizando] = uS(false);   // el lector de bases
  if (!Modal) return null;

  const v = veredicto;
  const ordenadas = [...requisitos].sort((a, b) => (a.orden ?? 100) - (b.orden ?? 100));
  // El plantel se evalúa contra el padrón; los requisitos de la EMPRESA
  // (clase 'empresa', mig 199) se muestran en «Cómo participar».
  const filas = ordenadas.filter(r => (r.clase || 'personal') === 'personal');
  const filasEmpresa = ordenadas.filter(r => r.clase === 'empresa');
  const cronograma = Array.isArray(lic.cronograma) ? lic.cronograma : [];
  const empresa = companies.find(c => c.id === lic.postulante_company_id);
  const u = urgencia(lic, hoy);
  const destino = destinoAlGanar(lic.tipo_trabajo);

  // Cada puesto de la tabla con su evaluación ya calculada por el veredicto.
  const puestoDe = (reqId) => (v?.puestos || []).find(p => p.requisitoId === reqId) || null;

  return (
    <Modal title={lic.objeto} onClose={onClose} size="xl">
      {/* ── Cabecera: el veredicto primero ── */}
      <div className="card card-p" style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 26, lineHeight: 1 }}>
            {!v?.total ? '❓' : (v.limpio ? '✅' : (v.califica ? '⚠️' : '⛔'))}
          </div>
          <div style={{ flex: '1 1 240px' }}>
            <div style={{ fontWeight: 700, fontSize: 13,
              color: !v?.total ? 'var(--tm)' : (v.califica ? (v.limpio ? 'var(--green)' : 'var(--amber)') : 'var(--red)') }}>
              {resumenVeredicto(v)}
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
              {!v?.total
                ? 'Carga los puestos que piden las bases para saber si calificamos.'
                : (v.califica
                  ? (v.limpio
                    ? 'Hay a quién presentar en todos los puestos, y los elegidos cumplen.'
                    : 'Hay a quién presentar, pero algún nombre ya elegido no cumple — eso es una observación segura.')
                  : 'Falta gente para al menos un puesto. Mira abajo a quién le falta poco.')}
            </div>
          </div>
          <div style={{ flex: '0 1 auto', textAlign: 'right' }}>
            <span className={`badge ${ETAPA_BADGE[lic.etapa] || 'b-gray'}`} style={{ fontSize: 9 }}>
              {ETAPA_LBL[lic.etapa] || lic.etapa}
            </span>
            <div style={{ fontSize: 10.5, marginTop: 3, color: URG_COLOR[u.nivel] }}>{u.texto}</div>
          </div>
        </div>
      </div>

      {/* ── Datos del proceso ── */}
      <div className="card card-p" style={{ marginBottom: 10, fontSize: 11.5 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <b style={{ fontSize: 12.5 }}>Datos del proceso</b>
          {canWrite && <button className="btn btn-ghost btn-xs" onClick={() => setEditando(true)}>Editar</button>}
        </div>
        {lic.nombre_inversion && (
          <div style={{ fontSize: 11, marginBottom: 8, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-c2)', lineHeight: 1.4 }}>
            <span style={{ color: 'var(--tm)' }}>Inversión:</span> «{lic.nombre_inversion}»{lic.cui ? <> · <b>CUI {lic.cui}</b></> : ''}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
          <div><span style={{ color: 'var(--tm)' }}>Nomenclatura:</span> {lic.nomenclatura || '—'}</div>
          <div><span style={{ color: 'var(--tm)' }}>Entidad:</span> {lic.entidad_convocante || '—'}</div>
          <div><span style={{ color: 'var(--tm)' }}>Tipo:</span> {TIPO_PROCESO_LBL[lic.tipo_trabajo] || lic.tipo_trabajo}</div>
          <div><span style={{ color: 'var(--tm)' }}>Mecanismo:</span> {MECANISMO_LBL[lic.mecanismo] || '—'}</div>
          <div><span style={{ color: 'var(--tm)' }}>Valor referencial:</span> <b>{money(lic.valor_referencial, lic.moneda)}</b></div>
          {(lic.monto_ejecucion || lic.monto_supervision) && (
            <div style={{ fontSize: 10.5 }}>
              <span style={{ color: 'var(--tm)' }}>Desglose:</span> ejecución {money(lic.monto_ejecucion, lic.moneda)}
              {lic.monto_supervision ? ` · supervisión ${money(lic.monto_supervision, lic.moneda)}` : ''}
            </div>
          )}
          <div><span style={{ color: 'var(--tm)' }}>Plazo:</span> {dias(lic.plazo_ejecucion_dias)}</div>
          <div><span style={{ color: 'var(--tm)' }}>Presentación:</span> {lic.fecha_presentacion || '—'}</div>
          {lic.cui && !lic.nombre_inversion && <div><span style={{ color: 'var(--tm)' }}>CUI:</span> {lic.cui}</div>}
          {lic.lugar && <div><span style={{ color: 'var(--tm)' }}>Lugar:</span> {lic.lugar}</div>}
          <div><span style={{ color: 'var(--tm)' }}>Postulamos con:</span> {empresa?.name || empresa?.nombre || '—'}</div>
        </div>

        {canWrite && (
          <div style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--tm)' }}>Etapa:</span>
            <select className="fi" style={{ width: 210 }} value={lic.etapa} disabled={busy}
              onChange={e => onGuardarLic({ etapa: e.target.value })}>
              {ETAPAS.map(e => <option key={e.v} value={e.v}>{e.label}</option>)}
            </select>
            {v && v.total > 0 && !v.califica && !esCerrada(lic.etapa) && (
              <span style={{ fontSize: 10.5, color: 'var(--amber)' }}>
                Si no calificamos, «Desistido» deja registrado por qué no nos presentamos.
              </span>
            )}
          </div>
        )}
      </div>

      {analizando && (
        <AnalisisBasesModal
          lic={lic} rubros={rubros} companies={companies} toast={toast}
          onClose={() => setAnalizando(false)}
          onAplicar={onAplicarAnalisis}
        />
      )}

      {/* ── Calendario del proceso (entrega 4) ── */}
      {cronograma.length > 0 && <CalendarioProceso cronograma={cronograma} hoy={hoy} />}

      {/* ── Cómo participar: la empresa y el consorcio (entrega 4) ── */}
      <ComoParticipar lic={lic} filasEmpresa={filasEmpresa} companies={companies}
        canWrite={canWrite} busy={busy} onPatch={onPatchLic} onBorrarReq={onBorrarReq} />

      {/* ── Requisitos de personal ── */}
      <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
        <div style={{ padding: '9px 14px', background: 'var(--bg-c2)', display: 'flex',
          justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <div>
            <b style={{ fontSize: 12.5 }}>Plantel clave que piden las bases</b>
            <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
              Se mide contra la experiencia <b>con constancia</b>: es la única presentable.
            </div>
          </div>
          {canWrite && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {/* La puerta de entrada de la entrega 3. Va acá, pegado a los
                  puestos, porque tipear los puestos a mano es exactamente el
                  trabajo que viene a reemplazar. */}
              <button className="btn btn-blue btn-xs" disabled={busy}
                onClick={() => setAnalizando(true)}
                title="Sube las bases en PDF o Word: se leen y se proponen los puestos, cada uno con la frase de donde salió">
                🔎 Leer las bases
              </button>
              <button className="btn btn-ghost btn-xs" disabled={busy}
                onClick={() => setNuevo({
                  cargo: '', profesion: '', rubro_id: '', exige_sustento: true,
                  meses_generales_minimos: 36, meses_minimos: 0,
                  participaciones_minimas: 2, meses_por_participacion: 2,
                  ventana_anios: 10, cargos_equivalentes: '',
                })}>
                + Agregar puesto
              </button>
            </div>
          )}
        </div>

        {filas.length === 0 && !nuevo && (
          <div className="empty-state" style={{ padding: '26px 14px', textAlign: 'center', fontSize: 11.5 }}>
            Todavía no hay puestos cargados. {lic.fuente === 'extraccion' && cronograma.length
              ? 'La convocatoria trajo el calendario y los datos del proceso; el plantel está en las BASES: súbelas con «Leer las bases».'
              : 'Léelas con «Leer las bases», o cópialos a mano.'}
          </div>
        )}

        <div style={{ display: 'grid', gap: 0 }}>
          {filas.map(r => (
            <PuestoFila key={r.id} fila={r} puesto={puestoDe(r.id)} rubros={rubros}
              candidatos={candidatos} canWrite={canWrite} busy={busy}
              onGuardar={(campos) => onGuardarReq(campos, r.id)}
              onBorrar={() => onBorrarReq(r)} />
          ))}
        </div>

        {nuevo && (
          <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 160px' }}>
              <label className="flabel">Cargo</label>
              <input className="fi" autoFocus value={nuevo.cargo} placeholder="Residente de Obra"
                onChange={e => setNuevo(n => ({ ...n, cargo: e.target.value }))} />
            </div>
            <div style={{ flex: '1 1 160px' }}>
              <label className="flabel">Profesión</label>
              <input className="fi" value={nuevo.profesion} placeholder="Ingeniero Civil"
                onChange={e => setNuevo(n => ({ ...n, profesion: e.target.value }))} />
            </div>
            <div style={{ width: 130 }}>
              <label className="flabel" title="La que se acredita con el diploma de incorporación al colegio">
                Exp. general (meses)
              </label>
              <input className="fi" type="number" min="0" value={nuevo.meses_generales_minimos}
                onChange={e => setNuevo(n => ({ ...n, meses_generales_minimos: Number(e.target.value) || 0 }))} />
            </div>
            <div style={{ flex: '1 1 180px' }}>
              <label className="flabel">Rubro</label>
              <select className="fi" value={nuevo.rubro_id}
                onChange={e => setNuevo(n => ({ ...n, rubro_id: e.target.value }))}>
                <option value="">Cualquier rubro (general)</option>
                {rubros.filter(x => x.activo !== false).map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              </select>
            </div>
            {/* Los tres criterios que las bases piden juntos y que un modelo de
                "solo meses" no distingue. Ver mig 198. */}
            <div style={{ width: 110 }}>
              <label className="flabel" title="«Sustentar como mínimo 02 participaciones»">Participac. mín.</label>
              <input className="fi" type="number" min="0" value={nuevo.participaciones_minimas}
                onChange={e => setNuevo(n => ({ ...n, participaciones_minimas: Number(e.target.value) || 0 }))} />
            </div>
            <div style={{ width: 120 }}>
              <label className="flabel" title="«por un plazo no menor a 02 meses cada participación»">Meses c/u</label>
              <input className="fi" type="number" min="0" value={nuevo.meses_por_participacion}
                onChange={e => setNuevo(n => ({ ...n, meses_por_participacion: Number(e.target.value) || 0 }))} />
            </div>
            <div style={{ width: 120 }}>
              <label className="flabel" title="«en los últimos 10 años». Vacío = las bases no acotan">Últimos (años)</label>
              <input className="fi" type="number" min="0" value={nuevo.ventana_anios ?? ''}
                onChange={e => setNuevo(n => ({ ...n, ventana_anios: e.target.value === '' ? null : Number(e.target.value) }))} />
            </div>
            <div style={{ flex: '1 1 100%' }}>
              <label className="flabel">Cargos que las bases aceptan (separados por «/»)</label>
              <input className="fi" value={nuevo.cargos_equivalentes}
                placeholder="Residente de obra / Supervisor de obra / Inspector de obra / Gerente de obra"
                onChange={e => setNuevo(n => ({ ...n, cargos_equivalentes: e.target.value }))} />
              <div style={{ fontSize: 10, color: 'var(--tm)' }}>
                Vacío = no se filtra por cargo. Si las bases listan sinónimos, copiálos todos: una constancia
                con un cargo fuera de la lista no cuenta como participación.
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setNuevo(null)}>Cancelar</button>
            <button className="btn btn-amber btn-sm" disabled={busy || !nuevo.cargo.trim()}
              onClick={async () => {
                const { cargos_equivalentes, ...resto } = nuevo;
                await onGuardarReq({
                  ...resto,
                  rubro_id: nuevo.rubro_id || null,
                  cargos_equivalentes: String(cargos_equivalentes || '')
                    .split(/[/;\n]|\sy\/o\s/i).map(x => x.trim()).filter(Boolean),
                });
                setNuevo(null);
              }}>Agregar</button>
          </div>
        )}
      </div>

      {/* ── Lo demás que dicen las bases (mig 200) ── */}
      <ReglasDelProceso lic={lic} />

      {/* ── Pasar a Trabajos ── */}
      <PasarATrabajos lic={lic} veredicto={v} destino={destino} canWrite={canWrite} toast={toast} />

      {canWrite && (
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={onBorrarLic}>
            Eliminar postulación
          </button>
        </div>
      )}

      {editando && (
        <PostulacionModal lic={lic} rubros={rubros} companies={companies}
          canWrite={canWrite} busy={busy}
          onClose={() => setEditando(false)}
          onGuardar={async (campos) => { await onGuardarLic(campos); setEditando(false); }} />
      )}
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ANALIZAR LAS BASES (tanda 15, entrega 3)
//
// La puerta de entrada de toda la cadena de extracción. Lo que la pantalla
// tiene que lograr, y por eso está armada así:
//
// 1. DECIR EL PRECIO ANTES DE COBRARLO. El triage corre en el navegador y es
//    gratis, así que se puede contar exactamente cuántas páginas van a OCR y
//    mostrar el costo ANTES de gastar un centavo. «94 páginas · USD 0,19,
//    ¿sigo?» es una decisión; una barra de progreso que ya empezó, no.
// 2. NO GUARDAR NADA SOLO. Lo extraído se PROPONE. Cada requisito viene con la
//    frase de las bases de donde salió y la página, y se guarda lo que la
//    persona tilda. Un requisito inventado que entra solo descalifica gente
//    que sí calificaba.
// 3. MOSTRAR LO QUE NO SE PUDO VERIFICAR. Lo que no pasó la comprobación de
//    cita no se esconde ni se borra: sale con ⚠ y arranca destildado.
// ═══════════════════════════════════════════════════════════════════

const PASO_LBL = {
  cache: 'Reusando lo que ya se leyó de este archivo',
  leyendo: 'Abriendo el documento',
  ocr: 'Leyendo las páginas escaneadas',
  indice: 'Buscando las secciones',
  localizar: 'Ubicando dónde está cada cosa',
  extraer: 'Extrayendo los requisitos',
  verificar: 'Verificando cada cita contra el documento',
};

const usd = (n) => `USD ${Number(n || 0).toFixed(3)}`;

const CAMPO_CABECERA_LBL = {
  nomenclatura: 'Nomenclatura', objeto: 'Objeto', nombre_inversion: 'Nombre de la inversión', cui: 'CUI',
  entidad_convocante: 'Entidad', entidad_ruc: 'RUC de la entidad', mecanismo: 'Mecanismo',
  valor_referencial: 'Valor referencial', monto_ejecucion: 'Monto de ejecución', monto_supervision: 'Monto de supervisión',
  moneda: 'Moneda', plazo_ejecucion_dias: 'Plazo (días)', lugar: 'Lugar', sistema_contratacion: 'Sistema de contratación',
  fecha_presentacion: 'Presentación de propuestas', definicion_obras_similares: 'Definición de obra similar',
  consorcio_permitido: 'Consorcio permitido', consorcio_reglas: 'Reglas de consorcio',
};
const mostrarValor = (k, v) => {
  if (k === 'mecanismo') return MECANISMO_LBL[v] || v;
  if (k === 'consorcio_permitido') return v ? 'Sí' : 'No';
  if (/^(valor_referencial|monto_)/.test(k)) return money(v);
  return String(v).slice(0, 110);
};

// ── Las reglas del juego: garantías, penalidades, puntajes y condiciones ──
//
// Gabriel, 8-set-2026: «hay mucha data por extraer de allí y organizarla».
// Esto es esa data, ya organizada y con la frase de las bases de donde salió.
// Es lo que hoy alguien tiene que leer a mano en 96 páginas antes de decidir
// si conviene presentarse: cuánta garantía hay que inmovilizar, cuánto se
// penaliza la mora, qué da puntaje y si hay adelanto.
function ReglasDelProceso({ lic }) {
  const [abierto, setAbierto] = uS(false);
  const listas = [
    { clave: 'factores_evaluacion', titulo: 'Factores de evaluación', badge: 'b-purple',
      linea: (f) => <>{f.factor}{f.puntaje_maximo ? <b> · {f.puntaje_maximo} puntos</b> : ''}{f.criterio ? <div style={{ color: 'var(--tm)' }}>{f.criterio}</div> : null}</> },
    { clave: 'garantias', titulo: 'Garantías', badge: 'b-blue',
      linea: (g) => <>{TIPO_GARANTIA_LBL[g.tipo] || g.tipo}{g.porcentaje ? <b> · {g.porcentaje}%</b> : ''}{g.monto ? <b> · {money(g.monto, lic.moneda)}</b> : ''}{g.detalle ? <div style={{ color: 'var(--tm)' }}>{g.detalle}</div> : null}</> },
    { clave: 'penalidades', titulo: 'Penalidades', badge: 'b-red',
      linea: (p) => <>{p.tipo === 'mora' ? 'Mora' : 'Otra penalidad'}{p.formula ? <> · <code style={{ fontSize: 10 }}>{p.formula}</code></> : ''}{p.tope ? <> · tope {p.tope}</> : ''}{p.detalle ? <div style={{ color: 'var(--tm)' }}>{p.detalle}</div> : null}</> },
    { clave: 'condiciones', titulo: 'Condiciones a considerar', badge: 'b-amber',
      linea: (c) => <><b>{TIPO_CONDICION_LBL[c.tipo] || c.tipo}</b>{c.titulo ? ` · ${c.titulo}` : ''}{c.detalle ? <div style={{ color: 'var(--tm)' }}>{c.detalle}</div> : null}</> },
    { clave: 'documentos_presentacion', titulo: 'Documentos a presentar', badge: 'b-gray',
      linea: (d) => <>{d.sobre ? <b>{d.sobre} · </b> : ''}{d.documento}{d.obligatorio === false ? <span style={{ color: 'var(--tm)' }}> (opcional)</span> : ''}</> },
  ].map(l => ({ ...l, filas: Array.isArray(lic[l.clave]) ? lic[l.clave] : [] }))
    .filter(l => l.filas.length);

  const alertas = Array.isArray(lic.alertas) ? lic.alertas : [];
  const total = listas.reduce((t, l) => t + l.filas.length, 0);
  if (!total && !alertas.length) return null;

  return (
    <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', background: 'var(--bg-c2)', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <b style={{ fontSize: 12.5 }}>Las reglas de este proceso ({total})</b>
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            Puntajes, garantías, penalidades y condiciones, tal como las escribieron las bases.
          </div>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={() => setAbierto(a => !a)}>{abierto ? 'Ocultar' : 'Ver'}</button>
      </div>
      {abierto && (
        <div style={{ padding: '10px 14px', display: 'grid', gap: 12 }}>
          {listas.map(l => (
            <div key={l.clave}>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>{l.titulo} ({l.filas.length})</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {l.filas.map((x, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '5px 8px',
                    borderRadius: 5, background: 'var(--bg-c2)', fontSize: 11,
                    borderLeft: `3px solid ${x.verificada === false ? 'var(--amber)' : 'transparent'}` }}>
                    <span className={`badge ${l.badge}`} style={{ fontSize: 8.5, flex: '0 0 auto' }}>{i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {l.linea(x)}
                      {x.fuente_cita && (
                        <div style={{ fontSize: 10, fontStyle: 'italic', color: 'var(--tm)', marginTop: 2 }}>
                          «{String(x.fuente_cita).slice(0, 220)}»{x.fuente_pagina != null ? ` — pág. ${x.fuente_pagina}` : ''}
                        </div>
                      )}
                      {x.verificada === false && (
                        <div style={{ fontSize: 10, color: 'var(--amber)' }}>Sin comprobar contra el documento: revísalo antes de usarlo.</div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {alertas.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4, color: 'var(--amber)' }}>
                ⚠ Lo que el lector marcó para revisar ({alertas.length})
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10.5, lineHeight: 1.5, color: 'var(--tm)' }}>
                {alertas.slice(0, 20).map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── El calendario que trajo la convocatoria ────────────────────────
function CalendarioProceso({ cronograma, hoy }) {
  const proxima = cronograma.find(e => (e.hasta || e.desde) >= hoy);
  return (
    <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', background: 'var(--bg-c2)' }}>
        <b style={{ fontSize: 12.5 }}>Calendario del proceso</b>
        <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
          {proxima ? <>Lo que corre ahora: <b>{proxima.etapa}</b> ({proxima.desde}{proxima.hasta ? ` → ${proxima.hasta}` : ''}).</> : 'Todas las etapas ya pasaron.'}
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>Etapa</th><th>Desde</th><th>Hasta</th><th></th></tr></thead>
          <tbody>
            {cronograma.map((e, i) => {
              const pasada = (e.hasta || e.desde) < hoy;
              const esProxima = proxima && proxima === e;
              return (
                <tr key={i} style={{ opacity: pasada ? 0.55 : 1, fontWeight: esProxima ? 700 : 400 }}>
                  <td style={{ fontSize: 11.5 }}>{e.etapa}</td>
                  <td style={{ fontSize: 11 }}>{e.desde}</td>
                  <td style={{ fontSize: 11 }}>{e.hasta || '—'}</td>
                  <td style={{ fontSize: 10, color: 'var(--tm)' }}>
                    {esProxima ? <span className="badge b-blue" style={{ fontSize: 9 }}>en curso / próxima</span>
                      : (e.fuente_pagina ? `pág. ${e.fuente_pagina}` : '')}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Cómo participar: la empresa, y el consorcio como camino ────────
//
// Gabriel (8-set-2026): «usualmente se hacen consorcios, se mezclan empresas
// para lograr la experiencia o también el capital para participar». Esta
// tarjeta junta lo que las bases piden del POSTOR, si permiten consorcio y
// con qué reglas, y el plan nuestro: quiénes vamos, con qué porcentaje y qué
// aporta cada uno. No evalúa a las empresas (eso es la entrega 5, cuando el
// grupo tenga cargada su experiencia): ordena la decisión.
const APORTES = ['experiencia', 'capital', 'personal', 'RNP / capacidad', 'equipos', 'otro'];

function ComoParticipar({ lic, filasEmpresa, companies, canWrite, busy, onPatch, onBorrarReq }) {
  const inicial = () => (Array.isArray(lic.consorcio) ? lic.consorcio : []).map(m => ({ ...m }));
  const [socios, setSocios] = uS(inicial);
  const [notas, setNotas] = uS(lic.participacion_notas || '');
  const [sucio, setSucio] = uS(false);
  const [abierto, setAbierto] = uS(true);

  const vr = Number(lic.valor_referencial) || 0;
  const total = socios.reduce((t, m) => t + (Number(m.porcentaje) || 0), 0);
  const grupo = (companies || []).filter(c => !c.deleted_at);

  const up = (i, patch) => { setSucio(true); setSocios(ss => ss.map((m, k) => (k === i ? { ...m, ...patch } : m))); };
  const agregar = () => { setSucio(true); setSocios(ss => [...ss, { company_id: '', nombre: '', ruc: '', porcentaje: '', aporta: 'experiencia', notas: '' }]); };
  const quitar = (i) => { setSucio(true); setSocios(ss => ss.filter((_, k) => k !== i)); };
  const guardar = async () => {
    await onPatch({
      consorcio: socios.map(m => ({
        company_id: m.company_id || null,
        nombre: (m.nombre || grupo.find(c => c.id === m.company_id)?.name || '').trim(),
        ruc: String(m.ruc || '').replace(/\D/g, '').slice(0, 11) || null,
        porcentaje: m.porcentaje === '' ? null : Number(m.porcentaje),
        aporta: m.aporta || null,
        notas: (m.notas || '').trim() || null,
      })).filter(m => m.nombre || m.company_id),
      participacion_notas: notas.trim() || null,
    });
    setSucio(false);
  };

  const permitido = lic.consorcio_permitido;
  return (
    <div className="card" style={{ marginBottom: 10, overflow: 'hidden' }}>
      <div style={{ padding: '9px 14px', background: 'var(--bg-c2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <div>
          <b style={{ fontSize: 12.5 }}>Cómo participar</b>
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            Lo que las bases piden de la EMPRESA, y si se puede ir en consorcio para sumar experiencia o capital.
          </div>
        </div>
        <button className="btn btn-ghost btn-xs" onClick={() => setAbierto(a => !a)}>{abierto ? 'Ocultar' : 'Ver'}</button>
      </div>

      {abierto && (
        <div style={{ padding: '10px 14px', display: 'grid', gap: 10 }}>
          {/* Consorcio: lo que dicen las bases */}
          <div style={{ fontSize: 11.5, display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <span className={`badge ${permitido === true ? 'b-green' : (permitido === false ? 'b-red' : 'b-gray')}`} style={{ fontSize: 9.5 }}>
              {permitido === true ? 'Consorcio permitido' : (permitido === false ? 'Consorcio NO permitido' : 'Consorcio: las bases no lo dicen (todavía)')}
            </span>
            {lic.consorcio_reglas && <div style={{ flex: '1 1 260px', fontSize: 10.5, color: 'var(--tm)', lineHeight: 1.45 }}>{lic.consorcio_reglas}</div>}
            {canWrite && permitido == null && (
              <div style={{ display: 'flex', gap: 4 }}>
                <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => onPatch({ consorcio_permitido: true })}>Sí se puede</button>
                <button className="btn btn-ghost btn-xs" disabled={busy} onClick={() => onPatch({ consorcio_permitido: false })}>No se puede</button>
              </div>
            )}
          </div>

          {/* Requisitos de la empresa */}
          <div>
            <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>Requisitos del postor</div>
            {filasEmpresa.length === 0 ? (
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                Todavía no hay requisitos de empresa cargados. Salen de las bases con «Leer las bases» (experiencia en obras similares, facturación, capacidad de contratación, RNP).
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 5 }}>
                {filasEmpresa.map(r => {
                  const montoCalc = r.monto_minimo || (r.multiplo_valor_referencial && vr ? r.multiplo_valor_referencial * vr : null);
                  return (
                    <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 8px', borderRadius: 6, background: 'var(--bg-c2)', fontSize: 11 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <b>{r.cargo || 'Requisito de la empresa'}</b>
                        {montoCalc ? <span style={{ color: 'var(--blue)' }}> · {money(montoCalc, lic.moneda)}</span> : ''}
                        {r.multiplo_valor_referencial ? <span style={{ color: 'var(--tm)' }}> ({r.multiplo_valor_referencial}× el valor referencial)</span> : ''}
                        {r.ventana_anios ? <span style={{ color: 'var(--tm)' }}> · últimos {r.ventana_anios} años</span> : ''}
                        {r.descripcion && <div style={{ color: 'var(--tm)', marginTop: 2 }}>{r.descripcion}</div>}
                        {r.fuente_cita && <div style={{ fontStyle: 'italic', fontSize: 10, marginTop: 2, color: 'var(--tm)' }}>«{r.fuente_cita.slice(0, 220)}»{r.fuente_pagina ? ` — pág. ${r.fuente_pagina}` : ''}</div>}
                      </div>
                      {canWrite && <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => onBorrarReq(r)}>✕</button>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* El plan de consorcio nuestro */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>
                Con quién vamos
                {socios.length > 0 && (
                  <span style={{ fontWeight: 400, marginLeft: 6, fontSize: 10.5, color: Math.abs(total - 100) < 0.01 ? 'var(--green)' : 'var(--amber)' }}>
                    {total}% {Math.abs(total - 100) < 0.01 ? '' : '(debería sumar 100%)'}
                  </span>
                )}
              </div>
              {canWrite && <button className="btn btn-ghost btn-xs" onClick={agregar}>+ Agregar socio</button>}
            </div>
            {socios.length === 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                Sin socios cargados = postula la empresa sola. Si falta experiencia o capital, agrega con quién completarlo y qué aporta.
              </div>
            )}
            <div style={{ display: 'grid', gap: 6 }}>
              {socios.map((m, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: '1 1 180px' }}>
                    <label className="flabel" style={{ fontSize: 10 }}>Empresa</label>
                    <select className="fi" style={{ fontSize: 11 }} disabled={!canWrite} value={m.company_id || ''}
                      onChange={e => up(i, { company_id: e.target.value, nombre: e.target.value ? '' : m.nombre })}>
                      <option value="">Otra empresa (escribir)</option>
                      {grupo.map(c => <option key={c.id} value={c.id}>{c.name || c.nombre}</option>)}
                    </select>
                  </div>
                  {!m.company_id && (
                    <>
                      <div style={{ flex: '1 1 160px' }}>
                        <label className="flabel" style={{ fontSize: 10 }}>Razón social</label>
                        <input className="fi" style={{ fontSize: 11 }} disabled={!canWrite} value={m.nombre || ''} onChange={e => up(i, { nombre: e.target.value })} />
                      </div>
                      <div style={{ width: 120 }}>
                        <label className="flabel" style={{ fontSize: 10 }}>RUC</label>
                        <input className="fi" style={{ fontSize: 11 }} disabled={!canWrite} value={m.ruc || ''} onChange={e => up(i, { ruc: e.target.value.replace(/\D/g, '').slice(0, 11) })} />
                      </div>
                    </>
                  )}
                  <div style={{ width: 80 }}>
                    <label className="flabel" style={{ fontSize: 10 }}>%</label>
                    <input className="fi" style={{ fontSize: 11 }} type="number" min="0" max="100" disabled={!canWrite} value={m.porcentaje ?? ''} onChange={e => up(i, { porcentaje: e.target.value })} />
                  </div>
                  <div style={{ width: 140 }}>
                    <label className="flabel" style={{ fontSize: 10 }}>Aporta</label>
                    <select className="fi" style={{ fontSize: 11 }} disabled={!canWrite} value={m.aporta || 'experiencia'} onChange={e => up(i, { aporta: e.target.value })}>
                      {APORTES.map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </div>
                  {canWrite && <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => quitar(i)}>✕</button>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="flabel" style={{ fontSize: 10 }}>Notas de la participación (por qué así, qué falta, quién consigue qué)</label>
            <textarea className="fi" rows={2} disabled={!canWrite} value={notas} style={{ fontSize: 11 }}
              onChange={e => { setNotas(e.target.value); setSucio(true); }} />
          </div>
          {canWrite && sucio && (
            <div style={{ textAlign: 'right' }}>
              <button className="btn btn-amber btn-sm" disabled={busy} onClick={guardar}>Guardar cómo participamos</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * El lector. Con `lic` COMPLEMENTA una postulación (propone lo que le falta);
 * sin `lic` la CREA: la cabecera se muestra editable, la persona la revisa y
 * recién ahí nace la postulación con su calendario y sus requisitos.
 */
function AnalisisBasesModal({ lic, rubros = [], companies = [], onClose, onAplicar, onCrear, toast }) {
  const Modal = window.Modal;
  const [archivo, setArchivo] = uS(null);
  const [fase, setFase] = uS('elegir');        // elegir · presupuesto · corriendo · revisar
  const [progreso, setProgreso] = uS(null);
  const [presupuesto, setPresupuesto] = uS(null);
  const [bloques, setBloques] = uS(null);
  const [salida, setSalida] = uS(null);
  // La huella del archivo y lo que ya se pagó por él (lib/cache-lectura.js).
  const [huella, setHuella] = uS(null);
  const [cacheado, setCacheado] = uS(null);
  const [unidad, setUnidad] = uS('pagina');
  const [marcados, setMarcados] = uS(() => new Set());        // puestos (personal)
  const [marcadosEmp, setMarcadosEmp] = uS(() => new Set());  // requisitos de empresa
  const [aplicarCabecera, setAplicarCabecera] = uS(true);
  const [aplicarCronograma, setAplicarCronograma] = uS(true);
  const [form, setForm] = uS(null);           // la cabecera editable (alta)
  const [guardando, setGuardando] = uS(false);
  // Guard SÍNCRONO: el doble clic en «Guardar» duplicaría todos los puestos.
  const guardandoRef = uR(false);

  if (!Modal) return null;
  const creando = !lic;

  // ── Paso 0: leer y presupuestar, sin gastar ──────────────────────
  const elegirArchivo = async (file) => {
    if (!file) return;
    setArchivo(file);
    setFase('corriendo');
    setProgreso({ paso: 'leyendo' });
    try {
      const { leerDocumento, presupuestar } = await import('../lib/bases-analisis.js');
      const { huellaDe, leerCache } = await import('../lib/cache-lectura.js');
      const { bloques: bs, unidad: u } = await leerDocumento(file, { onProgreso: setProgreso });
      setBloques(bs);
      setUnidad(u || 'pagina');
      setPresupuesto(presupuestar(bs));
      // ¿Este archivo ya se leyó antes? Entonces el escaneo no se vuelve a
      // pagar. Es lo que pidió Gabriel el 8-set: «no me gustaría perder eso».
      try {
        const h = await huellaDe(file);
        setHuella(h);
        setCacheado(await leerCache(h));
      } catch { setHuella(null); setCacheado(null); }
      setFase('presupuesto');
    } catch (e) {
      toast('No se pudo abrir el documento: ' + (e?.message || e), 'red');
      setFase('elegir');
      setArchivo(null);
    }
  };

  // ── Pasos 1 a 4: acá sí se gasta ─────────────────────────────────
  const correr = async () => {
    setFase('corriendo');
    try {
      const { analizar } = await import('../lib/bases-analisis.js');
      const { apiFetch, apiParse } = await import('../lib/api-client');
      const r = await analizar(bloques, { apiFetch, apiParse, onProgreso: setProgreso, cacheado });
      // Guardar el texto leído ANTES de mirar si la extracción salió bien: lo
      // que se pagó fue el escaneo, y eso ya está hecho aunque la IA falle.
      if (huella && !r.reusado && r.paginasOcr > 0) {
        try {
          const { guardarCache } = await import('../lib/cache-lectura.js');
          await guardarCache(huella, {
            markdown: r.markdown, paginasOcr: r.paginasOcr,
            costoOcr: r.costo?.ocr ?? 0, nombre: archivo?.name || null, unidad,
          });
          setCacheado({ markdown: r.markdown, paginasOcr: r.paginasOcr });
        } catch { /* sin caché se sigue igual */ }
      }
      setSalida(r);
      // Arrancan tildados SOLO los que pasaron la verificación de cita. Lo que
      // no se pudo comprobar se ve, pero no se guarda sin que alguien lo mire.
      setMarcados(new Set((r.filas || []).map((f, i) => (f.verificada ? i : -1)).filter(i => i >= 0)));
      setMarcadosEmp(new Set((r.filasEmpresa || []).map((f, i) => (f.verificada ? i : -1)).filter(i => i >= 0)));
      if (creando) {
        const c = r.cabecera || {};
        setForm({
          objeto: c.objeto || c.nombre_inversion || '',
          nomenclatura: c.nomenclatura || '',
          entidad_convocante: c.entidad_convocante || '',
          entidad_ruc: c.entidad_ruc || '',
          nombre_inversion: c.nombre_inversion || '',
          cui: c.cui || '',
          mecanismo: c.mecanismo || '',
          // Sugerido por el documento, confirmado por la persona.
          tipo_trabajo: r.sugerencias?.tipo_trabajo || TIPO_PROCESO_DEFAULT,
          tipoSugerido: r.sugerencias?.tipo_trabajo || null,
          origen: c.mecanismo === 'privado' ? 'privado' : 'publico',
          rubro_id: '',
          valor_referencial: c.valor_referencial ?? '',
          moneda: c.moneda || 'PEN',
          monto_ejecucion: c.monto_ejecucion ?? '',
          monto_supervision: c.monto_supervision ?? '',
          plazo_ejecucion_dias: c.plazo_ejecucion_dias ?? '',
          lugar: c.lugar || '',
          sistema_contratacion: c.sistema_contratacion || '',
          fecha_presentacion: c.fecha_presentacion || '',
          definicion_obras_similares: c.definicion_obras_similares || '',
          consorcio_permitido: c.consorcio_permitido,
          consorcio_reglas: c.consorcio_reglas || '',
          postulante_company_id: '',
        });
      }
      setFase('revisar');
    } catch (e) {
      toast('El análisis falló: ' + (e?.message || e), 'red');
      setFase('presupuesto');
    }
  };

  /** Reintentar la extracción SIN volver a escanear. */
  const reintentar = () => { setSalida(null); correr(); };

  const filas = salida?.filas || [];
  const filasEmp = salida?.filasEmpresa || [];
  const cronograma = salida?.cronograma || [];
  const extras = salida?.extras || { factores_evaluacion: [], garantias: [], penalidades: [], documentos_presentacion: [], condiciones: [] };
  const totalExtras = Object.values(extras).reduce((t, l) => t + l.length, 0);
  // Solo se propone lo que la postulación TODAVÍA NO TIENE: pisar con una
  // lectura automática un dato que alguien cargó a mano es peor que no leer.
  const cabecera = uM(() => {
    if (creando) return null;
    const prop = salida?.cabecera;
    if (!prop) return null;
    const falta = {};
    for (const [k, v] of Object.entries(prop)) {
      if (v == null || v === '') continue;
      if (k === 'moneda') continue;
      const actual = lic[k];
      if (actual == null || actual === '') falta[k] = v;
    }
    return Object.keys(falta).length ? falta : null;
  }, [salida, lic, creando]);
  const licTieneCalendario = !creando && Array.isArray(lic.cronograma) && lic.cronograma.length > 0;

  const bitacora = () => ({ archivo: archivo?.name || null, modelos: salida?.modelos || [], paginasOcr: salida?.paginasOcr ?? null });

  const guardar = async () => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    try {
      const elegidas = filas.filter((_, i) => marcados.has(i));
      const elegidasEmp = filasEmp.filter((_, i) => marcadosEmp.has(i));
      if (creando) {
        if (!form || form.objeto.trim().length < 3) { toast('La postulación necesita un objeto (qué se convoca)', 'red'); return; }
        const num = (v) => (v === '' || v == null ? null : Number(v));
        const { tipoSugerido, ...f } = form;
        void tipoSugerido;
        await onCrear({
          cabecera: {
            ...f,
            objeto: f.objeto.trim(),
            nomenclatura: f.nomenclatura.trim() || null,
            entidad_convocante: f.entidad_convocante.trim() || null,
            entidad_ruc: /^\d{11}$/.test(f.entidad_ruc) ? f.entidad_ruc : null,
            nombre_inversion: f.nombre_inversion.trim() || null,
            cui: f.cui || null,
            mecanismo: f.mecanismo || null,
            rubro_id: f.rubro_id || null,
            valor_referencial: num(f.valor_referencial),
            monto_ejecucion: num(f.monto_ejecucion),
            monto_supervision: num(f.monto_supervision),
            plazo_ejecucion_dias: num(f.plazo_ejecucion_dias),
            lugar: f.lugar.trim() || null,
            sistema_contratacion: f.sistema_contratacion.trim() || null,
            fecha_presentacion: f.fecha_presentacion || null,
            definicion_obras_similares: f.definicion_obras_similares.trim() || null,
            consorcio_permitido: typeof f.consorcio_permitido === 'boolean' ? f.consorcio_permitido : null,
            consorcio_reglas: f.consorcio_reglas.trim() || null,
            postulante_company_id: f.postulante_company_id || null,
          },
          requisitos: elegidas, requisitosEmpresa: elegidasEmp,
          cronograma: aplicarCronograma ? cronograma : [],
          extras, alertas: salida?.alertas || [],
          costo: salida?.costo || null, bitacora: bitacora(),
        });
        return;   // el padre cierra y abre la postulación nueva
      }
      await onAplicar({
        requisitos: elegidas, requisitosEmpresa: elegidasEmp,
        cabecera: aplicarCabecera ? cabecera : null,
        cronograma: aplicarCronograma && !licTieneCalendario ? cronograma : null,
        extras, alertas: salida?.alertas || [],
        costo: salida?.costo || null, bitacora: bitacora(),
      });
      onClose();
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const alternar = (set, i) => set(prev => {
    const s = new Set(prev);
    if (s.has(i)) s.delete(i); else s.add(i);
    return s;
  });
  const upForm = (patch) => setForm(f => ({ ...f, ...patch }));
  const aGuardar = marcados.size + marcadosEmp.size;
  const puedeGuardar = creando ? (form && form.objeto.trim().length >= 3) : (aGuardar > 0 || (aplicarCabecera && cabecera) || (aplicarCronograma && !licTieneCalendario && cronograma.length));

  return (
    <Modal title={creando ? 'Nueva postulación desde las bases o la convocatoria' : `Analizar las bases · ${lic.objeto || 'postulación'}`} onClose={onClose} size="xl">

      {/* ── Elegir el archivo ── */}
      {fase === 'elegir' && (
        <div style={{ padding: '18px 4px' }}>
          <div style={{ fontSize: 12, marginBottom: 10, lineHeight: 1.5 }}>
            Sube la <b>convocatoria</b> (el aviso de El Peruano en PDF) o las <b>bases</b> en <b>PDF</b> o <b>Word (.docx)</b>.
            Primero se revisa el documento en tu propia computadora —eso no cuesta nada— y recién después te digo
            cuánto sale leer las páginas escaneadas, antes de leerlas.
          </div>
          <input type="file" className="fi" accept=".pdf,.docx,application/pdf"
            onChange={e => elegirArchivo(e.target.files?.[0])} />
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 10, lineHeight: 1.5 }}>
            {creando
              ? 'De la convocatoria salen el nombre de la inversión, el CUI, el monto referencial con su desglose, el plazo, el calendario completo y si se admite consorcio. De las bases, además, el plantel que piden y los requisitos de la empresa. Puedes subir primero una y después la otra: la segunda complementa.'
              : 'Las páginas que ya son texto se leen gratis. Solo se paga el OCR de las escaneadas, que en unas bases suelen ser los Términos de Referencia.'}
          </div>
        </div>
      )}

      {/* ── El presupuesto, antes de gastar ── */}
      {fase === 'presupuesto' && presupuesto && (
        <div style={{ padding: '10px 4px' }}>
          <div className="card card-p" style={{ marginBottom: 12 }}>
            <b style={{ fontSize: 12.5 }}>Esto es lo que hay en {archivo?.name}</b>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginTop: 10, fontSize: 12 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--green)' }}>
                  {presupuesto.charsNativos.toLocaleString('es-PE')}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>caracteres que ya son texto · gratis</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--amber)' }}>{presupuesto.paginasOcr}</div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>páginas escaneadas · hay que leerlas</div>
              </div>
              <div>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{usd(presupuesto.costo.total)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  lo que cuesta este análisis ({presupuesto.tandas} tanda{presupuesto.tandas === 1 ? '' : 's'})
                </div>
              </div>
            </div>
            {presupuesto.paginasOcr === 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--green)', marginTop: 8 }}>
                Todo el documento es texto: la lectura sale prácticamente gratis (solo las pasadas de IA, que van a un modelo sin costo).
              </div>
            )}
            {cacheado && (
              <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 8, padding: '6px 8px',
                borderRadius: 6, background: 'rgba(34,197,94,0.10)' }}>
                ✅ <b>Este archivo ya se leyó antes</b>, así que el escaneo no se vuelve a pagar:
                esta lectura cuesta <b>USD 0.000</b>. Se reusan {cacheado.paginasOcr} páginas ya leídas.
              </div>
            )}
            {unidad === 'tramo' && (
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 8 }}>
                Es un documento de Word, que no tiene páginas: se parte en <b>{presupuesto.tramos} tramos</b> y
                las citas van a decir «tramo», no «página».
              </div>
            )}
            {presupuesto.decorativas > 0 && (
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 8 }}>
                {presupuesto.decorativas} imagen(es) son logos o sellos y no se mandan a leer.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setFase('elegir'); setArchivo(null); }}>
              Elegir otro archivo
            </button>
            <button className="btn btn-blue btn-sm" onClick={correr}>
              Analizar · {cacheado ? 'USD 0.000' : usd(presupuesto.costo.total)}
            </button>
          </div>
        </div>
      )}

      {/* ── Corriendo ── */}
      {fase === 'corriendo' && (
        <div style={{ padding: '28px 10px', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {PASO_LBL[progreso?.paso] || 'Trabajando'}…
          </div>
          {progreso?.paso === 'ocr' && progreso.total > 0 && (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--tm)', marginBottom: 8 }}>
                {progreso.hecho} de {progreso.total} páginas
              </div>
              <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-c2)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.round((progreso.hecho / progreso.total) * 100)}%`, background: 'var(--blue)' }} />
              </div>
            </>
          )}
          {progreso?.paso === 'leyendo' && progreso.total > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>página {progreso.pagina} de {progreso.total}</div>
          )}
          {progreso?.detalle && typeof progreso.detalle === 'string' && (
            <div style={{ fontSize: 11.5, color: 'var(--tm)' }}>{progreso.detalle}</div>
          )}
          <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 14 }}>
            No cierres esta ventana: el documento se está leyendo en tu computadora.
          </div>
        </div>
      )}

      {/* ── Revisar lo que se encontró ── */}
      {fase === 'revisar' && salida && (
        <div>
          <div className="card card-p" style={{ marginBottom: 10, display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{filas.length}</div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>puestos del plantel</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{filasEmp.length}</div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>requisitos de la empresa</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{cronograma.length}</div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>etapas del calendario</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{totalExtras}</div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>garantías, penalidades y condiciones</div>
            </div>
            <div>
              {/* Cuenta TODO lo que trae cita, no solo los requisitos: con una
                  convocatoria que solo trae calendario decía «0 comprobadas»
                  aunque 7 de 8 etapas hubieran verificado (8-set-2026). */}
              <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>
                {[...filas, ...filasEmp, ...cronograma, ...Object.values(extras).flat()]
                  .filter(x => x.verificada).length}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>datos con su cita comprobada</div>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{usd(salida.costo?.total)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                costó de verdad · {salida.paginasOcr} páginas leídas
              </div>
            </div>
            {salida.modelos?.length > 0 && (
              <div style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--tm)', textAlign: 'right' }}>
                leído por<br />{salida.modelos.join(' · ')}
              </div>
            )}
          </div>

          {salida.alertas?.length > 0 && (
            <div style={{ padding: '9px 12px', marginBottom: 10, borderRadius: 8, fontSize: 11,
              background: 'rgba(245,158,11,0.09)', border: '1px solid rgba(245,158,11,0.35)' }}>
              <b style={{ color: 'var(--amber)' }}>⚠ Para revisar a mano ({salida.alertas.length})</b>
              <ul style={{ margin: '6px 0 0 16px', padding: 0, lineHeight: 1.5 }}>
                {salida.alertas.slice(0, 10).map((a, i) => <li key={i}>{a}</li>)}
              </ul>
            </div>
          )}

          {/* ── La cabecera: editable si se está creando ── */}
          {creando && form && (
            <div className="card card-p" style={{ marginBottom: 10 }}>
              <b style={{ fontSize: 12.5 }}>La postulación que se va a crear</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 8 }}>
                Lo leído del documento ya está puesto. Revísalo, corrige lo que haga falta y elige con qué empresa postulamos.
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                <div>
                  <label className="flabel">Objeto del proceso *</label>
                  <input className="fi" value={form.objeto} onChange={e => upForm({ objeto: e.target.value })} />
                </div>
                {form.nombre_inversion && (
                  <div>
                    <label className="flabel">Nombre de la inversión (textual)</label>
                    <textarea className="fi" rows={2} value={form.nombre_inversion} onChange={e => upForm({ nombre_inversion: e.target.value })} />
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '2 1 240px' }}>
                    <label className="flabel">Nomenclatura</label>
                    <input className="fi" value={form.nomenclatura} onChange={e => upForm({ nomenclatura: e.target.value })} />
                  </div>
                  <div style={{ flex: '2 1 220px' }}>
                    <label className="flabel">Entidad convocante</label>
                    <input className="fi" value={form.entidad_convocante} onChange={e => upForm({ entidad_convocante: e.target.value })} />
                  </div>
                  <div style={{ flex: '0 1 120px' }}>
                    <label className="flabel">CUI</label>
                    <input className="fi" value={form.cui} onChange={e => upForm({ cui: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label className="flabel">
                      Tipo de proceso {form.tipoSugerido && <span className="badge b-blue" style={{ fontSize: 8.5, marginLeft: 4 }}>sugerido por el documento</span>}
                    </label>
                    <select className="fi" value={form.tipo_trabajo} onChange={e => upForm({ tipo_trabajo: e.target.value })}>
                      {TIPOS_PROCESO.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 200px' }}>
                    <label className="flabel">Mecanismo</label>
                    <select className="fi" value={form.mecanismo} onChange={e => upForm({ mecanismo: e.target.value })}>
                      <option value="">Sin definir</option>
                      {MECANISMOS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: '1 1 180px' }}>
                    <label className="flabel">Rubro</label>
                    <select className="fi" value={form.rubro_id} onChange={e => upForm({ rubro_id: e.target.value })}>
                      <option value="">Sin rubro</option>
                      {rubros.filter(r => r.activo !== false).map(r => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 150px' }}>
                    <label className="flabel">Valor referencial</label>
                    <input className="fi" type="number" step="0.01" value={form.valor_referencial} onChange={e => upForm({ valor_referencial: e.target.value })} />
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label className="flabel">Monto de ejecución</label>
                    <input className="fi" type="number" step="0.01" value={form.monto_ejecucion} onChange={e => upForm({ monto_ejecucion: e.target.value })} />
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label className="flabel">Monto de supervisión</label>
                    <input className="fi" type="number" step="0.01" value={form.monto_supervision} onChange={e => upForm({ monto_supervision: e.target.value })} />
                  </div>
                  <div style={{ flex: '0 1 110px' }}>
                    <label className="flabel">Plazo (días)</label>
                    <input className="fi" type="number" value={form.plazo_ejecucion_dias} onChange={e => upForm({ plazo_ejecucion_dias: e.target.value })} />
                  </div>
                  <div style={{ flex: '1 1 150px' }}>
                    <label className="flabel">Presentación de propuestas</label>
                    <input className="fi" type="date" value={form.fecha_presentacion} onChange={e => upForm({ fecha_presentacion: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 200px' }}>
                    <label className="flabel">Lugar</label>
                    <input className="fi" value={form.lugar} onChange={e => upForm({ lugar: e.target.value })} />
                  </div>
                  <div style={{ flex: '2 1 240px' }}>
                    <label className="flabel">Postulamos con</label>
                    <select className="fi" value={form.postulante_company_id} onChange={e => upForm({ postulante_company_id: e.target.value })}>
                      <option value="">Sin definir todavía</option>
                      {companies.filter(c => !c.deleted_at).map(c => <option key={c.id} value={c.id}>{c.name || c.nombre}</option>)}
                    </select>
                  </div>
                </div>
                {(form.consorcio_permitido != null || form.consorcio_reglas) && (
                  <div style={{ fontSize: 11, padding: '6px 8px', borderRadius: 6, background: 'var(--bg-c2)' }}>
                    <b>Consorcio:</b> {form.consorcio_permitido === true ? 'permitido' : (form.consorcio_permitido === false ? 'NO permitido' : 'sin definir')}
                    {form.consorcio_reglas && <div style={{ color: 'var(--tm)', marginTop: 2 }}>{form.consorcio_reglas.slice(0, 400)}</div>}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Datos que faltaban (complemento) ── */}
          {!creando && cabecera && (
            <label className="card card-p" style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
              marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={aplicarCabecera} style={{ marginTop: 3 }}
                onChange={() => setAplicarCabecera(v => !v)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 12.5 }}>Datos del proceso que faltaban</b>
                <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 5 }}>
                  Solo se proponen los campos vacíos. Lo que ya cargaste queda como está.
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 6, fontSize: 11 }}>
                  {Object.entries(cabecera).map(([k, v]) => (
                    <div key={k}>
                      <span style={{ color: 'var(--tm)' }}>{CAMPO_CABECERA_LBL[k] || k}:</span>{' '}
                      <b>{mostrarValor(k, v)}</b>
                    </div>
                  ))}
                </div>
              </div>
            </label>
          )}

          {/* ── El calendario ── */}
          {cronograma.length > 0 && (
            <label className="card card-p" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={aplicarCronograma && !licTieneCalendario} disabled={licTieneCalendario} style={{ marginTop: 3 }}
                onChange={() => setAplicarCronograma(v => !v)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 12.5 }}>Calendario del proceso ({cronograma.length} etapas)</b>
                <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 5 }}>
                  {licTieneCalendario ? 'Esta postulación ya tiene calendario cargado: no se pisa.' : 'Se guarda con la postulación para no tipearlo dos veces.'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 3, fontSize: 10.5 }}>
                  {cronograma.map((e, i) => (
                    <div key={i} style={{ color: e.verificada === false ? 'var(--amber)' : 'inherit' }}>
                      <b>{e.desde}</b>{e.hasta ? ` → ${e.hasta}` : ''} · {e.etapa}
                    </div>
                  ))}
                </div>
              </div>
            </label>
          )}

          {(salida.reusado || (huella && salida.paginasOcr > 0)) && (
            <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>
                {salida.reusado
                  ? 'El texto salió de una lectura anterior de este mismo archivo: no se pagó escaneo.'
                  : 'El escaneo quedó guardado: si algo salió mal, reintentar no vuelve a cobrarlo.'}
              </span>
              <button className="btn btn-ghost btn-xs" onClick={reintentar} disabled={guardando}>
                ↻ Reintentar la extracción · USD 0.000
              </button>
            </div>
          )}

          {filas.length === 0 && filasEmp.length === 0 && (
            <div className="empty-state" style={{ padding: '18px 14px', textAlign: 'center', fontSize: 11.5 }}>
              {creando
                ? 'Este documento no trae requisitos de plantel ni de empresa (una convocatoria normalmente no los trae: están en las bases). La postulación se crea igual con los datos y el calendario; después súbele las bases desde adentro.'
                : 'No se encontró ningún requisito. Puede que estén en una parte del documento que el OCR no pudo leer, o que estas bases no los detallen.'}
            </div>
          )}

          {filas.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, margin: '6px 0 4px' }}>Plantel clave ({filas.length})</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {filas.map((f, i) => (
              <label key={i} className="card card-p" style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
                cursor: 'pointer', borderLeft: `3px solid ${f.verificada ? 'var(--green)' : 'var(--amber)'}` }}>
                <input type="checkbox" checked={marcados.has(i)} onChange={() => alternar(setMarcados, i)} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                    {f.cargo || '(sin cargo)'}
                    {f.profesion && <span style={{ fontWeight: 400, color: 'var(--tm)' }}> · {f.profesion}</span>}
                    {!f.verificada && <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>sin verificar</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 3 }}>
                    {f.meses_generales_minimos > 0 && `Experiencia general ${f.meses_generales_minimos} meses · `}
                    {f.meses_minimos > 0 && `específica ${f.meses_minimos} meses · `}
                    {f.participaciones_minimas > 0 && `${f.participaciones_minimas} participaciones`}
                    {f.meses_por_participacion > 0 && ` de ${f.meses_por_participacion} meses c/u`}
                    {f.ventana_anios && ` · últimos ${f.ventana_anios} años`}
                  </div>
                  {f.cargos_equivalentes?.length > 0 && (
                    <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>
                      Vale también como: {f.cargos_equivalentes.join(' · ')}
                    </div>
                  )}
                  {f.fuente_cita && (
                    <div style={{ fontSize: 10.5, marginTop: 5, padding: '5px 8px', borderRadius: 5,
                      background: 'var(--bg-c2)', fontStyle: 'italic', lineHeight: 1.45 }}>
                      «{f.fuente_cita}»
                      {f.fuente_pagina != null && <b style={{ fontStyle: 'normal' }}> — página {f.fuente_pagina}</b>}
                    </div>
                  )}
                  {!f.verificada && f.verificacion_motivo && (
                    <div style={{ fontSize: 10.5, color: 'var(--amber)', marginTop: 4 }}>
                      {f.verificacion_motivo}. Compruébalo en las bases antes de guardarlo.
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {filasEmp.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, margin: '12px 0 4px' }}>Requisitos de la empresa ({filasEmp.length})</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {filasEmp.map((f, i) => (
              <label key={i} className="card card-p" style={{ display: 'flex', gap: 10, alignItems: 'flex-start',
                cursor: 'pointer', borderLeft: `3px solid ${f.verificada ? 'var(--green)' : 'var(--amber)'}` }}>
                <input type="checkbox" checked={marcadosEmp.has(i)} onChange={() => alternar(setMarcadosEmp, i)} style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 12.5 }}>
                    {f.cargo}
                    {f.monto_minimo && <span style={{ fontWeight: 400, color: 'var(--blue)' }}> · {money(f.monto_minimo)}</span>}
                    {f.multiplo_valor_referencial && <span style={{ fontWeight: 400, color: 'var(--tm)' }}> · {f.multiplo_valor_referencial}× el valor referencial</span>}
                    {f.ventana_anios && <span style={{ fontWeight: 400, color: 'var(--tm)' }}> · últimos {f.ventana_anios} años</span>}
                    {!f.verificada && <span className="badge b-amber" style={{ marginLeft: 6, fontSize: 9 }}>sin verificar</span>}
                  </div>
                  {f.descripcion && <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 3 }}>{f.descripcion}</div>}
                  {f.fuente_cita && (
                    <div style={{ fontSize: 10.5, marginTop: 5, padding: '5px 8px', borderRadius: 5,
                      background: 'var(--bg-c2)', fontStyle: 'italic', lineHeight: 1.45 }}>
                      «{f.fuente_cita}»
                      {f.fuente_pagina != null && <b style={{ fontStyle: 'normal' }}> — página {f.fuente_pagina}</b>}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>

          {totalExtras > 0 && (
            <div className="card card-p" style={{ marginTop: 12 }}>
              <b style={{ fontSize: 12.5 }}>Lo demás que dicen estas bases ({totalExtras})</b>
              <div style={{ fontSize: 10.5, color: 'var(--tm)', marginBottom: 6 }}>
                Se guarda con la postulación. Es lo que hoy alguien tiene que leer a mano antes de decidir.
              </div>
              <div style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                {extras.factores_evaluacion.map((f, i) => (
                  <div key={`f${i}`}><span className="badge b-purple" style={{ fontSize: 8.5 }}>puntaje</span>{' '}
                    {f.factor}{f.puntaje_maximo ? <b> · {f.puntaje_maximo} pts</b> : ''}</div>
                ))}
                {extras.garantias.map((g, i) => (
                  <div key={`g${i}`}><span className="badge b-blue" style={{ fontSize: 8.5 }}>garantía</span>{' '}
                    {TIPO_GARANTIA_LBL[g.tipo] || g.tipo}{g.porcentaje ? <b> · {g.porcentaje}%</b> : ''}{g.detalle ? ` — ${g.detalle.slice(0, 110)}` : ''}</div>
                ))}
                {extras.penalidades.map((p, i) => (
                  <div key={`p${i}`}><span className="badge b-red" style={{ fontSize: 8.5 }}>penalidad</span>{' '}
                    {p.tipo === 'mora' ? 'Mora' : 'Otra'}{p.formula ? ` · ${p.formula}` : ''}{p.tope ? ` · tope ${p.tope}` : ''}</div>
                ))}
                {extras.condiciones.map((c, i) => (
                  <div key={`c${i}`}><span className="badge b-amber" style={{ fontSize: 8.5 }}>{TIPO_CONDICION_LBL[c.tipo] || c.tipo}</span>{' '}
                    {c.titulo || (c.detalle || '').slice(0, 120)}</div>
                ))}
                {extras.documentos_presentacion.length > 0 && (
                  <div><span className="badge b-gray" style={{ fontSize: 8.5 }}>expediente</span>{' '}
                    {extras.documentos_presentacion.length} documento(s) de presentación obligatoria</div>
                )}
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--tm)', marginRight: 'auto' }}>
              {creando
                ? `Se crea la postulación con ${aGuardar} requisito(s)${aplicarCronograma && cronograma.length ? ' y su calendario' : ''}.`
                : `Se guardan ${aGuardar} de ${filas.length + filasEmp.length}. Lo que ya tenías cargado no se toca.`}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={guardando}>Cancelar</button>
            <button className="btn btn-blue btn-sm" onClick={guardar} disabled={guardando || !puedeGuardar}>
              {guardando ? 'Guardando…' : (creando ? 'Crear la postulación' : `Guardar ${aGuardar} requisito${aGuardar === 1 ? '' : 's'}`)}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Un puesto: el requisito, quién califica y a quién elegimos ──────
function PuestoFila({ fila, puesto, rubros, candidatos, canWrite, busy, onGuardar, onBorrar }) {
  const [abierto, setAbierto] = uS(false);
  const rubro = rubros.find(r => r.id === fila.rubro_id);
  const p = puesto;
  const evaluaciones = uM(() => {
    if (!p) return [];
    // El veredicto ya trae el elegido y el más cerca; para la lista completa se
    // reevalúa solo este puesto contra todos los candidatos.
    return buscarPlantel(candidatos, [p.requisito], { hoy: hoyLocal() })[0]?.candidatos || [];
  }, [p, candidatos]);

  const icono = !p ? '❓' : (p.elegidoEnFalta ? '⚠️' : (p.cubierto ? '✅' : '⛔'));

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{ padding: '8px 14px', display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, lineHeight: 1.2 }}>{icono}</span>
        <div style={{ flex: '2 1 220px', minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 12.5 }}>{fila.cargo || '(sin cargo)'}</div>
          <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
            {fila.profesion || 'cualquier profesión'}
            {fila.meses_generales_minimos > 0 && ` · ${formatearMeses(fila.meses_generales_minimos)} de exp. general`}
            {fila.participaciones_minimas > 0 && ` · ${fila.participaciones_minimas} participaciones`}
            {fila.meses_por_participacion > 0 && ` de ${formatearMeses(fila.meses_por_participacion)} c/u`}
            {fila.ventana_anios ? ` · últimos ${fila.ventana_anios} años` : ''}
            {fila.meses_minimos > 0 && ` · ${formatearMeses(fila.meses_minimos)} acumulados`}
            {rubro ? ` · ${rubro.nombre}` : ''}
            {fila.exige_sustento === false ? ' · sin exigir constancia' : ''}
          </div>
          {Array.isArray(fila.cargos_equivalentes) && fila.cargos_equivalentes.length > 0 && (
            <div style={{ fontSize: 10, color: 'var(--tm)' }}
              title={fila.cargos_equivalentes.join(' · ')}>
              Cargos aceptados: {fila.cargos_equivalentes.slice(0, 3).join(', ')}
              {fila.cargos_equivalentes.length > 3 ? ` y ${fila.cargos_equivalentes.length - 3} más` : ''}
            </div>
          )}
          {fila.fuente === 'extraccion' && (
            <div style={{ fontSize: 10, color: 'var(--blue)' }}>
              Extraído de las bases{fila.fuente_pagina ? ` · pág. ${fila.fuente_pagina}` : ''}
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 190px' }}>
          <div style={{ fontSize: 11, color: p?.cubierto ? 'var(--green)' : 'var(--red)' }}>
            {p ? `${p.nCumplen} ${p.nCumplen === 1 ? 'califica' : 'califican'}` : '—'}
          </div>
          {p && !p.cubierto && p.masCerca && (
            <div style={{ fontSize: 10, color: 'var(--amber)' }}>
              Más cerca: {nombreDe(p.masCerca.persona)} — {
                p.masCerca.participacionesFaltantes > 0
                  ? `le falta${p.masCerca.participacionesFaltantes > 1 ? 'n' : ''} ${p.masCerca.participacionesFaltantes} participación(es)`
                  : `le faltan ${formatearMeses(p.masCerca.mesesFaltantes)}`
              }
            </div>
          )}
        </div>

        <div style={{ flex: '1 1 200px' }}>
          <label className="flabel" style={{ fontSize: 10 }}>Presentamos a</label>
          <select className="fi" style={{ fontSize: 11 }} disabled={!canWrite || busy}
            value={fila.candidato_personal_id || ''}
            onChange={e => onGuardar({ candidato_personal_id: e.target.value || null })}>
            <option value="">Sin elegir</option>
            {evaluaciones.map(ev => (
              <option key={ev.persona.id} value={ev.persona.id}>
                {ev.cumple ? '✅ ' : (ev.aplica ? '⚠️ ' : '⛔ ')}{nombreDe(ev.persona)}
              </option>
            ))}
          </select>
          {p?.elegidoEnFalta && (
            <div style={{ fontSize: 10, color: 'var(--red)' }}>
              El elegido no cumple: {p.elegido.bloqueos[0] || 'revisar'}
            </div>
          )}
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', gap: 4 }}>
          <button className="btn btn-ghost btn-xs" onClick={() => setAbierto(a => !a)}>
            {abierto ? 'Ocultar' : 'Ver quién'}
          </button>
          {canWrite && (
            <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={onBorrar}>✕</button>
          )}
        </div>
      </div>

      {abierto && (
        <div style={{ padding: '4px 14px 10px 40px', display: 'grid', gap: 5 }}>
          {evaluaciones.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--tm)' }}>
              No hay nadie en el padrón profesional todavía.
            </div>
          )}
          {evaluaciones.slice(0, 12).map(ev => (
            <div key={ev.persona.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start',
              flexWrap: 'wrap', paddingBottom: 5, borderBottom: '1px solid var(--border)' }}>
              <span style={{ fontSize: 14, lineHeight: 1.2 }}>
                {ev.cumple ? '✅' : (ev.aplica ? '⚠️' : '⛔')}
              </span>
              <div style={{ flex: '1 1 190px' }}>
                <div style={{ fontWeight: 600, fontSize: 11.5 }}>{nombreDe(ev.persona)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--tm)' }}>
                  {ev.ficha?.profesion || 'sin ficha'} · {formatearMeses(ev.mesesSustentados)} con constancia
                </div>
              </div>
              <div style={{ flex: '2 1 250px', fontSize: 10.5 }}>
                {ev.bloqueos.map((b, k) => <div key={k} style={{ color: 'var(--red)' }}>✕ {b}</div>)}
                {ev.avisos.map((a, k) => <div key={k} style={{ color: 'var(--amber)' }}>• {a}</div>)}
                {!ev.bloqueos.length && !ev.avisos.length && (
                  <div style={{ color: 'var(--green)' }}>Sin observaciones — listo para presentar</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── El botón que cruza a Trabajos ──────────────────────────────────
// Prellena, NO crea. La decisión de convertir una postulación ganada en un
// trabajo con contabilidad propia la toma una persona, mirando el borrador.
function PasarATrabajos({ lic, veredicto, destino, canWrite, toast }) {
  const [ver, setVer] = uS(false);

  if (lic.obra_id || lic.trabajo_id) {
    return (
      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--green)' }}>
        ✅ Esta postulación ya pasó a Trabajos.
      </div>
    );
  }
  if (!puedePasarATrabajos(lic)) {
    return (
      <div className="card card-p" style={{ fontSize: 11, color: 'var(--tm)' }}>
        El paso a Trabajos se habilita cuando la etapa es <b>Buena pro (ganado)</b>. Es manual a propósito.
      </div>
    );
  }

  const borrador = prefillObraDesde(lic);

  return (
    <div className="card card-p">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ fontSize: 11.5 }}>
          <b>Ganamos este proceso.</b> Podés abrir el borrador del {destino === 'obra' ? 'trabajo de obra' : 'trabajo de bienes/servicios'} con los datos ya cargados.
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => setVer(v => !v)}>
          {ver ? 'Ocultar borrador' : 'Ver borrador'}
        </button>
      </div>

      {ver && (
        <div style={{ marginTop: 8, fontSize: 11.5 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 6 }}>
            <div><span style={{ color: 'var(--tm)' }}>Nombre:</span> {borrador.nombre_obra || '—'}</div>
            <div><span style={{ color: 'var(--tm)' }}>Cliente:</span> {borrador.cliente || '—'}</div>
            <div><span style={{ color: 'var(--tm)' }}>Presupuesto:</span> {money(borrador.presupuesto_total, lic.moneda)}</div>
            <div><span style={{ color: 'var(--tm)' }}>Estado inicial:</span> Planificación</div>
          </div>
          <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--amber)' }}>
            Falta decidir a mano si ejecuta una empresa sola o un consorcio: errarlo desarma la
            contabilidad de la obra, así que no se deduce de con qué RUC se postuló.
          </div>
          {canWrite && (
            <button className="btn btn-amber btn-sm" style={{ marginTop: 8 }}
              onClick={() => {
                // El alta de la obra vive en jx-obra.jsx, con su consorcio, su
                // seed de ubicaciones y su auditoría. NO se duplica acá: se le
                // pasa el borrador y esa pantalla abre su propio formulario ya
                // lleno. Al guardar, jx-obra escribe de vuelta licitaciones.obra_id.
                try {
                  window.__prefillObraDesdeLicitacion = { ...borrador, __licitacion_id: lic.id };
                  window.dispatchEvent(new CustomEvent('jx_navigate', { detail: { page: 'obras' } }));
                } catch {
                  toast('Abrí Obras para crear la obra con estos datos', 'blue');
                }
              }}>
              Abrir el formulario de obra con estos datos ›
            </button>
          )}
        </div>
      )}

      {veredicto && veredicto.total > 0 && !veredicto.limpio && (
        <div style={{ marginTop: 8, fontSize: 10.5, color: 'var(--amber)' }}>
          Ojo: el plantel de esta postulación todavía tiene observaciones.
        </div>
      )}
    </div>
  );
}

Object.assign(window, { LicitacionesPage });
