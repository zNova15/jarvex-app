// ═══════════════════════════════════════════════════════════════════
// JARVEX — El cartel de "estás dentro de una empresa" (tanda 2F).
//
// Hermano del cartel de obra activa de la entrega 2B, y por el mismo motivo:
// cuando entrás a la contabilidad de UNA empresa y desde ahí abrís
// Movimientos, Comprobantes o el Libro diario, esas pantallas te muestran lo
// de ESA empresa. Sin un cartel, no habría forma de saber por qué la lista es
// más corta que de costumbre.
//
// 🔴 SIN «VER TODAS LAS EMPRESAS» (9-sep-2026). Gabriel: «he ingresado al
// bloque de empresa y en cada una de ellas en la mayoría de secciones me sale
// el botón de "Ver todas las empresas", quítalo, se supone que aquí nos
// concentraremos netamente en la contabilidad de cada empresa
// independientemente». La salida sigue existiendo — «Volver a la empresa»
// lleva al Panel, y desde ahí «Volver a Empresas» (jx-empresa-detalle.jsx)
// limpia el contexto — pero ya no es un atajo de un click desde cada pantalla
// contable, que era justo lo que invitaba a mezclar dos empresas sin querer.
//
// Vive en el chunk PRINCIPAL (lo importa main.jsx) y se expone como
// window.EmpresaActivaBanner para que lo usen las páginas lazy sin
// import cruzado. Mismo patrón que window.JxIcon y window.TemaToggle.
// ═══════════════════════════════════════════════════════════════════
import React from "react";
import { getEmpresaActivaId, EMPRESA_ACTIVA_EVENT } from "../lib/empresa-activa.js";

const JxIcon = (p) => (window.JxIcon ? <window.JxIcon {...p} /> : null);

/**
 * Hook: el id de la empresa activa, reactivo a los cambios.
 * Igual que useObraActiva, para que una pantalla abierta se entere cuando el
 * usuario sale del contexto desde otra parte.
 */
export function useEmpresaActivaId() {
  const [id, setId] = React.useState(() => getEmpresaActivaId());
  React.useEffect(() => {
    const on = (e) => setId(e?.detail?.id ?? getEmpresaActivaId());
    window.addEventListener(EMPRESA_ACTIVA_EVENT, on);
    return () => window.removeEventListener(EMPRESA_ACTIVA_EVENT, on);
  }, []);
  return id;
}

// `onSalir` ya no se usa acá (el botón que lo disparaba se quitó el
// 9-sep-2026), pero se sigue aceptando sin usar: 15 pantallas lo siguen
// pasando y tocarlas todas para borrar una prop muerta no vale el riesgo.
function EmpresaActivaBanner({ onSalir: _onSalir }) {
  const empresaId = useEmpresaActivaId();
  const { data: companies } = window.__hooks?.useCompanies?.() || { data: [] };
  if (!empresaId) return null;
  const emp = (companies || []).find(c => c.id === empresaId);

  return (
    <div className="card card-p" style={{
      marginBottom: 12, borderLeft: '3px solid var(--purple)',
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
    }}>
      <JxIcon name="building" size={16} color="var(--purple)" />
      <div style={{ flex: 1, minWidth: 200, fontSize: 12, color: 'var(--ts)' }}>
        Estás dentro de <strong style={{ color: 'var(--tp)' }}>{emp?.name || 'una empresa'}</strong>
        {emp?.ruc ? <span style={{ color: 'var(--tm)' }}> · RUC {emp.ruc}</span> : null}
        <div style={{ fontSize: 11, color: 'var(--tm)', marginTop: 2 }}>
          Esta pantalla muestra solo lo suyo. Su contabilidad es independiente de la de las demás.
        </div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={() => window.__navTo?.('empresas', 'general')}
        title="Volver al panel de esta empresa">
        <JxIcon name="chevL" size={12} /> Volver a la empresa
      </button>
    </div>
  );
}

Object.assign(window, { EmpresaActivaBanner });
export { EmpresaActivaBanner };
