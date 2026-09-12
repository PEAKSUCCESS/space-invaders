import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned so the hub's VITE_SPACE_URL override (http://localhost:5191) always
  // resolves to this app. strictPort fails loudly rather than silently taking
  // another port when 5191 is busy.
  server: { port: 5191, strictPort: true },
  // Expose Vercel's deploy environment to the client (production | preview |
  // development). Drives the stage-only "PICS ONLY" category; empty locally.
  define: {
    __VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
})
