import { expect, test } from '@playwright/test'
import { crearUsuario, formVersion, pedir, ROL_MUSICO, sumarAlProyecto } from '../support/api'
import { wavDePrueba } from '../support/audio'
import { consultar } from '../support/db'
import { cancionConUnaVersion } from '../support/escenarios'
import { Evidencia } from '../support/evidencia'

// PRU-08 · HU-SEG-B01 · Seguridad
// Un integrante con rol Músico (sin GESTIONAR_VERSIONES) no puede crear una
// versión: 403 y ninguna fila nueva en cancionversion (la tabla "versions"
// del plan).
test('PRU-08 un Músico no puede crear una versión', async ({ page }, testInfo) => {
  const ev = new Evidencia('PRU-08', testInfo)

  const c = await cancionConUnaVersion('PRU-08', 10)
  const musico = await crearUsuario('Musico')
  await sumarAlProyecto(c.productor, musico, c.proyecto, ROL_MUSICO)
  const ruta = `/proyectos/${c.proyecto}/canciones/${c.cancion}/versiones`

  const rol = await consultar(
    `SELECT i.nombreintegrante, r.nombrerol
       FROM integranteproyecto ip
       JOIN integrante i ON i.codintegrante = ip.codintegrante
       JOIN rol r ON r.codrol = ip.codrol
      WHERE ip.codigoproyecto = $1 AND ip.codintegrante = $2`,
    [c.proyecto, musico.codigoIntegrante],
  )
  expect(rol.filas[0]?.nombrerol).toBe('Músico (Artista)')
  const contar = () =>
    consultar(`SELECT count(*)::int AS versiones FROM cancionversion WHERE codigocancion = $1`, [c.cancion])
  const antes = await contar()

  // 1. Autenticado como Músico. 2. Enviar el POST: con el body del plan...
  const conBodyDelPlan = await pedir('POST', ruta, {
    token: musico.token,
    json: { track_id: 'abc123', file_url: 'x.wav' },
  })
  // ...y con un cuerpo válido (archivo .wav real), para descartar que el
  // rechazo venga de la validación del cuerpo y no del rol.
  const conArchivo = await pedir('POST', ruta, {
    token: musico.token,
    form: formVersion(wavDePrueba(10), 'Versión subida por un Músico'),
  })

  // 3. La respuesta indica que la operación no es válida para su rol.
  expect(conBodyDelPlan.status).toBe(403)
  expect(conArchivo.status).toBe(403)

  // 4. Consultar la tabla de versiones: sin registros nuevos.
  const despues = await contar()
  expect(despues.filas).toEqual(antes.filas)

  await ev.capturaHttp(page, 'musico-crea-version', 'POST de versión con token de Músico', [conBodyDelPlan, conArchivo], [
    { titulo: 'Rol del usuario en el proyecto', consulta: rol },
    { titulo: 'cancionversion ANTES', consulta: antes },
    { titulo: 'cancionversion DESPUÉS', consulta: despues },
  ])
})
