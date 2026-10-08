import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  envDir: '..',
  plugins: [react()],
  optimizeDeps: {
    include: ['exceljs'],
  },
  server: {
    port: 5173,
  },
});
