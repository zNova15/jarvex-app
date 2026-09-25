// ═══════════════════════════════════════════════════════════════════
// ¿QUÉ DICE la pantalla del Simulador de Órdenes?
//
// `pantallas-montan.test.jsx` verifica que ABRA con datos vacíos. Lo que hay
// que proteger acá es otra cosa: que NO PROMETA de más. Esta pantalla muestra
// un plan de compras de millones de soles armado por un motor, y tiene tres
// frenos que son el producto, no un adorno:
//
//   1. la cobertura va contra el presupuesto COMPRABLE, no contra el total
//      (el 47% de Miraflores es planilla y nunca se cubre con órdenes);
//   2. la mano de obra dice, con todas las letras, que NO genera ningún
//      registro — ni un alta, ni un pedido a RRHH, ni una orden;
//   3. nada de lo que se acepte es todavía un documento.
//
// Si alguien los borra refactorizando, este test lo dice.
// ═══════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

const OBRA = 'o1';
const EL_INCA = 'c-inca';

const PARTIDAS = [
  { id: 'pa1', obra_id: OBRA, codigo: '01.01', descripcion: 'MUROS DE LADRILLO',
    fecha_inicio_planificada: '2026-10-05', fecha_fin_planificada: '2026-10-22' },
  { id: 'pa2', obra_id: OBRA, codigo: '01.02', descripcion: 'INSTALACIONES',
    fecha_inicio_planificada: '2026-11-03', fecha_fin_planificada: '2026-11-28' },
  // Sin fechas: su línea tiene que salir por «Sin planificar», no repartida a ojo.
  { id: 'pa3', obra_id: OBRA, codigo: '01.03', descripcion: 'VARIOS' },
];

const PRESUPUESTO = [
  { id: 'ip1', obra_id: OBRA, partida_id: 'pa1', insumo_codigo: '210020001',
    nombre_insumo: 'CEMENTO PORTLAND TIPO I', unidad: 'bol', tipo_insumo: 'material',
    cantidad_presupuestada: 400, precio_presupuestado: 30, costo_presupuestado: 12000 },
  { id: 'ip2', obra_id: OBRA, partida_id: 'pa2', insumo_codigo: '210030001',
    nombre_insumo: 'TUBERIA PVC 4"', unidad: 'm', tipo_insumo: 'material',
    cantidad_presupuestada: 500, precio_presupuestado: 12, costo_presupuestado: 6000 },
  // Un sobre: el expediente aparta plata sin decir qué se compra (§4.1).
  { id: 'ip3', obra_id: OBRA, partida_id: 'pa1', insumo_codigo: null,
    nombre_insumo: 'HERRAMIENTAS MANUALES', unidad: '%mo', tipo_insumo: 'equipo',
    cantidad_presupuestada: 1, precio_presupuestado: 5000, costo_presupuestado: 5000 },
  // Mano de obra: NO se compra. Nunca puede salir como una orden.
  { id: 'ip4', obra_id: OBRA, partida_id: 'pa1', insumo_codigo: '470010001',
    nombre_insumo: 'PEON', unidad: 'hh', tipo_insumo: 'mano_obra',
    cantidad_presupuestada: 8000, precio_presupuestado: 20, costo_presupuestado: 160000 },
  // Sin fecha de partida → «Sin planificar» con su motivo.
  { id: 'ip5', obra_id: OBRA, partida_id: 'pa3', insumo_codigo: '210040001',
    nombre_insumo: 'ARENA GRUESA', unidad: 'm3', tipo_insumo: 'material',
    cantidad_presupuestada: 50, precio_presupuestado: 40, costo_presupuestado: 2000 },
];

const PERSONAL = [
  { id: 'pe1', obra_id: OBRA, nombre_completo: 'JUAN PEREZ', cargo: 'PEON', estado: 'activo' },
  { id: 'pe2', obra_id: OBRA, nombre_completo: 'LUIS RAMOS', cargo: 'Subcontrato MOSHCO', estado: 'activo' },
];

function montarBrowserFalso() {
  const g = globalThis;
  g.window = g;
  g.innerWidth = 1400;
  g.addEventListener = () => {}; g.removeEventListener = () => {};
  g.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
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
  g.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  g.JxIcon = () => null;
  g.SinObraEmpty = () => null;
  g.__newId = () => 'id-falso';
  g.__getObraActivaId = () => OBRA;
  g.__fecha = { hoyLocal: () => '2026-10-01', getTZ: () => 'America/Lima' };
  g.__hooks = {
    useObras: () => ({ data: [{ id: OBRA, nombre_obra: 'PLAN MIRAFLORES', fecha_inicio: '2026-04-30', fecha_fin_estimada: '2026-12-30' }], loading: false }),
    useCompanies: () => ({ data: [{ id: EL_INCA, name: 'CONSORCIO EL INCA', rubro: 'ejecutora_obra' }], loading: false }),
    useConsorcios: () => ({ data: [{ id: 'k1', obra_id: OBRA, company_id: EL_INCA }], loading: false }),
    useInsumosPartida: () => ({ data: PRESUPUESTO, loading: false }),
    usePartidas: () => ({ data: PARTIDAS, loading: false }),
    usePersonal: () => ({ data: PERSONAL, loading: false }),
  };
}

const render = (props = {}) => renderToString(
  React.createElement(globalThis.SimuladorOrdenesPage, { showToast: () => {}, ...props })
);

beforeAll(async () => {
  montarBrowserFalso();
  await import('../../components/jx-simulador-ordenes.jsx');
});

describe('la pantalla del Simulador de Órdenes', () => {
  it('queda expuesta como window.SimuladorOrdenesPage', () => {
    expect(typeof globalThis.SimuladorOrdenesPage).toBe('function');
  });

  it('ofrece cómo se juntan las órdenes, con el monto mínimo en 0 (tanda 2.3)', () => {
    // Desde la 3.1 el monto mínimo y la frecuencia por rubro viven en ⚙.
    expect(render()).toContain('Cada cuánto se emite una orden');
    const html = render({ ajustesAbiertos: true });
    expect(html).toContain('Monto mínimo por orden');
    expect(html).toContain('0 = sin mínimo');
    expect(html).toContain('Frecuencia distinta por rubro');
  });

  it('nombra a la ejecutora: es la única que puede emitir la orden (§7)', () => {
    expect(render()).toContain('CONSORCIO EL INCA');
  });

  it('DICE que el escenario vive en el navegador hasta que se convierta (tanda 4)', () => {
    const html = render();
    expect(html).toContain('queda guardado en este navegador');
    // Desde la tanda 4 la pantalla SÍ escribe, pero en dos pasos separados: la
    // requisición se deshace, la orden quema un correlativo. Que eso esté
    // dicho es lo que evita que alguien crea que aceptar ya emitió.
    expect(html).toContain('Son dos pasos');
    expect(html).toContain('Convertir en requisiciones');
    expect(html).toContain('correlativo');
  });

  it('el botón de convertir arranca APAGADO: sin nada aceptado no hay qué escribir', () => {
    const html = render();
    const i = html.indexOf('Convertir en requisiciones');
    expect(i).toBeGreaterThan(0);
    // El `disabled` va en el mismo <button> que el rótulo.
    expect(html.slice(Math.max(0, i - 260), i)).toContain('disabled');
  });

  it('la cobertura se mide contra lo COMPRABLE, no contra el presupuesto total', () => {
    const html = render();
    expect(html).toContain('Presupuesto comprable');
    expect(html).toContain('es planilla');
    expect(html).toContain('la planilla no se cubre con órdenes');
  });

  it('arma órdenes por período y por RUBRO, y NUNCA una de mano de obra', () => {
    const html = render();
    // Desde el 22-set el título de una orden es «Rubro de proveedor —
    // período»: el cemento con la arena en una, la tubería en otra. Antes las
    // tres caían juntas en «Materiales — octubre 2026», que es la orden
    // mezclada que Gabriel no podía mandarle a nadie.
    expect(html).toContain('Concreto, agregados y aditivos — octubre 2026');
    expect(html).toContain('Tubería, válvulas y accesorios — noviembre 2026');
    expect(html).not.toContain('Materiales — octubre 2026');
    // La planilla no se compra: no puede aparecer como una orden propuesta.
    expect(html).not.toContain('Mano de obra — octubre 2026');
  });

  it('los proveedores van en UN datalist compartido, no en un select por fila', () => {
    // Producción tiene 549 proveedores + 28 empresas = 577 candidatos. Un
    // <select> por línea son 577 <option> por fila: con una orden abierta de
    // 167 insumos eso son ~96.000 nodos de DOM. El datalist se dibuja una
    // sola vez y se filtra escribiendo.
    const html = render();
    expect(html.match(/<datalist/g) || []).toHaveLength(1);
    expect(html).toContain('id="jx-sim-proveedores"');
  });

  it('no ofrece las opciones que piden un dato que nadie carga (ronda 3)', () => {
    // «Reprogramado a mano», «por cuadrilla» y «manual» terminaban en «Sin
    // planificar» (§15.1 punto 4). La 3.3 trae el cronograma por escenario.
    const html = render({ ajustesAbiertos: true });
    expect(html).not.toContain('Reprogramado a mano');
    expect(html).not.toContain('Por cuadrilla que entra');
    expect(html).not.toContain('Manual, partida por partida');
    expect(html).toContain('Todo al inicio del tramo');
  });

  it('los sobres van en la pestaña de su categoría, explican el techo y NO lo dan por firme', () => {
    // Desde la 3.1 no hay pestaña de sobres: «HERRAMIENTAS MANUALES» va con
    // las herramientas.
    expect(render()).not.toContain('HERRAMIENTAS MANUALES');
    const html = render({ vistaInicial: 'herramientas' });
    expect(html).toContain('HERRAMIENTAS MANUALES');
    expect(html).toContain('un monto reservado sin decir qué se compra');
    // Nadie informó cuánto del sobre ya se gastó: el aviso tiene que estar.
    expect(html).toContain('cuánto de este sobre ya se gastó');
  });

  it('la pestaña de mano de obra lleva la leyenda del §5, sin excusas', () => {
    const html = render({ vistaInicial: 'dotacion' });
    expect(html).toContain('NO genera ningún registro');
    expect(html).toContain('no le pide gente a RRHH');
    // La oferta sale del padrón, no de horas realmente trabajadas.
    expect(html).toContain('no de horas realmente trabajadas');
    // Los días laborables reales, no un divisor fijo.
    expect(html).toContain('208 h/mes');
  });

  it('el subcontrato NO se suma a los peones: sale con su motivo', () => {
    const html = render({ vistaInicial: 'dotacion' });
    expect(html).toContain('Lo que quedó afuera de la cuenta');
    expect(html).toContain('subcontrato');
  });

  it('lo que no se pudo ubicar en un período sale con el motivo, no repartido', () => {
    const html = render({ vistaInicial: 'pendientes' });
    expect(html).toContain('ARENA GRUESA');
    expect(html).toContain('no tiene fecha de inicio planificada');
    expect(html).toContain('no las reparte «parejo» para que el total cierre');
  });

  // ── Los tres pedidos de Gabriel del 22-set ────────────────────────
  it('hay un botón para pedir una recomendación nueva', () => {
    // «No hay botón para solicitar nueva recomendación, solo cambia cambiando
    // los filtros de arriba». El plan se recalculaba solo con una perilla o
    // con un sync, y no había forma de decir «volvé a mirar».
    const html = render();
    expect(html).toContain('Nueva recomendación');
  });

  it('la pestaña de mano de obra abre con la SIMULACIÓN, no con el padrón', () => {
    const html = render({ vistaInicial: 'dotacion' });
    // Lo que el plan dice por su cuenta: cuánto cuesta y cuánta gente pide.
    expect(html).toContain('Costo de la planilla en el plan');
    expect(html).toContain('Pico de gente que pide el plan');
    expect(html).toContain('Promedio por');
    // 8.000 HH × S/ 20 = S/ 160 k de planilla, que antes no se mostraba.
    expect(html).toContain('S/ 160 k');
    // El padrón sigue, pero DESPUÉS y dicho como lo que es.
    expect(html).toContain('Y recién acá, el contraste con la obra real');
    expect(html.indexOf('Costo de la planilla en el plan'))
      .toBeLessThan(html.indexOf('Personas en el padrón'));
  });

  it('ofrece qué resta el almacén, con «todo lo que entró» por defecto (tanda 2.5)', () => {
    const html = render({ ajustesAbiertos: true });
    expect(html).toContain('Del almacén, restar');
    expect(html).toMatch(/<option value="entradas" selected="">Todo lo que entró<\/option>/);
    expect(html).toContain('Solo lo que hay hoy');
    expect(html).toContain('Personalizado por insumo');
  });

  // La bandeja en sí («Nada se imputa solo», «Órdenes ya emitidas»…) se mudó
  // a su propia página en la tanda 3.2 — ver simulador-imputar-pantalla.test.jsx.
  // Lo que queda acá, del ESCENARIO, es elegir insumo por insumo qué se resta:
  // ese picker se había dejado de dibujar al mover la pestaña (regresión de
  // la propia tanda 3.1, atajada acá).
  describe('modo personalizado del almacén', () => {
    const ESC = [{ id: 'e1', nombre: 'Personalizado', obra_id: OBRA, params: { almacenModo: 'personalizado' }, actualizado: '2026-10-01' }];
    let antes;
    beforeAll(() => {
      antes = globalThis.localStorage.getItem;
      globalThis.localStorage.getItem = (k) => (k === `jx_sim_ordenes_v1:${OBRA}` ? JSON.stringify(ESC) : null);
    });
    afterAll(() => { globalThis.localStorage.getItem = antes; });

    it('sin nada imputado todavía, dice que hay que imputar primero', () => {
      const html = render({ ajustesAbiertos: true });
      expect(html).toContain('Personalizado por insumo');
      expect(html).toContain('todavía no hay ítems del almacén imputados');
      // El acceso a la página de imputar sigue estando, para cuando falte.
      expect(html).toContain('Imputar lo ya comprado');
    });
  });

  // Tanda 3.5: el modo real completo. La partida de los muros va al 50%.
  describe('lo ya ejecutado (tanda 3.5)', () => {
    const CON_AVANCE = PARTIDAS.map(p => (p.id === 'pa1' ? { ...p, porcentaje_avance: 50 } : p));
    const escenario = (params) => [{ id: 'e1', nombre: 'Real', obra_id: OBRA, params, actualizado: '2026-10-01' }];
    let antesLS, antesPartidas;
    const conEscenario = (params) => {
      globalThis.localStorage.getItem = (k) => (k === `jx_sim_ordenes_v1:${OBRA}` ? JSON.stringify(escenario(params)) : null);
    };
    beforeAll(() => {
      antesLS = globalThis.localStorage.getItem;
      antesPartidas = globalThis.__hooks.usePartidas;
      globalThis.__hooks.usePartidas = () => ({ data: CON_AVANCE, loading: false });
    });
    afterAll(() => {
      globalThis.localStorage.getItem = antesLS;
      globalThis.__hooks.usePartidas = antesPartidas;
    });

    // React separa los textos contiguos con <!-- -->: se sacan para leer la frase.
    const texto = (html) => html.replace(/<!-- -->/g, '');

    it('en ⚙ ofrece restarlo, apagado, y dice cuánto hay reportado', () => {
      conEscenario({ modo: 'real' });
      const html = texto(render({ ajustesAbiertos: true }));
      expect(html).toContain('Lo ya ejecutado (avance de las partidas)');
      expect(html).toMatch(/<option value="no" selected="">No restar<\/option>/);
      expect(html).toContain('1 partida(s) con avance');
      expect(html).toContain('Hoy el plan lo vuelve a pedir');
    });

    it('apagado, hay un aviso que lo dice (el avance sin usar no es silencioso)', () => {
      conEscenario({ modo: 'real' });
      expect(texto(render())).toContain('Avisos (1)');
    });

    it('prendido, lo ejecutado se muestra aparte y el sobre lo toma como gastado', () => {
      conEscenario({ modo: 'real', restarAvance: true });
      const html = render();
      expect(html).toContain('saca lo ya ejecutado');
      expect(html).toContain('Ya ejecutado (avance)');
      const herr = render({ vistaInicial: 'herramientas' });
      expect(herr).toContain('se estimó con el avance de sus partidas');
      // Ya no es «nadie informó lo gastado»: hay un piso, y se dice qué es.
      expect(herr).not.toContain('cuánto de este sobre ya se gastó');
    });

    it('en Simulación no existe: ni la perilla ni el aviso', () => {
      conEscenario({ modo: 'simulacion', restarAvance: true });
      const html = render({ ajustesAbiertos: true });
      expect(html).not.toContain('Lo ya ejecutado (avance de las partidas)');
      expect(html).not.toContain('Ya ejecutado (avance)');
      expect(html).not.toContain('Avisos (');
    });
  });

  it('los escenarios sugeridos son PUNTOS DE PARTIDA dentro de ⚙, corridos por el motor real (2.6 → 3.1)', () => {
    expect(render()).not.toContain('Pedir recomendación a la IA');
    const html = render({ ajustesAbiertos: true });
    expect(html).toContain('Puntos de partida');
    expect(html).toContain('Pedir recomendación a la IA');
    expect(html).toContain('Caja ajustada');
    expect(html).toContain('Cero desabastecimiento');
    expect(html).toContain('Pocas órdenes');
    // Ninguna cantidad ni precio nuevo: solo las perillas que ya existen.
    expect(html).toContain('El colchón por insumo no lo toca ningún enfoque');
    expect(html).toContain('Usar este enfoque');
  });

  // ── Ronda 3, tanda 3.1: la pantalla contesta UNA pregunta a la vez ──
  it('el primer selector es el modo: Simulación o Según lo real', () => {
    const html = render();
    expect(html).toContain('🧪 Simulación');
    expect(html).toContain('📍 Según lo real');
    expect(html.indexOf('📍 Según lo real')).toBeLessThan(html.indexOf('De dónde salen las fechas'));
    // El anclaje viejo no aparece más.
    expect(html).not.toContain('Desde cuándo se planifica');
    expect(html).not.toContain('Solo los períodos que faltan');
  });

  it('las perillas finas están detrás de ⚙, cerradas por defecto', () => {
    const html = render();
    expect(html).toContain('⚙ Ajustes finos');
    for (const t of ['Pedir con cuántos días de anticipación', 'Monto mínimo por orden', 'Del almacén, restar', 'Cómo se reparte un tramo largo']) {
      expect(html).not.toContain(t);
    }
  });

  it('los resultados salen en una pestaña por categoría, y ya no hay «Imputar» ni «Escenarios sugeridos» como pestañas', () => {
    const html = render();
    expect(html).toMatch(/🧱 Materiales \(\d+\)/);
    expect(html).toMatch(/🦺 Herramientas y EPPs \(\d+\)/);
    expect(html).toContain('📄 Ya pedido');
    expect(html).not.toContain('Órdenes propuestas (');
    expect(html).not.toContain('Sobres sin detalle (');
    expect(html).not.toContain('💡 Escenarios sugeridos');
    expect(html).not.toMatch(/<button[^>]*>🧾 Imputar lo ya comprado/);
    // La pestaña de materiales trae las órdenes de materiales y no el sobre.
    expect(html).toContain('Concreto, agregados y aditivos — octubre 2026');
  });

  // «vistaInicial: 'imputar'» ya no existe como vista: cualquier resto de esa
  // navegación vieja (localStorage, un link guardado) cae en la primera
  // categoría en vez de romper.
  it('un vistaInicial "imputar" ya retirado no rompe: cae en la primera categoría', () => {
    const html = render({ vistaInicial: 'imputar' });
    expect(html).toContain('Concreto, agregados y aditivos — octubre 2026');
  });

  describe('en modo Simulación', () => {
    const ESC = [{ id: 'e1', nombre: 'Hipótesis', obra_id: OBRA, params: { modo: 'simulacion', arranque: 'hoy' }, actualizado: '2026-10-01' }];
    let antes;
    beforeAll(() => {
      antes = globalThis.localStorage.getItem;
      globalThis.localStorage.getItem = (k) => (k === `jx_sim_ordenes_v1:${OBRA}` ? JSON.stringify(ESC) : null);
    });
    afterAll(() => { globalThis.localStorage.getItem = antes; });

    it('ofrece cuándo arranca la obra y dice cuánto se corrió el cronograma', () => {
      const html = render().replace(/<!-- -->/g, '');
      expect(html).toContain('La obra arranca');
      expect(html).toContain('Como si empezara hoy');
      // Obra del 30-abr, hoy 1-oct: 154 días hacia adelante.
      expect(html).toContain('154 día(s) hacia adelante');
      expect(html).toContain('El plazo y el orden de las partidas no cambian');
    });

    it('no muestra lo que es del modo real: ni la perilla del almacén ni avisos de compras', () => {
      const html = render({ ajustesAbiertos: true });
      expect(html).not.toContain('Del almacén, restar');
      expect(html).not.toContain('Avisos (');
    });

    it('no deja convertir en requisiciones: el plan no restó lo ya comprado', () => {
      const html = render();
      expect(html).toContain('no se convierte en requisiciones');
    });
  });

  // ── Ronda 3, tanda 3.3: el cronograma «aleatorio por escenario» ──
  it('ofrece el cronograma aleatorio por escenario y el reparto «según el escenario»', () => {
    const html = render({ ajustesAbiertos: true });
    expect(html).toContain('🎲 Aleatorio por escenario');
    expect(html).toContain('Según el escenario (lo que avanza la obra cada mes)');
    // Sin elegir el aleatorio, no hay historia ni curva que mostrar.
    expect(html).not.toContain('La historia de la obra');
    expect(html).not.toContain('Plata que pide el plan cada mes');
  });

  const conEscenario = (params) => {
    const ESC = [{ id: 'e1', nombre: 'Historia', obra_id: OBRA, params, actualizado: '2026-10-01' }];
    let antes;
    beforeAll(() => {
      antes = globalThis.localStorage.getItem;
      globalThis.localStorage.getItem = (k) => (k === `jx_sim_ordenes_v1:${OBRA}` ? JSON.stringify(ESC) : null);
    });
    afterAll(() => { globalThis.localStorage.getItem = antes; });
  };

  describe('con una historia de la obra (tanda 3.3)', () => {
    conEscenario({ modo: 'simulacion', cronograma: 'escenario', historia: 'frenazo', semilla: 3 });

    it('dice qué historia tomó, la cuenta, y deja sortear otra', () => {
      const html = render().replace(/<!-- -->/g, '');
      expect(html).toContain('La historia de la obra');
      expect(html).toContain('Frenazo a mitad de obra');
      expect(html).toContain('sorteo n.º 3');
      expect(html).toContain('🎲 Otro');
      expect(html).toContain('del ritmo del Gantt');
      // El fin se respeta (§15.3) y la pantalla lo dice.
      expect(html).toContain('Termina el 30 dic 2026, en la fecha del plazo');
      expect(html).not.toContain('ESTIRA el fin');
    });

    it('muestra la curva de carga contra el Gantt, con leyenda y tabla', () => {
      const html = render();
      expect(html).toContain('Plata que pide el plan cada mes');
      expect(html).toContain('Gantt, sin la historia');
      expect(html).toContain('Con esta historia');
      expect(html).toContain('Ver la tabla mes por mes');
      expect(html).toContain('La historia mueve la plata, no la cambia');
    });

    it('con el reparto parejo, avisa que adentro de un tramo largo no se ve el ritmo', () => {
      expect(render()).toContain('Repartir según el escenario');
    });

    it('sin relato de la IA guardado, no inventa uno', () => {
      expect(render()).not.toContain('Cómo la cuenta la IA');
    });
  });

  describe('con la historia que estira el fin', () => {
    conEscenario({ modo: 'simulacion', cronograma: 'escenario', historia: 'atraso_todo', reparto: 'escenario' });

    it('lo dice con todas las letras: es la única que mueve la fecha de fin', () => {
      const html = render().replace(/<!-- -->/g, '');
      expect(html).toContain('Pagos atrasados todo el plazo');
      expect(html).toContain('ESTIRA el fin');
      expect(html).toContain('Es la única del catálogo que mueve la fecha de fin');
      // Ya reparte según el escenario: no hace falta sugerirlo.
      expect(html).not.toContain('Repartir según el escenario');
    });
  });

  describe('con la historia que eligió la IA (tanda 3.4)', () => {
    const VALORES = { inicio: 0.35, duracion: 0.25, ritmo: 0.5, cuotaCaras: 0.4 };
    const RELATO = { historia: 'frenazo', ajustes: VALORES, relato: 'La entidad paga tarde y la obra se frena.', porQue: 'La plata está al final.', model: 'modelo-x' };
    const ESC = [{
      id: 'e1', nombre: 'IA', obra_id: OBRA, actualizado: '2026-10-01',
      params: { modo: 'simulacion', cronograma: 'escenario', historia: 'frenazo', historiaAjustes: VALORES },
      relatoIA: RELATO,
    }];
    let antes;
    beforeAll(() => {
      antes = globalThis.localStorage.getItem;
      globalThis.localStorage.getItem = (k) => (k === `jx_sim_ordenes_v1:${OBRA}` ? JSON.stringify(ESC) : null);
    });
    afterAll(() => { globalThis.localStorage.getItem = antes; });

    it('muestra el relato de la IA, dicho como lo que es', () => {
      const html = render();
      expect(html).toContain('Cómo la cuenta la IA');
      expect(html).toContain('La entidad paga tarde y la obra se frena.');
      expect(html).toContain('las fechas, los ritmos y la plata de abajo los calculó el sistema');
      // El relato del sistema, con las fechas de verdad, sigue abajo.
      expect(html).toContain('en la fecha del plazo');
    });

    it('ofrece pedirle otra historia a la IA, con lo que preocupa como opcional', () => {
      const html = render();
      expect(html).toContain('Que la IA elija la historia');
      expect(html).toContain('¿Qué te preocupa de esta obra? (opcional)');
    });
  });

  it('sin obra activa no revienta: muestra el vacío', () => {
    const antes = globalThis.__getObraActivaId;
    const antesHooks = globalThis.__hooks.useObras;
    globalThis.__getObraActivaId = () => null;
    globalThis.__hooks = { ...globalThis.__hooks, useObras: () => ({ data: [], loading: false }) };
    try {
      expect(() => render()).not.toThrow();
    } finally {
      globalThis.__getObraActivaId = antes;
      globalThis.__hooks = { ...globalThis.__hooks, useObras: antesHooks };
    }
  });
});
