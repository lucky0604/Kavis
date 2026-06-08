import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { configureApiRoutes } from './server/index';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'janus-api-routes',
      configureServer(server) {
        configureApiRoutes(server);
      },
    },
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  server: {
    port: 5173,
  },
});
