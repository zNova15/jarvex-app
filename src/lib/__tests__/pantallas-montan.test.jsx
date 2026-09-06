// ═══════════════════════════════════════════════════════════════════
// EL TEST QUE FALTABA: ¿la pantalla ABRE?
//
// El 3-sep-2026 Gabriel reportó «entro a contabilidad y me sale un error, no
// me deja ingresar». La causa era una línea:
//
//     const filtered = uMC(() => { … guiasPorMov … }, [ …, guiasPorMov, … ]);
//     …500 líneas más abajo…
//     const guiasPorMov = uMC(…)
//
// Un `const` usado antes de su declaración es un ReferenceError de TDZ, y como
// `guiasPorMov` estaba en el ARRAY DE DEPS (que se evalúa en cada render),
// MovimientosContablesPage tiraba el error en el primer render: pantalla
// muerta. No lo veía NADA: ni el build (es JS válido), ni el lint, ni los 983
// tests de librería — porque ningún test montaba un componente.
//
// Este test monta CADA pantalla registrada con datos vacíos y el rol admin.
// No verifica lo que dibuja (eso es de cada test de librería): verifica que
// ABRA. Es barato y ataja la clase de bug más cara que tiene esta app —
// la pantalla en blanco.
//
// Datos vacíos ⇒ este test NO puede ver un crash que dependa de una fila rara.
// Lo que sí garantiza: TDZ, hooks fuera de orden, un import roto, un `.map` de
// undefined en el camino feliz. Que es exactamente lo que se nos escapó.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

// ── Un browser de mentira, lo mínimo para que un render corra en Node ──
// Se monta sobre globalThis (no sobre un objeto aparte) porque en el browser
// `window.X` y el identificador suelto `X` son la MISMA cosa, y la app usa las
// dos formas indistintamente.
function montarBrowserFalso() {
  const store = {};
  const g = globalThis;
  g.window = g;
  g.location = { href: 'http://localhost/', hash: '', search: '', reload() {} };
  g.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  g.addEventListener = () => {}; g.removeEventListener = () => {}; g.dispatchEvent = () => {};
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  g.innerWidth = 1400;
  g.getComputedStyle = () => ({ getPropertyValue: () => '' });
  const nodo = () => ({
    style: { setProperty() {}, getPropertyValue: () => '' },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild() {}, removeChild() {}, dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    getContext: () => null, addEventListener() {}, removeEventListener() {},
  });
  g.document = {
    documentElement: nodo(), body: nodo(), head: nodo(),
    createElement: nodo, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
  };
  g.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };

  const hookVacio = () => ({ data: [], loading: false, error: null, refetch: () => {} });
  g.__hooks = new Proxy({}, { get: () => hookVacio });
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__canSeeSidebarItem = () => true;
  g.__hasPerm = () => true;
  g.__navTo = () => {};
  g.__getObraActivaId = () => null;
  g.__setObraActivaId = () => {};
  g.__fecha = { hoyLocal: () => '2026-09-03', horaLocal: () => '12:00', getTZ: () => 'America/Lima' };
  g.__newId = () => 'id-falso';
  g.JxIcon = () => null;
  g.SinObraEmpty = () => null;
}

// Los chunks que se cargan on-demand. Cada uno expone sus pantallas en
// `window.*Page` al importarse: no hace falta listarlas a mano.
const CHUNKS = [
  '../../components/jx-activos-fijos.jsx',
  '../../components/jx-activos.jsx',
  '../../components/jx-admin.jsx',
  '../../components/jx-alertas.jsx',
  '../../components/jx-almacen.jsx',
  '../../components/jx-ambiental.jsx',
  '../../components/jx-analisis-insumos.jsx',
  '../../components/jx-asientos.jsx',
  '../../components/jx-audit-log.jsx',
  '../../components/jx-busqueda.jsx',
  '../../components/jx-caja-chica.jsx',
  '../../components/jx-calidad.jsx',
  '../../components/jx-captura-campo.jsx',
  '../../components/jx-captura-magica.jsx',
  '../../components/jx-compras-categoria.jsx',
  '../../components/jx-compras-pendientes.jsx',
  '../../components/jx-compras.jsx',
  '../../components/jx-comprobantes.jsx',
  '../../components/jx-conciliacion.jsx',
  '../../components/jx-conflicts.jsx',
  '../../components/jx-contabilidad.jsx',
  '../../components/jx-control-consumo.jsx',
  '../../components/jx-cts-grati.jsx',
  '../../components/jx-cumplimiento-cronograma.jsx',
  '../../components/jx-dashboard-ejecutivo.jsx',
  '../../components/jx-dashboard-gestion.jsx',
  '../../components/jx-dashboard.jsx',
  '../../components/jx-epps.jsx',
  '../../components/jx-especialidad.jsx',
  '../../components/jx-evidencias.jsx',
  '../../components/jx-foto-insumo.jsx',
  '../../components/jx-frentes.jsx',
  '../../components/jx-gestion.jsx',
  '../../components/jx-guias.jsx',
  '../../components/jx-importar.jsx',
  '../../components/jx-ingeniero.jsx',
  '../../components/jx-inicio.jsx',
  '../../components/jx-insumos-emergencia.jsx',
  '../../components/jx-insumos-persona.jsx',
  '../../components/jx-kpis-obra.jsx',
  '../../components/jx-libros-electronicos.jsx',
  '../../components/jx-mantenimiento.jsx',
  '../../components/jx-mi-frente.jsx',
  '../../components/jx-migracion-import.jsx',
  '../../components/jx-movimientos-insumos.jsx',
  '../../components/jx-movimientos.jsx',
  '../../components/jx-obra.jsx',
  '../../components/jx-ordenes-intercompany.jsx',
  '../../components/jx-ordenes.jsx',
  '../../components/jx-pagos.jsx',
  '../../components/jx-personal-contratos.jsx',
  '../../components/jx-plame.jsx',
  '../../components/jx-plan-cuentas.jsx',
  '../../components/jx-planillas.jsx',
  '../../components/jx-precio-historial.jsx',
  '../../components/jx-profesionales.jsx',
  '../../components/jx-reportes-avance.jsx',
  '../../components/jx-reportes-contable.jsx',
  '../../components/jx-reportes-financieros.jsx',
  '../../components/jx-reportes-movimientos.jsx',
  '../../components/jx-reportes.jsx',
  '../../components/jx-seguridad.jsx',
  '../../components/jx-social.jsx',
  '../../components/jx-solicitud-residente.jsx',
  '../../components/jx-solicitudes.jsx',
  '../../components/jx-ssoma-extra.jsx',
  '../../components/jx-ssoma.jsx',
  '../../components/jx-stock-estados.jsx',
  '../../components/jx-stock-ubic.jsx',
  '../../components/jx-subcontratos-val.jsx',
  '../../components/jx-subcontratos.jsx',
  '../../components/jx-tesoreria.jsx',
  '../../components/jx-trabajos.jsx',
  '../../components/jx-ubicaciones.jsx',
  '../../components/jx-valorizaciones.jsx',
];

let pantallas = [];
const fallosImport = [];

beforeAll(async () => {
  montarBrowserFalso();
  const antes = new Set(Object.keys(globalThis));
  for (const c of CHUNKS) { try { await import(c); } catch (e) { fallosImport.push(`${c}: ${e.message}`); } }
  pantallas = Object.keys(globalThis).filter(k => !antes.has(k) && /Page$/.test(k)).sort();
// 🔴 TIMEOUT EXPLÍCITO (5-sep-2026). Este hook importa ~40 chunks de la app;
// solo tarda ~6 s, pero con la suite completa corriendo en paralelo se pasaba
// del default de 10 s de vitest y el archivo entero se marcaba FAILED sin que
// fallara una sola aserción. Ése era "el test flaky" que el handoff de R2
// mandaba volver a correr — y es JUSTO el que no puede ser ruido: es el que
// atrapó el TDZ que dejó Movimientos Contables muerto con el green gate en
// verde. Un guard que falla al azar se termina ignorando.
}, 60000);

describe('cada pantalla abre', () => {
  it('se encontraron las pantallas de los chunks importados', () => {
    // Si este número se desploma, algún chunk dejó de exponer sus páginas y el
    // test de abajo pasaría sin probar nada.
    expect(fallosImport, 'chunk que no se pudo ni importar').toEqual([]);
    // 114 el 3-sep-2026. El piso está bajo a propósito: sirve para detectar
    // que un chunk dejó de exponer sus páginas, no para contarlas.
    expect(pantallas.length).toBeGreaterThan(100);
  });

  it('ninguna tira un error al montarse', () => {
    const fallos = [];
    for (const nombre of pantallas) {
      try {
        renderToString(React.createElement(globalThis[nombre], {
          showToast: () => {}, onNav: () => {}, onEnterObra: () => {}, onVolver: () => {},
        }));
      } catch (e) {
        fallos.push(`${nombre}: ${e.message}`);
      }
    }
    expect(fallos, 'pantalla que revienta al abrir').toEqual([]);
  });
});
