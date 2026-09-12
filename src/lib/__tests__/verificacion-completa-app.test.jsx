import { describe, it, expect, beforeAll } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { requiereBancarizacion, convertirMoneda, UMBRAL_BANCARIZACION_PEN, UMBRAL_BANCARIZACION_USD } from '../tipo-cambio.js';
import { limpiarPrefijoServicio, sugerirSubfamilia } from '../catalogo-subfamilias.js';
import { resolverCategorias } from '../bandeja-categorizacion.js';

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
}

describe('Verificación dentro de la aplicación (E2E Component & Logic)', () => {
  beforeAll(() => {
    montarBrowserFalso();
  });

  it('Tanda 1 & 5: AnalisisInsumosPage permite acceso a rol contador y muestra guía y herramientas', async () => {
    window.__currentRol = 'contador';
    window.__useAuth = () => ({ profile: { rol: 'contador' }, user: { id: 'usr-1' } });
    window.__hooks = {
      useAccountingMovements: () => ({ data: [] }),
      useInsumoCorrelaciones: () => ({ data: [] }),
      useCompanies: () => ({ data: [{ id: 'emp-1', name: 'Constructora Alfa', tipo_entidad: 'propia' }] }),
    };

    window.__analisisInsumosIntent = { tab: 'correlaciones' };
    const mod = await import('../../components/jx-analisis-insumos.jsx');
    const AnalisisInsumosPage = mod.default || mod.AnalisisInsumosPage;
    expect(AnalisisInsumosPage).toBeDefined();

    const html = renderToString(React.createElement(AnalisisInsumosPage, { showToast: () => {} }));

    // 1. Acceso de contabilidad concedido (no sale 'Sin acceso')
    expect(html).not.toContain('Sin acceso');

    // 2. Tanda 5: La tarjeta guía de las 4 herramientas se renderiza
    expect(html).toContain('Guía de Insumos y Servicios en JARVEX');
    expect(html).toContain('Catálogo');
    expect(html).toContain('Categorizar');
    expect(html).toContain('Correlaciones');
    expect(html).toContain('Mapeo de Presupuesto');

    // 3. Tanda 1: Unión manual de insumos presente
    expect(html).toContain('Unir dos insumos manualmente');
  });

  it('Tanda 2: Regla de Bancarización D.L. 1529 opera correctamente para PEN y USD', () => {
    expect(UMBRAL_BANCARIZACION_PEN).toBe(2000);
    expect(UMBRAL_BANCARIZACION_USD).toBe(500);

    // En soles
    expect(requiereBancarizacion(2000, 'PEN')).toBe(true);
    expect(requiereBancarizacion(1999.99, 'PEN')).toBe(false);

    // En dólares
    expect(requiereBancarizacion(500, 'USD')).toBe(true);
    expect(requiereBancarizacion(499.99, 'USD')).toBe(false);

    // Conversión
    expect(convertirMoneda({ monto: 100, monedaOrigen: 'USD', monedaDestino: 'PEN', tipoCambio: 3.75 })).toBe(375);
  });

  it('Tanda 3 & 4: EmpresaDetalle renderiza inventario con filtros de flujo, columnas homogéneas y margen', async () => {
    window.__currentRol = 'admin';
    window.__useAuth = () => ({ profile: { rol: 'admin' }, user: { id: 'usr-1' } });
    window.__hooks = {
      useAccountingMovements: () => ({
        data: [
          {
            id: 'mov-1',
            company_id: 'emp-1',
            type: 'egreso',
            date: '2026-03-01',
            currency: 'PEN',
            notas: JSON.stringify({
              items_factura: [
                { descripcion: 'CEMENTO PORTLAND TIPO I', cantidad: 100, unidad: 'bolsa', precio_unitario: 25 },
                { descripcion: 'ANTICIPO POR COMPRA DE MATERIAL', cantidad: 1, unidad: 'und', precio_unitario: 5000 },
              ],
            }),
          },
          {
            id: 'mov-2',
            company_id: 'emp-1',
            type: 'ingreso',
            date: '2026-03-05',
            currency: 'PEN',
            notas: JSON.stringify({
              items_factura: [
                { descripcion: 'CEMENTO PORTLAND TIPO I', cantidad: 60, unidad: 'bolsa', precio_unitario: 35 },
              ],
            }),
          },
        ],
      }),
      useInsumoCorrelaciones: () => ({ data: [] }),
      usePersonal: () => ({ data: [] }),
      useCuentasBancarias: () => ({ data: [] }),
    };

    const mod = await import('../../components/jx-empresa-detalle.jsx');
    const EmpresaDetalle = mod.default || mod.EmpresaDetalle;
    expect(EmpresaDetalle).toBeDefined();

    const company = { id: 'emp-1', name: 'Constructora Alfa', ruc: '20123456789' };
    const html = renderToString(React.createElement(EmpresaDetalle, { company, seccionInicial: 'inventario' }));

    // Filtros de flujo
    expect(html).toContain('Flujo:');
    expect(html).toContain('Solo compras');
    expect(html).toContain('Solo ventas');
    expect(html).toContain('Compra y venta');

    // Columnas homogéneas
    expect(html).toContain('Insumo / Categoría');
    expect(html).toContain('Compras');
    expect(html).toContain('Ventas');
    expect(html).toContain('Saldo físico');
    expect(html).toContain('Margen econ.');

    // Insumo con compra y venta calcula margen
    expect(html).toContain('CEMENTO PORTLAND TIPO I');
    expect(html).toContain('Categorizar');

    // Anticipo detectado con badge
    expect(html).toContain('anticipo');
  });

  it('Tanda 5: Servicios, limpieza de prefijos y aprendizaje multi-empresa', () => {
    // 1. Limpieza de prefijos comerciales
    expect(limpiarPrefijoServicio('Por la compra del servicio de alquiler de camioneta 4x4')).toBe('alquiler de camioneta 4x4');
    expect(sugerirSubfamilia('POR LA COMPRA DEL SERVICIO DE ALQUILER DE CAMIONETA 4X4', 'servicios')?.subfamilia).toBe('servicio_alquiler');

    // 2. Aprendizaje global
    const filasAprendidas = [
      { norm: 'cemento_andino', fuente: 'manual', company_id: 'empresa_1', catalogo_insumo_id: 'cat_cemento' },
    ];
    // Empresa 2 hereda la categorización aprendida por Empresa 1
    const resEmpresa2 = resolverCategorias(filasAprendidas, { companyId: 'empresa_2' });
    expect(resEmpresa2.get('cemento_andino')?.catalogo_insumo_id).toBe('cat_cemento');
  });
});
