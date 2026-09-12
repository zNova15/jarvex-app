import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { ReemplazoPropuestaSire } from '../../components/jx-reemplazo-sire.jsx';

const JARVEX = 'c-jarvex';
const COMPANY = {
  id: JARVEX,
  name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.',
  legal_name: 'JARVEX INGENIERIA, TECNOLOGIA Y PROYECTOS E.I.R.L.',
  ruc: '20615646505',
};

const MOV_COMPRA_1 = {
  id: 'm-1',
  company_id: JARVEX,
  type: 'cost',
  clase: 'compra',
  document_type: 'factura',
  document_number: 'F001-100',
  third_party_ruc: '20501234567',
  third_party_name: 'PROVEEDOR 1 SAC',
  amount: 118.00,
  date: '2026-07-05',
};

const MOV_COMPRA_2 = {
  id: 'm-2',
  company_id: JARVEX,
  type: 'cost',
  clase: 'compra',
  document_type: 'factura',
  document_number: 'F001-200',
  third_party_ruc: '20601234567',
  third_party_name: 'PROVEEDOR 2 SAC',
  amount: 590.00,
  date: '2026-07-12',
};

const CORTE_SUNAT_JULIO = {
  id: 'corte-julio-2026',
  company_id: JARVEX,
  periodo: '202607',
  libro: 'compras',
  archivo: 'propuesta-compras-julio.csv',
  created_at: '2026-07-31T20:00:00Z',
  filas: [
    {
      tipoCp: '01',
      serie: 'F001',
      numero: 100,
      contraparteRuc: '20501234567',
      total: 118.00,
    },
  ],
};

beforeAll(() => {
  globalThis.window = globalThis.window || {};
  globalThis.window.__hooks = {
    useSunatCortes: () => ({
      data: [CORTE_SUNAT_JULIO],
      loading: false,
    }),
  };
});

describe('Pantalla de Reemplazo Propuesta SIRE SUNAT (.ZIP)', () => {
  it('renderiza la cabecera oficial y el sub-selector de registros', () => {
    const html = renderToString(
      <ReemplazoPropuestaSire
        company={COMPANY}
        companies={[COMPANY]}
        movs={[MOV_COMPRA_1, MOV_COMPRA_2]}
        anio={2026}
        mes={7}
      />
    );

    expect(html).toContain('Reemplazo de Propuesta SIRE SUNAT (.ZIP)');
    expect(html).toContain('Oficial R.S. 112-2021');
    expect(html).toContain('Compras (RCE - 080400)');
    expect(html).toContain('Ventas (RVIE - 140400)');
  });

  it('cruza con el corte de SUNAT e identifica qué comprobantes ya están y cuáles faltan', () => {
    const html = renderToString(
      <ReemplazoPropuestaSire
        company={COMPANY}
        companies={[COMPANY]}
        movs={[MOV_COMPRA_1, MOV_COMPRA_2]}
        anio={2026}
        mes={7}
      />
    );

    // Debe mostrar badges y contadores
    expect(html).toContain('Ya en SUNAT');
    expect(html).toContain('Pendiente');
    expect(html).toContain('F001-100');
    expect(html).toContain('F001-200');
    expect(html).toContain('PROVEEDOR 1 SAC');
    expect(html).toContain('PROVEEDOR 2 SAC');
    expect(html).toContain('Seleccionar solo pendientes');
  });

  it('muestra el nombre reglamentario del archivo ZIP con 33 caracteres de base', () => {
    const html = renderToString(
      <ReemplazoPropuestaSire
        company={COMPANY}
        companies={[COMPANY]}
        movs={[MOV_COMPRA_1, MOV_COMPRA_2]}
        anio={2026}
        mes={7}
      />
    );

    // Nomenclatura oficial RCE para 20615646505 y julio 2026:
    // LE + 20615646505 + 202607 + 00 + 080400 + 021112.zip
    expect(html).toContain('LE2061564650520260700080400021112.zip');
    expect(html).toContain('Descargar Reemplazo Propuesta (.ZIP)');
  });
});

