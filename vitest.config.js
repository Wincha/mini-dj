import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

const { version } = JSON.parse(readFileSync('./package.json', 'utf8'))

// Dos proyectos con entornos distintos:
//   unit → Node pelado, para la lógica pura (audio, lib, i18n). Arranca en
//          milisegundos porque no monta ningún DOM.
//   dom  → jsdom + Testing Library, solo para los componentes de React.
// Las pruebas de navegador (tests/e2e) viven en vitest.e2e.config.js aparte:
// dependen de tener Chrome en la máquina y no deben tumbar el CI.
export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.{js,jsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/dom/**/*.test.{js,jsx}'],
          setupFiles: ['tests/setup/dom.js'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{js,jsx}'],
      // Sin lógica que probar: punto de entrada, tablas de traducción y el
      // worker (una envoltura de tres líneas sobre detectTempo).
      exclude: ['src/main.jsx', 'src/i18n/locales/**', 'src/**/*.worker.js'],
    },
  },
})
