import { defineConfig } from 'vitest/config'

// Pruebas de navegador, aparte a propósito: necesitan un Chrome instalado en
// la máquina y levantan el servidor de Vite. `npm test` no las incluye, así
// que el CI no depende de ellas.
//
// Chrome: se busca en las rutas habituales o en MINI_DJ_CHROME. Si no hay,
// los tests se saltan (no fallan).
export default defineConfig({
  test: {
    name: 'e2e',
    environment: 'node',
    include: ['tests/e2e/**/*.test.js'],
    testTimeout: 60000,
    hookTimeout: 120000,
    // Un navegador cada vez: son pesados y comparten el servidor
    fileParallelism: false,
  },
})
