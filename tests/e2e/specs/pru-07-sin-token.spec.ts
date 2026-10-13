import { expect, test } from '@playwright/test'
import { formVersion, pedir } from '../support/api'
import { wavDePrueba } from '../support/audio'
import { consultar } from '../support/db'
import { cancionConUnaVersion } from '../support/escenarios'
import { Evidencia } from '../support/evidencia'

// PRU-07 · HU-SEG-B01 · Seguridad
// Una request sin token a un endpoint protegido se rechaza con 401 y no
// ejecuta el handler. El "POST /api/versions" del plan corresponde en la API
// real a POST /proyectos/{id}/canciones/{id}/versiones.
test('PRU-07 rechazo de request sin token a endpoint protegido', async ({ page }, testInfo) => {
  const ev = new Evidencia('PRU-07', testInfo)

  // 1. Autenticarse (el usuario tiene token y una canción donde podría crear versiones).
  const c = await cancionConUnaVersion('PRU-07', 10)
  const ruta = `/proyectos/${c.proyecto}/canciones/${c.cancion}/versiones`
  const contar = () =>
    consultar(
      `SELECT count(*)::int AS versiones, max(numeroversion) AS ultima_version
         FROM cancionversion WHERE codigocancion = $1`,
      [c.cancion],
    )
  const antes = await contar()

  // 2. Remover el token del header. 3. Enviar el POST con un cuerpo válido.
  const sinHeader = await pedir('POST', ruta, { token: null, form: formVersion(wavDePrueba(10), 'Intento sin token') })
  // Variante: header presente pero con un token que no es un JWT válido.
  const tokenInvalido = await fetch(`http://localhost:8080${ruta}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-invalido' },
    body: formVersion(wavDePrueba(10)),
  })
  const invalido = {
    metodo: 'POST',
    url: ruta,
    headers: { Authorization: 'Bearer token-invalido' },
    cuerpo: '(multipart con archivo .wav)',
    status: tokenInvalido.status,
    respuesta: await tokenInvalido.json(),
  }

  const despues = await contar()

  // 4. Código de respuesta y body.
  expect(sinHeader.status).toBe(401)
  expect(sinHeader.respuesta).toEqual({ error: 'token de autenticación requerido' })
  expect(invalido.status).toBe(401)
  // El handler no se ejecutó: no hay versiones nuevas.
  expect(despues.filas).toEqual(antes.filas)

  await ev.capturaHttp(page, 'request-sin-token', 'POST de versión sin Authorization', [sinHeader, invalido], [
    { titulo: 'Versiones de la canción ANTES del POST', consulta: antes },
    { titulo: 'Versiones de la canción DESPUÉS del POST', consulta: despues },
  ])
})
