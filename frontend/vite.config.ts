import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin.html',
      },
    },
  },
  server: {
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
      '/api': {
        target: 'http://localhost:3001',
      },
      '/uploads': {
        target: 'http://localhost:3001',
      },
      '/uploads_eras': {
        target: 'http://localhost:3001',
      },
      '/uploads_buffs': {
        target: 'http://localhost:3001',
      },
    },
  },
})
