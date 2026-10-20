import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { crearProyecto, crearUsuario, pedir, type Intercambio, type Usuario } from './api'
import { prepararAudio } from './audio'
import { config } from './env'

// Helpers de las pruebas de subida de audio (PSA, specs/psa-*.spec.ts):
// subir pistas, sondear la URL presignada como lo haría el navegador y
// observar el reproductor del Detalle de la canción.

export const enProd = config.target === 'prod'

// La evidencia de prod va aparte para no pisar la de la corrida local.
export const idEvidencia = (id: string): string => (enProd ? `${id}-prod` : id)

export const sello = (): string => new Date().toISOString().slice(5, 19).replace('T', ' ')

// --- Contexto: quién sube y a qué proyecto -----------------------------------

export interface Contexto {
  usuario: Usuario
  proyecto: number
}

// Local: Productor y proyecto nuevos. Prod: la cuenta y el proyecto de QA
// (en prod no se crean usuarios).
export async function contextoDeSubida(prueba: string): Promise<Contexto> {
  if (!enProd) {
    const usuario = await crearUsuario('Productor')
    return { usuario, proyecto: await crearProyecto(usuario, `${prueba} Proyecto ${sello()}`) }
  }
  if (!config.prod.proyecto) {
    throw new Error('Falta E2E_PROD_PROYECTO_ID (proyecto de QA en prod)')
  }
  return { usuario: await usuarioProd(), proyecto: config.prod.proyecto }
}

export async function usuarioProd(): Promise<Usuario> {
  const { email, password } = config.prod
  if (!email || !password || !config.anonKey) {
    throw new Error('Faltan E2E_PROD_EMAIL, E2E_PROD_PASSWORD o E2E_ANON_KEY')
  }
  const res = await fetch(`${config.gotrueUrl}/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const sesion = (await res.json()) as { access_token?: string }
  if (!sesion.access_token) {
    throw new Error(`login de ${email} en prod falló: ${JSON.stringify(sesion)}`)
  }
  return { email, password, nombre: email, token: sesion.access_token, codigoUsuario: 0, codigoIntegrante: 0 }
}

// --- Subida --------------------------------------------------------------------

export const MIME: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac' }

// Mismo Content-Type de la parte que pone el navegador según la extensión.
function archivo(ruta: string): File {
  const tipo = MIME[extname(ruta).slice(1).toLowerCase()] ?? 'application/octet-stream'
  return new File([readFileSync(ruta)], basename(ruta), { type: tipo })
}

export interface CancionCreada {
  codigoCancion: number
  codigoCancionVersion: number
  numeroVersion: number
}

export interface Subida<T> {
  intercambio: Intercambio<T>
  ms: number
}

export async function subirCancion(
  ctx: Contexto,
  nombre: string,
  idAudio: string | null,
): Promise<Subida<CancionCreada>> {
  const form = new FormData()
  form.set('nombre', nombre)
  if (idAudio) {
    form.set('archivo', archivo(await prepararAudio(idAudio)))
  }
  const inicio = Date.now()
  const intercambio = await pedir<CancionCreada>('POST', `/proyectos/${ctx.proyecto}/canciones`, {
    token: ctx.usuario.token,
    form,
  })
  if (intercambio.status === 201) {
    registrarCreada(ctx, intercambio.respuesta.codigoCancion)
  }
  return { intercambio, ms: Date.now() - inicio }
}

export async function subirVersion(
  ctx: Contexto,
  cancion: number,
  idAudio: string,
  notas?: string,
): Promise<Subida<CancionCreada>> {
  const form = new FormData()
  form.set('archivo', archivo(await prepararAudio(idAudio)))
  if (notas) {
    form.set('notas', notas)
  }
  const inicio = Date.now()
  const intercambio = await pedir<CancionCreada>(
    'POST',
    `/proyectos/${ctx.proyecto}/canciones/${cancion}/versiones`,
    { token: ctx.usuario.token, form },
  )
  return { intercambio, ms: Date.now() - inicio }
}

// --- Limpieza en prod ------------------------------------------------------------

const creadas: { ctx: Contexto; cancion: number }[] = []

export function registrarCreada(ctx: Contexto, cancion: number): void {
  creadas.push({ ctx, cancion })
}

// En prod da de baja (lógica) lo que creó la spec y anota el prefijo de MinIO
// a borrar a mano: la baja no elimina los archivos. En local no borra nada,
// igual que el resto de las pruebas.
export async function limpiarProd(): Promise<void> {
  if (!enProd) {
    return
  }
  const registro = resolve(config.evidenciaDir, 'PSA-limpieza-prod.txt')
  mkdirSync(config.evidenciaDir, { recursive: true })
  for (const { ctx, cancion } of creadas.splice(0)) {
    const baja = await pedir('DELETE', `/proyectos/${ctx.proyecto}/canciones/${cancion}`, {
      token: ctx.usuario.token,
    })
    appendFileSync(
      registro,
      `${new Date().toISOString()} baja HTTP ${baja.status} · docker exec $(docker ps -qf name=minio) mc rm --recursive --force local/stemhub-audio/proyectos/${ctx.proyecto}/canciones/${cancion}/\n`,
    )
  }
}

// --- Sondeo de la URL presignada ---------------------------------------------------

export interface AudioVersion {
  codigoCancionVersion: number
  url: string
  formatoArchivo: string
  expiraEnSegundos: number
}

export interface RespuestaSondeo {
  status: number
  headers: Record<string, string>
  // Cuerpo de error de MinIO o del proxy (XML/HTML), recortado.
  error?: string
}

export interface Sondeo {
  audio: Intercambio<AudioVersion>
  host: string
  protocolo: string
  get: RespuestaSondeo
  rango: RespuestaSondeo
  preflight: RespuestaSondeo
  bytes: number
  sha256: string
  // Copia local de lo descargado (para ffprobe).
  ruta: string | null
}

const HEADERS_DE_INTERES = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'vary',
  'server',
  'x-amz-request-id',
]

async function respuesta(res: Response, leerError: boolean): Promise<RespuestaSondeo> {
  const headers: Record<string, string> = {}
  for (const nombre of HEADERS_DE_INTERES) {
    const valor = res.headers.get(nombre)
    if (valor !== null) {
      headers[nombre] = valor
    }
  }
  return {
    status: res.status,
    headers,
    ...(leerError && res.status >= 400 ? { error: (await res.text()).slice(0, 600) } : {}),
  }
}

// Pide la URL presignada de la versión y la usa como el navegador desde el
// frontend: GET completo y con Range, ambos con Origin, y el preflight CORS.
export async function sondearAudio(token: string, rutaDeVersion: string, guardarComo?: string): Promise<Sondeo> {
  const audio = await pedir<AudioVersion>('GET', `${rutaDeVersion}/audio`, { token })
  const vacio: RespuestaSondeo = { status: 0, headers: {} }
  if (audio.status !== 200) {
    return { audio, host: '', protocolo: '', get: vacio, rango: vacio, preflight: vacio, bytes: 0, sha256: '', ruta: null }
  }

  const url = new URL(audio.respuesta.url)
  const origen = { Origin: config.frontendUrl }

  const resGet = await fetch(url, { headers: origen })
  const get = await respuesta(resGet, true)
  const cuerpo = get.status === 200 ? Buffer.from(await resGet.arrayBuffer()) : Buffer.alloc(0)
  let ruta: string | null = null
  if (guardarComo && get.status === 200) {
    mkdirSync(resolve(guardarComo, '..'), { recursive: true })
    writeFileSync(guardarComo, cuerpo)
    ruta = guardarComo
  }

  const resRango = await fetch(url, { headers: { ...origen, Range: 'bytes=0-1023' } })
  const rango = await respuesta(resRango, true)
  await resRango.arrayBuffer().catch(() => undefined)

  const resPreflight = await fetch(url, {
    method: 'OPTIONS',
    headers: { ...origen, 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'range' },
  })
  const preflight = await respuesta(resPreflight, true)

  return {
    audio,
    host: url.host,
    protocolo: url.protocol,
    get,
    rango,
    preflight,
    bytes: cuerpo.length,
    sha256: createHash('sha256').update(cuerpo).digest('hex'),
    ruta,
  }
}

// --- Reproductor del Detalle -----------------------------------------------------------

export const ERROR_CARGA = 'Error al cargar pista de audio'
export const ERROR_REPRODUCCION = 'Error al reproducir la pista de audio'

export interface EstadoReproductor {
  // listo: la onda terminó de cargar sin error; error: snackbar de error;
  // colgado: pasó el tiempo límite con el skeleton visible y sin error.
  estado: 'listo' | 'error' | 'colgado'
  ms: number
  // "m:ss / m:ss" debajo de la onda.
  tiempo: string | null
  consola: string[]
  requestsFallidas: string[]
  respuestasAudio: { url: string; status: number; contentType: string | null }[]
}

const sinQuery = (url: string): string => url.split('?')[0] ?? url

// Navega al Detalle y espera a que la onda quede lista o falle, registrando
// la consola y el tráfico del audio (URL presignada sin la firma).
export async function abrirDetalle(page: Page, ruta: string, limiteMs = 90_000): Promise<EstadoReproductor> {
  const consola: string[] = []
  const requestsFallidas: string[] = []
  const respuestasAudio: EstadoReproductor['respuestasAudio'] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consola.push(`[${msg.type()}] ${msg.text().slice(0, 500)}`)
    }
  })
  page.on('pageerror', (err) => consola.push(`[pageerror] ${err.message.slice(0, 500)}`))
  page.on('requestfailed', (req) => {
    requestsFallidas.push(`${req.method()} ${sinQuery(req.url())} → ${req.failure()?.errorText ?? '?'}`)
  })
  page.on('response', (res) => {
    const url = res.url()
    if (url.includes('X-Amz-Signature') || /\/versiones\/\d+\/audio$/.test(sinQuery(url))) {
      respuestasAudio.push({ url: sinQuery(url), status: res.status(), contentType: res.headers()['content-type'] ?? null })
    }
  })

  const inicio = Date.now()
  await page.goto(ruta)
  const skeleton = page.getByTestId('onda-skeleton')
  const snackbar = page.getByText(ERROR_CARGA)
  await skeleton.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined)

  const estado = await Promise.race([
    skeleton.waitFor({ state: 'hidden', timeout: limiteMs }).then(() => 'listo' as const),
    snackbar.waitFor({ state: 'visible', timeout: limiteMs }).then(() => 'error' as const),
  ]).catch(() => 'colgado' as const)
  const ms = Date.now() - inicio

  // El skeleton también se oculta cuando falla: el snackbar manda.
  const final = estado === 'listo' && (await snackbar.isVisible()) ? 'error' : estado
  const tiempo = await page
    .getByText(/^\d+:\d{2} \/ \d+:\d{2}$/)
    .first()
    .textContent({ timeout: 2_000 })
    .catch(() => null)

  return { estado: final, ms, tiempo, consola, requestsFallidas, respuestasAudio }
}

// "m:ss" → segundos.
export function segundos(texto: string): number {
  const [m, s] = texto.split(':').map(Number)
  return (m ?? 0) * 60 + (s ?? 0)
}
