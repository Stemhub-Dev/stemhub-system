import { expect, test } from '@playwright/test'
import { crearComentario, crearUsuario, pedir, ROL_MUSICO, rutaVersion, sumarAlProyecto } from '../support/api'
import { consultar } from '../support/db'
import { cancionConUnaVersion, rutaDetalle } from '../support/escenarios'
import { Evidencia, iniciarSesion } from '../support/evidencia'

// PRU-09 · HU-COM-B04 · Seguridad
// Un Músico no puede eliminar el comentario de otro Músico. El
// "DELETE /api/comments/{id}" del plan corresponde en la API real a
// DELETE /proyectos/{p}/canciones/{c}/versiones/{v}/comentarios/{id}.
test('PRU-09 un músico no puede eliminar un comentario ajeno', async ({ page }, testInfo) => {
  const ev = new Evidencia('PRU-09', testInfo)

  const c = await cancionConUnaVersion('PRU-09', 10)
  const musicoA = await crearUsuario('MusicoA')
  const musicoB = await crearUsuario('MusicoB')
  await sumarAlProyecto(c.productor, musicoA, c.proyecto, ROL_MUSICO)
  await sumarAlProyecto(c.productor, musicoB, c.proyecto, ROL_MUSICO)
  const ruta = rutaVersion(c.proyecto, c.cancion, c.versionInicial)

  // 1. Crear el comentario con el Usuario A.
  const TEXTO = 'Comentario del músico A: la guitarra está desafinada'
  const codigo = await crearComentario(musicoA, ruta, TEXTO, 4)
  const leer = () =>
    consultar(
      `SELECT c.codigocomentario, i.nombreintegrante AS autor, c.descripcioncomentario,
              c.fechahorabajacomentario
         FROM comentario c JOIN integrante i ON i.codintegrante = c.codintegrante
        WHERE c.codigocomentario = $1`,
      [codigo],
    )
  const antes = await leer()

  // 2. Autenticarse como Usuario B. 3. DELETE con el token de B.
  const borrado = await pedir('DELETE', `${ruta}/comentarios/${codigo}`, { token: musicoB.token })

  // 4. Código de respuesta.
  expect(borrado.status).toBe(403)
  expect(borrado.respuesta).toEqual({ error: expect.stringMatching(/permis/i) })

  // 5. El comentario sigue en la BD sin cambios.
  const despues = await leer()
  expect(despues.filas).toEqual(antes.filas)
  expect(despues.filas[0]?.fechahorabajacomentario).toBeNull()

  await ev.capturaHttp(page, 'delete-comentario-ajeno', 'DELETE del comentario de A con el token de B', [borrado], [
    { titulo: 'Comentario ANTES del DELETE', consulta: antes },
    { titulo: 'Comentario DESPUÉS del DELETE', consulta: despues },
  ])

  // En la UI, B no ve la opción de eliminar en el comentario de A.
  await iniciarSesion(page, musicoB.email, musicoB.password)
  await page.goto(rutaDetalle(c))
  const panel = page.locator('aside').filter({ hasText: 'COMENTARIOS' })
  await expect(panel.getByText(TEXTO)).toBeVisible()
  await expect.soft(panel.getByRole('button', { name: 'Eliminar comentario' })).toHaveCount(0)
  await ev.captura(page, 'vista-musico-b')
})
