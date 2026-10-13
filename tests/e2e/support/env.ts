import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Lee el mismo .env de la raíz de stemhub-system que usa docker-compose.yml,
// así las pruebas apuntan a la base y a los puertos del stack levantado.
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

function leerEnv(ruta: string): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(ruta, 'utf8')
        .split('\n')
        .map((linea) => linea.trim())
        .filter((linea) => linea && !linea.startsWith('#') && linea.includes('='))
        .map((linea) => {
          const i = linea.indexOf('=')
          return [linea.slice(0, i).trim(), linea.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
        }),
    )
  } catch {
    return {}
  }
}

const env = { ...leerEnv(resolve(raiz, '.env')), ...process.env } as Record<string, string | undefined>

// Anon key fija de la Supabase CLI local (pública, igual en cualquier
// instalación; es el default de VITE_SUPABASE_ANON_KEY en docker-compose.yml).
const ANON_KEY_LOCAL =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

export const config = {
  frontendUrl: env.E2E_FRONTEND_URL ?? 'http://localhost:5173',
  apiUrl: env.E2E_API_URL ?? 'http://localhost:8080',
  gotrueUrl: env.E2E_GOTRUE_URL ?? 'http://127.0.0.1:54321/auth/v1',
  mailpitUrl: env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:54324',
  anonKey: env.VITE_SUPABASE_ANON_KEY ?? ANON_KEY_LOCAL,
  db: {
    host: env.E2E_DB_HOST ?? '127.0.0.1',
    port: Number(env.DB_PORT ?? 5433),
    database: env.DB_NAME ?? 'stemhubdev',
    user: env.DB_USER ?? 'stemhub_app',
    password: env.DB_PASSWORD ?? '',
  },
  // Carpeta donde cada prueba deja sus capturas y respuestas HTTP.
  evidenciaDir: resolve(raiz, env.E2E_EVIDENCIA_DIR ?? 'docs/pruebas/evidencia'),
}
