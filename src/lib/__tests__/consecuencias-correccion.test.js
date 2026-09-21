// Tests de la ventana de consecuencias (tanda 3 del destino, 18-set-2026).
//
// El pedido de Gabriel: «cuando ellas lo corrijan, corrijan las decisiones
// anteriormente tomadas, emergiendo una ventana que mencione los cambios que
// ocasionaría en el sistema». Cada test dice, en una línea, qué hace la
// ventana con un caso concreto. Los catálogos son chicos y controlados a
// propósito: lo que se prueba es la cadena de decisiones, no el clasificador.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cuentasCompatibles, familiasDeCuenta, alcanceDeCorreccion, causasDeCuenta,
  seleccionInicial, correccionesElegidas, resolvedorCorregido, tipoPorDestino,
  correccionDeTipo, diffAsientos, avisosDeCuenta, alcanceDeCorrecciones,
  planDeHermanos, armarConsecuencias,
} from '../consecuencias-correccion.js';
import { crearResolvedorDeFamilia, cuentasDeComprobante } from '../cuenta-de-comprobante.js';
import { resolverDestino, opcionesDestino, seTraslada } from '../destino-asiento.js';
import { claveMapeo } from '../mapeo-insumos.js';

const item = (descripcion, cantidad = 1, precio_unitario = 100) => ({ descripcion, cantidad, precio_unitario });
const mov = (items, extra = {}) => ({
  id: 'm1', clase: 'compra', type: 'cost', destino_contable: 'obra', obra_id: 'o1',
  amount: 118, payment_status: 'pending', company_id: 'emp1', currency: 'PEN',
  date: '2026-08-20', document_number: 'F001-100', description: 'Compra',
  notas: JSON.stringify({ items_factura: items }),
  ...extra,
});

// Un catálogo con un error a propósito: la amoladora quedó como acero liso
// (02 → 602) cuando es una herramienta (37 → 656).
const CATALOGO = [
  { id: 'c-amol', nombre: 'AMOLADORA ANGULAR 4 1/2', familia: '02', company_id: null },
  { id: 'c-cem', nombre: 'CEMENTO PORTLAND TIPO I', familia: '21', company_id: 'emp1' },
  { id: 'c-acero', nombre: 'ACERO CORRUGADO 1/2', familia: '03', company_id: null },
  { id: 'c-mant', nombre: 'SERVICIO TECNICO GENERAL', familia: 'S13', company_id: 'emp1' },
];
const resolver = (extra = {}) => crearResolvedorDeFamilia({ catalogo: CATALOGO, ...extra });

// ═══════════════════════════════════════════════════════════════════
describe('las piezas', () => {
  it('602 y 6021 son compatibles (una afina a la otra); 602 y 603 no', () => {
    expect(cuentasCompatibles('602', '6021')).toBe(true);
    expect(cuentasCompatibles('63', '631')).toBe(true);
    expect(cuentasCompatibles('602', '603')).toBe(false);
    expect(cuentasCompatibles('', '603')).toBe(false);
  });

  it('el puente al revés: a la 656 llegan las herramientas, el EPP y los equipos no activados', () => {
    const cods = familiasDeCuenta('656').map(f => f.codigo);
    expect(cods).toEqual(expect.arrayContaining(['37', '83', '48', 'administrativos']));
    expect(cods).not.toContain('21');
  });

  it('a la 634 llega una sola familia: mantenimiento', () => {
    expect(familiasDeCuenta('634').map(f => f.codigo)).toEqual(['S08']);
  });

  it('en una venta el puente al revés usa las cuentas de venta', () => {
    const cods = familiasDeCuenta('704', { esVenta: true }).map(f => f.codigo);
    expect(cods).toContain('S03');
    expect(cods).not.toContain('21');
  });

  it('el resolvedor dice de qué fila del catálogo salió la familia', () => {
    const r = resolver()('AMOLADORA ANGULAR 4 1/2');
    expect(r.via).toBe('nombre');
    expect(r.catalogoId).toBe('c-amol');
    expect(r.catalogoGlobal).toBe(true);
    expect(resolver()('CEMENTO PORTLAND TIPO I').catalogoGlobal).toBe(false);
  });

  it('el reparto trae el detalle por ítem, con la cuenta de cada uno', () => {
    const r = cuentasDeComprobante(mov([item('AMOLADORA ANGULAR 4 1/2')]), { familiaDe: resolver() });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ familia: '02', cuenta: '602', via: 'nombre', catalogoId: 'c-amol' });
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('B · dónde se corrige la causa', () => {
  it('si la descripción ES el insumo, se corrige el insumo', () => {
    expect(alcanceDeCorreccion({ via: 'nombre', catalogoId: 'c1', norm: 'x' })).toBe('insumo');
  });

  it('si la decisión apunta a un insumo del MISMO nombre, también', () => {
    expect(alcanceDeCorreccion({ via: 'alias', catalogoId: 'c1', catalogoNorm: 'x', norm: 'x' })).toBe('insumo');
  });

  it('si apunta a OTRO insumo, se corrige solo la descripción: no se rompe el acero para arreglar la amoladora', () => {
    expect(alcanceDeCorreccion({ via: 'alias', catalogoId: 'c-acero', catalogoNorm: 'acero', norm: 'amoladora bosch' }))
      .toBe('descripcion');
  });

  it('lo que dedujo el clasificador se corrige dando de alta la descripción', () => {
    expect(alcanceDeCorreccion({ via: 'clasificador', catalogoId: null })).toBe('descripcion');
  });
});

describe('B · las causas de la cuenta', () => {
  it('la amoladora salió en la 602 porque el insumo está como acero: se ofrece corregirlo', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')]);
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const { causas, sinCausa } = causasDeCuenta(m, { reparto, cuentaNueva: '656' });
    expect(sinCausa).toBe(null);
    expect(causas).toHaveLength(1);
    expect(causas[0]).toMatchObject({ familia: '02', cuenta: '602', alcance: 'insumo', corregible: true });
    expect(causas[0].familiasPosibles.map(f => f.codigo)).toContain('37');
  });

  it('con varias familias posibles NO se pre-elige ninguna: elegir por ella sería inventar', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')]);
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const c = causasDeCuenta(m, { reparto, cuentaNueva: '656' });
    expect(c.causas[0].sugerida).toBe(null);
    expect(seleccionInicial(c).correcciones[c.causas[0].norm]).toBe('');
  });

  it('con UNA sola familia posible, se pre-marca', () => {
    const m = mov([item('SERVICIO TECNICO GENERAL')]);
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const c = causasDeCuenta(m, { reparto, cuentaNueva: '634' });
    expect(c.causas[0].sugerida).toBe('S08');
    expect(seleccionInicial(c).correcciones[c.causas[0].norm]).toBe('S08');
  });

  it('en un comprobante REPARTIDO no se pre-marca nada, ni con una sola posible', () => {
    // Una factura de ferretería: reclasificar el cemento porque la factura
    // traía otra cosa sería el peor efecto posible de la ventana.
    const m = mov([item('CEMENTO PORTLAND TIPO I', 1, 500), item('SERVICIO TECNICO GENERAL', 1, 100)]);
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const c = causasDeCuenta(m, { reparto, cuentaNueva: '634' });
    expect(c.partido).toBe(true);
    expect(Object.values(seleccionInicial(c).correcciones).every(v => v === '')).toBe(true);
  });

  it('solo aparecen los ítems que la cuenta nueva contradice', () => {
    const m = mov([item('CEMENTO PORTLAND TIPO I', 1, 500), item('AMOLADORA ANGULAR 4 1/2', 1, 100)]);
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const c = causasDeCuenta(m, { reparto, cuentaNueva: '602' });
    // Los dos van a la 602 hoy (la amoladora, mal): ninguno contradice.
    expect(c.causas).toHaveLength(0);
  });

  it('a una cuenta sin familia (un activo, 33) no se puede llegar corrigiendo la clasificación, y se dice', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')]);
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const c = causasDeCuenta(m, { reparto, cuentaNueva: '3331' });
    expect(c.causas[0].corregible).toBe(false);
    expect(c.sinCausa).toMatch(/Ninguna clasificación/);
    expect(c.sinCausa).toMatch(/volver a salir/);
  });

  it('sin ítems no hay causa que corregir, y la cuenta queda a mano', () => {
    const m = { ...mov([]), notas: null };
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const c = causasDeCuenta(m, { reparto, cuentaNueva: '656' });
    expect(c.causas).toEqual([]);
    expect(c.sinCausa).toMatch(/no trae el detalle/);
  });

  it('una familia que no está entre las posibles no se escribe', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')]);
    const reparto = cuentasDeComprobante(m, { familiaDe: resolver() });
    const { causas } = causasDeCuenta(m, { reparto, cuentaNueva: '656' });
    const norm = causas[0].norm;
    expect(correccionesElegidas(causas, { correcciones: { [norm]: '21' } })).toEqual([]);
    expect(correccionesElegidas(causas, { correcciones: { [norm]: '37' } })[0]).toMatchObject({
      familia: '37', familiaAntes: '02', alcance: 'insumo', catalogoId: 'c-amol',
    });
  });
});

describe('B · la simulación', () => {
  it('corregir el insumo mueve a TODAS las descripciones que apuntan a él', () => {
    const base = crearResolvedorDeFamilia({
      catalogo: CATALOGO,
      alias: [{ norm: claveMapeo('AMOLADORA BOSCH GWS'), catalogo_insumo_id: 'c-amol', company_id: 'emp1', fuente: 'manual' }],
    });
    const corr = resolvedorCorregido(base, [{ norm: claveMapeo('AMOLADORA ANGULAR 4 1/2'), familia: '37', alcance: 'insumo', catalogoId: 'c-amol' }]);
    expect(corr('AMOLADORA ANGULAR 4 1/2').familia).toBe('37');
    expect(corr('AMOLADORA BOSCH GWS').familia).toBe('37');
    expect(corr('CEMENTO PORTLAND TIPO I').familia).toBe('21');
  });

  it('corregir una descripción suelta NO mueve al insumo al que apuntaba', () => {
    const base = crearResolvedorDeFamilia({
      catalogo: CATALOGO,
      alias: [{ norm: claveMapeo('AMOLADORA BOSCH'), catalogo_insumo_id: 'c-acero', company_id: 'emp1', fuente: 'manual' }],
    });
    expect(base('AMOLADORA BOSCH').familia).toBe('03');
    const corr = resolvedorCorregido(base, [{ norm: claveMapeo('AMOLADORA BOSCH'), familia: '37', alcance: 'descripcion' }]);
    expect(corr('AMOLADORA BOSCH').familia).toBe('37');
    expect(corr('ACERO CORRUGADO 1/2').familia).toBe('03');
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('B · el tipo que lee el Estado de Resultados', () => {
  it('el destino dice costo o gasto: 90-93 costo, 94/95/97 gasto, existencias nada', () => {
    expect(tipoPorDestino('92')).toBe('cost');
    expect(tipoPorDestino('91')).toBe('cost');
    expect(tipoPorDestino('94')).toBe('expense');
    expect(tipoPorDestino('97')).toBe('expense');
    expect(tipoPorDestino('24')).toBe(null);
    expect(tipoPorDestino(null)).toBe(null);
  });

  it('una compra de obra con destino 94 pasa a GASTO, sin desvincular la obra', () => {
    const t = correccionDeTipo(mov([]), '94');
    expect(t).toMatchObject({ actual: 'cost', nuevo: 'expense', escribir: 'expense' });
  });

  it('un gasto general con destino 92 pasa a COSTO', () => {
    const t = correccionDeTipo(mov([], { type: 'expense', destino_contable: 'gastos_generales', obra_id: null }), '92');
    expect(t).toMatchObject({ actual: 'expense', nuevo: 'cost', escribir: 'cost' });
  });

  it('si el tipo nuevo es el que diría la vinculación sola, no se fuerza: se borra el ajuste', () => {
    const t = correccionDeTipo(mov([], { type: 'expense', clasificacion_manual: 'expense' }), '92');
    expect(t).toMatchObject({ nuevo: 'cost', escribir: null });
  });

  it('una operación entre empresas NO cambia de tipo: el Consolidado la necesita como costo', () => {
    const t = correccionDeTipo(mov([], { is_intercompany: true }), '94');
    expect(t.bloqueado).toBe(true);
    expect(t.nuevo).toBe('cost');
  });

  it('sin contradicción no hay nada que decir', () => {
    expect(correccionDeTipo(mov([]), '92')).toBe(null);
    expect(correccionDeTipo(mov([]), '24')).toBe(null);
    expect(correccionDeTipo(mov([], { clase: 'venta', type: 'income' }), '94')).toBe(null);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('A · qué cambia', () => {
  it('el diff dice qué cuenta sale y cuál entra, no cuatro filas con la glosa repetida', () => {
    const antes = { partidas: [{ cuenta: '602', debe: 100, haber: 0 }, { cuenta: '42', debe: 0, haber: 100 }] };
    const despues = { partidas: [{ cuenta: '656', debe: 100, haber: 0 }, { cuenta: '42', debe: 0, haber: 100 }] };
    const d = diffAsientos(antes, despues);
    expect(d.map(x => x.cuenta)).toEqual(['602', '656']);
    expect(d[0]).toMatchObject({ antes: 100, despues: 0 });
    expect(d[1]).toMatchObject({ antes: 0, despues: 100 });
  });

  it('pasar de gasto a ACTIVO avisa que deja de bajar la renta de golpe', () => {
    const av = avisosDeCuenta('602', '3331');
    expect(av[0].texto).toMatch(/ACTIVO/);
    expect(av[0].texto).toMatch(/depreciación/);
    expect(av.some(a => /destino desaparece/.test(a.texto))).toBe(true);
    expect(av.some(a => /Estado de Resultados/.test(a.texto))).toBe(true);
  });

  it('pasar a un pago por adelantado (18) también se avisa', () => {
    expect(avisosDeCuenta('656', '1821')[0].texto).toMatch(/adelantado/);
  });

  it('entre dos cuentas de gasto no hay nada que avisar: 602 a 603 no le cambia la renta a nadie', () => {
    expect(avisosDeCuenta('602', '603')).toEqual([]);
  });

  it('una cuenta que no es del elemento 6 no lleva destino', () => {
    expect(seTraslada('3331')).toBe(false);
    expect(seTraslada('6032')).toBe(true);
    expect(seTraslada('')).toBe(true);
    expect(resolverDestino(mov([]), { cuentaOrigen: '3331' })).toBe(null);
    expect(opcionesDestino(mov([]), { cuentaOrigen: '3331' })).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('C · a qué más se aplica', () => {
  const norma = claveMapeo('AMOLADORA ANGULAR 4 1/2');
  const correccion = [{ norm: norma, familia: '37', alcance: 'insumo', catalogoId: 'c-amol' }];
  const movs = [
    mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'yo' }),
    mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'abierto', date: '2026-08-02' }),
    mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'cerrado', date: '2026-05-10', amount: 500 }),
    mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'otra', company_id: 'emp2', currency: 'USD', amount: 40 }),
    mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'amano', cuenta_pcge: '6021' }),
    mov([item('CEMENTO PORTLAND TIPO I')], { id: 'ajeno' }),
  ];

  it('cuenta los que se mueven solos, sin contarse a sí mismo', () => {
    const base = resolver();
    const a = alcanceDeCorrecciones({
      movs, familiaDe: base, familiaDeCorregida: resolvedorCorregido(base, correccion),
      correcciones: correccion, excluirId: 'yo', companyId: 'emp1',
    });
    expect(a.cambian.map(x => x.id).sort()).toEqual(['abierto', 'cerrado', 'otra']);
    expect(a.cambian.find(x => x.id === 'abierto')).toMatchObject({ antes: ['602'], despues: ['656'] });
  });

  it('dice cuántos son de meses ya presentados', () => {
    const base = resolver();
    const a = alcanceDeCorrecciones({
      movs, familiaDe: base, familiaDeCorregida: resolvedorCorregido(base, correccion),
      correcciones: correccion, excluirId: 'yo', companyId: 'emp1',
    });
    expect(a.cerrados).toBe(1);
    expect(a.otrasEmpresas).toBe(1);
  });

  it('los que tienen cuenta a mano no cambian, y se cuentan aparte', () => {
    const base = resolver();
    const a = alcanceDeCorrecciones({
      movs, familiaDe: base, familiaDeCorregida: resolvedorCorregido(base, correccion),
      correcciones: correccion, excluirId: 'yo', companyId: 'emp1',
    });
    expect(a.conManual).toBe(1);
  });

  it('nunca suma soles con dólares', () => {
    const base = resolver();
    const a = alcanceDeCorrecciones({
      movs, familiaDe: base, familiaDeCorregida: resolvedorCorregido(base, correccion),
      correcciones: correccion, excluirId: 'yo', companyId: 'emp1',
    });
    expect(a.porMoneda).toEqual({ PEN: 618, USD: 40 });
  });

  // 🔴 CAMBIÓ EL 22-set-2026. Antes los hermanos de meses ya presentados se
  // apartaban y NO se tocaban. Esa exclusión era justo lo que rompía el cierre
  // anual: corregía el insumo para adelante y dejaba las treinta facturas
  // viejas del mismo proveedor en la cuenta mala. Ahora se corrigen todos, y
  // `cerrados` pasó a ser un CONTEO para que la ventana pueda decirlo.
  it('los hermanos de meses presentados TAMBIÉN reciben la corrección, y se cuentan', () => {
    const p = planDeHermanos([
      mov([], { id: 'h1', date: '2026-08-05' }),
      mov([], { id: 'h2', date: '2026-06-05' }),
    ], { cambios: { cuenta: '656' } });
    expect(p.planes.map(x => x.id)).toEqual(['h1', 'h2']);
    // Siguen identificados, para poder avisar cuántos son.
    expect(p.cerrados.map(x => x.id)).toEqual(['h2']);
  });

  it('los hermanos que la reclasificación ya arregla no reciben la cuenta a mano', () => {
    const base = resolver();
    const p = planDeHermanos([mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'h1' })], {
      cambios: { cuenta: '656' }, familiaDeCorregida: resolvedorCorregido(base, correccion), hayCorrecciones: true,
    });
    expect(p.seArreglanSolos.map(x => x.id)).toEqual(['h1']);
    expect(p.planes).toEqual([]);
  });

  it('cada hermano con destino de gasto lleva su propio ajuste de tipo', () => {
    const p = planDeHermanos([mov([], { id: 'h1' })], { cambios: { destino: '94' } });
    expect(p.planes[0].cambios).toMatchObject({ destino: '94', tipo: 'expense' });
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('la ventana entera', () => {
  const base = resolver();

  it('cambiar solo la contrapartida no abre la ventana', () => {
    const r = armarConsecuencias({ mov: mov([item('AMOLADORA ANGULAR 4 1/2')]), cambios: { contrapartida: '4212' }, familiaDe: base });
    expect(r.hayQueDecir).toBe(false);
  });

  it('corregir la cuenta con la causa corregida: la cuenta ya no queda a mano, sale sola', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')]);
    const primera = armarConsecuencias({ mov: m, cambios: { cuenta: '656' }, familiaDe: base });
    expect(primera.hayQueDecir).toBe(true);
    const norm = primera.causas[0].norm;
    const r = armarConsecuencias({
      mov: m, cambios: { cuenta: '656' }, familiaDe: base,
      seleccion: { correcciones: { [norm]: '37' }, corregirTipo: true },
    });
    expect(r.salesola).toBe(true);
    expect(r.escribir.cuenta).toBe(null);
    expect(r.asientoDespues.partidas[0].cuenta).toBe('656');
    expect(r.diff.map(d => d.cuenta)).toEqual(expect.arrayContaining(['602', '656']));
  });

  it('corregir SOLO este comprobante deja la cuenta a mano', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')]);
    const r = armarConsecuencias({ mov: m, cambios: { cuenta: '656' }, familiaDe: base });
    expect(r.correcciones).toEqual([]);
    expect(r.escribir.cuenta).toBe('656');
  });

  it('el destino 94 en una compra de obra propone pasarla a gasto, y se puede no hacerlo', () => {
    const m = mov([item('CEMENTO PORTLAND TIPO I')]);
    const r = armarConsecuencias({ mov: m, cambios: { destino: '94' }, familiaDe: base });
    expect(r.hayQueDecir).toBe(true);
    expect(r.escribir.tipo).toBe('expense');
    expect(r.cambioDeTipo).toMatchObject({ de: 'cost', a: 'expense', importe: 118 });

    const sin = armarConsecuencias({
      mov: m, cambios: { destino: '94' }, familiaDe: base,
      seleccion: { correcciones: {}, corregirTipo: false },
    });
    expect('tipo' in sin.escribir).toBe(false);
    expect(sin.cambioDeTipo).toBe(null);
  });

  it('pasar una compra a ACTIVO borra el destino elegido y lo dice', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')], { cuenta_pcge_destino: '92' });
    const r = armarConsecuencias({ mov: m, cambios: { cuenta: '3331', destino: '92' }, familiaDe: base });
    expect(r.escribir.destino).toBe(null);
    expect(r.avisos.some(a => /ACTIVO/.test(a.texto))).toBe(true);
    expect(r.avisos.some(a => /se borra/.test(a.texto))).toBe(true);
    expect(r.asientoDespues.partidas.map(p => p.cuenta)).not.toContain('791');
  });

  it('mandar a una existencia avisa el costo atrapado', () => {
    const m = mov([item('CEMENTO PORTLAND TIPO I')]);
    const r = armarConsecuencias({ mov: m, cambios: { destino: '24' }, familiaDe: base });
    expect(r.hayQueDecir).toBe(true);
    expect(r.avisos.some(a => /más renta/.test(a.texto))).toBe(true);
  });

  // 🔴 CAMBIÓ EL 22-set-2026. Antes esto exigía una casilla «entiendo que
  // cambia N comprobantes de meses presentados» para poder guardar. Se apagó
  // junto con el candado del Libro Diario: el cierre anual reclasifica el
  // ejercicio entero y el 94 % de los comprobantes es de un mes presentado, o
  // sea que la casilla salía casi siempre y se marcaba sin leerla. El número
  // se sigue contando y diciendo; lo que se fue es la traba.
  it('si la corrección mueve comprobantes de meses presentados, se cuenta pero NO traba', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'yo' });
    const otro = mov([item('AMOLADORA ANGULAR 4 1/2')], { id: 'viejo', date: '2026-03-01' });
    const norm = claveMapeo('AMOLADORA ANGULAR 4 1/2');
    const r = armarConsecuencias({
      mov: m, cambios: { cuenta: '656' }, familiaDe: base, movs: [m, otro],
      seleccion: { correcciones: { [norm]: '37' } },
    });
    expect(r.alcance.cerrados).toBe(1);
    expect(r.cerradosQueSeMueven).toBe(1);
    // La traba está apagada, y este test es el que vigila que siga apagada:
    // si alguien la vuelve a prender sin querer, el cierre anual se rompe otra vez.
    expect(r.requiereAceptarCerrados).toBe(false);
  });

  it('un rol que no escribe el catálogo ve la causa pero no puede corregirla (espejo de la RLS)', () => {
    const m = mov([item('SERVICIO TECNICO GENERAL')]);
    const r = armarConsecuencias({ mov: m, cambios: { cuenta: '634' }, familiaDe: base, puedeReclasificar: false });
    expect(r.causas).toHaveLength(1);
    expect(r.causas[0].corregible).toBe(false);
    expect(r.reclasificarVedado).toBe(true);
    // Aunque la única familia posible se pre-marcaría, no se escribe nada.
    expect(r.correcciones).toEqual([]);
    expect(r.escribir.cuenta).toBe('634');
  });

  it('el asiento de después sigue cuadrando', () => {
    const m = mov([item('AMOLADORA ANGULAR 4 1/2')]);
    const norm = claveMapeo('AMOLADORA ANGULAR 4 1/2');
    const r = armarConsecuencias({
      mov: m, cambios: { cuenta: '656', destino: '94' }, familiaDe: base,
      seleccion: { correcciones: { [norm]: '37' } },
    });
    expect(r.asientoDespues.cuadra).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
describe('la escritura del tipo, junto con el destino', () => {
  let almacen;
  beforeEach(async () => {
    almacen = new Map([
      ['a', { id: 'a', version: 1, type: 'cost', destino_contable: 'obra', obra_id: 'o1', clase: 'compra' }],
      ['i', { id: 'i', version: 1, type: 'cost', destino_contable: 'obra', clase: 'compra', is_intercompany: true }],
    ]);
    vi.resetModules();
    vi.doMock('../../db/jarvex.db', () => ({
      SYNC_STATUS: { PENDING_CREATE: 'pending_create', PENDING_UPDATE: 'pending_update' },
      db: {
        accounting_movements: {
          get: async (id) => almacen.get(id) || null,
          update: async (id, campos) => {
            if (!almacen.has(id)) return 0;
            almacen.set(id, { ...almacen.get(id), ...campos });
            return 1;
          },
        },
      },
    }));
  });

  it('el destino 94 y el gasto se guardan en la MISMA escritura, y el type se deriva', async () => {
    const { fijarCuentaManual } = await import('../cuenta-manual-db.js');
    const r = await fijarCuentaManual('a', { destino: '94', tipo: 'expense' }, { userId: 'u1' });
    expect(r.ok).toBe(true);
    expect(almacen.get('a')).toMatchObject({
      cuenta_pcge_destino: '94', clasificacion_manual: 'expense', type: 'expense', version: 2,
    });
  });

  it('un intercompany sigue siendo costo aunque llegue un gasto: la regla dura manda', async () => {
    const { fijarCuentaManual } = await import('../cuenta-manual-db.js');
    await fijarCuentaManual('i', { tipo: 'expense' }, { userId: 'u1' });
    expect(almacen.get('i').type).toBe('cost');
  });

  it('un tipo inventado no se guarda', async () => {
    const { fijarCuentaManual } = await import('../cuenta-manual-db.js');
    const r = await fijarCuentaManual('a', { tipo: 'gasto' }, { userId: 'u1' });
    expect(r.ok).toBe(false);
    expect(almacen.get('a').version).toBe(1);
  });

  it('borrar el ajuste devuelve el tipo a la vinculación', async () => {
    const { fijarCuentaManual } = await import('../cuenta-manual-db.js');
    await fijarCuentaManual('a', { tipo: 'expense' }, { userId: 'u1' });
    await fijarCuentaManual('a', { tipo: null }, { userId: 'u1' });
    expect(almacen.get('a')).toMatchObject({ clasificacion_manual: null, type: 'cost' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// TANDA 4 — cuando la cuenta no la puso la clasificación.
//
// Sin esto la ventana ofrecería corregir una familia que no decide nada: la
// contadora la corregiría, la cuenta no se movería, y la ventana habría
// mentido en el único lugar donde promete no hacerlo.
// ═══════════════════════════════════════════════════════════════════
describe('tanda 4: la causa está en otra pantalla', () => {
  const repartoConNaturaleza = (naturaleza, cuenta) => ({
    lineas: [{ cuenta, cuentaMadre: cuenta.slice(0, 2), porcion: 1, familias: ['66'] }],
    items: [{
      descripcion: 'TUBERIA PVC SAP 1/2"', norm: claveMapeo('TUBERIA PVC SAP 1/2"'),
      importe: 300, familia: '66', origen: 'clasificador', score: 0.9,
      via: 'clasificador', cuenta, naturaleza,
    }],
  });

  it('marcada «para revender», no se ofrece reclasificar: se dice dónde se cambia', () => {
    const { causas } = causasDeCuenta(mov([item('TUBERIA PVC SAP 1/2"', 10, 30)]), {
      reparto: repartoConNaturaleza('politica_reventa', '601'),
      cuentaNueva: '602',
    });
    expect(causas).toHaveLength(1);
    expect(causas[0].corregible).toBe(false);
    expect(causas[0].sugerida).toBeNull();
    expect(causas[0].porNaturaleza).toMatch(/Inventario/);
  });

  it('cargada en el 7.1, manda al registro y no al catálogo', () => {
    const { causas } = causasDeCuenta(mov([item('AMOLADORA DEWALT', 1, 900)]), {
      reparto: repartoConNaturaleza('activo_cargado', '337'),
      cuentaNueva: '656',
    });
    expect(causas[0].corregible).toBe(false);
    expect(causas[0].porNaturaleza).toMatch(/7\.1/);
  });

  it('a la 601 no llega ninguna familia, y ya no se dice que no hay nada que hacer', () => {
    // Antes de la tanda 4 esto contestaba «ninguna clasificación de insumo
    // lleva a la 601», que es cierto y a la vez inútil: la causa existe.
    const { causas, sinCausa } = causasDeCuenta(mov([item('TUBERIA PVC SAP 1/2"', 10, 30)]), {
      reparto: repartoConNaturaleza('politica_transforma', '602'),
      cuentaNueva: '601',
    });
    expect(causas).toHaveLength(1);
    expect(sinCausa).toBeNull();
    expect(causas[0].porNaturaleza).toBeTruthy();
  });

  it('un aviso que NO cambió la cuenta no bloquea la corrección por familia', () => {
    // «Marcado uso de la empresa pero sin cargar en el 7.1» avisa y nada más:
    // la cuenta sigue siendo la de la familia, así que la familia sí es la causa.
    const { causas } = causasDeCuenta(mov([item('TUBERIA PVC SAP 1/2"', 10, 30)]), {
      reparto: repartoConNaturaleza('activo_sin_registrar', '602'),
      cuentaNueva: '656',
    });
    expect(causas[0].porNaturaleza).toBeNull();
    expect(causas[0].corregible).toBe(true);
  });

  it('sin naturaleza, todo sigue exactamente igual que en la tanda 3', () => {
    const { causas } = causasDeCuenta(mov([item('TUBERIA PVC SAP 1/2"', 10, 30)]), {
      reparto: repartoConNaturaleza(null, '602'),
      cuentaNueva: '656',
    });
    expect(causas[0].porNaturaleza).toBeNull();
    expect(causas[0].corregible).toBe(true);
  });
});
