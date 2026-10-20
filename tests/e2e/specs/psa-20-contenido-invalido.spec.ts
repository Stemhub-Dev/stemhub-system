import { expect, test } from '@playwright/test'
import { crearUsuario, ROL_MUSICO, sumarAlProyecto } from '../support/api'
import { AUDIOS, audioPrueba } from '../support/audio'
import { consultar } from '../support/db'
import { Evidencia, iniciarSesion } from '../support/evidencia'
import { abrirDetalle, contextoDeSubida, sello, subirCancion, type Contexto } from '../support/subida'

// PSA-20 a PSA-22 · Qué acepta el POST de canción además de audio válido.
// Solo local: no deja archivos basura en prod.

let ctx: Contexto

test.beforeAll(async () => {
  ctx = await contextoDeSubida('PSA-20')
})

// El backend solo valida la extensión. Aceptable: lo rechaza (400) o lo
// acepta y el navegador lo reproduce. Defecto: lo acepta y el Detalle
// muestra el mismo síntoma que prod (error o onda colgada).
for (const audio of AUDIOS.filter((a) => a.contenidoInvalido)) {
  test(`PSA-20 ${audio.id}`, async ({ page }, testInfo) => {
    test.setTimeout(180_000)
    const ev = new Evidencia(`PSA-20-${audio.id}`, testInfo)
    const subida = await subirCancion(ctx, `PSA-20 ${audio.id} ${sello()}`, audio.id)
    await ev.capturaHttp(page, 'subida', `Subida de ${audio.archivo}: ${audio.descripcion}`, [subida.intercambio])
    expect([201, 400]).toContain(subida.intercambio.status)
    if (subida.intercambio.status === 400) {
      return
    }

    await iniciarSesion(page, ctx.usuario.email, ctx.usuario.password)
    const reproductor = await abrirDetalle(
      page, `/proyectos/${ctx.proyecto}/canciones/${subida.intercambio.respuesta.codigoCancion}`, 60_000,
    )
    await ev.captura(page, `detalle-${reproductor.estado}`)
    await ev.json('reproductor', reproductor)
    expect(
      reproductor.estado,
      'el backend aceptó un archivo que el navegador no puede reproducir (debería responder 400)',
    ).toBe('listo')
  })
}

test('PSA-21 nombres de archivo y extensiones', async ({ page }, testInfo) => {
  const ev = new Evidencia('PSA-21', testInfo)
  const intercambios = []
  const consultas = []

  const raro = await subirCancion(ctx, `PSA-21 nombre raro ${sello()}`, 'S-NOMBRE-RARO')
  intercambios.push(raro.intercambio)
  expect(raro.intercambio.status).toBe(201)
  const fila = await consultar(
    'SELECT urlarchivocancionver, formatoarchivocancionver FROM cancionversion WHERE codigocancionversion = $1',
    [raro.intercambio.respuesta.codigoCancionVersion],
  )
  consultas.push({ titulo: audioPrueba('S-NOMBRE-RARO').archivo, consulta: fila })
  expect(fila.filas[0]).toMatchObject({
    urlarchivocancionver: `proyectos/${ctx.proyecto}/canciones/${raro.intercambio.respuesta.codigoCancion}/v1.mp3`,
    formatoarchivocancionver: 'mp3',
  })

  for (const id of ['S-SIN-EXTENSION', 'S-TXT']) {
    const rechazo = await subirCancion(ctx, `PSA-21 ${id} ${sello()}`, id)
    intercambios.push(rechazo.intercambio)
    expect(rechazo.intercambio.status).toBe(400)
    expect(rechazo.intercambio.respuesta).toEqual({ error: 'El formato del archivo debe ser MP3, WAV o FLAC' })
  }
  await ev.capturaHttp(page, 'nombres', 'Nombres de archivo y extensiones', intercambios, consultas)
})

test('PSA-22 validaciones del alta de canción', async ({ page }, testInfo) => {
  const ev = new Evidencia('PSA-22', testInfo)
  const nombre = `PSA-22 ${sello()}`

  const sinNombre = await subirCancion(ctx, '   ', 'S-WAV-1S')
  const sinArchivo = await subirCancion(ctx, `${nombre} sin archivo`, null)
  const primera = await subirCancion(ctx, nombre, 'S-WAV-1S')
  const duplicada = await subirCancion(ctx, nombre, 'S-WAV-1S')

  const musico = await crearUsuario('Musico')
  await sumarAlProyecto(ctx.usuario, musico, ctx.proyecto, ROL_MUSICO)
  const sinPermiso = await subirCancion({ usuario: musico, proyecto: ctx.proyecto }, `${nombre} músico`, 'S-WAV-1S')

  const todos = [sinNombre, sinArchivo, primera, duplicada, sinPermiso].map((s) => s.intercambio)
  await ev.capturaHttp(page, 'validaciones', 'Validaciones del alta de canción', todos)

  expect(sinNombre.intercambio.status).toBe(400)
  expect(sinArchivo.intercambio.status).toBe(400)
  expect(primera.intercambio.status).toBe(201)
  expect(duplicada.intercambio.status).toBe(409)
  expect(sinPermiso.intercambio.status).toBe(403)
})
