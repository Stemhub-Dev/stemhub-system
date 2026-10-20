import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { rutaVersion } from '../support/api'
import { infoAudio, prepararAudio } from '../support/audio'
import { consultar } from '../support/db'
import { config } from '../support/env'
import { Evidencia } from '../support/evidencia'
import { contextoDeSubida, sello, sondearAudio, subirCancion, subirVersion } from '../support/subida'

// PSA-40 y PSA-41 · Concurrencia y falla de MinIO. Solo local.

test('PSA-40 dos versiones subidas a la vez', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  const ev = new Evidencia('PSA-40', testInfo)
  const ctx = await contextoDeSubida('PSA-40')
  const inicial = await subirCancion(ctx, `PSA-40 ${sello()}`, 'R-MP3-CORTO')
  expect(inicial.intercambio.status).toBe(201)
  const cancion = inicial.intercambio.respuesta.codigoCancion

  const ids = ['R-WAV-MEDIO', 'R-FLAC-MEDIO']
  const versiones = await Promise.all(ids.map((id) => subirVersion(ctx, cancion, id, `PSA-40 ${id}`)))
  const filas = await consultar(
    `SELECT codigocancionversion, numeroversion, urlarchivocancionver
       FROM cancionversion WHERE codigocancion = $1 ORDER BY numeroversion`,
    [cancion],
  )
  await ev.capturaHttp(page, 'concurrentes', 'Dos POST de versión en paralelo', versiones.map((v) => v.intercambio), [
    { titulo: 'versiones de la canción', consulta: filas },
  ])

  for (const v of versiones) {
    expect(v.intercambio.status, JSON.stringify(v.intercambio.respuesta)).toBe(201)
  }
  expect(versiones.map((v) => v.intercambio.respuesta.numeroVersion).sort()).toEqual([2, 3])
  for (const [i, v] of versiones.entries()) {
    const sondeo = await sondearAudio(ctx.usuario.token, rutaVersion(ctx.proyecto, cancion, v.intercambio.respuesta.codigoCancionVersion))
    expect(sondeo.sha256, `contenido de ${ids[i]}`).toBe(infoAudio(await prepararAudio(ids[i]!)).sha256)
  }
})

test('PSA-41 MinIO caído: 500 y sin canción huérfana', async ({ page }, testInfo) => {
  test.skip(!config.detenerMinio, 'Solo con E2E_DETENER_MINIO=1 (detiene el contenedor stemhub-minio)')
  test.setTimeout(300_000)
  const ev = new Evidencia('PSA-41', testInfo)
  const ctx = await contextoDeSubida('PSA-41')
  const nombre = `PSA-41 ${sello()}`

  execFileSync('docker', ['stop', 'stemhub-minio'])
  let subida
  try {
    subida = await subirCancion(ctx, nombre, 'R-MP3-CORTO')
  } finally {
    execFileSync('docker', ['start', 'stemhub-minio'])
    // Espera a que vuelva a responder para no romper las pruebas siguientes.
    for (let i = 0; i < 30; i++) {
      const vivo = await fetch('http://localhost:9000/minio/health/live').then((r) => r.ok).catch(() => false)
      if (vivo) {
        break
      }
      await new Promise((r) => setTimeout(r, 2_000))
    }
  }

  const filas = await consultar(
    'SELECT count(*)::int AS canciones FROM cancion WHERE codigoproyecto = $1 AND nombrecancion = $2',
    [ctx.proyecto, nombre],
  )
  await ev.capturaHttp(page, 'minio-caido', 'Alta de canción con MinIO detenido', [subida.intercambio], [
    { titulo: 'canciones con ese nombre', consulta: filas },
  ])
  expect(subida.intercambio.status).toBe(500)
  expect(subida.intercambio.respuesta).toEqual({ error: 'Error al almacenar el archivo de audio' })
  expect(filas.filas[0]?.canciones).toBe(0)
})
