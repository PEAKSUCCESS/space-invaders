import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Pinned (after Gameshow1's 5193) so a hub VITE_SPACE_INVADERS_URL override of
  // http://localhost:5194 always resolves to this app. strictPort fails loudly
  // rather than silently taking another port when 5194 is busy.
  server: { port: 5194, strictPort: true },
  // Expose Vercel's deploy environment to the client (production | preview |
  // development). Drives the stage-only "PICS ONLY" category; empty locally.
  define: {
    __VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
})
