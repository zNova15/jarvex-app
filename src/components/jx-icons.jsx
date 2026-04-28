import React from "react";
// JARVEX Icon Library
const JxIcon = ({ name, size = 16, color = 'currentColor', strokeWidth = 1.6 }) => {
  const s = { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 };
  const p = { fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round' };

  const icons = {
    dashboard:    <><rect x="3" y="3" width="7" height="7" rx="1.5" {...p}/><rect x="14" y="3" width="7" height="7" rx="1.5" {...p}/><rect x="3" y="14" width="7" height="7" rx="1.5" {...p}/><rect x="14" y="14" width="7" height="7" rx="1.5" {...p}/></>,
    building:     <><path d="M3 21V7l9-4 9 4v14" {...p}/><path d="M9 21v-8h6v8" {...p}/><line x1="3" y1="21" x2="21" y2="21" {...p}/></>,
    chart:        <><line x1="18" y1="20" x2="18" y2="10" {...p}/><line x1="12" y1="20" x2="12" y2="4" {...p}/><line x1="6" y1="20" x2="6" y2="14" {...p}/><line x1="2" y1="20" x2="22" y2="20" {...p}/></>,
    package:      <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" {...p}/><polyline points="3.27 6.96 12 12.01 20.73 6.96" {...p}/><line x1="12" y1="22.08" x2="12" y2="12" {...p}/></>,
    tool:         <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" {...p}/></>,
    users:        <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" {...p}/><circle cx="9" cy="7" r="4" {...p}/><path d="M23 21v-2a4 4 0 0 0-3-3.87" {...p}/><path d="M16 3.13a4 4 0 0 1 0 7.75" {...p}/></>,
    user:         <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...p}/><circle cx="12" cy="7" r="4" {...p}/></>,
    calendar:     <><rect x="3" y="4" width="18" height="18" rx="2" {...p}/><line x1="16" y1="2" x2="16" y2="6" {...p}/><line x1="8" y1="2" x2="8" y2="6" {...p}/><line x1="3" y1="10" x2="21" y2="10" {...p}/></>,
    truck:        <><rect x="1" y="3" width="15" height="13" rx="1" {...p}/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8" {...p}/><circle cx="5.5" cy="18.5" r="2.5" {...p}/><circle cx="18.5" cy="18.5" r="2.5" {...p}/></>,
    clipboard:    <><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" {...p}/><rect x="8" y="2" width="8" height="4" rx="1" {...p}/></>,
    gantt:        <><line x1="3" y1="6" x2="21" y2="6" {...p}/><line x1="3" y1="12" x2="21" y2="12" {...p}/><line x1="3" y1="18" x2="21" y2="18" {...p}/><rect x="5" y="4" width="5" height="4" rx="1" {...p}/><rect x="10" y="10" width="7" height="4" rx="1" {...p}/><rect x="7" y="16" width="6" height="4" rx="1" {...p}/></>,
    compare:      <><polyline points="18 8 22 12 18 16" {...p}/><polyline points="6 8 2 12 6 16" {...p}/><line x1="2" y1="12" x2="22" y2="12" {...p}/></>,
    image:        <><rect x="3" y="3" width="18" height="18" rx="2" {...p}/><circle cx="8.5" cy="8.5" r="1.5" {...p}/><polyline points="21 15 16 10 5 21" {...p}/></>,
    settings:     <><circle cx="12" cy="12" r="3" {...p}/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" {...p}/></>,
    shield:       <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...p}/></>,
    alert:        <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" {...p}/><line x1="12" y1="9" x2="12" y2="13" {...p}/><line x1="12" y1="17" x2="12.01" y2="17" {...p}/></>,
    alertCircle:  <><circle cx="12" cy="12" r="10" {...p}/><line x1="12" y1="8" x2="12" y2="12" {...p}/><line x1="12" y1="16" x2="12.01" y2="16" {...p}/></>,
    plus:         <><line x1="12" y1="5" x2="12" y2="19" {...p}/><line x1="5" y1="12" x2="19" y2="12" {...p}/></>,
    search:       <><circle cx="11" cy="11" r="8" {...p}/><line x1="21" y1="21" x2="16.65" y2="16.65" {...p}/></>,
    filter:       <><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" {...p}/></>,
    download:     <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...p}/><polyline points="7 10 12 15 17 10" {...p}/><line x1="12" y1="15" x2="12" y2="3" {...p}/></>,
    upload:       <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...p}/><polyline points="17 8 12 3 7 8" {...p}/><line x1="12" y1="3" x2="12" y2="15" {...p}/></>,
    eye:          <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" {...p}/><circle cx="12" cy="12" r="3" {...p}/></>,
    edit:         <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" {...p}/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" {...p}/></>,
    trash:        <><polyline points="3 6 5 6 21 6" {...p}/><path d="M19 6l-1 14H6L5 6" {...p}/><path d="M10 11v6" {...p}/><path d="M14 11v6" {...p}/><path d="M9 6V4h6v2" {...p}/></>,
    x:            <><line x1="18" y1="6" x2="6" y2="18" {...p}/><line x1="6" y1="6" x2="18" y2="18" {...p}/></>,
    check:        <><polyline points="20 6 9 17 4 12" {...p}/></>,
    checkCircle:  <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" {...p}/><polyline points="22 4 12 14.01 9 11.01" {...p}/></>,
    chevR:        <><polyline points="9 18 15 12 9 6" {...p}/></>,
    chevD:        <><polyline points="6 9 12 15 18 9" {...p}/></>,
    chevL:        <><polyline points="15 18 9 12 15 6" {...p}/></>,
    menu:         <><line x1="3" y1="12" x2="21" y2="12" {...p}/><line x1="3" y1="6" x2="21" y2="6" {...p}/><line x1="3" y1="18" x2="21" y2="18" {...p}/></>,
    bell:         <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" {...p}/><path d="M13.73 21a2 2 0 0 1-3.46 0" {...p}/></>,
    logout:       <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" {...p}/><polyline points="16 17 21 12 16 7" {...p}/><line x1="21" y1="12" x2="9" y2="12" {...p}/></>,
    dollar:       <><line x1="12" y1="1" x2="12" y2="23" {...p}/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" {...p}/></>,
    trendUp:      <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" {...p}/><polyline points="17 6 23 6 23 12" {...p}/></>,
    trendDown:    <><polyline points="23 18 13.5 8.5 8.5 13.5 1 6" {...p}/><polyline points="17 18 23 18 23 12" {...p}/></>,
    layers:       <><polygon points="12 2 2 7 12 12 22 7 12 2" {...p}/><polyline points="2 17 12 22 22 17" {...p}/><polyline points="2 12 12 17 22 12" {...p}/></>,
    list:         <><line x1="8" y1="6" x2="21" y2="6" {...p}/><line x1="8" y1="12" x2="21" y2="12" {...p}/><line x1="8" y1="18" x2="21" y2="18" {...p}/><line x1="3" y1="6" x2="3.01" y2="6" {...p}/><line x1="3" y1="12" x2="3.01" y2="12" {...p}/><line x1="3" y1="18" x2="3.01" y2="18" {...p}/></>,
    arrowIn:      <><path d="M12 2v10" {...p}/><path d="m8 6 4 4 4-4" {...p}/><path d="M4 14H2v6h20v-6h-2" {...p}/></>,
    arrowOut:     <><path d="M12 12V2" {...p}/><path d="m8 6 4-4 4 4" {...p}/><path d="M4 14H2v6h20v-6h-2" {...p}/></>,
    inbox:        <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" {...p}/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" {...p}/></>,
    map:          <><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" {...p}/><line x1="8" y1="2" x2="8" y2="18" {...p}/><line x1="16" y1="6" x2="16" y2="22" {...p}/></>,
    hard:         <><line x1="22" y1="12" x2="2" y2="12" {...p}/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" {...p}/></>,
    lock:         <><rect x="3" y="11" width="18" height="11" rx="2" {...p}/><path d="M7 11V7a5 5 0 0 1 10 0v4" {...p}/></>,
    camera:       <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...p}/><circle cx="12" cy="13" r="4" {...p}/></>,
    file:         <><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" {...p}/><polyline points="13 2 13 9 20 9" {...p}/></>,
    hash:         <><line x1="4" y1="9" x2="20" y2="9" {...p}/><line x1="4" y1="15" x2="20" y2="15" {...p}/><line x1="10" y1="3" x2="8" y2="21" {...p}/><line x1="16" y1="3" x2="14" y2="21" {...p}/></>,
    activity:     <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" {...p}/></>,
    hardHat:      <><path d="M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z" {...p}/><path d="M10 10V5a2 2 0 0 1 4 0v5" {...p}/><path d="M4 15v-3a8 8 0 0 1 16 0v3" {...p}/></>,
  };

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={s} aria-hidden="true">
      {icons[name] || icons.dashboard}
    </svg>
  );
};

// Empty state cuando no hay obra activa (usado por componentes que dependen
// de obraId). Más informativo que "Cargando…" infinito.
const SinObraEmpty = ({ icon = 'building' }) => (
  <div className="page-wrap">
    <div className="empty-state" style={{ paddingTop: 60 }}>
      <JxIcon name={icon} size={36} color="rgba(242,183,5,0.55)" />
      <p style={{ fontSize: 14, color: 'var(--ts)', marginTop: 14, fontWeight: 600 }}>
        Esperando obra activa
      </p>
      <p style={{ fontSize: 12.5, color: 'var(--tm)', marginTop: 6, lineHeight: 1.5, maxWidth: 380, margin: '6px auto 0' }}>
        No hay obras visibles para tu usuario. Posibles razones:<br />
        · Aún no se ha creado ninguna obra (créala en <strong>Obras / Proyectos</strong>).<br />
        · Tu sesión está sincronizando — espera unos segundos.<br />
        · No estás asignado a ninguna obra (pide al admin que te asigne).
      </p>
      <button className="btn btn-amber btn-sm" style={{ marginTop: 16 }} onClick={() => window.location.reload()}>
        <JxIcon name="check" size={12} /> Recargar
      </button>
    </div>
  </div>
);

Object.assign(window, { JxIcon, SinObraEmpty });