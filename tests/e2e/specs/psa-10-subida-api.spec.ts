import { execFileSync } from 'node:child_process'
import { expect, test } from '@playwright/test'
import { esperar, pedir, rutaVersion, type Intercambio, type VersionListado } from '../support/api'
import { AUDIOS_VALIDOS, audioPrueba, infoAudio, prepararAudio } from '../support/audio'
import { consultar, type ConsultaDb } from '../support/db'
import { config } from '../support/env'
import { Evidencia } from '../support/evidencia'
import {
  contextoDeSubida, enProd, idEvidencia, limpiarProd, MIME, registrarCreada, sello, sondearAudio,
  subirCancion, subirVersion, type Contexto,
} from '../support/subida'

// PSA-10 a PSA-13 · Subida por API: lo que se sube es lo que después baja el
// navegador por la URL presignada, byte a byte.

const EN_PROD = new Set(['R-MP3-CORTO', 'R-MP3-MEDIO', 'R-WAV-MEDIO', 'R-FLAC-MEDIO', 'S-WAV-100MIB'])

const filaVersion = (codigoVersion: number): Promise<ConsultaDb> =>
  consultar(
    `SELECT codigocancionversion, numeroversion, urlarchivocancionver, formatoarchivocancionver
       FROM cancionversion WHERE codigocancionversion = $1`,
    [codigoVersion],
  )

let ctx: Contexto

test.beforeAll(async () => {
  ctx = await contextoDeSubida('PSA-10')
})

test.afterAll(async () => {
  await limpiarProd()
})

test.describe('PSA-10 subida de canción y descarga íntegra', () => {
  for (const audio of AUDIOS_VALIDOS) {
    const tag = EN_PROD.has(audio.id) ? ' @prod' : ''
    test(`PSA-10 ${audio.id}${tag}`, async ({ page }, testInfo) => {
      test.setTimeout(300_000)
      const ev = new Evidencia(idEvidencia(`PSA-10-${audio.id}`), testInfo)
      const info = infoAudio(await prepararAudio(audio.id))

      const subida = await subirCancion(ctx, `PSA-10 ${audio.id} ${sello()}`, audio.id)
      expect(subida.intercambio.status, JSON.stringify(subida.intercambio.respuesta)).toBe(201)
      const { codigoCancion, codigoCancionVersion } = subida.intercambio.respuesta

      const consultas = []
      if (!enProd) {
        const fila = await filaVersion(codigoCancionVersion)
        consultas.push({ titulo: 'versión guardada', consulta: fila })
        expect(fila.filas[0]).toMatchObject({
          numeroversion: 1,
          urlarchivocancionver: `proyectos/${ctx.proyecto}/canciones/${codigoCancion}/v1.${audio.formato}`,
          formatoarchivocancionver: audio.formato,
        })
      }

      const sondeo = await sondearAudio(ctx.usuario.token, rutaVersion(ctx.proyecto, codigoCancion, codigoCancionVersion))
      await ev.capturaHttp(page, 'subida-y-url', `Subida de ${audio.id} y URL de audio`, [subida.intercambio, sondeo.audio], consultas)
      await ev.json('sondeo', { audio, info, msSubida: subida.ms, sondeo })

      expect(sondeo.audio.status).toBe(200)
      expect(sondeo.get.status, sondeo.get.error).toBe(200)
      expect(sondeo.bytes, 'tamaño descargado').toBe(info.bytes)
      expect(sondeo.sha256, 'contenido descargado').toBe(info.sha256)
      expect.soft(sondeo.get.headers['content-type']).toBe(MIME[audio.formato!])
      expect.soft(sondeo.get.headers['access-control-allow-origin'], 'CORS para el frontend').toBeTruthy()
      expect.soft(sondeo.rango.status, 'Range').toBe(206)
      if (enProd) {
        expect.soft(sondeo.protocolo, 'URL https en prod').toBe('https:')
      }
    })
  }
})

test('PSA-11 versiones sucesivas con distintos formatos @prod', async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  const ev = new Evidencia(idEvidencia('PSA-11'), testInfo)
  const inicial = await subirCancion(ctx, `PSA-11 ${sello()}`, 'R-MP3-CORTO')
  expect(inicial.intercambio.status).toBe(201)
  const { codigoCancion } = inicial.intercambio.respuesta

  const intercambios: Intercambio[] = [inicial.intercambio]
  const subidas = [{ id: 'R-MP3-CORTO', version: inicial.intercambio.respuesta.codigoCancionVersion, numero: 1 }]
  for (const [id, notas] of [['R-WAV-MEDIO', 'v2 en WAV'], ['R-FLAC-MEDIO', 'v3 en FLAC']] as const) {
    const v = await subirVersion(ctx, codigoCancion, id, notas)
    intercambios.push(v.intercambio)
    expect(v.intercambio.status, JSON.stringify(v.intercambio.respuesta)).toBe(201)
    subidas.push({ id, version: v.intercambio.respuesta.codigoCancionVersion, numero: v.intercambio.respuesta.numeroVersion })
  }
  expect(subidas.map((s) => s.numero)).toEqual([1, 2, 3])

  const listado = await pedir<VersionListado[]>(
    'GET', `/proyectos/${ctx.proyecto}/canciones/${codigoCancion}/versiones`, { token: ctx.usuario.token },
  )
  expect(esperar(listado, 200)).toHaveLength(3)
  intercambios.push(listado)

  const consultas = []
  for (const s of subidas) {
    const audio = audioPrueba(s.id)
    const sondeo = await sondearAudio(ctx.usuario.token, rutaVersion(ctx.proyecto, codigoCancion, s.version))
    expect(sondeo.sha256, `contenido de la v${s.numero}`).toBe(infoAudio(await prepararAudio(s.id)).sha256)
    if (!enProd) {
      const fila = await filaVersion(s.version)
      consultas.push({ titulo: `v${s.numero}`, consulta: fila })
      expect(fila.filas[0]?.urlarchivocancionver).toBe(
        `proyectos/${ctx.proyecto}/canciones/${codigoCancion}/v${s.numero}.${audio.formato}`,
      )
    }
  }
  await ev.capturaHttp(page, 'versiones', 'Canción con 3 versiones (MP3, WAV, FLAC)', intercambios, consultas)
})

test('PSA-12 archivo que supera el límite por 4 bytes @prod', async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  const ev = new Evidencia(idEvidencia('PSA-12'), testInfo)
  const nombre = `PSA-12 ${sello()}`
  const subida = await subirCancion(ctx, nombre, 'S-WAV-100MIB-MAS-1')

  const consultas = []
  if (!enProd) {
    const filas = await consultar(
      'SELECT count(*)::int AS canciones FROM cancion WHERE codigoproyecto = $1 AND nombrecancion = $2',
      [ctx.proyecto, nombre],
    )
    consultas.push({ titulo: 'no quedó la canción', consulta: filas })
    expect(filas.filas[0]?.canciones).toBe(0)
  }
  await ev.capturaHttp(page, 'rechazo', 'Subida de 100 MiB + 4 bytes', [subida.intercambio], consultas)

  // 413 del backend (JSON con su mensaje), no un corte del proxy.
  expect(subida.intercambio.status).toBe(413)
  expect(subida.intercambio.respuesta).toEqual({ error: 'El archivo de audio supera el tamaño máximo permitido' })
})

test('PSA-13 subida lenta (512 KB/s) no la corta el proxy @prod', async ({ page }, testInfo) => {
  test.setTimeout(300_000)
  const ev = new Evidencia(idEvidencia('PSA-13'), testInfo)
  const audio = audioPrueba('R-WAV-MEDIO')
  const ruta = await prepararAudio(audio.id)
  const url = `${config.apiUrl}/proyectos/${ctx.proyecto}/canciones`

  // curl en vez de fetch: limita la velocidad de subida.
  const salida = execFileSync('curl', [
    '-sS', '--limit-rate', '512k', '--max-time', '280',
    '-H', `Authorization: Bearer ${ctx.usuario.token}`,
    '-F', `nombre=PSA-13 ${sello()}`,
    '-F', `archivo=@${ruta};type=audio/wav`,
    '-w', '\n%{http_code} %{time_total}',
    url,
  ]).toString()
  const lineas = salida.trimEnd().split('\n')
  const [status, segundos] = (lineas.pop() ?? '').split(' ')
  const cuerpo = lineas.join('\n')
  let respuesta: unknown = cuerpo
  try {
    respuesta = JSON.parse(cuerpo)
    const creada = respuesta as { codigoCancion?: number }
    if (creada.codigoCancion) {
      registrarCreada(ctx, creada.codigoCancion)
    }
  } catch {
    // Respuesta del proxy (HTML/texto).
  }

  await ev.capturaHttp(page, 'subida-lenta', `Subida de ${audio.id} a 512 KB/s (${segundos} s)`, [
    { metodo: 'POST', url, headers: { curl: '--limit-rate 512k' }, cuerpo: { archivo: audio.archivo }, status: Number(status), respuesta },
  ])
  expect(Number(status), cuerpo.slice(0, 300)).toBe(201)
})
