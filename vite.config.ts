import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Expose Vercel's deploy environment to the client (production | preview |
  // development). Drives the stage-only "PICS ONLY" category; empty locally.
  define: {
    __VERCEL_ENV__: JSON.stringify(process.env.VERCEL_ENV ?? ''),
  },
})
