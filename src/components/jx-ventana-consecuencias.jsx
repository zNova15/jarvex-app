// ═══════════════════════════════════════════════════════════════════
// JARVEX — LA VENTANA DE CONSECUENCIAS (tanda 3 del destino, 18-set-2026).
//
// Lo que ve la contadora entre «Guardar» y la escritura, cuando corregir la
// cuenta de un asiento arrastra algo más. La lógica entera vive en
// `src/lib/consecuencias-correccion.js` (pura, testeada); esto solo la dibuja.
//
// Vive en su propio archivo y sin tocar `window` para poder renderizarla en un
// test con escenarios reales: una ventana que revienta al abrirse es peor que
// no tenerla, porque se descubre justo cuando alguien está por guardar.
// Solo la importa `jx-asientos.jsx`, así que viaja dentro de ese chunk.
// ═══════════════════════════════════════════════════════════════════
import React from "react";

// Importe con su moneda. Nunca se suman monedas distintas (regla 11): cada
// una se muestra por separado.
const fmtMon = (n, cur = 'PEN') => {
  const pre = !cur || cur === 'PEN' ? 'S/ ' : (cur === 'USD' ? 'US$ ' : `${cur} `);
  return pre + Number(n || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const ladoDe = (neto, cur) => (Math.abs(neto) < 0.005 ? '—'
  : `${fmtMon(Math.abs(neto), cur)} al ${neto > 0 ? 'debe' : 'haber'}`);

const CAJA_AVISO = {
  rojo:  { background: 'rgba(231,76,60,.10)', color: 'var(--red)' },
  ambar: { background: 'rgba(242,183,5,.12)', color: 'var(--amber)' },
  info:  { background: 'var(--bg-s)', color: 'var(--tm)' },
  verde: { background: 'rgba(46,204,113,.10)', color: 'var(--ts)' },
};
const Caja = ({ nivel = 'info', children, style }) => (
  <div style={{ padding: '8px 10px', borderRadius: 6, fontSize: 12, lineHeight: 1.45, ...CAJA_AVISO[nivel], ...style }}>
    {children}
  </div>
);
const TituloBloque = ({ letra, children }) => (
  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--tm)', letterSpacing: '.03em', marginBottom: 6 }}>
    {letra} · {children}
  </div>
);

/** De dónde salió la familia de un ítem, dicho en castellano. */
function origenDeItem(it) {
  if (!it.familia) return 'no se reconoció: ninguna clasificación le corresponde todavía';
  const fam = it.familiaNombre || it.familia;
  if (it.via === 'nombre' || it.via === 'alias') {
    const insumo = it.catalogoNombre && it.via === 'alias' && it.alcance === 'descripcion'
      ? ` (cuenta como el insumo «${it.catalogoNombre}»)`
      : '';
    return `está clasificado como ${fam} en el catálogo${it.catalogoGlobal ? ' del grupo' : ' de la empresa'}${insumo}`;
  }
  return `lo dedujo el clasificador del texto: ${fam} (${Math.round((Number(it.score) || 0) * 100)} %)`;
}

/** Qué se va a escribir si se corrige esta clasificación. */
function queSeCorrige(it, familia) {
  const fam = familia;
  if (it.alcance === 'insumo') {
    return `Se corrige el insumo «${it.catalogoNombre || it.descripcion}» del catálogo`
      + `${it.catalogoGlobal ? ' del grupo: vale para TODAS las empresas' : ''}. Todas las facturas que lo traigan pasan a ${fam}.`;
  }
  if (it.catalogoNombre) {
    return `«${it.descripcion}» deja de contar como «${it.catalogoNombre}» y pasa a ser un insumo propio en ${fam}. `
      + `«${it.catalogoNombre}» no se toca: si el mal clasificado es él, corregilo en Clasificación de insumos y servicios.`;
  }
  return `«${it.descripcion}» se da de alta en el catálogo como ${fam}: la próxima factura que lo traiga ya sale bien.`;
}

/**
 * LA VENTANA DE CONSECUENCIAS (tanda 3 del destino).
 *
 * Tres bloques, en el orden en que se leen: qué cambia acá, de dónde salió la
 * decisión que se está corrigiendo, y qué más se mueve. Todo lo que dice sale
 * de `armarConsecuencias`, que simula el asiento con la corrección aplicada:
 * no hay una segunda cuenta hecha acá que pueda contradecir al libro.
 */
export function VentanaConsecuencias({ c, seleccion, setSeleccion, cuentaElegida, moneda }) {
  if (!c) return null;
  const sel = seleccion || c.seleccion;
  const marcar = (cambios) => setSeleccion({ ...sel, ...cambios });
  const nombresFam = new Map();
  for (const it of c.causas) for (const f of it.familiasPosibles) nombresFam.set(f.codigo, f.nombre);

  const hayC = c.alcance.cambian.length || c.alcance.conManual || c.hermanos.planes.length
    || c.hermanos.cerrados.length || c.hermanos.seArreglanSolos.length;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* ── A · QUÉ CAMBIA ─────────────────────────────────────── */}
      <div>
        <TituloBloque letra="A">Qué cambia en este comprobante</TituloBloque>
        {c.diff.length > 0 ? (
          <table className="tbl" style={{ fontSize: 12 }}>
            <thead>
              <tr><th>Cuenta</th><th style={{ textAlign: 'right' }}>Antes</th><th style={{ textAlign: 'right' }}>Después</th></tr>
            </thead>
            <tbody>
              {c.diff.map(d => (
                <tr key={d.cuenta}>
                  <td>
                    <span className="col-m" style={{ fontFamily: 'monospace', fontWeight: 600 }}>{d.cuenta}</span>{' '}
                    <span style={{ color: 'var(--tm)' }}>{d.nombre}</span>
                  </td>
                  <td style={{ textAlign: 'right', color: Math.abs(d.antes) > 0.005 ? 'var(--ts)' : 'var(--tm)' }}>{ladoDe(d.antes, moneda)}</td>
                  <td style={{ textAlign: 'right', color: Math.abs(d.despues) > 0.005 ? 'var(--ts)' : 'var(--tm)', fontWeight: 600 }}>{ladoDe(d.despues, moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize: 12, color: 'var(--tm)' }}>Las líneas del asiento quedan igual.</div>
        )}
        <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
          {c.cambioDeTipo && (
            <Caja nivel="ambar">
              En el Estado de Resultados pasa de <strong>{c.cambioDeTipo.de === 'cost' ? 'Costos' : 'Gastos'}</strong> a{' '}
              <strong>{c.cambioDeTipo.a === 'cost' ? 'Costos' : 'Gastos'}</strong>:{' '}
              {fmtMon(c.cambioDeTipo.importe, c.cambioDeTipo.moneda)}. La vinculación a la obra no se toca.
            </Caja>
          )}
          {c.salesola && (
            <Caja nivel="verde">
              La {cuentaElegida} no queda puesta a mano: con la clasificación corregida, este comprobante
              sale solo en esa cuenta. Si mañana se corrige otra cosa del comprobante, la cuenta la sigue.
            </Caja>
          )}
          {c.avisos.map((a, i) => (
            <Caja key={i} nivel={a.nivel === 'rojo' ? 'rojo' : a.nivel === 'ambar' ? 'ambar' : 'info'}>
              {a.nivel !== 'info' ? '⚠ ' : ''}{a.texto}
            </Caja>
          ))}
        </div>
      </div>

      {/* ── B · DE DÓNDE SALIÓ ─────────────────────────────────── */}
      {(c.causas.length > 0 || c.sinCausa || c.tipo) && (
        <div>
          <TituloBloque letra="B">De dónde salió la decisión que estás corrigiendo</TituloBloque>
          <div style={{ display: 'grid', gap: 8 }}>
            {c.causas.map(it => {
              const elegida = sel.correcciones?.[it.norm] || '';
              return (
                <div key={it.norm} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 12, lineHeight: 1.45 }}>
                  <div>
                    <strong style={{ color: 'var(--ts)' }}>«{it.descripcion}»</strong>{' '}
                    <span style={{ color: 'var(--tm)' }}>
                      {origenDeItem(it)}{it.cuenta ? <> → <span className="col-m">{it.cuenta}</span></> : null}
                    </span>
                  </div>
                  {it.corregible ? (
                    <div style={{ marginTop: 6 }}>
                      <select
                        className="fi"
                        style={{ width: '100%', fontSize: 12 }}
                        value={elegida}
                        onChange={e => marcar({ correcciones: { ...(sel.correcciones || {}), [it.norm]: e.target.value } })}>
                        <option value="">No corregir la clasificación (solo este comprobante)</option>
                        {it.familiasPosibles.map(f => (
                          <option key={f.codigo} value={f.codigo}>Corregirla a {f.nombre} → {f.cuenta}</option>
                        ))}
                      </select>
                      <div style={{ marginTop: 4, color: elegida ? 'var(--ts)' : 'var(--tm)', fontSize: 11.5 }}>
                        {elegida
                          ? queSeCorrige(it, nombresFam.get(elegida) || elegida)
                          : 'Si no se corrige, la próxima factura con este ítem vuelve a salir en la cuenta de antes.'}
                      </div>
                    </div>
                  ) : null}
                  {/* Tanda 4: la cuenta no la puso la clasificación sino lo que
                      la empresa hace con el insumo. Ofrecer reclasificarlo acá
                      sería ofrecer una corrección que no corrige nada. */}
                  {it.porNaturaleza && (
                    <div style={{ marginTop: 6, color: 'var(--tm)', fontSize: 11.5 }}>
                      {it.porNaturaleza}
                    </div>
                  )}
                </div>
              );
            })}
            {c.reclasificarVedado && (
              <Caja nivel="info">
                Corregir la clasificación del catálogo lo hace contabilidad (admin, gerente o
                contador). Con tu rol la corrección vale para este comprobante: avisales para
                que corrijan el insumo y la próxima factura salga bien.
              </Caja>
            )}
            {c.partido && c.causas.some(x => x.corregible) && (
              <Caja nivel="info">
                Este comprobante mezcla cosas de naturalezas distintas, así que no se marcó ninguna
                corrección sola: marcá solo los ítems que estaban mal clasificados.
              </Caja>
            )}
            {c.sinCausa && <Caja nivel="info">{c.sinCausa}</Caja>}
            {c.tipo && (c.tipo.bloqueado ? (
              <Caja nivel="info">{c.tipo.porque}</Caja>
            ) : (
              <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12, lineHeight: 1.45 }}>
                <input type="checkbox" style={{ marginTop: 2 }}
                  checked={sel.corregirTipo !== false}
                  onChange={e => marcar({ corregirTipo: e.target.checked })}/>
                <span>
                  Corregir también el tipo: pasa de <strong>{c.tipo.actual === 'cost' ? 'Costo' : 'Gasto'}</strong> a{' '}
                  <strong>{c.tipo.nuevo === 'cost' ? 'Costo' : 'Gasto'}</strong>.
                  <div style={{ color: 'var(--tm)', fontSize: 11.5 }}>{c.tipo.porque}</div>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* ── C · A QUÉ MÁS SE APLICA ────────────────────────────── */}
      <div>
        <TituloBloque letra="C">A qué más se aplica</TituloBloque>
        {!hayC ? (
          <div style={{ fontSize: 12, color: 'var(--tm)' }}>A nada más: el cambio queda en este comprobante.</div>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {c.alcance.cambian.length > 0 && (
              <Caja nivel={c.alcance.cerrados ? 'rojo' : 'ambar'}>
                Con la clasificación corregida cambian solos <strong>{c.alcance.cambian.length}</strong> comprobante(s) más
                ({Object.entries(c.alcance.porMoneda).map(([cur, n]) => fmtMon(n, cur)).join(' · ')}).
                {c.alcance.cerrados > 0 && <> <strong>{c.alcance.cerrados} son de meses ya presentados a SUNAT.</strong></>}
                {c.alcance.otrasEmpresas > 0 && <> {c.alcance.otrasEmpresas} son de otras empresas del grupo.</>}
                <div style={{ marginTop: 5, color: 'var(--tm)', fontSize: 11.5 }}>
                  {c.alcance.ejemplos.map(e => (
                    <div key={e.id}>
                      {e.documento || '(sin número)'} · {e.fecha} · {e.proveedor || '—'} · {fmtMon(e.importe, e.moneda)}:{' '}
                      <span className="col-m">{e.antes.join('+') || '?'}</span> → <span className="col-m">{e.despues.join('+') || '?'}</span>
                      {e.cerrado ? ' 🔒' : ''}
                    </div>
                  ))}
                  {c.alcance.cambian.length > c.alcance.ejemplos.length && (
                    <div>y {c.alcance.cambian.length - c.alcance.ejemplos.length} más.</div>
                  )}
                </div>
              </Caja>
            )}
            {/* 🔴 Acá había una casilla OBLIGATORIA («entiendo que cambia el
                asiento de N comprobantes de meses ya presentados») sin la cual
                no se podía guardar. Se sacó el 22-set-2026 junto con el candado
                del Libro Diario: el cierre anual reclasifica el ejercicio
                entero y el 94 % de los comprobantes es de un mes presentado, o
                sea que la casilla aparecía casi siempre y se marcaba sin leer.
                El NÚMERO se sigue diciendo —arriba, en la caja del alcance— y
                cada escritura queda en Auditoría; lo que se fue es la traba. */}
            {c.cerradosQueSeMueven > 0 && (
              <Caja nivel="ambar">
                <strong>{c.cerradosQueSeMueven} de los que se mueven son de meses ya presentados a SUNAT.</strong>
                {' '}Se corrigen igual —es lo que hace falta para el cierre anual— y queda
                registrado en Auditoría. Si preferís no moverlos, dejá la clasificación sin corregir.
              </Caja>
            )}
            {c.alcance.conManual > 0 && (
              <Caja nivel="info">
                {c.alcance.conManual} comprobante(s) con el mismo ítem tienen la cuenta puesta a mano: esos no cambian.
              </Caja>
            )}
            {(c.hermanos.planes.length > 0 || c.hermanos.cerrados.length > 0 || c.hermanos.seArreglanSolos.length > 0) && (
              <Caja nivel="info">
                Del mismo proveedor:
                {c.hermanos.planes.length > 0 && <> <strong>{c.hermanos.planes.length}</strong> reciben la misma corrección.</>}
                {c.hermanos.seArreglanSolos.length > 0 && <> {c.hermanos.seArreglanSolos.length} ya salen bien con la clasificación corregida, sin ponerles nada a mano.</>}
                {c.hermanos.cerrados.length > 0 && <> {c.hermanos.cerrados.length} son de meses ya presentados y <strong>también se corrigen</strong>.</>}
              </Caja>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default VentanaConsecuencias;
