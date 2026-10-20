import { resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { esperar, pedir, rutaVersion, type VersionListado } from '../support/api'
import { infoAudio } from '../support/audio'
import { config } from '../support/env'
import { Evidencia, iniciarSesion } from '../support/evidencia'
import { abrirDetalle, enProd, idEvidencia, sondearAudio, usuarioProd } from '../support/subida'

// PSA-01 a PSA-04 · Diagnóstico de canciones que ya fallan en prod (solo
// lectura: no sube ni borra nada). Canciones en E2E_DIAG_CANCIONES
// ("proyecto/canción,..."); la cuenta de E2E_PROD_* tiene que poder verlas.
const MAX_VERSIONES = 3

test.describe('PSA-01 a PSA-04 diagnóstico de canciones existentes', () => {
  test.skip(!enProd || config.diagnostico.length === 0, 'Requiere E2E_TARGET=prod y E2E_DIAG_CANCIONES')

  for (const par of config.diagnostico) {
    test(`PSA-01 diagnóstico ${par} @prod`, async ({ page }, testInfo) => {
      test.setTimeout(300_000)
      const [proyecto, cancion] = par.split('/').map(Number)
      const ev = new Evidencia(idEvidencia(`PSA-01-${proyecto}-${cancion}`), testInfo)
      const usuario = await usuarioProd()

      const listado = await pedir<VersionListado[]>(
        'GET', `/proyectos/${proyecto}/canciones/${cancion}/versiones`, { token: usuario.token },
      )
      const versiones = esperar(listado, 200).slice(0, MAX_VERSIONES)

      // PSA-01 URL presignada, PSA-02 headers/CORS/Range, PSA-03 integridad.
      const sondeos = []
      for (const v of versiones) {
        const ruta = rutaVersion(proyecto, cancion, v.codigoCancionVersion)
        const local = resolve(
          import.meta.dirname, '../.cache/audio/diagnostico', `${proyecto}-${cancion}-${v.codigoCancionVersion}`,
        )
        const sondeo = await sondearAudio(usuario.token, ruta, local)
        const info = sondeo.ruta ? infoAudio(sondeo.ruta) : null
        sondeos.push({ version: v, sondeo: { ...sondeo, ruta: undefined }, ffprobe: info })

        expect.soft(sondeo.audio.status, `GET /audio de la versión ${v.etiquetaVersion}`).toBe(200)
        expect.soft(sondeo.protocolo, 'la página es https: la URL del audio también debe serlo').toBe('https:')
        expect.soft(sondeo.get.status, 'GET de la URL presignada').toBe(200)
        expect.soft(sondeo.get.headers['access-control-allow-origin'], 'CORS para el frontend').toBeTruthy()
        expect.soft(sondeo.rango.status, 'GET con Range').toBe(206)
        expect.soft(info?.duracion ?? null, 'ffprobe puede leer el archivo guardado').not.toBeNull()
      }
      await ev.capturaHttp(page, 'versiones-y-audio', `Versiones y URL de audio de ${par}`, [
        listado,
        ...sondeos.map((s) => s.sondeo.audio),
      ])
      await ev.json('sondeo-urls', sondeos)

      // PSA-04 lo que ve el navegador en el Detalle.
      await iniciarSesion(page, usuario.email, usuario.password)
      const reproductor = await abrirDetalle(page, `/proyectos/${proyecto}/canciones/${cancion}`, 120_000)
      await ev.captura(page, `detalle-${reproductor.estado}`)
      await ev.json('reproductor', reproductor)
      expect.soft(reproductor.estado, 'el reproductor carga la última versión').toBe('listo')
    })
  }
})
