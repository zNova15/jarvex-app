import { describe, it, expect } from 'vitest';
import {
  tokensDe, perfilarProveedores, sugerirProveedores, porQueEsteProveedor,
  LARGO_TOKEN_MINIMO, TOKENS_EN_COMUN_MINIMO,
} from '../simulador-proveedor.js';

// ── LOS DATOS SON LOS REALES ──────────────────────────────────────
// Medidos contra producción el 22-set-2026:
//
//   · 1.814 líneas de factura con ítems, en 741 comprobantes, TODAS con
//     proveedor identificado. 344 proveedores distintos; 119 con ≥5 líneas.
//   · `proveedores` NO tiene columna `rubro` (la traen 28 de 577 candidatos).
//   · `insumo_precios_historial` tiene 0 filas; `insumo_mapeo`, 3.
//   · De los 427 insumos comprables de Miraflores, 12 (2,8%) coinciden
//     EXACTO con alguna descripción de factura. Con 2 palabras en común
//     sube a 174 de 419 (42%) — y ahí es donde se ve que el proveedor
//     acierta y el precio no.
//
// Los pares de abajo son textuales de la base.

const mov = (id, proveedorId, nombre, descripciones, fecha = '2026-06-01') => ({
  id, type: 'expense', clase: 'compra', date: fecha,
  proveedor_id: proveedorId, third_party_name: nombre,
  payment_status: 'pending', document_type: 'factura',
  notas: JSON.stringify({
    items_factura: descripciones.map(d => ({
      descripcion: typeof d === 'string' ? d : d.descripcion,
      cantidad: 1,
      precio_unitario: typeof d === 'string' ? 100 : d.precio,
      unidad: 'und',
      tipo_insumo: typeof d === 'string' ? 'material' : (d.tipo || 'material'),
    })),
  }),
});

// El ferretero de sanitarios de Miraflores: es quien vendió las válvulas,
// los tapones y las uniones universales.
const FERNANDEZ = mov('m1', 'pv-fernandez', 'FERNANDEZ CHAVEZ OLINDA GREGORIANA', [
  { descripcion: 'VALVULA ESFERICA DE 4" BRONCE', precio: 338.98 },
  { descripcion: 'VALVULA COMPUERTA DE 3" BRONCE', precio: 127.12 },
  { descripcion: 'TAPON 2" HEMBRA', precio: 5.93 },
  { descripcion: 'UNION UNIVERSAL DE 4" F°G°', precio: 105.93 },
]);
// Ropa de trabajo.
const SALINAS = mov('m2', 'pv-salinas', 'DISTRIBUIDORA E INVERSIONES SALINAS RM E.I.R.L.', [
  { descripcion: 'PANTALON Y CAMISACO DE DRILL OBRERO AZUL CON CINTA REFLECTIVA', precio: 40.25 },
]);
// El alquiler de camioneta cuyo importe —S/ 10.423,73— es el que NO puede
// terminar al lado de un balde de S/ 25.
const CAMIONETA = mov('m3', 'pv-transportes', 'TRANSPORTES DEL NORTE', [
  { descripcion: 'ALQUILER DE CAMIONETA INC/CHOFER Y COMBUSTIBLE PARA REALIZAR EL DOCUMENTO DE TRABAJO DE LA OBRA: MEJ. Y AMPL. DEL SERVICIO DE AGUA POTABLE', precio: 10423.73, tipo: 'servicio' },
]);

const MOVS = [FERNANDEZ, SALINAS, CAMIONETA];

const linea = (nombre, clave = nombre) => ({ nombre, clave, insumo_codigo: null });

describe('tokensDe', () => {
  it('parte, saca tildes y descarta las palabras cortas', () => {
    expect(tokensDe('VÁLVULA COMPUERTA DE 2"')).toEqual(['valvula', 'compuerta']);
  });

  it(`descarta lo de menos de ${LARGO_TOKEN_MINIMO} letras: «de», «con», los números sueltos`, () => {
    expect(tokensDe('TUBO DE 4" X 6m')).toEqual(['tubo']);
  });

  it('descarta las palabras que aparecen en todo y no dicen nada', () => {
    // Sin esta lista, «PARA» y «AGUA» emparejan un balde con un alquiler de
    // camioneta — que es literalmente uno de los pares que produjo la medición.
    expect(tokensDe('BALDE PARA AGUA CON TAPA')).not.toContain('para');
    expect(tokensDe('SERVICIO DE OBRA GENERAL')).toEqual([]);
  });

  it('no repite: dos veces la misma palabra no vale doble', () => {
    expect(tokensDe('TUBO TUBO TUBO PVC')).toEqual(['tubo']);
  });

  it('un texto vacío no rompe nada', () => {
    expect(tokensDe('')).toEqual([]);
    expect(tokensDe(null)).toEqual([]);
  });
});

describe('perfilarProveedores — el «rubro» sale de lo que facturó, no de una etiqueta', () => {
  it('arma un perfil por proveedor con sus líneas y sus facturas', () => {
    const p = perfilarProveedores(MOVS);
    expect(p.size).toBe(3);
    expect(p.get('pv-fernandez').lineas).toBe(4);
    expect(p.get('pv-fernandez').facturas).toBe(1);
  });

  it('declara de dónde sale el rubro, para que nadie lo confunda con companies.rubro', () => {
    const p = perfilarProveedores(MOVS);
    expect(p.get('pv-transportes').fuenteRubro).toBe('facturas');
    expect(p.get('pv-transportes').tipoPrincipal).toBe('servicio');
    expect(p.get('pv-fernandez').tipoPrincipal).toBe('material');
  });

  it('usa el nombre del catálogo cuando lo hay: el tercero puede venir escrito distinto', () => {
    const p = perfilarProveedores(MOVS, { nombrePorId: { 'pv-fernandez': 'FERNANDEZ CHAVEZ OLINDA G.' } });
    expect(p.get('pv-fernandez').nombre).toBe('FERNANDEZ CHAVEZ OLINDA G.');
  });

  it('una VENTA no dice nada de lo que un proveedor sabe vender', () => {
    const venta = { ...mov('m9', 'pv-x', 'CLIENTE', ['CEMENTO PORTLAND']), type: 'income', clase: 'venta' };
    expect(perfilarProveedores([venta]).size).toBe(0);
  });

  it('una compra anulada por nota de crédito tampoco', () => {
    const compra = mov('m10', 'pv-y', 'PROVEEDOR Y', [{ descripcion: 'CEMENTO PORTLAND TIPO I', precio: 100 }]);
    const nc = {
      id: 'm11', type: 'expense', clase: 'compra', date: '2026-06-02',
      document_type: 'nota_credito', proveedor_id: 'pv-y', third_party_name: 'PROVEEDOR Y',
      amount: 100, notas: JSON.stringify({ factura_afectada_id: 'm10' }),
    };
    const p = perfilarProveedores([compra, nc]);
    // Si la NC se pudo imputar, la compra no cuenta; si no, cuenta.
    // Lo que NUNCA puede pasar es que la NC misma sume líneas al perfil.
    expect(p.has('pv-y') ? p.get('pv-y').lineas : 0).toBeLessThanOrEqual(1);
  });

  it('sin movimientos no inventa candidatos', () => {
    expect(perfilarProveedores([]).size).toBe(0);
  });
});

describe('sugerirProveedores — acierta el QUIÉN', () => {
  const perfiles = perfilarProveedores(MOVS);

  it('la orden de sanitarios cae en el ferretero de sanitarios', () => {
    const r = sugerirProveedores([
      linea('VALVULA COMPUERTA DE BRONCE DE 2"'),
      linea('TAPON HEMBRA PVC SP DE 1" NTP 399.002'),
      linea('UNION UNIVERSAL DE FIERRO GALVANIZADO DE 4"'),
    ], perfiles);
    expect(r.candidatos[0].nombre).toContain('FERNANDEZ');
    expect(r.candidatos[0].lineasCubiertas).toBeGreaterThanOrEqual(2);
  });

  it('la orden de ropa de trabajo cae en el que vende ropa de trabajo', () => {
    const r = sugerirProveedores([linea('CHALECO DE TELA DRILL CON CINTA REFLECTIVA')], perfiles);
    expect(r.candidatos[0].nombre).toContain('SALINAS');
  });

  it('EL BALDE NO CAE EN LA CAMIONETA — el par que rompía el emparejamiento crudo', () => {
    // «BALDE HERMÉTICO PARA AGUA CON TAPA 10L» compartía PARA y AGUA con
    // «ALQUILER DE CAMIONETA … AGUA POTABLE …», de S/ 10.423,73.
    const r = sugerirProveedores([linea('BALDE HERMÉTICO PARA AGUA CON TAPA 10L')], perfiles);
    expect(r.candidatos.map(c => c.nombre)).not.toContain('TRANSPORTES DEL NORTE');
  });

  it('NUNCA devuelve un precio: el historial dice a quién, no a cuánto', () => {
    const r = sugerirProveedores([linea('VALVULA COMPUERTA DE BRONCE DE 2"')], perfiles);
    for (const c of r.candidatos) {
      expect(c.precioSugerido).toBe(null);
      expect(c.base).toBe('facturas_anteriores');
      expect(Object.keys(c)).not.toContain('precio');
      expect(Object.keys(c)).not.toContain('ultimoPrecio');
    }
  });

  it('trae la evidencia del par, no solo el nombre', () => {
    const r = sugerirProveedores([linea('VALVULA COMPUERTA DE BRONCE DE 2"')], perfiles);
    const e = r.candidatos[0].ejemplos[0];
    expect(e.pedido).toContain('VALVULA COMPUERTA');
    expect(String(e.vendio)).toContain('VALVULA');
  });

  it(`una sola palabra en común NO alcanza (con 1 matchea el 92%)`, () => {
    expect(TOKENS_EN_COMUN_MINIMO).toBe(2);
    // «VALVULA» sola la comparte media ferretería.
    const r = sugerirProveedores([linea('VALVULA MARIPOSA WAFER')], perfiles);
    expect(r.candidatos).toHaveLength(0);
  });

  it('cuenta líneas DISTINTAS, no facturas: el que vendió cemento 200 veces no es candidato a válvulas', () => {
    const repetido = [
      mov('m20', 'pv-cemento', 'CEMENTERA', [{ descripcion: 'CEMENTO PORTLAND TIPO I', precio: 28 }], '2026-01-01'),
      mov('m21', 'pv-cemento', 'CEMENTERA', [{ descripcion: 'CEMENTO PORTLAND TIPO I', precio: 28 }], '2026-02-01'),
      mov('m22', 'pv-cemento', 'CEMENTERA', [{ descripcion: 'CEMENTO PORTLAND TIPO I', precio: 28 }], '2026-03-01'),
      FERNANDEZ,
    ];
    const r = sugerirProveedores([
      linea('VALVULA COMPUERTA DE BRONCE DE 2"'),
      linea('TAPON 2" HEMBRA PVC'),
      linea('CEMENTO PORTLAND TIPO I (42.5 kg)'),
    ], perfilarProveedores(repetido));
    expect(r.candidatos[0].nombre).toContain('FERNANDEZ');
    expect(r.candidatos[0].lineasCubiertas).toBe(2);
    expect(r.candidatos[1].lineasCubiertas).toBe(1);
  });

  it('dice cuántas líneas de la orden tienen antecedente, sin redondear para arriba', () => {
    const r = sugerirProveedores([
      linea('VALVULA COMPUERTA DE BRONCE DE 2"'),
      linea('ALGO QUE NADIE VENDIO NUNCA'),
    ], perfiles);
    expect(r.alcance).toEqual({ lineas: 2, conCandidato: 1 });
  });

  it('sin perfiles no sugiere a nadie en vez de sugerir al primero de la lista', () => {
    const r = sugerirProveedores([linea('CEMENTO')], new Map());
    expect(r.candidatos).toEqual([]);
  });

  it('sin líneas tampoco', () => {
    expect(sugerirProveedores([], perfiles).candidatos).toEqual([]);
  });

  it('respeta el tope pedido', () => {
    const r = sugerirProveedores([linea('VALVULA COMPUERTA DE BRONCE DE 2"')], perfiles, { max: 1 });
    expect(r.candidatos.length).toBeLessThanOrEqual(1);
  });

  it('la explicación habla de líneas y de facturas, nunca de plata', () => {
    const r = sugerirProveedores([linea('VALVULA COMPUERTA DE BRONCE DE 2"')], perfiles);
    const txt = porQueEsteProveedor(r.candidatos[0]);
    expect(txt).toContain('líneas');
    expect(txt).not.toMatch(/S\/|precio/i);
  });
});
