import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // VITE_BASE_PATH is set automatically by the GitHub Actions deploy workflow
  base: process.env.VITE_BASE_PATH ?? '/',
})
