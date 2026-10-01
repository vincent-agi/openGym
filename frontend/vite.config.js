import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: {
    rollupOptions: {
      output: {
        // exercises-data.js is a ~900KB literal, eagerly reachable from every view that
        // renders an exercise name (Home, Workout, Library, ...) — no lazy boundary can
        // defer it without an async refactor of EXDB/EXIDX across the app and its tests.
        // Isolating it in its own chunk at least keeps it out of the app-code chunk, so
        // app changes don't invalidate its cache (and vice versa) and the warning limit
        // below doesn't have to be inflated for everything else.
        manualChunks: id => id.includes('lib/exercises-data.js') ? 'exercises-data' : undefined
      }
    }
  }
})
