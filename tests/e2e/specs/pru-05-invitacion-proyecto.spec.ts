import { expect, test } from '@playwright/test'
import { crearProyecto, crearUsuario, esperar, pedir } from '../support/api'
import { consultar } from '../support/db'
import { config } from '../support/env'
import { Evidencia, iniciarSesion } from '../support/evidencia'
import { esperarMail } from '../support/mailpit'

interface Colaborador {
  codigoIntegrante: number
  nombre: string
  nombreRol: string
  esPropietario: boolean
}

// PRU-05 · HU-NOT-F02 + gestión de colaboradores (Versionado) · Integración
// Invitación a un proyecto con rol Músico y su aceptación: el módulo de
// notificaciones manda el mail y el de versionado registra al colaborador.
test('PRU-05 invitación y aceptación de un proyecto', async ({ page, browser }, testInfo) => {
  const ev = new Evidencia('PRU-05', testInfo)

  // Datos de entrada: proyecto existente y el email de un usuario a invitar.
  const dueno = await crearUsuario('Productor')
  const invitado = await crearUsuario('Musico')
  const nombreProyecto = `PRU-05 Proyecto ${new Date().toISOString().slice(5, 16).replace('T', ' ')}`
  const proyecto = await crearProyecto(dueno, nombreProyecto)

  // 1. Autenticarse. 2. Ingresar a un proyecto del que es dueño.
  await iniciarSesion(page, dueno.email, dueno.password)
  await page.goto(`/proyectos/${proyecto}/canciones`)
  await expect(page.getByRole('heading', { name: nombreProyecto })).toBeVisible()

  // 3. Invitar al usuario desde el detalle del proyecto con rol Músico.
  await page.getByRole('button', { name: 'Compartir' }).click()
  await page.locator('#invite-email').fill(invitado.email)
  await page.locator('#invite-rol').selectOption({ label: 'Músico (Artista)' })
  await ev.captura(page, 'formulario-invitacion')
  const envio = page.waitForResponse(
    (r) => r.url().endsWith(`/proyectos/${proyecto}/invitaciones`) && r.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Enviar invitación' }).click()
  expect((await envio).status()).toBe(201)
  await expect(page.getByText(invitado.email)).toBeVisible()
  await expect(page.getByText(/Músico \(Artista\) · Pendiente/)).toBeVisible()
  await ev.captura(page, 'invitacion-pendiente')

  // 4. Se dispara el email "Invitación a un proyecto".
  const mail = await esperarMail(invitado.email)
  expect(mail.Subject).toBe(`Te invitaron a colaborar en ${nombreProyecto} en StemHub`)
  const enlace = mail.Text.match(/https?:\/\/\S+\/invitaciones\/[\w-]+/)?.[0]
  expect(enlace, 'el mail debe traer el enlace de aceptación').toBeTruthy()
  await ev.json('mail-recibido', { asunto: mail.Subject, de: mail.From, para: mail.To, texto: mail.Text })
  const bandeja = await page.context().newPage()
  await bandeja.goto(`${config.mailpitUrl}/view/${mail.ID}`)
  await expect(bandeja.getByText(mail.Subject).first()).toBeVisible()
  await ev.captura(bandeja, 'mail-invitacion')
  await bandeja.close()

  // 5. El invitado acepta la invitación (con su propia sesión).
  const contextoInvitado = await browser.newContext()
  const paginaInvitado = await contextoInvitado.newPage()
  await iniciarSesion(paginaInvitado, invitado.email, invitado.password)
  await paginaInvitado.goto(new URL(enlace!).pathname)
  await expect(paginaInvitado.getByText(nombreProyecto)).toBeVisible()
  await expect(paginaInvitado.getByText('Músico (Artista)')).toBeVisible()
  await ev.captura(paginaInvitado, 'invitado-ve-la-invitacion')
  await paginaInvitado.getByRole('button', { name: 'Aceptar invitación' }).click()
  await expect(paginaInvitado).toHaveURL(new RegExp(`/proyectos/${proyecto}/canciones$`))
  await expect(paginaInvitado.getByRole('heading', { name: nombreProyecto })).toBeVisible()
  await ev.captura(paginaInvitado, 'invitado-dentro-del-proyecto')
  await contextoInvitado.close()

  // 6. Queda listado como colaborador con el rol asignado.
  await page.reload()
  await page.getByRole('button', { name: 'Ver colaboradores del proyecto' }).click()
  const popover = page.getByRole('dialog', { name: 'Colaboradores del proyecto' })
  await expect(popover.locator('li').filter({ hasText: invitado.nombre })).toContainText('Músico (Artista)')
  await ev.captura(page, 'colaboradores-del-proyecto')

  const integrantes = await pedir<Colaborador[]>('GET', `/proyectos/${proyecto}/integrantes`, { token: dueno.token })
  const nuevo = esperar(integrantes, 200).find((x) => x.codigoIntegrante === invitado.codigoIntegrante)
  expect(nuevo?.nombreRol).toBe('Músico (Artista)')
  expect(nuevo?.esPropietario).toBe(false)

  const membresia = await consultar(
    `SELECT ip.codintegrante, i.nombreintegrante, r.nombrerol, ip.fechahorabajaintegranteproy
       FROM integranteproyecto ip
       JOIN integrante i ON i.codintegrante = ip.codintegrante
       JOIN rol r ON r.codrol = ip.codrol
      WHERE ip.codigoproyecto = $1 ORDER BY ip.codigointegranteproyecto`,
    [proyecto],
  )
  const invitacion = await consultar(
    `SELECT codigoinvitacionproy, emailinvitado, codrol, fechahoraaceptacioninvitacion
       FROM invitacionproyecto WHERE codigoproyecto = $1`,
    [proyecto],
  )
  expect(invitacion.filas[0]?.fechahoraaceptacioninvitacion).not.toBeNull()
  await ev.capturaHttp(page, 'consistencia-modulos', 'Colaboradores del proyecto tras aceptar', [integrantes], [
    { titulo: 'Invitación (módulo de notificaciones)', consulta: invitacion },
    { titulo: 'Integrantes del proyecto (módulo de versionado)', consulta: membresia },
  ])
})
