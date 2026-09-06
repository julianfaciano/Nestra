import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import './ui/theme.css';

const root = document.getElementById('root');
if (!root) throw new Error('No se encontró el punto de montaje de Nestra.');

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
