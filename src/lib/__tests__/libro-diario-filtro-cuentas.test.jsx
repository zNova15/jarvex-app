// El filtro por estado de la cuenta del Libro Diario.
//
// Lo pidió Gabriel al probar la tanda 2: los asientos cuya cuenta no se pudo
// deducir quedaban mezclados entre los buenos y había que ir a buscarlos badge
// por badge. Son 345 de 1.742 en producción — una lista por la que se puede
// pasar de a tandas, pero solo si se la puede aislar.
//
// Se testea la CLASIFICACIÓN (qué asiento entra en qué estado), que es donde
// vive la lógica; la pantalla solo la usa para filtrar.
import { describe, it, expect } from 'vitest';
import { generarAsiento, cumpleEstadoCuenta, contarEstadosDeCuenta, ESTADOS_CUENTA } from '../asientos.js';
import { crearResolvedorDeFamilia, cuentasDeComprobante } from '../cuenta-de-comprobante.js';

const familiaDe = crearResolvedorDeFamilia({});
const OPTS = { repartoDe: (m) => cuentasDeComprobante(m, { familiaDe }) };

const item = (descripcion, cantidad = 1, precio_unitario = 100) => ({ descripcion, cantidad, precio_unitario });
const compra = (items, extra = {}) => generarAsiento({
  id: 'm', clase: 'compra', type: 'cost', amount: 1180, payment_status: 'pending',
  category: 'Factura', description: 'Factura F001-1',
  notas: JSON.stringify({ items_factura: items }), ...extra,
}, OPTS);

describe('qué asiento cae en cada estado', () => {
  it('un comprobante sin ítems está POR DEFINIR', () => {
    const a = compra([], { notas: null });
    expect(cumpleEstadoCuenta(a, 'por_definir')).toBe(true);
    expect(cumpleEstadoCuenta(a, 'manual')).toBe(false);
  });

  it('ítems que nadie reconoce también', () => {
    const a = compra([item('XKCD ZZZQQ 9999')]);
    expect(cumpleEstadoCuenta(a, 'por_definir')).toBe(true);
  });

  it('un flete reconocido NO está por definir', () => {
    const a = compra([item('TRANSPORTE NACIONAL')]);
    expect(cumpleEstadoCuenta(a, 'por_definir')).toBe(false);
  });

  it('la cuenta puesta a mano es MANUAL y nunca «por definir»', () => {
    const a = compra([item('XKCD ZZZQQ 9999')], { cuenta_pcge: '659' });
    expect(cumpleEstadoCuenta(a, 'manual')).toBe(true);
    expect(cumpleEstadoCuenta(a, 'por_definir')).toBe(false);
  });

  it('un comprobante que va a dos cuentas es PARTIDA', () => {
    const a = compra([
      item('CEMENTO PORTLAND TIPO I', 10, 80),
      item('CARRETILLA BUGGY', 1, 200),
    ]);
    expect(cumpleEstadoCuenta(a, 'partida')).toBe(true);
  });

  it('la comida del personal queda en REVISAR: 625 o 631 según el caso', () => {
    // «Atención al personal» (625) si es el almuerzo de todos los días,
    // «gastos de viaje» (631) si fue una comisión de servicio. La familia no
    // distingue, así que se elige lo más probable y se avisa.
    const a = compra([item('ALMUERZO PERSONAL DE OBRA', 1, 1000)]);
    expect(a.cuentas.provisional).toBe(false);
    expect(cumpleEstadoCuenta(a, 'revisar')).toBe(true);
    expect(cumpleEstadoCuenta(a, 'por_definir')).toBe(false);
  });

  it('un alquiler de maquinaria NO necesita revisión: es claramente un servicio', () => {
    const a = compra([item('ALQUILER DE RETROEXCAVADORA', 1, 1000)]);
    expect(cumpleEstadoCuenta(a, 'revisar')).toBe(false);
    expect(cumpleEstadoCuenta(a, 'por_definir')).toBe(false);
  });

  it('«por definir» y «a mano» son excluyentes — nunca los dos a la vez', () => {
    const casos = [
      compra([item('TRANSPORTE NACIONAL')]),
      compra([item('XKCD ZZZQQ 9999')]),
      compra([item('XKCD ZZZQQ 9999')], { cuenta_pcge: '659' }),
      compra([], { notas: null }),
    ];
    for (const a of casos) {
      expect(cumpleEstadoCuenta(a, 'por_definir') && cumpleEstadoCuenta(a, 'manual')).toBe(false);
    }
  });

  it('«todas» no filtra nada', () => {
    const a = compra([item('TRANSPORTE NACIONAL')]);
    expect(cumpleEstadoCuenta(a, 'todas')).toBe(true);
    expect(cumpleEstadoCuenta(compra([]), 'todas')).toBe(true);
  });
});

describe('un asiento sin la marca de cuentas cuenta como «por definir»', () => {
  it('no se lo da por bueno solo porque sea viejo', () => {
    // Si algún día llega un asiento generado sin el reparto, lo honesto es
    // tratarlo como indeterminado: es exactamente lo que es.
    expect(cumpleEstadoCuenta({ partidas: [] }, 'por_definir')).toBe(true);
    expect(cumpleEstadoCuenta({ partidas: [] }, 'manual')).toBe(false);
  });
});

describe('los contadores del desplegable', () => {
  it('cuentan cada estado sobre el mismo lote', () => {
    const lote = [
      compra([item('TRANSPORTE NACIONAL')]),
      compra([item('XKCD ZZZQQ 9999')]),
      compra([item('XKCD ZZZQQ 9999')], { cuenta_pcge: '659' }),
      compra([item('CEMENTO PORTLAND TIPO I', 10, 80), item('CARRETILLA BUGGY', 1, 200)]),
    ];
    const c = contarEstadosDeCuenta(lote);
    expect(c.todas).toBe(4);
    expect(c.por_definir).toBe(1);
    expect(c.manual).toBe(1);
    expect(c.partida).toBe(1);
  });

  it('un lote vacío no rompe nada', () => {
    const c = contarEstadosDeCuenta([]);
    expect(c.todas).toBe(0);
    for (const e of ESTADOS_CUENTA) expect(c[e.v]).toBe(0);
  });

  it('cada estado del desplegable tiene su etiqueta', () => {
    for (const e of ESTADOS_CUENTA) expect(e.label.length).toBeGreaterThan(3);
  });
});
