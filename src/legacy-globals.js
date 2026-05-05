// Expone React, ReactDOM como globales para los componentes JSX heredados del prototipo
// Este archivo se importa PRIMERO en main.jsx.
//
// Chart.js fue removido del bundle eager — se carga lazy via lib/chart-loader.js
// solo cuando algún componente con <canvas> lo necesita (-250 KB del initial bundle).
import React from 'react';
import ReactDOM from 'react-dom/client';

window.React = React;
window.ReactDOM = ReactDOM;

// Alias globales usados en el prototipo
globalThis.React = React;
globalThis.ReactDOM = ReactDOM;
