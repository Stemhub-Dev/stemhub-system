import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, type Page, type TestInfo } from '@playwright/test'
import type { Intercambio } from './api'
import type { ConsultaDb } from './db'
import { config } from './env'

// Evidencia de cada prueba en docs/pruebas/evidencia/PRU-XX/: capturas de la
// UI numeradas por paso, más los intercambios HTTP y consultas a la BD
// (en JSON y renderizados como captura, para las pruebas sin pantalla).

export class Evidencia {
  private readonly dir: string
  private paso = 0

  constructor(
    private readonly id: string,
    private readonly testInfo: TestInfo,
  ) {
    this.dir = resolve(config.evidenciaDir, id)
    // Cada corrida reemplaza la evidencia anterior de la prueba.
    rmSync(this.dir, { recursive: true, force: true })
    mkdirSync(this.dir, { recursive: true })
  }

  private nombreArchivo(nombre: string, extension: string): string {
    this.paso += 1
    return `${String(this.paso).padStart(2, '0')}-${nombre}.${extension}`
  }

  async captura(page: Page, nombre: string, opciones: { fullPage?: boolean } = {}): Promise<void> {
    // Fuentes de íconos y waveforms terminan de pintar un instante después.
    await page.waitForTimeout(400)
    const archivo = this.nombreArchivo(nombre, 'png')
    const ruta = resolve(this.dir, archivo)
    await page.screenshot({ path: ruta, fullPage: opciones.fullPage ?? false })
    await this.testInfo.attach(`${this.id} ${archivo}`, { path: ruta, contentType: 'image/png' })
  }

  async json(nombre: string, datos: unknown): Promise<void> {
    const archivo = this.nombreArchivo(nombre, 'json')
    const contenido = JSON.stringify(datos, null, 2)
    writeFileSync(resolve(this.dir, archivo), contenido)
    await this.testInfo.attach(`${this.id} ${archivo}`, {
      body: contenido,
      contentType: 'application/json',
    })
  }

  // Dibuja los intercambios HTTP y las consultas a la BD como una "consola"
  // y la captura: es la evidencia visual de las pruebas de backend.
  async capturaHttp(
    page: Page,
    nombre: string,
    titulo: string,
    intercambios: Intercambio[],
    consultas: { titulo: string; consulta: ConsultaDb }[] = [],
  ): Promise<void> {
    await this.json(nombre, { intercambios, consultas })
    // Pestaña aparte: la de la prueba conserva su sesión y su pantalla.
    const consola = await page.context().newPage()
    await consola.setViewportSize({ width: 1200, height: 800 })
    await consola.setContent(htmlConsola(this.id, titulo, intercambios, consultas))
    const archivo = this.nombreArchivo(nombre, 'png')
    const ruta = resolve(this.dir, archivo)
    await consola.locator('main').screenshot({ path: ruta })
    await consola.close()
    await this.testInfo.attach(`${this.id} ${archivo}`, { path: ruta, contentType: 'image/png' })
  }
}

const escapar = (texto: string): string =>
  texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const formatear = (valor: unknown): string =>
  escapar(typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2))

function htmlConsola(
  id: string,
  titulo: string,
  intercambios: Intercambio[],
  consultas: { titulo: string; consulta: ConsultaDb }[],
): string {
  const bloquesHttp = intercambios
    .map((i) => {
      const color = i.status < 300 ? '#3fb950' : i.status < 500 ? '#f0883e' : '#f85149'
      const headers = Object.entries(i.headers)
        .map(([k, v]) => `${escapar(k)}: ${escapar(v)}`)
        .join('\n')
      return `
      <section>
        <div class="req"><b>${i.metodo}</b> ${escapar(i.url.replace(/^https?:\/\/[^/]+/, ''))}</div>
        <pre class="dim">${headers || '(sin headers de autenticación)'}</pre>
        ${i.cuerpo === undefined ? '' : `<pre>${formatear(i.cuerpo)}</pre>`}
        <div class="res" style="color:${color}">HTTP ${i.status}</div>
        <pre>${formatear(i.respuesta)}</pre>
      </section>`
    })
    .join('')

  const bloquesDb = consultas
    .map(({ titulo: t, consulta }) => {
      const columnas = Object.keys(consulta.filas[0] ?? {})
      const tabla = consulta.filas.length
        ? `<table><tr>${columnas.map((c) => `<th>${escapar(c)}</th>`).join('')}</tr>${consulta.filas
            .map(
              (f) =>
                `<tr>${columnas.map((c) => `<td>${formatear(f[c] instanceof Date ? (f[c] as Date).toISOString() : f[c])}</td>`).join('')}</tr>`,
            )
            .join('')}</table>`
        : '<p class="dim">(0 filas)</p>'
      return `
      <section>
        <div class="req"><b>BD</b> ${escapar(t)}</div>
        <pre class="dim">${escapar(consulta.sql)}${consulta.parametros.length ? `\n-- parámetros: ${escapar(JSON.stringify(consulta.parametros))}` : ''}</pre>
        ${tabla}
      </section>`
    })
    .join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; background: #0d1117; font-family: ui-monospace, Menlo, Consolas, monospace; color: #e6edf3; }
    main { padding: 24px; width: 1150px; }
    h1 { font-size: 18px; margin: 0 0 4px; } .sub { color: #8b949e; font-size: 12px; margin-bottom: 16px; }
    section { border: 1px solid #30363d; border-radius: 8px; padding: 12px 14px; margin-bottom: 12px; background: #161b22; }
    .req { font-size: 14px; color: #79c0ff; } .res { font-size: 15px; font-weight: bold; margin-top: 8px; }
    pre { margin: 6px 0 0; font-size: 12px; white-space: pre-wrap; word-break: break-all; }
    .dim { color: #8b949e; }
    table { border-collapse: collapse; margin-top: 8px; font-size: 12px; }
    th, td { border: 1px solid #30363d; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { color: #8b949e; }
  </style></head><body><main>
    <h1>${escapar(id)} — ${escapar(titulo)}</h1>
    <div class="sub">Ejecutado ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hourCycle: 'h23' })} contra ${escapar(config.apiUrl)}</div>
    ${bloquesHttp}${bloquesDb}
  </main></body></html>`
}

// --- UI ---------------------------------------------------------------------------

export async function iniciarSesion(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.locator('#email').fill(email)
  await page.locator('#password').fill(password)
  await page.locator('form button[type="submit"]').click()
  await expect(page).not.toHaveURL(/\/login/)
}
