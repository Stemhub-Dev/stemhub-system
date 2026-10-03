import { expect, test } from '@playwright/test'
import { esperar, pedir, rutaVersion, type Separacion, type StemListado } from '../support/api'
import { consultar } from '../support/db'
import { cancionConUnaVersion, rutaDetalle } from '../support/escenarios'
import { Evidencia, iniciarSesion } from '../support/evidencia'

// PRU-04 · HU-IA-B01 · Funcional
// Separar el audio de una versión en pistas con el servicio de IA
// (microservicio Python / Spleeter), desde la pantalla de la versión. Los
// stems se reproducen de a uno: iniciar uno detiene el que estaba sonando.
test('PRU-04 separar el audio de una versión en 4 stems', async ({ page }, testInfo) => {
  test.setTimeout(10 * 60_000)
  const ev = new Evidencia('PRU-04', testInfo)

  // Datos de entrada: versión con un archivo .wav válido.
  const c = await cancionConUnaVersion('PRU-04', 60)
  const ruta = rutaVersion(c.proyecto, c.cancion, c.versionInicial)

  // 1. Autenticarse.
  await iniciarSesion(page, c.productor.email, c.productor.password)

  // 2. Ingresar a la versión y seleccionar "Separar instrumentos".
  await page.goto(rutaDetalle(c))
  await expect(page.getByText('Esta versión todavía no tiene stems')).toBeVisible()
  await page.getByRole('button', { name: 'Separar Pistas' }).click()
  const dialogo = page.getByRole('dialog')
  await dialogo.getByText('4 stems').click()
  await expect(dialogo.getByRole('radio', { checked: true })).toHaveValue('4')
  await ev.captura(page, 'dialogo-separar-pistas')

  const solicitud = page.waitForResponse(
    (r) => r.url().endsWith(`${ruta}/stems/separacion`) && r.request().method() === 'POST',
  )
  await dialogo.getByRole('button', { name: 'Separar', exact: true }).click()
  expect((await solicitud).status()).toBe(202)

  // 3. Esperar el procesamiento.
  await expect(page.getByRole('status').filter({ hasText: 'Separando las pistas' })).toBeVisible()
  await ev.captura(page, 'separacion-en-curso')

  const stems = page.locator('section[aria-labelledby="titulo-stems"]')
  await expect(stems.getByRole('heading', { name: 'STEMS DISPONIBLES' })).toBeVisible()
  await expect(stems.locator('li').filter({ hasText: 'IA' })).toHaveCount(4, { timeout: 8 * 60_000 })
  await expect(page.getByText('Listo: agregamos los stems separados con IA.')).toBeVisible()
  await ev.captura(page, 'stems-generados')

  // Resultado: 4 stems (batería, bajo, otros, voz) asociados a la versión de origen.
  const separacion = await pedir<Separacion>('GET', `${ruta}/stems/separacion`, { token: c.productor.token })
  expect(esperar(separacion, 200).estado).toBe('COMPLETADA')
  const listado = await pedir<StemListado[]>('GET', `${ruta}/stems`, { token: c.productor.token })
  const generados = esperar(listado, 200)
  expect(generados).toHaveLength(4)
  expect(generados.every((s) => s.generadoConIA)).toBe(true)
  expect(generados.map((s) => s.nombreCategoria).sort()).toEqual(['Bajo', 'Batería', 'Otros', 'Voz'])

  const bd = await consultar(
    `SELECT s.codstem, s.nombrestem, cs.nombrecategoriastem AS categoria, s.generadoconia, s.codigocancionversion
       FROM stem s JOIN categoriastem cs ON cs.codcategoriastem = s.codcategoriastem
      WHERE s.codigocancionversion = $1 ORDER BY s.codstem`,
    [c.versionInicial],
  )
  await ev.capturaHttp(page, 'api-separacion-y-stems', 'Estado de la separación y stems generados', [separacion, listado], [
    { titulo: 'Stems asociados a la versión de origen', consulta: bd },
  ])

  // Cada stem se reproduce individualmente...
  const [primero, segundo] = [generados[0]!, generados[1]!]
  await stems.getByRole('button', { name: `Reproducir ${primero.nombre}` }).click()
  await expect(stems.getByRole('button', { name: `Pausar ${primero.nombre}` })).toBeVisible()
  await expect(stems.getByText('Reproduciendo')).toHaveCount(1)
  await ev.captura(page, 'primer-stem-reproduciendo')

  // ...y no simultáneamente: al iniciar otro, el anterior se detiene.
  await stems.getByRole('button', { name: `Reproducir ${segundo.nombre}` }).click()
  await expect(stems.getByRole('button', { name: `Pausar ${segundo.nombre}` })).toBeVisible()
  await expect(stems.getByRole('button', { name: `Reproducir ${primero.nombre}` })).toBeVisible()
  await expect(stems.getByText('Reproduciendo')).toHaveCount(1)
  await ev.captura(page, 'segundo-stem-reproduciendo-primero-detenido')
})
