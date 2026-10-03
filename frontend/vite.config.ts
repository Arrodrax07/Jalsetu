import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the API (FastAPI on :8000) is proxied under /api, including the WebSocket.
export default defineConfig({
  plugins: [react()],
  // maplibre-gl (~800 kB) is required by the first screen (command-centre map); other pages are code-split.
  build: { chunkSizeWarningLimit: 1500 },
  // `npm run build && npm run preview` serves the production build (service worker, offline portal) with the same proxy.
  preview: {
    port: 5173,
    allowedHosts: ['.trycloudflare.com'],
    proxy: { '/api': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true, ws: true } },
  },
  server: {
    port: 5173,
    // Phones need HTTPS for GPS; a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:5173`) provides it.
    allowedHosts: ['.trycloudflare.com'],
    proxy: {
      '/api': { target: process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000', changeOrigin: true, ws: true },
    },
  },
})
