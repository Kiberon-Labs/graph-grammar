import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    host: true,
    // Honour the PORT env var so external preview/launchers can pin the port.
    port: process.env.PORT ? Number(process.env.PORT) : undefined,
  },
})
