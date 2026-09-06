import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api -> Fastify backend on 127.0.0.1 (avoids the localhost/IPv6 issue and CORS).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: true },
    },
  },
})
