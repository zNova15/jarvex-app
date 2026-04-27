// Expone React, ReactDOM como globales para los componentes JSX heredados del prototipo
// Este archivo se importa PRIMERO en main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import Chart from 'chart.js/auto';

window.React = React;
window.ReactDOM = ReactDOM;
window.Chart = Chart;

// Alias globales usados en el prototipo
globalThis.React = React;
globalThis.ReactDOM = ReactDOM;
globalThis.Chart = Chart;
