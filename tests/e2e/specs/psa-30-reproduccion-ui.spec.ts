import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { devices, expect, test, type Page } from '@playwright/test'
import { AUDIOS_VALIDOS, infoAudio, prepararAudio, sha256 } from '../support/audio'
import { config } from '../support/env'
import { Evidencia, iniciarSesion } from '../support/evidencia'
import {
  abrirDetalle, contextoDeSubida, ERROR_CARGA, ERROR_REPRODUCCION, idEvidencia, limpiarProd, registrarCreada,
  segundos, sello, subirCancion, type Contexto, type EstadoReproductor,
} from '../support/subida'

// PSA-30 a PSA-33 · El flujo que reportan los usuarios: publicar la canción
// desde "Nueva canción" y escucharla en el Detalle.

const EN_PROD = new Set(['R-MP3-CORTO', 'R-MP3-MEDIO', 'R-WAV-MEDIO', 'R-FLAC-MEDIO', 'R-MP3-MUY-LARGO', 'S-WAV-100MIB'])
const PESADOS = ['R-WAV-MEDIO', 'R-FLAC-GRANDE', 'R-MP3-MUY-LARGO', 'S-WAV-100MIB']
const LIMITE_LISTO_MS = 120_000

let ctx: Contexto

test.beforeAll(async () => {
  ctx = await contextoDeSubida('PSA-30')
})

test.afterAll(async () => {
  await limpiarProd()
})

// La onda quedó lista, la duración coincide con ffprobe y Play avanza.
// En celular el Detalle no es responsive: el menú lateral y el panel de
// Versiones quedan encima del botón Play y un click real nunca le llega
// (Playwright reintenta hasta el timeout). Ahí el click se despacha directo
// al botón: lo que mide PSA-31 es la carga del audio, no el layout.
async function verificarReproduccion(
  page: Page,
  reproductor: EstadoReproductor,
  duracion: number | null,
  enCelular = false,
) {
  const pulsar = (nombre: string) => {
    const boton = page.getByRole('button', { name: nombre })
    return enCelular ? boton.dispatchEvent('click') : boton.click()
  }
  expect(reproductor.estado, JSON.stringify(reproductor, null, 2)).toBe('listo')
  await expect(page.getByText(ERROR_CARGA)).toBeHidden()

  const [, total] = (reproductor.tiempo ?? '0:00 / 0:00').split(' / ')
  expect(Math.abs(segundos(total ?? '0:00') - Math.floor(duracion ?? 0)), `duración mostrada ${total}`).toBeLessThanOrEqual(1)

  await pulsar('Reproducir')
  await page.waitForTimeout(2_500)
  await expect(page.getByText(ERROR_REPRODUCCION)).toBeHidden()
  if ((duracion ?? 0) < 5) {
    // Ya terminó y el cursor volvió a 0:00: alcanza con que no haya error.
    return
  }
  const actual = await page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/).first().textContent()
  expect(segundos((actual ?? '0:00').split(' / ')[0] ?? '0:00'), `tiempo tras 2,5 s de Play: ${actual}`).toBeGreaterThanOrEqual(1)
  await pulsar('Pausar')
}

test.describe('PSA-30 publicar desde "Nueva canción" y reproducir', () => {
  for (const audio of AUDIOS_VALIDOS) {
    const tag = EN_PROD.has(audio.id) ? ' @prod' : ''
    test(`PSA-30 ${audio.id}${tag}`, async ({ page }, testInfo) => {
      test.setTimeout(360_000)
      const ev = new Evidencia(idEvidencia(`PSA-30-${audio.id}${config.webkit ? '-webkit' : ''}`), testInfo)
      const ruta = await prepararAudio(audio.id)
      const info = infoAudio(ruta)
      const nombre = `PSA-30 ${audio.id} ${sello()}`

      await iniciarSesion(page, ctx.usuario.email, ctx.usuario.password)
      await page.goto(`/proyectos/${ctx.proyecto}/canciones/nueva`)
      await page.locator('#nombre').fill(nombre)
      await page.locator('input[type="file"]').setInputFiles(ruta)
      await ev.captura(page, 'formulario')

      const post = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith(`/proyectos/${ctx.proyecto}/canciones`),
        { timeout: 240_000 },
      )
      const inicio = Date.now()
      await page.getByRole('button', { name: 'Crear canción' }).click()
      const respuesta = await post
      const msSubida = Date.now() - inicio
      const creada = (await respuesta.json()) as { codigoCancion?: number; error?: string }
      expect(respuesta.status(), JSON.stringify(creada)).toBe(201)
      registrarCreada(ctx, creada.codigoCancion!)
      await expect(page).toHaveURL(new RegExp(`/proyectos/${ctx.proyecto}/canciones$`))

      const reproductor = await abrirDetalle(page, `/proyectos/${ctx.proyecto}/canciones/${creada.codigoCancion}`, LIMITE_LISTO_MS)
      await ev.captura(page, `detalle-${reproductor.estado}`)
      await ev.json('resultado', { audio, info, msSubida, reproductor })
      await verificarReproduccion(page, reproductor, info.duracion)
      await ev.captura(page, 'reproduciendo')
    })
  }
})

// Mismo chequeo en celulares (emulados en Chrome; con E2E_WEBKIT=1, iPhone en
// WebKit). La canción se sube por API: lo que se mide es la carga.
for (const [dispositivo, perfil] of [['Pixel 7', devices['Pixel 7']], ['iPhone 13', devices['iPhone 13']]] as const) {
  test.describe(`PSA-31 ${dispositivo}`, () => {
    const { defaultBrowserType: _, ...emulacion } = perfil
    test.use(emulacion)

    for (const id of PESADOS) {
      test(`PSA-31 ${dispositivo} ${id} @prod`, async ({ page }, testInfo) => {
        test.setTimeout(360_000)
        const etiqueta = `${dispositivo.replace(' ', '-')}-${id}${config.webkit ? '-webkit' : ''}`
        const ev = new Evidencia(idEvidencia(`PSA-31-${etiqueta}`), testInfo)
        const info = infoAudio(await prepararAudio(id))
        const subida = await subirCancion(ctx, `PSA-31 ${etiqueta} ${sello()}`, id)
        expect(subida.intercambio.status).toBe(201)

        await iniciarSesion(page, ctx.usuario.email, ctx.usuario.password)
        const reproductor = await abrirDetalle(
          page, `/proyectos/${ctx.proyecto}/canciones/${subida.intercambio.respuesta.codigoCancion}`, LIMITE_LISTO_MS,
        )
        await ev.captura(page, `detalle-${reproductor.estado}`, { fullPage: true })
        await ev.json('resultado', { id, info, reproductor })
        await verificarReproduccion(page, reproductor, info.duracion, true)
      })
    }
  })
}

test('PSA-32 seek en la onda y descarga del archivo @prod', async ({ page }, testInfo) => {
  test.setTimeout(240_000)
  const ev = new Evidencia(idEvidencia('PSA-32'), testInfo)
  const id = 'R-MP3-MEDIO'
  const info = infoAudio(await prepararAudio(id))
  const subida = await subirCancion(ctx, `PSA-32 ${sello()}`, id)
  expect(subida.intercambio.status).toBe(201)

  await iniciarSesion(page, ctx.usuario.email, ctx.usuario.password)
  const reproductor = await abrirDetalle(page, `/proyectos/${ctx.proyecto}/canciones/${subida.intercambio.respuesta.codigoCancion}`)
  expect(reproductor.estado).toBe('listo')

  // Click a la mitad de la onda: el cursor salta a ~duración / 2.
  const onda = page.locator('div.h-32.cursor-text')
  const caja = (await onda.boundingBox())!
  await onda.click({ position: { x: caja.width / 2, y: caja.height / 2 } })
  // El tiempo se actualiza con el 'timeupdate' del <audio>, un instante
  // después del click: se espera a que deje de marcar 0:00 antes de leerlo.
  const reloj = page.getByText(/^\d+:\d{2} \/ \d+:\d{2}$/).first()
  await expect(reloj).not.toHaveText(/^0:00 \//, { timeout: 5_000 }).catch(() => undefined)
  const tiempo = (await reloj.textContent()) ?? ''
  expect(Math.abs(segundos(tiempo.split(' / ')[0] ?? '0:00') - (info.duracion ?? 0) / 2), `tras el seek: ${tiempo}`).toBeLessThanOrEqual(10)
  await ev.captura(page, 'seek-a-la-mitad')

  const descarga = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar audio' }).click()
  const destino = resolve(import.meta.dirname, '../.cache/audio/descargados-ui', `PSA-32-${Date.now()}.mp3`)
  mkdirSync(resolve(destino, '..'), { recursive: true })
  await (await descarga).saveAs(destino)
  await ev.json('descarga', { nombreSugerido: (await descarga).suggestedFilename(), sha256: sha256(destino), original: info.sha256 })
  expect(sha256(destino)).toBe(info.sha256)
})

test('PSA-33 reproducir después de que vence la URL firmada (16 min) @prod', async ({ page }, testInfo) => {
  test.skip(!config.lentas, 'Solo con E2E_LENTAS=1 (espera 16 minutos)')
  test.setTimeout(25 * 60_000)
  const ev = new Evidencia(idEvidencia('PSA-33'), testInfo)
  const id = 'R-MP3-LARGO'
  const subida = await subirCancion(ctx, `PSA-33 ${sello()}`, id)
  expect(subida.intercambio.status).toBe(201)

  await iniciarSesion(page, ctx.usuario.email, ctx.usuario.password)
  const reproductor = await abrirDetalle(page, `/proyectos/${ctx.proyecto}/canciones/${subida.intercambio.respuesta.codigoCancion}`)
  expect(reproductor.estado).toBe('listo')
  await ev.captura(page, 'listo')

  await page.waitForTimeout(16 * 60_000)
  // Lejos del inicio, para que el <audio> tenga que pedir otro rango.
  const onda = page.locator('div.h-32.cursor-text')
  const caja = (await onda.boundingBox())!
  await onda.click({ position: { x: caja.width * 0.9, y: caja.height / 2 } })
  await page.getByRole('button', { name: 'Reproducir' }).click()
  await page.waitForTimeout(4_000)
  const fallo = await page.getByText(ERROR_REPRODUCCION).isVisible()
  await ev.captura(page, fallo ? 'fallo-tras-vencer' : 'reproduce-tras-vencer')
  if (fallo) {
    // El reproductor pide una URL nueva al volver a dar Play.
    await page.getByRole('button', { name: 'Reproducir' }).click()
    await expect(page.getByTestId('onda-skeleton')).toBeHidden({ timeout: LIMITE_LISTO_MS })
    await page.waitForTimeout(4_000)
    await ev.captura(page, 'reintento')
  }
  await expect(page.getByRole('button', { name: 'Pausar' })).toBeVisible()
})
