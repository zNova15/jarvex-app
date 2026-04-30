// ─────────────────────────────────────────────────────────────
//  Plan Contable General Empresarial (PCGE) — Perú
//  Catálogo base de cuentas principales para constructoras.
//  Tipo: 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto'
//  Clase: dígito raíz del PCGE (1..7)
// ─────────────────────────────────────────────────────────────
export const PCGE_DEFAULT = [
  // Clase 1 — Activo disponible / exigible
  { codigo: '10',   nombre: 'Efectivo y equivalentes de efectivo',                tipo: 'activo',     clase: 1, padre: null  },
  { codigo: '101',  nombre: 'Caja',                                                tipo: 'activo',     clase: 1, padre: '10'  },
  { codigo: '104',  nombre: 'Cuentas corrientes en instituciones financieras',     tipo: 'activo',     clase: 1, padre: '10'  },
  { codigo: '105',  nombre: 'Otros equivalentes de efectivo',                      tipo: 'activo',     clase: 1, padre: '10'  },
  { codigo: '12',   nombre: 'Cuentas por cobrar comerciales - Terceros',           tipo: 'activo',     clase: 1, padre: null  },
  { codigo: '121',  nombre: 'Facturas, boletas y otros comprobantes por cobrar',   tipo: 'activo',     clase: 1, padre: '12'  },
  { codigo: '13',   nombre: 'Cuentas por cobrar comerciales - Relacionadas',       tipo: 'activo',     clase: 1, padre: null  },
  { codigo: '14',   nombre: 'Cuentas por cobrar al personal, accionistas, etc.',   tipo: 'activo',     clase: 1, padre: null  },
  { codigo: '16',   nombre: 'Cuentas por cobrar diversas - Terceros',              tipo: 'activo',     clase: 1, padre: null  },

  // Clase 2 — Activo realizable (existencias)
  { codigo: '20',   nombre: 'Mercaderías',                                         tipo: 'activo',     clase: 2, padre: null  },
  { codigo: '24',   nombre: 'Materias primas',                                     tipo: 'activo',     clase: 2, padre: null  },
  { codigo: '25',   nombre: 'Materiales auxiliares, suministros y repuestos',      tipo: 'activo',     clase: 2, padre: null  },
  { codigo: '28',   nombre: 'Existencias por recibir',                             tipo: 'activo',     clase: 2, padre: null  },

  // Clase 3 — Activo inmovilizado
  { codigo: '33',   nombre: 'Inmuebles, maquinaria y equipo',                      tipo: 'activo',     clase: 3, padre: null  },
  { codigo: '333',  nombre: 'Maquinarias y equipos de explotación',                tipo: 'activo',     clase: 3, padre: '33'  },
  { codigo: '334',  nombre: 'Unidades de transporte',                              tipo: 'activo',     clase: 3, padre: '33'  },
  { codigo: '39',   nombre: 'Depreciación, amortización y agotamiento acumulado',  tipo: 'activo',     clase: 3, padre: null  },

  // Clase 4 — Pasivos
  { codigo: '40',   nombre: 'Tributos por pagar',                                  tipo: 'pasivo',     clase: 4, padre: null  },
  { codigo: '4011', nombre: 'IGV',                                                 tipo: 'pasivo',     clase: 4, padre: '40'  },
  { codigo: '4017', nombre: 'Impuesto a la renta',                                 tipo: 'pasivo',     clase: 4, padre: '40'  },
  { codigo: '41',   nombre: 'Remuneraciones y participaciones por pagar',          tipo: 'pasivo',     clase: 4, padre: null  },
  { codigo: '42',   nombre: 'Cuentas por pagar comerciales - Terceros',            tipo: 'pasivo',     clase: 4, padre: null  },
  { codigo: '45',   nombre: 'Obligaciones financieras',                            tipo: 'pasivo',     clase: 4, padre: null  },
  { codigo: '46',   nombre: 'Cuentas por pagar diversas - Terceros',               tipo: 'pasivo',     clase: 4, padre: null  },

  // Clase 5 — Patrimonio
  { codigo: '50',   nombre: 'Capital',                                             tipo: 'patrimonio', clase: 5, padre: null  },
  { codigo: '58',   nombre: 'Reservas',                                            tipo: 'patrimonio', clase: 5, padre: null  },
  { codigo: '59',   nombre: 'Resultados acumulados',                               tipo: 'patrimonio', clase: 5, padre: null  },

  // Clase 6 — Gastos por naturaleza
  { codigo: '60',   nombre: 'Compras',                                             tipo: 'gasto',      clase: 6, padre: null  },
  { codigo: '62',   nombre: 'Gastos de personal, directores y gerentes',           tipo: 'gasto',      clase: 6, padre: null  },
  { codigo: '63',   nombre: 'Gastos de servicios prestados por terceros',          tipo: 'gasto',      clase: 6, padre: null  },
  { codigo: '64',   nombre: 'Gastos por tributos',                                 tipo: 'gasto',      clase: 6, padre: null  },
  { codigo: '65',   nombre: 'Otros gastos de gestión',                             tipo: 'gasto',      clase: 6, padre: null  },
  { codigo: '66',   nombre: 'Pérdida por medición de activos no financieros',      tipo: 'gasto',      clase: 6, padre: null  },
  { codigo: '67',   nombre: 'Gastos financieros',                                  tipo: 'gasto',      clase: 6, padre: null  },
  { codigo: '68',   nombre: 'Valuación y deterioro de activos y provisiones',      tipo: 'gasto',      clase: 6, padre: null  },

  // Clase 7 — Ingresos
  { codigo: '70',   nombre: 'Ventas',                                              tipo: 'ingreso',    clase: 7, padre: null  },
  { codigo: '704',  nombre: 'Prestación de servicios',                             tipo: 'ingreso',    clase: 7, padre: '70'  },
  { codigo: '75',   nombre: 'Otros ingresos de gestión',                           tipo: 'ingreso',    clase: 7, padre: null  },
  { codigo: '77',   nombre: 'Ingresos financieros',                                tipo: 'ingreso',    clase: 7, padre: null  },
];

export const PCGE_TIPO_LABEL = {
  activo:     'Activo',
  pasivo:     'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso:    'Ingreso',
  gasto:      'Gasto',
};

export const PCGE_TIPO_BADGE = {
  activo:     'b-green',
  pasivo:     'b-red',
  patrimonio: 'b-blue',
  ingreso:    'b-green',
  gasto:      'b-amber',
};

export const PCGE_CUSTOM_KEY = 'jarvex_plan_cuentas_custom';

export function loadCustomCuentas() {
  try {
    const raw = localStorage.getItem(PCGE_CUSTOM_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveCustomCuentas(arr) {
  try { localStorage.setItem(PCGE_CUSTOM_KEY, JSON.stringify(arr || [])); } catch {}
}
