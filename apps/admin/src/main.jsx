import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './router';
import RootProviders from './providers/RootProviders';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RootProviders>
      <RouterProvider router={router} />
    </RootProviders>
  </React.StrictMode>,
);
