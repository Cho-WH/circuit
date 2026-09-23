import React from 'react';
import ReactDOM from 'react-dom/client';
import { FeedbackAdminApp, ErrorBoundary } from './app';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><FeedbackAdminApp /></ErrorBoundary></React.StrictMode>,
);
