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
    // 700kB instead of 500 — silences the warning for chunks we accept as
    // large (the SuperAdmin chunk is ~600kB and that's fine because it's
    // route-split and only loaded for platform admins).
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        // Vendor chunking — function form so any package under node_modules/foo
        // routes into the right bucket whether it's imported directly or by a
        // transitive dep. Heavy libs (recharts, dnd, xlsx) get their own chunks
        // so the main bundle stays small.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          // livekit-client is ~600kB on its own — heavy WebRTC SDK. Only the
          // CallWidget pulls it. Splitting means agents on settings/reports
          // pages never download it.
          if (id.includes('livekit-client'))    return 'livekit';
          if (id.includes('@dnd-kit'))          return 'dnd';
          if (id.includes('recharts'))          return 'charts';
          if (id.includes('@tanstack/react-query')) return 'query';
          if (id.includes('lucide-react'))      return 'ui';
          if (id.includes('react-router'))      return 'vendor';
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor';
          if (id.includes('zustand') || id.includes('immer'))     return 'vendor';
          if (id.includes('dompurify'))         return 'libs';
          if (id.includes('axios'))             return 'vendor';
          if (id.includes('uuid'))              return 'vendor';
          return 'libs';
        },
      },
    },
  },
});
