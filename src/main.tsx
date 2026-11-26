import React from 'react';
import ReactDOM from 'react-dom/client';
import { App, ErrorBoundary } from './app';
import { loadMathFont } from './typography';

// Show the circuit with its fallback font while the CDN request is pending.
void loadMathFont().catch(() => undefined);
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
