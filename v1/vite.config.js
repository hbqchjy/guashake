import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { VantResolver } from '@vant/auto-import-resolver'

export default defineConfig({
  base: '/v1/',
  plugins: [
    vue(),
    AutoImport({
      resolvers: [VantResolver()],
    }),
    Components({
      resolvers: [VantResolver()],
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/triage': 'http://localhost:3000',
      '/cost': 'http://localhost:3000',
      '/booking': 'http://localhost:3000',
      '/archive': 'http://localhost:3000',
      '/auth': 'http://localhost:3000',
      '/analytics': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
})
