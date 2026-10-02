import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    /**
     * Vite rejects requests whose Host header it doesn't recognise, which blocks the
     * app when it's reached through a tunnel. Allow the usual tunnel domains (a
     * leading dot covers subdomains) plus anything named in TUNNEL_HOST. Keep this
     * a list rather than `true` — with the passcode in front, the remaining risk is
     * DNS rebinding, and an explicit list closes that off.
     */
    allowedHosts: [
      '.ngrok.app',
      '.ngrok-free.app',
      '.ngrok.io',
      '.trycloudflare.com',
      '.loca.lt',
      '.ts.net',
      ...(process.env.TUNNEL_HOST ? [process.env.TUNNEL_HOST] : []),
    ],
  },
})
