// En qué mes se declara un comprobante (23-set-2026). Pedido de Gabriel: «hay
// comprobantes emitidos en enero que se declaran en marzo; que mover uno de
// febrero 2026 a junio 2026 les sea sencillo a las asistentes».
import { describe, it, expect } from 'vitest';
import {
  periodoDeEmision, periodoDeDeclaracion, declaraEnPeriodo, esDiferido,
  validarPeriodoDeclarado, periodosPresentados, mesesEntre, humano,
} from '../periodo-declaracion.js';

const factura = (extra = {}) => ({
  id: 'f1', clase: 'compra', date: '2026-02-26',
  document_number: 'F087-1234177', amount: 254.28, ...extra,
});

describe('el mes en que se declara', () => {
  it('sin nada guardado es el de la emisión: el caso normal', () => {
    expect(periodoDeEmision(factura())).toBe('202602');
    expect(periodoDeDeclaracion(factura())).toBe('202602');
    expect(esDiferido(factura())).toBe(false);
  });

  it('con período guardado manda el guardado, y la fecha NO se toca', () => {
    const m = factura({ periodo_declarado: '202606' });
    expect(periodoDeDeclaracion(m)).toBe('202606');
    expect(m.date).toBe('2026-02-26');          // el papel sigue siendo de febrero
    expect(esDiferido(m)).toBe(true);
  });

  it('un período guardado corrupto se ignora en vez de esconder el comprobante', () => {
    expect(periodoDeDeclaracion(factura({ periodo_declarado: '2026' }))).toBe('202602');
    expect(periodoDeDeclaracion(factura({ periodo_declarado: '202613' }))).toBe('202602');
  });

  it('declaraEnPeriodo es la que usa el filtro del mes', () => {
    const m = factura({ periodo_declarado: '202606' });
    expect(declaraEnPeriodo(m, 2026, 6)).toBe(true);
    expect(declaraEnPeriodo(m, 2026, 2)).toBe(false);   // ya no sale en febrero
    expect(declaraEnPeriodo(factura(), 2026, 2)).toBe(true);
  });

  it('por string, nunca con new Date(): el día 1 no se va al mes anterior', () => {
    expect(periodoDeEmision(factura({ date: '2026-07-01' }))).toBe('202607');
    expect(periodoDeEmision(factura({ date: '2026-01-01' }))).toBe('202601');
  });
});

describe('mover un comprobante de mes', () => {
  const presentados = ['202601', '202602', '202603', '202604', '202605', '202606', '202607'];

  it('febrero → junio: el caso que pidió Gabriel', () => {
    const r = validarPeriodoDeclarado(factura(), '202606');
    expect(r.ok).toBe(true);
    expect(r.error).toBe(null);
  });

  it('NO se puede declarar antes de emitir', () => {
    const r = validarPeriodoDeclarado(factura(), '202601');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ANTES de emitirlo/);
    expect(r.error).toMatch(/febrero 2026/);
  });

  it('vaciarlo (volver al mes de emisión) siempre se puede', () => {
    expect(validarPeriodoDeclarado(factura({ periodo_declarado: '202606' }), '').ok).toBe(true);
  });

  it('avisa —sin bloquear— cuando el mes destino ya se le presentó a SUNAT', () => {
    const r = validarPeriodoDeclarado(factura(), '202606', { periodosPresentados: presentados });
    expect(r.ok).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/ya le fue presentado/);
    expect(r.avisos.join(' ')).toMatch(/rectificar/);
  });

  it('un mes NO presentado no dispara ese aviso', () => {
    const r = validarPeriodoDeclarado(factura(), '202609', { periodosPresentados: presentados });
    expect(r.avisos.join(' ')).not.toMatch(/ya le fue presentado/);
  });

  it('avisa al pasarse de los 12 meses del crédito fiscal', () => {
    const r = validarPeriodoDeclarado(factura(), '202704');   // 14 meses después
    expect(r.ok).toBe(true);
    expect(r.avisos.join(' ')).toMatch(/12 meses/);
  });

  it('justo a los 12 meses todavía no avisa', () => {
    expect(validarPeriodoDeclarado(factura(), '202702').avisos).toEqual([]);
  });

  it('rechaza un período mal escrito', () => {
    expect(validarPeriodoDeclarado(factura(), '2026-06').ok).toBe(false);
    expect(validarPeriodoDeclarado(factura(), '202600').ok).toBe(false);
  });

  it('sin fecha de emisión no hay contra qué validar', () => {
    const r = validarPeriodoDeclarado({ id: 'x' }, '202606');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/fecha de emisión/);
  });
});

describe('qué meses ya se presentaron', () => {
  const cortes = [
    { company_id: 'gasomi', libro: 'compras', periodo: '202601' },
    { company_id: 'gasomi', libro: 'ventas', periodo: '202601' },
    { company_id: 'gasomi', libro: 'compras', periodo: '202607' },
    { company_id: 'el-inca', libro: 'compras', periodo: '202608' },
    { company_id: 'gasomi', libro: 'compras', periodo: '202609', deleted_at: '2026-09-01' },
  ];

  it('sale de los cortes cargados: si hay CSV de ese mes, es que ya se presentó', () => {
    expect(periodosPresentados(cortes, { companyId: 'gasomi', libro: 'compras' }))
      .toEqual(['202601', '202607']);
  });

  it('no mezcla empresas ni cuenta los cortes borrados', () => {
    expect(periodosPresentados(cortes, { companyId: 'el-inca', libro: 'compras' })).toEqual(['202608']);
    expect(periodosPresentados(cortes, { companyId: 'gasomi', libro: 'compras' })).not.toContain('202609');
  });
});

describe('utilidades', () => {
  it('mesesEntre cruza el año', () => {
    expect(mesesEntre('202612', '202701')).toBe(1);
    expect(mesesEntre('202602', '202606')).toBe(4);
    expect(mesesEntre('202606', '202602')).toBe(-4);
  });

  it('humano escribe el mes como lo dice la contadora', () => {
    expect(humano('202609')).toBe('setiembre 2026');
    expect(humano('202601')).toBe('enero 2026');
  });
});
