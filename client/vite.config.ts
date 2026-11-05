import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// โหมด dev: ส่ง socket.io ไปที่ server พอร์ต 3000
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/socket.io': { target: 'http://localhost:3000', ws: true } },
  },
});
