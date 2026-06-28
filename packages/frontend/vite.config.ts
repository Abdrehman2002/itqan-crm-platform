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
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Object-form manualChunks — known-good. The function form I tried
        // earlier (commit 532f35a) split React across the vendor/libs boundary
        // in a way that loaded `useState` before React itself was defined,
        // producing a blank screen with
        //   Uncaught TypeError: Cannot read properties of undefined (reading 'useState')
        // The object form lets Rollup decide the safe boundary while we still
        // get the bundle-size wins from route-splitting the page components.
        manualChunks: {
          vendor:  ['react', 'react-dom', 'react-router-dom'],
          query:   ['@tanstack/react-query'],
          charts:  ['recharts'],
          ui:      ['lucide-react'],
          livekit: ['livekit-client'],
          dnd:     ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
});
