// Tanda 4 del destino — la naturaleza de un insumo.
// Lo que se prueba acá no es «la función devuelve 601»: es que las DOS cosas
// que la tanda promete se cumplan — que el hecho le gane a la política, y que
// nada se active por decreto.
import { describe, it, expect } from 'vitest';
import {
  NATURALEZA, CUENTA_MERCADERIA, CUENTA_MATERIA_PRIMA,
  llaveNaturaleza, esCuentaDeBien, itemSeRevende, cuentaPorNaturaleza,
  activoPorLinea, activoDeLineaDe,
} from '../naturaleza-insumo.js';
import { DESTINOS, DESTINO_INFO, ayudaDestino, llaveDestino } from '../destino-inventario.js';

describe('espejo de destino-inventario.js', () => {
  // 🔴 Este test es el que autoriza la duplicación de los cuatro valores. Si
  // alguien renombra un cajón allá y no acá, la naturaleza deja de reconocer la
  // decisión en silencio: el libro seguiría asentando la cuenta vieja y nadie
  // vería un error, solo una cuenta que no cambia nunca.
  it('los cuatro cajones son exactamente los mismos', () => {
    expect(Object.values(NATURALEZA).sort()).toEqual([...DESTINOS].sort());
  });

  it('la llave se normaliza igual que la de la decisión', () => {
    for (const n of ['TUBERÍA PVC 1/2"', 'Taladro Bosch  GSB-550', 'ACERO 3/8']) {
      expect(llaveNaturaleza(n)).toBe(llaveDestino(n));
    }
  });
});

describe('esCuentaDeBien', () => {
  it('los bienes comprados sí', () => {
    for (const c of ['601', '602', '603', '60911', '656']) expect(esCuentaDeBien(c)).toBe(true);
  });
  it('los servicios no — marcar «reventa» un alquiler no lo hace mercadería', () => {
    for (const c of ['631', '635', '624', '638', '639', '701', '704']) {
      expect(esCuentaDeBien(c)).toBe(false);
    }
  });
});

describe('itemSeRevende', () => {
  it('separado para venta y vendido son hechos', () => {
    expect(itemSeRevende({ venta_status: 'para_venta' })).toBe(true);
    expect(itemSeRevende({ venta_status: 'vendido' })).toBe(true);
  });
  it('sin estado, no', () => {
    expect(itemSeRevende({})).toBe(false);
    expect(itemSeRevende(null)).toBe(false);
    expect(itemSeRevende({ venta_status: '' })).toBe(false);
  });
});

describe('la política mueve la cuenta', () => {
  it('«para revender» → 601 Mercaderías', () => {
    const r = cuentaPorNaturaleza('602', NATURALEZA.REVENTA);
    expect(r.cuenta).toBe(CUENTA_MERCADERIA);
    expect(r.cambiada).toBe(true);
    expect(r.revisar).toBe(false);
  });

  it('«se transforma» → 602 Materias primas', () => {
    const r = cuentaPorNaturaleza('656', NATURALEZA.TRANSFORMA);
    expect(r.cuenta).toBe(CUENTA_MATERIA_PRIMA);
    expect(r.cambiada).toBe(true);
  });

  it('«se consume» no cambia nada: es la política por defecto', () => {
    expect(cuentaPorNaturaleza('602', NATURALEZA.GASTO)).toBeNull();
  });

  it('sin política tampoco: manda la familia', () => {
    expect(cuentaPorNaturaleza('603', null)).toBeNull();
    expect(cuentaPorNaturaleza('603', '')).toBeNull();
  });

  it('ya estando en la cuenta que corresponde, no se anuncia un cambio', () => {
    const r = cuentaPorNaturaleza('601', NATURALEZA.REVENTA);
    expect(r.cuenta).toBe('601');
    expect(r.cambiada).toBe(false);
  });

  it('sobre un SERVICIO la política no hace nada', () => {
    // El caso: alguien marcó «para revender» un alquiler de maquinaria. Un
    // alquiler no entra a ningún inventario; mandarlo a la 601 sería asentar
    // una mercadería que no existe.
    expect(cuentaPorNaturaleza('635', NATURALEZA.REVENTA)).toBeNull();
    expect(cuentaPorNaturaleza('631', NATURALEZA.TRANSFORMA)).toBeNull();
  });
});

describe('«uso de la empresa» NO activa por decreto', () => {
  // Esta es la regla que justifica la tanda entera. Un taladro de S/ 150 es
  // «uso de la empresa» y NO es un activo fijo; mandarlo a la 33 lo sacaría
  // del resultado del ejercicio sin que nadie lo haya registrado.
  it('sin activo cargado, la cuenta no se toca y queda para revisar', () => {
    const r = cuentaPorNaturaleza('656', NATURALEZA.ACTIVO);
    expect(r.cuenta).toBe('656');
    expect(r.cambiada).toBe(false);
    expect(r.revisar).toBe(true);
    expect(r.motivo).toBe('activo_sin_registrar');
    expect(r.porque).toMatch(/7\.1/);
  });

  it('nunca devuelve una cuenta del elemento 3 inventada', () => {
    for (const base of ['602', '603', '656', '60911']) {
      expect(cuentaPorNaturaleza(base, NATURALEZA.ACTIVO).cuenta).toBe(base);
    }
  });
});

describe('el HECHO le gana a la política', () => {
  const activo = { id: 'a1', cuenta_contable: '33411' };

  it('la línea cargada en el 7.1 manda, con la cuenta del propio registro', () => {
    const r = cuentaPorNaturaleza('603', NATURALEZA.ACTIVO, { activo });
    expect(r.cuenta).toBe('33411');
    expect(r.cambiada).toBe(true);
    expect(r.revisar).toBe(false);
    expect(r.motivo).toBe('activo_cargado');
  });

  it('le gana incluso a «para revender»: esta compra puntual se activó', () => {
    expect(cuentaPorNaturaleza('602', NATURALEZA.REVENTA, { activo }).cuenta).toBe('33411');
  });

  it('y a un servicio: si alguien lo activó, es un activo', () => {
    // Una instalación facturada como servicio que se capitalizó con el equipo.
    expect(cuentaPorNaturaleza('638', null, { activo }).cuenta).toBe('33411');
  });

  it('sin familia reconocida, la cuenta sale igual del registro 7.1', () => {
    const r = cuentaPorNaturaleza('', null, { activo });
    expect(r.cuenta).toBe('33411');
    expect(r.cambiada).toBe(true);
  });

  it('un activo SIN cuenta del PCGE no inventa una: avisa y deja la de la familia', () => {
    const r = cuentaPorNaturaleza('603', null, { activo: { id: 'a2', cuenta_contable: null } });
    expect(r.cuenta).toBe('603');
    expect(r.cambiada).toBe(false);
    expect(r.revisar).toBe(true);
    expect(r.motivo).toBe('activo_sin_cuenta');
  });

  it('un activo con una cuenta que no es del elemento 3 tampoco se usa', () => {
    const r = cuentaPorNaturaleza('603', null, { activo: { id: 'a3', cuenta_contable: '602' } });
    expect(r.motivo).toBe('activo_sin_cuenta');
    expect(r.cuenta).toBe('603');
  });
});

describe('el HECHO de la venta', () => {
  it('un ítem separado para venta es mercadería aunque la política diga otra cosa', () => {
    const r = cuentaPorNaturaleza('602', NATURALEZA.TRANSFORMA, { seRevende: true });
    expect(r.cuenta).toBe(CUENTA_MERCADERIA);
    expect(r.motivo).toBe('venta_registrada');
  });

  it('pero no convierte un servicio en mercadería', () => {
    expect(cuentaPorNaturaleza('639', null, { seRevende: true })).toBeNull();
  });

  it('el activo cargado le gana también a la venta', () => {
    const r = cuentaPorNaturaleza('602', null, {
      seRevende: true, activo: { id: 'a1', cuenta_contable: '333' },
    });
    expect(r.cuenta).toBe('333');
  });
});

describe('el hecho, indexado por línea', () => {
  const filas = [
    { id: 'a1', accounting_movement_id: 'm1', accounting_item_idx: 0, cuenta_contable: '337' },
    { id: 'a2', accounting_movement_id: 'm1', accounting_item_idx: 2, cuenta_contable: '333' },
    { id: 'a3', accounting_movement_id: 'm2', accounting_item_idx: 1, cuenta_contable: '33411' },
    { id: 'x', accounting_movement_id: 'm9', accounting_item_idx: 0, deleted_at: '2026-01-01' },
    { id: 'y', accounting_movement_id: null, accounting_item_idx: 0 },
    { id: 'z', accounting_movement_id: 'm3', accounting_item_idx: null },
  ];
  const buscar = activoDeLineaDe(activoPorLinea(filas));

  it('encuentra la línea 0, que es la que un `!idx` perdería', () => {
    expect(buscar('m1', 0)?.id).toBe('a1');
  });

  it('no confunde líneas ni comprobantes', () => {
    expect(buscar('m1', 2)?.id).toBe('a2');
    expect(buscar('m1', 1)).toBeNull();
    expect(buscar('m2', 1)?.id).toBe('a3');
  });

  it('ignora las borradas y las que no apuntan a una línea', () => {
    expect(buscar('m9', 0)).toBeNull();
    expect(buscar('m3', 0)).toBeNull();
  });

  it('sin mapa no explota', () => {
    expect(activoDeLineaDe(null)('m1', 0)).toBeNull();
    expect(buscar(null, 0)).toBeNull();
  });
});

describe('la consecuencia contable se dice donde se decide', () => {
  // La decisión de destino dejó de ser solo del inventario: mueve el libro
  // diario. Si algún cajón se quedara sin explicarlo, la contadora cambiaría
  // una cuenta contable creyendo que solo cambia una columna de saldo.
  it('los cuatro cajones dicen qué le hacen a la contabilidad', () => {
    for (const d of DESTINOS) {
      expect(DESTINO_INFO[d].contable, d).toBeTruthy();
      expect(ayudaDestino(d)).toContain(DESTINO_INFO[d].contable);
    }
  });

  it('el de «uso de la empresa» avisa que NO activa solo', () => {
    expect(DESTINO_INFO.activo_uso.contable).toMatch(/7\.1/);
  });
});
