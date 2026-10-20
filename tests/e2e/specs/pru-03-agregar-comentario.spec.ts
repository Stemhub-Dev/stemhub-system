import { expect, test } from '@playwright/test'
import { esperar, pedir, rutaVersion, type ComentarioListado } from '../support/api'
import { consultar } from '../support/db'
import { cancionConUnaVersion, rutaDetalle } from '../support/escenarios'
import { Evidencia, iniciarSesion } from '../support/evidencia'

// PRU-03 · HU-COM-B02 · Funcional
// Agregar un comentario a una versión anclado a un timestamp de audio.
test('PRU-03 agregar comentario con timestamp de audio 00:01:23', async ({ page }, testInfo) => {
  const ev = new Evidencia('PRU-03', testInfo)

  // Datos de entrada: versión existente con un audio de exactamente 100 s,
  // así el segundo 83 queda en el 83 % del ancho de la forma de onda.
  const DURACION = 100
  const SEGUNDO = 83
  const TEXTO = 'El bajo no se escucha en este fragmento'
  const c = await cancionConUnaVersion('PRU-03', DURACION)
  const ruta = rutaVersion(c.proyecto, c.cancion, c.versionInicial)

  // 1. Autenticarse.
  await iniciarSesion(page, c.productor.email, c.productor.password)

  // 2. Abrir la versión y posicionar el reproductor en el segundo 83.
  await page.goto(rutaDetalle(c))
  await expect(page.getByText(/0:00 \/ 1:40/)).toBeVisible()
  // wavesurfer dibuja dentro de un shadow root montado en el contenedor.
  const onda = page.locator('div.cursor-text > div').first()
  const caja = (await onda.boundingBox())!
  // Se apunta al medio del segundo 83 (83,4 s): un píxel equivale a ~0,17 s
  // y apuntar al borde exacto puede caer en 82,9 s.
  await onda.click({ position: { x: (caja.width * (SEGUNDO + 0.4)) / DURACION, y: caja.height / 2 } })

  await expect(page.getByText(/1:23 \/ 1:40/)).toBeVisible()
  const panel = page.locator('aside').filter({ hasText: 'COMENTARIOS' })
  // Chip del rango pendiente junto al campo de texto.
  const chipRango = panel.getByRole('button', { name: 'Quitar rango seleccionado' }).locator('..')
  await expect(chipRango).toContainText('1:23')

  // 3. Escribir el comentario y confirmar el envío.
  await panel.getByPlaceholder('Escribí un comentario').fill(TEXTO)
  await ev.captura(page, 'comentario-listo-para-enviar')
  const creado = page.waitForResponse(
    (r) => r.url().endsWith(`${ruta}/comentarios`) && r.request().method() === 'POST',
  )
  await panel.getByRole('button', { name: 'Enviar comentario' }).click()
  const respuestaPost = await creado
  expect(respuestaPost.status()).toBe(201)
  const { codigoComentario } = (await respuestaPost.json()) as { codigoComentario: number }

  // Aparece de inmediato en el listado, con su marca de tiempo...
  await expect(panel.getByText(TEXTO)).toBeVisible()
  await expect(panel.getByRole('button', { name: /1:23/ })).toBeVisible()

  // ...y con su marcador en el segundo 83 de la forma de onda (83 % del ancho).
  const marcador = page.locator(`[part~="comentario-${codigoComentario}"]`)
  await expect(marcador).toBeAttached()
  const izquierda = await marcador.evaluate((el) => parseFloat((el as HTMLElement).style.left))
  expect(Math.floor((izquierda / 100) * DURACION)).toBe(SEGUNDO)
  await ev.captura(page, 'comentario-publicado-con-marcador')

  // Persistencia: asociado a la versión y al timestamp indicado.
  const listado = await pedir<ComentarioListado[]>('GET', `${ruta}/comentarios`, {
    token: c.productor.token,
  })
  const guardado = esperar(listado, 200).find((x) => x.codigoComentario === codigoComentario)
  expect(guardado?.texto).toBe(TEXTO)
  expect(Math.floor(guardado!.tiempoInicioSegundos!)).toBe(SEGUNDO)

  const bd = await consultar(
    `SELECT codigocomentario, codigocancionversion, descripcioncomentario,
            tiempoiniciosegundos, tiempofinsegundos, fechahoraaltacomentario
       FROM comentario WHERE codigocomentario = $1`,
    [codigoComentario],
  )
  expect(Number(bd.filas[0]?.codigocancionversion)).toBe(c.versionInicial)
  await ev.capturaHttp(page, 'persistencia', 'Comentario persistido con timestamp', [listado], [
    { titulo: 'Fila del comentario en la BD', consulta: bd },
  ])
})
