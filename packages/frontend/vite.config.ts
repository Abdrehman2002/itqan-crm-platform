import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@crm/shared': path.resolve(__dirname, '../../packages/shared/src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api':    { target: 'http://localhost:3000', changeOrigin: true },
      '/auth':   { target: 'http://localhost:3000', changeOrigin: true },
      '/graphql':{ target: 'http://localhost:3000', changeOrigin: true },
      '/docs':   { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor:   ['react', 'react-dom', 'react-router-dom'],
          query:    ['@tanstack/react-query'],
          charts:   ['recharts'],
          ui:       ['lucide-react'],
        },
      },
    },
  },
});
