import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Polyfill pra crypto.randomUUID — a API nativa só existe em "secure context"
// (HTTPS ou localhost). Acesso via HTTP por IP da intranet (ex: http://10.0.0.5:4500)
// é considerado inseguro, mesmo na rede interna. crypto.getRandomValues está
// disponível em todos os contextos, então geramos o UUID v4 manualmente.
if (typeof window !== 'undefined' && window.crypto && !window.crypto.randomUUID) {
  (window.crypto as Crypto & { randomUUID?: () => string }).randomUUID = (): `${string}-${string}-${string}-${string}-${string}` => {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versão 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}` as `${string}-${string}-${string}-${string}-${string}`;
  };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
