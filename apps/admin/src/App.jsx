import React from 'react';

export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#f8fafc',
    }}>
      <div style={{ textAlign: 'center', padding: '2rem' }}>
        <h1 style={{ fontSize: '3rem', margin: 0, color: '#0f172a', letterSpacing: '-0.02em' }}>
          OMS<span style={{ color: '#2563eb' }}>King</span>
        </h1>
        <p style={{ color: '#64748b', marginTop: '0.5rem', fontSize: '1.125rem' }}>
          Omnichannel Order Management System
        </p>
        <p style={{ color: '#94a3b8', marginTop: '2rem', fontSize: '0.875rem' }}>
          Phase 0 — Architecture &amp; Foundation. UI foundation begins in Phase 1.
        </p>
      </div>
    </div>
  );
}
