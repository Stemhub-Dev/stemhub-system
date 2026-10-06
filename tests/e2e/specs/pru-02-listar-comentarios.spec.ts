import { expect, test } from '@playwright/test'
import {
  crearComentario,
  crearUsuario,
  esperar,
  pedir,
  ROL_MUSICO,
  rutaVersion,
  sumarAlProyecto,
  type ComentarioListado,
} from '../support/api'
import { consultar } from '../support/db'
import { cancionConUnaVersion, rutaDetalle } from '../support/escenarios'
import { Evidencia, iniciarSesion } from '../support/evidencia'

// PRU-02 · HU-COM-B01 · Funcional
// Obtener los comentarios de una versión, ordenados por fecha.
test('PRU-02 obtener comentarios de una versión ordenados por fecha', async ({ page }, testInfo) => {
  const ev = new Evidencia('PRU-02', testInfo)

  // Datos de entrada: una versión con 5 comentarios de dos autores, cargados
  // en distintas fechas (la API siempre usa "ahora", así que la fecha de
  // alta se corre en la BD a días distintos).
  const c = await cancionConUnaVersion('PRU-02')
  const musico = await crearUsuario('Musico')
  await sumarAlProyecto(c.productor, musico, c.proyecto, ROL_MUSICO)
  const ruta = rutaVersion(c.proyecto, c.cancion, c.versionInicial)

  const carga = [
    { autor: c.productor, texto: 'Intro: subir el pad un par de dB', segundo: 5, haceDias: 5 },
    { autor: musico, texto: 'La batería entra tarde en el primer verso', segundo: 18, haceDias: 4 },
    { autor: c.productor, texto: 'Revisar afinación de la voz en el estribillo', segundo: 42, haceDias: 3 },
    { autor: musico, texto: 'El solo de guitarra quedó muy largo', segundo: 61, haceDias: 2 },
    { autor: c.productor, texto: 'Final: probar fade out más corto', segundo: 95, haceDias: 1 },
  ]
  const codigos: number[] = []
  for (const comentario of carga) {
    const codigo = await crearComentario(comentario.autor, ruta, comentario.texto, comentario.segundo)
    await consultar(
      `UPDATE comentario SET fechahoraaltacomentario = now() - make_interval(days => $2) WHERE codigocomentario = $1`,
      [codigo, comentario.haceDias],
    )
    codigos.push(codigo)
  }

  // 1. Autenticarse.
  await iniciarSesion(page, c.productor.email, c.productor.password)

  // 2. Abrir la versión con comentarios.
  await page.goto(rutaDetalle(c))
  const panel = page.locator('aside').filter({ hasText: 'COMENTARIOS' })
  for (const comentario of carga) {
    await expect(panel.getByText(comentario.texto)).toBeVisible()
  }
  await ev.captura(page, 'panel-comentarios')

  // 3. Consultar el endpoint que lista los comentarios de la versión.
  const listado = await pedir<ComentarioListado[]>('GET', `${ruta}/comentarios`, {
    token: c.productor.token,
  })
  const comentarios = esperar(listado, 200)

  expect(comentarios).toHaveLength(5)
  // Orden por fecha de creación: el backend devuelve primero el más reciente.
  const fechas = comentarios.map((x) => Date.parse(x.fechaHoraAlta))
  expect(fechas).toEqual([...fechas].sort((a, b) => b - a))
  expect(comentarios.map((x) => x.codigoComentario)).toEqual([...codigos].reverse())
  for (const x of comentarios) {
    const esperado = carga[codigos.indexOf(x.codigoComentario)]!
    expect(x.texto).toBe(esperado.texto)
    expect(x.autor.nombre).toBe(esperado.autor.nombre)
    expect(x.tiempoInicioSegundos).toBe(esperado.segundo)
  }

  const bd = await consultar(
    `SELECT c.codigocomentario, i.nombreintegrante AS autor, c.descripcioncomentario AS texto,
            c.tiempoiniciosegundos, c.fechahoraaltacomentario
       FROM comentario c JOIN integrante i ON i.codintegrante = c.codintegrante
      WHERE c.codigocancionversion = $1 ORDER BY c.fechahoraaltacomentario DESC`,
    [c.versionInicial],
  )
  await ev.capturaHttp(page, 'api-listado-comentarios', 'GET comentarios de la versión', [listado], [
    { titulo: 'Comentarios de la versión en la BD', consulta: bd },
  ])
})
