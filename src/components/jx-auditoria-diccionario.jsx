// ═══════════════════════════════════════════════════════════════════
// JARVEX — EL PANEL DE AUDITORÍA DEL DICCIONARIO (tanda 5, 15-sep-2026).
//
// EL DEFECTO, CONTADO POR LOS NÚMEROS DE SEPTIEMBRE. La app aprende términos
// sola: cada decisión de la bandeja deja uno, cada recorrido con IA deja
// varios. En una semana eso fueron 368 términos vivos con 12 decisiones vivas
// detrás. Nadie lo vio hasta que el clasificador empezó a contestar
// «CUSQUEÑA → [21] Cemento», porque el único lugar donde se veía el
// diccionario lo mostraba de a UNA clasificación por vez — para encontrar los
// huérfanos hubo que consultar la base a mano.
//
// QUÉ HACE ESTA PANTALLA. Pone todo el diccionario propio en una sola lista
// que se puede filtrar por de dónde salió cada término (mig 212: tuyo /
// aprendido / de la IA), por a qué clasificación apunta, y por las dos formas
// de estar mal que se pueden detectar solas:
//
//   · CONTRADICE A LA NORMA — el Anexo 2 de la R.J. 016-2026 dice otra cosa,
//     con fuerza. No siempre es un error (la capa propia existe justamente
//     para corregir a la norma cuando hace falta), pero es la lista corta.
//   · SE PELEA CONSIGO MISMO — el mismo texto apuntando a dos clasificaciones
//     distintas. Cuál gana depende del orden en que se indexen: azar.
//
// Y deja despachar en bloque: sacar del diccionario las marcadas, o mandarlas
// todas a otra clasificación.
//
// 🔴 NO HAY «LIMPIAR TODO LO DE LA IA». Se marca y se mira: es la misma
// decisión de producto que la bandeja de clasificación, donde tampoco hay
// «marcar todas». Un botón que borra 500 términos sin que nadie los lea es el
// error del 365 otra vez, con el signo cambiado — y entre esos 500 están los
// que sí estaban bien.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import {
  ORIGENES, filasDeAuditoria, resumenPorOrigen, conflictosDeCodigo,
  filtrarAuditoria, codigosConTerminos,
} from "../lib/auditoria-diccionario.js";
import { quitarTerminosEnLote, moverTerminosEnLote } from "../lib/clasificaciones-db.js";
import { etiquetaCategoria } from "../lib/indices-unificados-iupc.js";
import { SelectorClasificacion, ClasificacionDatalist } from "./jx-selector-clasificacion.jsx";

const { useState: uS, useMemo: uM, useRef: uR, useId: uId } = React;

const BADGE_BANDA = { alta: 'b-red', media: 'b-amber' };

function PanelAuditoriaDiccionario({ terminos, opciones, esPrueba = false, userId = null, showToast, refrescar }) {
  // Regla de hooks: todo antes de cualquier early return.
  const [origen, setOrigen] = uS('');
  const [codigo, setCodigo] = uS('');
  const [busca, setBusca] = uS('');
  const [soloContradicciones, setSoloContra] = uS(false);
  const [soloConflictos, setSoloConf] = uS(false);
  const [marcadas, setMarcadas] = uS(() => new Set());
  const [destino, setDestino] = uS('');
  const [limite, setLimite] = uS(60);
  // Anti doble-click (regla crítica 2): ref SÍNCRONO. Un doble tap en «Sacar
  // las marcadas» no puede correr dos veces sobre la misma selección.
  const enCursoRef = uR(false);
  const listId = uId();

  // El contraste contra la norma reclasifica CADA término, así que se hace una
  // sola vez por cambio del diccionario y no en cada tecleo del buscador.
  const filas = uM(
    () => filasDeAuditoria(terminos, { demo: esPrueba }),
    [terminos, esPrueba],
  );
  const resumen = uM(() => resumenPorOrigen(filas), [filas]);
  const conflictos = uM(() => conflictosDeCodigo(filas), [filas]);
  const nContradicen = uM(() => filas.filter(f => f.contra).length, [filas]);
  const codigos = uM(() => codigosConTerminos(filas), [filas]);

  const visibles = uM(
    () => filtrarAuditoria(filas, { origen, codigo, busca, soloContradicciones, soloConflictos }),
    [filas, origen, codigo, busca, soloContradicciones, soloConflictos],
  );
  const enPantalla = uM(() => visibles.slice(0, limite), [visibles, limite]);
  const nMarcadas = uM(
    () => visibles.filter(f => marcadas.has(f.id)).length,
    [visibles, marcadas],
  );

  const conGuard = (fn) => async (...a) => {
    if (enCursoRef.current) return;
    enCursoRef.current = true;
    try { await fn(...a); }
    catch (e) { showToast?.('No se pudo: ' + (e?.message || e), 'error'); }
    finally { enCursoRef.current = false; }
  };

  const idsMarcados = () => visibles.filter(f => marcadas.has(f.id)).map(f => f.id);

  const sacar = conGuard(async () => {
    const ids = idsMarcados();
    if (!ids.length) return;
    const ok = typeof confirm !== 'function' || confirm(
      `Se van a SACAR del diccionario ${ids.length} ${ids.length === 1 ? 'término' : 'términos'}.\n\n`
      + 'La app deja de reconocerlos: las descripciones que los usaban vuelven a clasificarse '
      + 'con la norma. Las decisiones ya tomadas NO se tocan.\n\n¿Seguir?',
    );
    if (!ok) return;
    const n = await quitarTerminosEnLote(ids, { userId });
    setMarcadas(new Set());
    await refrescar?.();
    showToast?.(`✓ ${n} ${n === 1 ? 'término sacado' : 'términos sacados'} del diccionario`, 'green');
  });

  const mover = conGuard(async () => {
    const ids = idsMarcados();
    if (!ids.length || !destino) return;
    const n = await moverTerminosEnLote(ids, destino, { userId });
    setMarcadas(new Set());
    setDestino('');
    await refrescar?.();
    showToast?.(`✓ ${n} ${n === 1 ? 'término movido' : 'términos movidos'} a ${etiquetaCategoria(destino)}`, 'green');
  });

  const togglear = (id) => setMarcadas(prev => {
    const s = new Set(prev);
    if (s.has(id)) s.delete(id); else s.add(id);
    return s;
  });

  // «Marcar las de esta vista» marca lo que está FILTRADO, no todo el
  // diccionario: es lo que la persona está mirando y puede leer. Sin filtro no
  // se ofrece — sería el «marcar todas» que esta pantalla no tiene.
  const hayFiltro = !!(origen || codigo || busca.trim() || soloContradicciones || soloConflictos);

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <ClasificacionDatalist id={listId} opciones={opciones} />

      <div className="card card-p" style={{ fontSize: 11.5, color: 'var(--ts)', lineHeight: 1.6 }}>
        Acá está <strong>todo el diccionario propio</strong> junto: los términos que la app aprendió
        y los que escribiste vos. La base oficial (el Anexo 2 del INEI y el árbol de servicios) no
        aparece — esa no se audita ni se toca.
        <div style={{ marginTop: 6, color: 'var(--tm)' }}>
          Lo que aprende solo tiene que poder revisarse igual de rápido que se aprendió. En septiembre
          quedaron <strong>365 términos huérfanos</strong> de decisiones ya deshechas, y el clasificador
          los usaba con la autoridad de la norma peruana.
        </div>
      </div>

      {/* ── El titular: de dónde salió cada término ─────────────── */}
      <div className="card card-p">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <strong style={{ fontSize: 12.5 }}>📖 {filas.length} {filas.length === 1 ? 'término propio' : 'términos propios'}</strong>
          {resumen.map(o => (
            <button key={o.slug} type="button"
              className={`btn btn-xs ${origen === o.slug ? 'btn-amber' : 'btn-ghost'}`}
              title={o.ayuda}
              onClick={() => setOrigen(origen === o.slug ? '' : o.slug)}>
              <span className={`badge ${o.badge}`} style={{ fontSize: 8.5, marginRight: 4 }}>{o.corto}</span>
              {o.n}
            </button>
          ))}
          {origen && (
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => setOrigen('')}>Ver todos</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
          <button type="button" className={`btn btn-xs ${soloContradicciones ? 'btn-red' : 'btn-ghost'}`}
            disabled={!nContradicen}
            title="El Anexo 2 de la R.J. 016-2026 dice otra cosa, y lo dice con fuerza. No siempre es un error: la capa propia existe para corregir a la norma. Pero es la lista corta donde mirar primero."
            onClick={() => setSoloContra(v => !v)}>
            ⚠ {nContradicen} contradicen a la norma
          </button>
          <button type="button" className={`btn btn-xs ${soloConflictos ? 'btn-red' : 'btn-ghost'}`}
            disabled={!conflictos.length}
            title="El mismo texto apuntando a dos clasificaciones distintas. Cuál gana depende del orden en que se indexen: azar."
            onClick={() => setSoloConf(v => !v)}>
            ⚔ {conflictos.length} se pelean entre sí
          </button>
        </div>
      </div>

      {/* ── Los filtros ─────────────────────────────────────────── */}
      <div className="card card-p" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', minWidth: 180 }}>
          <label style={{ fontSize: 10.5, color: 'var(--tm)' }}>Buscar término</label>
          <input className="fi" style={{ fontSize: 12 }} value={busca}
            placeholder="cemento, cusqueña, drill…"
            onChange={e => { setBusca(e.target.value); setLimite(60); }} />
        </div>
        <div style={{ flex: '1 1 220px', minWidth: 180 }}>
          <label style={{ fontSize: 10.5, color: 'var(--tm)' }}>Clasificación a la que apunta</label>
          <select className="fi" style={{ fontSize: 12 }} value={codigo}
            onChange={e => { setCodigo(e.target.value); setLimite(60); }}>
            <option value="">Todas ({codigos.length} con términos)</option>
            {codigos.map(c => <option key={c.codigo} value={c.codigo}>{c.etiqueta} ({c.n})</option>)}
          </select>
        </div>
        <div style={{ fontSize: 11, color: 'var(--tm)' }}>
          {visibles.length} {visibles.length === 1 ? 'término' : 'términos'} en esta vista
        </div>
      </div>

      {/* ── Lo que se hace con las marcadas ─────────────────────── */}
      {nMarcadas > 0 && (
        <div className="card card-p" style={{ borderLeft: '3px solid var(--amber)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <strong style={{ fontSize: 12 }}>{nMarcadas} {nMarcadas === 1 ? 'marcado' : 'marcados'}</strong>
          <button type="button" className="btn btn-xs btn-red" onClick={sacar}>
            ✕ Sacar del diccionario
          </button>
          <div style={{ flex: '1 1 240px', minWidth: 200 }}>
            <label style={{ fontSize: 10.5, color: 'var(--tm)' }}>…o mandarlos todos a</label>
            <SelectorClasificacion listId={listId} opciones={opciones} value={destino}
              onChange={setDestino} permitirVacio
              placeholder="Elegí la clasificación correcta…" style={{ fontSize: 12 }} />
          </div>
          <button type="button" className="btn btn-xs btn-green" disabled={!destino} onClick={mover}>
            → Mover los {nMarcadas}
          </button>
          <button type="button" className="btn btn-xs btn-ghost" onClick={() => setMarcadas(new Set())}>
            Desmarcar
          </button>
        </div>
      )}

      {/* ── La lista ────────────────────────────────────────────── */}
      <div className="card card-p">
        {hayFiltro && visibles.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <button type="button" className="btn btn-xs btn-ghost"
              title="Marca los que estás viendo con este filtro — no todo el diccionario."
              onClick={() => setMarcadas(prev => {
                const s = new Set(prev);
                for (const f of visibles) s.add(f.id);
                return s;
              })}>
              Marcar los {visibles.length} de esta vista
            </button>
          </div>
        )}
        {visibles.length === 0 ? (
          <div style={{ fontSize: 11.5, color: 'var(--tm)', fontStyle: 'italic' }}>
            {filas.length === 0
              ? 'El diccionario propio está vacío: la app todavía no aprendió ningún término y no escribiste ninguno a mano.'
              : 'Ningún término cae en este filtro.'}
          </div>
        ) : (
          <table className="tbl" style={{ fontSize: 11.5 }}>
            <tbody>
              {enPantalla.map(f => {
                const o = ORIGENES.find(x => x.slug === f.origen);
                return (
                  <tr key={f.id} style={f.contra ? { background: 'rgba(231,76,60,.06)' } : undefined}>
                    <td style={{ width: 24 }}>
                      <input type="checkbox" checked={marcadas.has(f.id)} onChange={() => togglear(f.id)} />
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{f.termino}</div>
                      {f.contra && (
                        <div style={{ fontSize: 10.5, color: 'var(--tm)', marginTop: 2 }}>
                          La norma diría <strong>{etiquetaCategoria(f.contra.codigo)}</strong>
                          <span className={`badge ${BADGE_BANDA[f.contra.banda] || 'b-gray'}`} style={{ marginLeft: 4, fontSize: 8.5 }}>
                            {Math.round(f.contra.score * 100)}%
                          </span>
                          {f.contra.motivos?.[0] && <> · {f.contra.motivos[0]}</>}
                        </div>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>→ {f.etiqueta}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`badge ${o?.badge || 'b-gray'}`} style={{ fontSize: 8.5 }}
                        title={o?.ayuda}>{o?.corto || f.origen}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {visibles.length > enPantalla.length && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-xs btn-ghost" onClick={() => setLimite(l => l + 120)}>
              Ver {Math.min(120, visibles.length - enPantalla.length)} más
              {' '}({visibles.length - enPantalla.length} sin mostrar)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { PanelAuditoriaDiccionario });
export { PanelAuditoriaDiccionario };
