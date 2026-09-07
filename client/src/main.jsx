import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { getTheme, applyTheme } from './lib/theme.js';
import './styles.css';

applyTheme(getTheme());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
