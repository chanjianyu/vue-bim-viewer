import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

// npm link 消费 dist；Vue、Three 由宿主提供，避免两个响应式/渲染实例。
export default defineConfig({
  plugins: [vue()],
  build: {
    lib: {
      entry: fileURLToPath(new URL('./src/index.js', import.meta.url)),
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
      cssFileName: 'style',
    },
    rolldownOptions: { external: [/^vue(?:\/|$)/, /^three(?:\/|$)/] },
  },
})
