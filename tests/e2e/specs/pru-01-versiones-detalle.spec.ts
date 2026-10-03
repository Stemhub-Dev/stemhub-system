import { expect, test } from '@playwright/test'
import { crearVersion, esperar, pedir, type VersionListado } from '../support/api'
import { wavDePrueba } from '../support/audio'
import { cancionConUnaVersion, rutaDetalle } from '../support/escenarios'
import { Evidencia, iniciarSesion } from '../support/evidencia'

// PRU-01 · HU-VER-B01 · Funcional
// Obtener versiones y detalle de una canción (VER-ALL-DETAIL-02).
test('PRU-01 obtener versiones y detalle de una canción', async ({ page }, testInfo) => {
  const ev = new Evidencia('PRU-01', testInfo)

  // Datos de entrada: proyecto con una canción con 2 versiones cargadas, con
  // audios distintos y notas solo en la v2.
  const c = await cancionConUnaVersion('PRU-01', 60)
  const NOTAS_V2 = 'Mezcla nueva: bajo más presente y voz al frente.'
  const { codigoCancionVersion: v2 } = await crearVersion(
    c.productor, c.proyecto, c.cancion, wavDePrueba(45, 440), NOTAS_V2,
  )
  const v1 = c.versionInicial

  const listado = await pedir<VersionListado[]>(
    'GET', `/proyectos/${c.proyecto}/canciones/${c.cancion}/versiones`, { token: c.productor.token },
  )
  const versiones = esperar(listado, 200)
  expect(versiones.map((v) => v.codigoCancionVersion).sort()).toEqual([v1, v2].sort())
  const etiqueta = (cod: number) => versiones.find((v) => v.codigoCancionVersion === cod)!.etiquetaVersion
  await ev.capturaHttp(page, 'api-listado-versiones', 'GET versiones de la canción', [listado])

  // 1. El usuario se autentica.
  await iniciarSesion(page, c.productor.email, c.productor.password)

  // 2. Ingresa al proyecto que tiene la canción.
  await page.goto(`/proyectos/${c.proyecto}/canciones`)
  await expect(page.getByText(c.nombreCancion)).toBeVisible()
  await ev.captura(page, 'proyecto-con-cancion')

  // 3. Ingresa a la canción con dos versiones.
  await page.getByText(c.nombreCancion).first().click()
  await expect(page).toHaveURL(new RegExp(`${rutaDetalle(c)}$`))

  const sidebar = page.locator('aside').filter({ hasText: 'VERSIONES' })
  const botonVersion = (cod: number) => sidebar.getByRole('button', { name: new RegExp(etiqueta(cod)) })
  await expect(botonVersion(v1)).toBeVisible()
  await expect(botonVersion(v2)).toBeVisible()
  await expect(sidebar.locator('li')).toHaveCount(2)

  const badge = page.locator('section span.rounded-full.bg-lavender-100').first()
  const notas = page.getByText('NOTAS DE VERSIÓN').locator('..')

  // Navegar a la v1: cambia la pista de audio pedida y las notas.
  const audioV1 = page.waitForResponse((r) => r.url().endsWith(`/versiones/${v1}/audio`) && r.ok())
  await botonVersion(v1).click()
  await audioV1
  await expect(badge).toHaveText(etiqueta(v1))
  await expect(notas).toContainText('Esta versión no tiene notas cargadas.')
  await expect(page.getByText('Cargando audio...')).toBeHidden()
  await expect(page.getByText(/0:00 \/ 1:00/)).toBeVisible()
  await ev.captura(page, 'detalle-version-1')

  // Volver a la v2: vuelven a actualizarse audio y notas.
  const audioV2 = page.waitForResponse((r) => r.url().endsWith(`/versiones/${v2}/audio`) && r.ok())
  await botonVersion(v2).click()
  await audioV2
  await expect(badge).toHaveText(etiqueta(v2))
  await expect(notas).toContainText(NOTAS_V2)
  await expect(page.getByText(/0:00 \/ 0:45/)).toBeVisible()
  await ev.captura(page, 'detalle-version-2')
})
