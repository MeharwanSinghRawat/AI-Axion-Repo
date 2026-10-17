// Axion UI Runtime Configuration
// Dynamically reads API_BASE from window.__ENV__ (injected via Kubernetes ConfigMap)
// or falls back to import.meta.env.VITE_API_BASE or default host

declare global {
  interface Window {
    __ENV__?: {
      API_BASE?: string;
    };
  }
}

export const API_BASE: string =
  (typeof window !== 'undefined' && window.__ENV__?.API_BASE) ||
  (import.meta.env.VITE_API_BASE as string) ||
  '';
