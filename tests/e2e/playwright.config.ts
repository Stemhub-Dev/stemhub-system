import { defineConfig } from '@playwright/test'
import { config } from './support/env'

// Las pruebas corren contra el stack local real (./up.sh): frontend, backend,
// Postgres, GoTrue, Mailpit, MinIO y el microservicio de IA. No levantan nada
// por su cuenta.
export default defineConfig({
  testDir: './specs',
  // Las separaciones con Spleeter se procesan de a una en el backend y
  // tardan minutos: en serie el tiempo total es predecible.
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['json', { outputFile: 'resultados/resultados.json' }],
  ],
  use: {
    baseURL: config.frontendUrl,
    // Chrome del sistema: no hace falta `npx playwright install`.
    channel: 'chrome',
    viewport: { width: 1600, height: 1000 },
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
