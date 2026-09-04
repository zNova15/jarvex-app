// ═══════════════════════════════════════════════════════════════════
// EL SEGUNDO PISO DEL MISMO GATE: ¿la pantalla abre CON DATOS?
//
// `pantallas-montan.test.jsx` monta las 114 pantallas con las tablas VACÍAS.
// Eso ataja TDZ, hooks fuera de orden e imports rotos, y su propio encabezado
// lo dice: «datos vacíos ⇒ este test NO puede ver un crash que dependa de una
// fila rara».
//
// Gabriel, 4-sep-2026, probando staging: «el problema viene cuando yo quiero
// ingresar a la parte de movimientos, y movimientos A VECES no me deja
// ingresar». "A veces" es la firma de un crash que depende del dato, no del
// código: con el catálogo vacío la pantalla abre siempre.
//
// Este archivo monta las MISMAS pantallas contra un juego de filas realista
// —el grupo de verdad: una empresa propia, un consorcio, un consorcio tratado
// como tercero, y comprobantes con las rarezas que hay en producción (nota de
// crédito en negativo, factura sin número, anulada, en dólares, interna sin
// espejo)— y además lo hace DOS veces: mirando el grupo entero y **parado
// dentro de una empresa** (`empresa_activa_id` en localStorage), que es el
// contexto donde apareció el problema.
//
// Las filas son a propósito IRREGULARES: la app es offline-first y las tablas
// bajan de a poco, así que una pantalla tiene que sobrevivir a una fila a la
// que todavía le faltan campos. Si una revienta, es un bug de la pantalla.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const JARVEX = 'c-jarvex';
const INCA   = 'c-inca';
const ESPER  = 'c-esperanza';
const OBRA   = 'o-1';

// ── El grupo, en miniatura ──────────────────────────────────────────
const COMPANIES = [
  { id: JARVEX, name: 'JARVEX INGENIERIA', legal_name: 'JARVEX INGENIERIA E.I.R.L.', ruc: '20615646505',
    status: 'activa', tipo_entidad: 'propia', company_type: 'constructora', rubro: 'construccion' },
  { id: INCA, name: 'CONSORCIO EL INCA', ruc: '20615346081', status: 'activa', tipo_entidad: 'consorcio' },
  // Consorcio del grupo tratado como TERCERO para el consolidado (3-sep).
  { id: ESPER, name: 'CONSORCIO ESPERANZA', ruc: '20611547367', status: 'activa', tipo_entidad: 'tercero' },
  // Fila a medio bajar: sin ruc, sin tipo_entidad, sin status.
  { id: 'c-parcial', name: 'PROVEEDORA S.A.C.' },
];

const mov = (o) => ({
  currency: 'PEN', payment_status: 'paid', deleted_at: null, demo: false, date: '2026-07-06',
  version: 1, ...o,
});

const MOVS = [
  // Venta interna sin espejo cargado (la que se ve "del otro lado").
  mov({ id: 'm1', company_id: JARVEX, type: 'income', clase: 'venta', amount: 12920,
    document_type: 'factura', document_number: 'E001-1', is_intercompany: true,
    related_company_id: INCA, third_party_ruc: '20615346081', third_party_name: 'CONSORCIO EL INCA',
    obra_id: OBRA, destino_contable: 'obra',
    description: 'Factura E001-1 · CONSORCIO EL INCA',
    notas: JSON.stringify({ subtotal: 10949.15, igv: 1970.85, items_factura: [
      { descripcion: 'Amoladora', cantidad: 2, precio_real_unitario: 350, tipo_insumo: 'material' },
      { descripcion: 'Servicio de flete', cantidad: 1, tipo_insumo: 'servicio' },
    ] }) }),
  // Nota de crédito en NEGATIVO contra el consorcio-tercero.
  mov({ id: 'm2', company_id: JARVEX, type: 'income', clase: 'venta', amount: -690,
    document_type: 'nota_credito', document_number: 'E001-48', date: '2026-05-20',
    is_intercompany: true, related_company_id: ESPER, third_party_ruc: '20611547367',
    third_party_name: 'CONSORCIO ESPERANZA', description: 'Nota de Crédito E001-48' }),
  // Compra a un proveedor de la calle, anulada.
  mov({ id: 'm3', company_id: JARVEX, type: 'cost', clase: 'compra', amount: 4500,
    document_type: 'factura', document_number: 'F001-9', payment_status: 'cancelled',
    third_party_ruc: '20505543174', third_party_name: 'KOPLAST', obra_id: OBRA }),
  // En dólares, sin número de documento ni descripción, sin obra.
  mov({ id: 'm4', company_id: JARVEX, type: 'expense', amount: 320.5, currency: 'USD',
    document_number: null, description: null, destino_contable: 'gastos_generales' }),
  // Par interco completo (venta + compra espejo con el vínculo del comprador).
  mov({ id: 'm5', company_id: JARVEX, type: 'income', clase: 'venta', amount: 5000,
    document_type: 'factura', document_number: 'E001-3', is_intercompany: true,
    related_company_id: INCA }),
  mov({ id: 'm6', company_id: INCA, type: 'cost', clase: 'compra', amount: 5000,
    document_type: 'factura', document_number: 'E001-3', is_intercompany: true,
    related_company_id: JARVEX, related_movement_id: 'm5', obra_id: OBRA,
    notas: JSON.stringify({ intercompany_auto: true, desglose_heredado_de: 'm5' }) }),
  // Libro de una entidad que el consolidado deja afuera.
  mov({ id: 'm7', company_id: ESPER, type: 'expense', amount: 1200, clase: 'compra',
    document_number: 'F002-1', third_party_name: 'GRIFO' }),
  // Fila a medio bajar: sin type, sin amount, sin fecha.
  mov({ id: 'm8', company_id: JARVEX, date: null, amount: null, type: null }),
];

const OBRAS = [
  { id: OBRA, nombre_obra: 'MEJORAMIENTO BAÑOS DEL INCA', estado: 'en_ejecucion',
    tipo_trabajo: 'obra_ejecucion', ejecutora_company_id: INCA, fecha_inicio: '2026-01-10',
    presupuesto_total: 2500000 },
  { id: 'o-2', nombre_obra: 'SUPERVISION NAMORA', estado: 'planificacion' },
];

const DATOS = {
  useCompanies: COMPANIES,
  useAccountingMovements: MOVS,
  useObras: OBRAS,
  useConsorcios: [{ id: 'k1', company_id: INCA, obra_id: OBRA, nombre: 'CONSORCIO EL INCA' }],
  useConsorcioSocios: [{ id: 's1', consorcio_id: 'k1', company_id: JARVEX, porcentaje: 60 }],
  useTrabajos: [{ id: 't1', nombre: 'Suministro de tuberías', tipo: 'bien', estado: 'en_curso',
    ejecutor_company_id: JARVEX }],
  usePersonal: [
    { id: 'p1', nombre_completo: 'JUAN PEREZ', dni: '12345678', obra_id: OBRA, estado: 'activo',
      categoria: 'operario', forma_pago: 'planilla', jornal_diario: 80 },
    { id: 'p2', nombre_completo: 'MARIA LOPEZ', obra_id: OBRA, estado: 'activo' },
  ],
  usePlanillas: [{ id: 'pl1', obra_id: OBRA, company_id: JARVEX, periodo_anio: 2026,
    periodo_mes: 7, estado: 'cerrada', total_neto: 15000 }],
  useCuentasBancarias: [{ id: 'cb1', company_id: JARVEX, banco: 'BCP', numero_cuenta: '191-000',
    moneda: 'PEN', saldo_actual: 42000, estado: 'activa' }],
  useMateriales: [{ id: 'mat1', nombre: 'Cemento', unidad: 'bls', obra_id: OBRA, stock_actual: 120 }],
  useMovimientosMateriales: [{ id: 'mm1', material_id: 'mat1', obra_id: OBRA, tipo: 'ingreso',
    cantidad: 100, fecha: '2026-07-01' }],
  useActivosPesados: [{ id: 'a1', company_id: JARVEX, nombre: 'Retroexcavadora', estado: 'operativo' }],
  useEvidencias: [{ id: 'ev1', modulo_relacionado: 'accounting_movements',
    registro_relacionado_id: 'm1', url_archivo: 'https://x/y.pdf', sync_status: 'uploaded' }],
};

// ── Un browser de mentira (mismo que el test hermano, con datos) ────
function montarBrowserFalso(store) {
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

  g.__hooks = new Proxy({}, {
    get: (_t, nombre) => () => ({
      data: DATOS[nombre] || [], loading: false, error: null, refetch: () => {},
    }),
  });
  g.__useAuth = () => ({ profile: { rol: 'admin', id: 'u1' }, loading: false });
  g.__canSeeSidebarItem = () => true;
  g.__hasPerm = () => true;
  g.__navTo = () => {};
  g.__getObraActivaId = () => null;
  g.__setObraActivaId = () => {};
  g.__fecha = { hoyLocal: () => '2026-09-04', horaLocal: () => '12:00', getTZ: () => 'America/Lima' };
  g.__newId = () => 'id-falso';
  g.JxIcon = () => null;
  g.SinObraEmpty = () => null;
}

const CHUNKS = [
  '../../components/jx-activos.jsx', '../../components/jx-admin.jsx',
  '../../components/jx-almacen.jsx', '../../components/jx-analisis-insumos.jsx',
  '../../components/jx-asientos.jsx', '../../components/jx-caja-chica.jsx',
  '../../components/jx-captura-magica.jsx', '../../components/jx-compras-categoria.jsx',
  '../../components/jx-compras-pendientes.jsx', '../../components/jx-compras.jsx',
  '../../components/jx-comprobantes.jsx', '../../components/jx-conciliacion.jsx',
  '../../components/jx-contabilidad.jsx', '../../components/jx-dashboard.jsx',
  '../../components/jx-guias.jsx', '../../components/jx-inicio.jsx',
  '../../components/jx-libros-electronicos.jsx', '../../components/jx-obra.jsx',
  '../../components/jx-ordenes-intercompany.jsx',
  '../../components/jx-ordenes.jsx', '../../components/jx-pagos.jsx',
  '../../components/jx-plan-cuentas.jsx', '../../components/jx-planillas.jsx',
  '../../components/jx-profesionales.jsx', '../../components/jx-reportes-contable.jsx',
  '../../components/jx-reportes-financieros.jsx', '../../components/jx-tesoreria.jsx',
  '../../components/jx-trabajos.jsx', '../../components/jx-valorizaciones.jsx',
];

const store = {};
let pantallas = [];

beforeAll(async () => {
  montarBrowserFalso(store);
  const antes = new Set(Object.keys(globalThis));
  for (const c of CHUNKS) { await import(c); }
  pantallas = Object.keys(globalThis).filter(k => !antes.has(k) && /Page$/.test(k)).sort();
});

function montarTodas() {
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
  return fallos;
}

describe('cada pantalla abre CON DATOS', () => {
  it('encontró las pantallas de los chunks contables', () => {
    expect(pantallas.length).toBeGreaterThan(30);
  });

  it('mirando el grupo entero, ninguna revienta', () => {
    delete store.empresa_activa_id;
    expect(montarTodas(), 'pantalla que revienta con datos').toEqual([]);
  });

  it('parado DENTRO de una empresa, ninguna revienta', () => {
    // Es el contexto del reporte: entrar a Empresas → JARVEX → Contabilidad →
    // Movimientos. El selector queda clavado y las pantallas se acotan.
    store.empresa_activa_id = JARVEX;
    expect(montarTodas(), 'pantalla que revienta en contexto de empresa').toEqual([]);
    delete store.empresa_activa_id;
  });
});
