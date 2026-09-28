// Default backend URL; can be overridden with VITE_API_BASE in frontend/.env.
// Varsayılan backend adresi; frontend/.env içinde VITE_API_BASE ile değiştirilebilir.
export const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000';
