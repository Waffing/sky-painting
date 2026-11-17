import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base: './' 便于静态托管（Qoder Sites）以相对路径加载资源；部署步如需域名根路径可改为 '/'
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
})
