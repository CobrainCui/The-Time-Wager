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
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react-dom") || id.includes("node_modules/react/")) return "react-vendor";
          if (id.includes("socket.io-client") || id.includes("engine.io-client")) return "socket-vendor";
          if (id.includes("chart.js") || id.includes("react-chartjs-2")) return "chart-vendor";
          if (id.includes("jspdf") || id.includes("html2canvas")) return "pdf-vendor";
        },
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
      '/uploads_personas': {
        target: 'http://localhost:3001',
      },
    },
  },
})
