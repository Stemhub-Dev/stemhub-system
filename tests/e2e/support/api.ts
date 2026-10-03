import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { config } from './env'

// Cliente HTTP mínimo contra el backend Go y GoTrue. Cada llamada devuelve
// también lo que se mandó, para poder mostrar request y response como
// evidencia de la prueba.

export interface Intercambio<T = unknown> {
  metodo: string
  url: string
  headers: Record<string, string>
  cuerpo?: unknown
  status: number
  respuesta: T
}

interface Opciones {
  token?: string | null
  json?: unknown
  form?: FormData
}

export async function pedir<T = unknown>(
  metodo: string,
  ruta: string,
  { token, json, form }: Opciones = {},
): Promise<Intercambio<T>> {
  const url = ruta.startsWith('http') ? ruta : `${config.apiUrl}${ruta}`
  const headers: Record<string, string> = {}
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  let body: BodyInit | undefined
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(json)
  } else if (form) {
    body = form
  }

  const res = await fetch(url, { method: metodo, headers, body })
  const texto = await res.text()
  let respuesta: unknown = texto
  try {
    respuesta = texto ? JSON.parse(texto) : null
  } catch {
    // Respuesta no JSON: queda como texto.
  }

  return {
    metodo,
    url,
    // El token completo no aporta a la evidencia y la vuelve ilegible.
    headers: token
      ? { ...headers, Authorization: `Bearer ${token.slice(0, 16)}…` }
      : headers,
    cuerpo: json ?? (form ? describirForm(form) : undefined),
    status: res.status,
    respuesta: respuesta as T,
  }
}

function describirForm(form: FormData): Record<string, string> {
  const campos: Record<string, string> = {}
  form.forEach((valor, clave) => {
    campos[clave] = typeof valor === 'string' ? valor : `<archivo ${valor.name}, ${valor.size} bytes>`
  })
  return campos
}

function esperar<T>(intercambio: Intercambio<T>, ...esperados: number[]): T {
  if (!esperados.includes(intercambio.status)) {
    throw new Error(
      `${intercambio.metodo} ${intercambio.url} → ${intercambio.status}: ${JSON.stringify(intercambio.respuesta)}`,
    )
  }
  return intercambio.respuesta
}

function archivoAudio(ruta: string): Blob {
  return new File([readFileSync(ruta)], basename(ruta), { type: 'audio/wav' })
}

// --- Usuarios ---------------------------------------------------------------

export interface Usuario {
  email: string
  password: string
  nombre: string
  token: string
  codigoUsuario: number
  codigoIntegrante: number
}

const PASSWORD = 'Prueba123!'

// Alta en GoTrue (sin confirmación de email en local) + perfil de StemHub.
export async function crearUsuario(rol: string): Promise<Usuario> {
  const marca = String(Date.now())
  const email = `qa-${rol.toLowerCase()}-${marca}-${Math.floor(Math.random() * 1e4)}@test.local`
  const nombre = `QA ${rol} ${marca.slice(-4)}`

  const res = await fetch(`${config.gotrueUrl}/signup`, {
    method: 'POST',
    headers: { apikey: config.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const sesion = (await res.json()) as { access_token?: string }
  if (!sesion.access_token) {
    throw new Error(`signup de ${email} falló: ${JSON.stringify(sesion)}`)
  }

  const perfil = esperar(
    await pedir<{ codigoUsuario: number; codigoIntegrante: number }>('POST', '/usuarios/registrar', {
      token: sesion.access_token,
      json: { nombre },
    }),
    200,
    201,
  )

  return {
    email,
    password: PASSWORD,
    nombre,
    token: sesion.access_token,
    codigoUsuario: perfil.codigoUsuario,
    codigoIntegrante: perfil.codigoIntegrante,
  }
}

// --- Proyectos, canciones y versiones ----------------------------------------

export const ROL_PRODUCTOR = 1
export const ROL_MUSICO = 2

export async function crearProyecto(usuario: Usuario, nombre: string): Promise<number> {
  const [tipos, generos] = await Promise.all([
    pedir<{ id: number }[]>('GET', '/configuracion/tipos-proyecto', { token: usuario.token }),
    pedir<{ id: number }[]>('GET', '/configuracion/generos', { token: usuario.token }),
  ])
  const proyecto = esperar(
    await pedir<{ codigoProyecto: number }>('POST', '/proyectos/crear', {
      token: usuario.token,
      json: {
        nombre,
        descripcion: 'Proyecto creado por las pruebas automatizadas',
        codigoTipoProyecto: esperar(tipos, 200)[0]?.id,
        codigosGeneros: [esperar(generos, 200)[0]?.id],
        codRol: ROL_PRODUCTOR,
      },
    }),
    200,
    201,
  )
  return proyecto.codigoProyecto
}

export async function crearCancion(
  usuario: Usuario,
  proyecto: number,
  nombre: string,
  wav: string,
): Promise<{ codigoCancion: number; codigoCancionVersion: number }> {
  const form = new FormData()
  form.set('nombre', nombre)
  form.set('archivo', archivoAudio(wav))
  return esperar(
    await pedir('POST', `/proyectos/${proyecto}/canciones`, { token: usuario.token, form }),
    200,
    201,
  ) as { codigoCancion: number; codigoCancionVersion: number }
}

export function formVersion(wav: string, notas?: string): FormData {
  const form = new FormData()
  form.set('archivo', archivoAudio(wav))
  if (notas) {
    form.set('notas', notas)
  }
  return form
}

export async function crearVersion(
  usuario: Usuario,
  proyecto: number,
  cancion: number,
  wav: string,
  notas?: string,
): Promise<{ codigoCancionVersion: number }> {
  return esperar(
    await pedir('POST', `/proyectos/${proyecto}/canciones/${cancion}/versiones`, {
      token: usuario.token,
      form: formVersion(wav, notas),
    }),
    200,
    201,
  ) as { codigoCancionVersion: number }
}

export interface VersionListado {
  codigoCancionVersion: number
  numeroVersion: number
  etiquetaVersion: string
  notas: string | null
}

export function rutaVersion(proyecto: number, cancion: number, version: number): string {
  return `/proyectos/${proyecto}/canciones/${cancion}/versiones/${version}`
}

// --- Comentarios ---------------------------------------------------------------

export interface ComentarioListado {
  codigoComentario: number
  texto: string
  tiempoInicioSegundos: number | null
  tiempoFinSegundos: number | null
  fechaHoraAlta: string
  autor: { codigoIntegrante: number; nombre: string }
}

export async function crearComentario(
  usuario: Usuario,
  rutaDeVersion: string,
  texto: string,
  segundo?: number,
): Promise<number> {
  const creado = esperar(
    await pedir<{ codigoComentario: number }>('POST', `${rutaDeVersion}/comentarios`, {
      token: usuario.token,
      json: {
        texto,
        ...(segundo === undefined
          ? {}
          : { tiempoInicioSegundos: segundo, tiempoFinSegundos: segundo }),
      },
    }),
    201,
  )
  return creado.codigoComentario
}

// --- Invitaciones ----------------------------------------------------------------

export async function invitar(
  dueno: Usuario,
  proyecto: number,
  email: string,
  codRol: number,
): Promise<Intercambio> {
  return pedir('POST', `/proyectos/${proyecto}/invitaciones`, {
    token: dueno.token,
    json: { email, codRol },
  })
}

// Suma a `invitado` al proyecto con el rol pedido por el flujo real de
// invitación (invitar → bandeja del invitado → aceptar).
export async function sumarAlProyecto(
  dueno: Usuario,
  invitado: Usuario,
  proyecto: number,
  codRol: number,
): Promise<void> {
  esperar(await invitar(dueno, proyecto, invitado.email, codRol), 200, 201)
  const bandeja = esperar(
    await pedir<{ token: string; nombreProyecto: string }[]>('GET', '/invitaciones', {
      token: invitado.token,
    }),
    200,
  )
  const pendiente = bandeja[0]
  if (!pendiente) {
    throw new Error(`${invitado.email} no tiene invitaciones pendientes`)
  }
  esperar(
    await pedir('POST', `/invitaciones/${pendiente.token}/aceptar`, { token: invitado.token }),
    200,
  )
}

// --- Stems ------------------------------------------------------------------------

export interface Separacion {
  estado: 'PENDIENTE' | 'PROCESANDO' | 'COMPLETADA' | 'ERROR'
  cantidadStems: number
  mensajeError: string | null
  tiempoProcesamientoMs: number | null
}

export interface StemListado {
  codStem: number
  nombre: string
  codCategoriaStem: number
  nombreCategoria: string
  generadoConIA: boolean
}

export async function esperarSeparacion(
  usuario: Usuario,
  rutaDeVersion: string,
  limiteMs: number,
): Promise<Separacion> {
  const fin = Date.now() + limiteMs
  for (;;) {
    const separacion = esperar(
      await pedir<Separacion>('GET', `${rutaDeVersion}/stems/separacion`, { token: usuario.token }),
      200,
    )
    if (separacion.estado === 'COMPLETADA' || separacion.estado === 'ERROR') {
      return separacion
    }
    if (Date.now() > fin) {
      throw new Error(`La separación sigue en ${separacion.estado} después de ${limiteMs} ms`)
    }
    await new Promise((r) => setTimeout(r, 3000))
  }
}

export { esperar }
