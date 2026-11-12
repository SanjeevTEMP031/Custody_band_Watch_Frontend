import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiBaseUrl = env.VITE_API_BASE_URL ?? '/api/v1'
  const proxyTarget = env.VITE_API_PROXY_TARGET?.trim()
  const usesRelativeApiBase = !/^https?:\/\//i.test(apiBaseUrl)

  if (mode === 'development' && usesRelativeApiBase && !proxyTarget) {
    console.warn(
      'VITE_API_BASE_URL is relative. Set VITE_API_PROXY_TARGET to the backend laptop origin in .env.local.'
    )
  }

  return {
    plugins: [react()],
    server: proxyTarget && usesRelativeApiBase
      ? {
          proxy: {
            '/api': {
              target: proxyTarget,
              changeOrigin: true,
            },
          },
        }
      : undefined,
  }
})
