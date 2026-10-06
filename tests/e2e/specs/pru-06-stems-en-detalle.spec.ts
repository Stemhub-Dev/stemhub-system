import { expect, test } from '@playwright/test'
import { esperar, esperarSeparacion, pedir, rutaVersion, type StemListado } from '../support/api'
import { consultar } from '../support/db'
import { cancionConUnaVersion, rutaDetalle } from '../support/escenarios'
import { Evidencia, iniciarSesion } from '../support/evidencia'

// PRU-06 · HU-IA-B01 + HU-BUQ-B03 · Integración
// Al terminar la separación, los stems generados quedan disponibles en el
// listado/filtrado de stems de esa versión (backend Go + microservicio IA +
// MinIO + frontend).
test('PRU-06 los stems separados quedan disponibles en el detalle de la canción', async ({ page }, testInfo) => {
  test.setTimeout(12 * 60_000)
  const ev = new Evidencia('PRU-06', testInfo)

  // Datos de entrada: versión con un .wav válido de ~3 minutos.
  const c = await cancionConUnaVersion('PRU-06', 180)
  const ruta = rutaVersion(c.proyecto, c.cancion, c.versionInicial)

  // 1. Autenticarse.
  await iniciarSesion(page, c.productor.email, c.productor.password)

  // 2. Ingresar a la versión y seleccionar "Separar instrumentos".
  await page.goto(rutaDetalle(c))
  await expect(page.getByText(/0:00 \/ 3:00/)).toBeVisible()
  await page.getByRole('button', { name: 'Separar Pistas' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Separar', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Separando las pistas' })).toBeVisible()

  // 3. Esperar el procesamiento (consultando el estado como lo hace el front).
  // Se sale de la pantalla para comprobar que no depende de quedarse en ella.
  await page.goto(`/proyectos/${c.proyecto}/canciones`)
  const separacion = await esperarSeparacion(c.productor, ruta, 10 * 60_000)
  expect(separacion.estado, separacion.mensajeError ?? '').toBe('COMPLETADA')

  // 4. El usuario vuelve a la versión en el detalle de canción.
  await page.goto(rutaDetalle(c))
  const stems = page.locator('section[aria-labelledby="titulo-stems"]')
  const filas = stems.locator('li')
  await expect(filas).toHaveCount(4)
  await ev.captura(page, 'listado-stems-separados')

  // El listado coincide con el endpoint de stems de la versión.
  const listado = await pedir<StemListado[]>('GET', `${ruta}/stems`, { token: c.productor.token })
  const generados = esperar(listado, 200)
  expect(generados).toHaveLength(4)
  for (const stem of generados) {
    await expect(filas.filter({ hasText: stem.nombre })).toHaveCount(1)
  }

  // Búsqueda/filtrado de stems de la versión por categoría (HU-BUQ-B03).
  const filtros = stems.getByRole('group', { name: 'Filtrar por categoría' })
  await expect(filtros.getByRole('button', { name: /Todos\s*4/ })).toHaveAttribute('aria-pressed', 'true')
  const voz = generados.find((s) => s.nombreCategoria === 'Voz')!
  await filtros.getByRole('button', { name: /^Voz/ }).click()
  await expect(filas).toHaveCount(1)
  await expect(filas.first()).toContainText(voz.nombre)
  await ev.captura(page, 'filtro-categoria-voz')
  await filtros.getByRole('button', { name: /^Todos/ }).click()
  await expect(filas).toHaveCount(4)

  const bd = await consultar(
    `SELECT codseparacionstem, cantidadstems, estadoseparacion, tiempoprocesamientoms
       FROM separacionstem WHERE codigocancionversion = $1`,
    [c.versionInicial],
  )
  await ev.capturaHttp(page, 'api-stems-version', 'Stems de la versión tras la separación', [listado], [
    { titulo: 'Separación registrada', consulta: bd },
  ])
})
