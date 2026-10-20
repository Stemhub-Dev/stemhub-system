import { crearCancion, crearProyecto, crearUsuario, type Usuario } from './api'
import { wavDePrueba } from './audio'

export interface CancionDePrueba {
  productor: Usuario
  proyecto: number
  cancion: number
  versionInicial: number
  nombreProyecto: string
  nombreCancion: string
}

// Productor dueño de un proyecto con una canción y su v1 (.wav real subido a
// MinIO por el backend).
export async function cancionConUnaVersion(
  prueba: string,
  segundosAudio = 100,
  productor?: Usuario,
): Promise<CancionDePrueba> {
  const dueno = productor ?? (await crearUsuario('Productor'))
  const sello = new Date().toISOString().slice(5, 16).replace('T', ' ')
  const nombreProyecto = `${prueba} Proyecto ${sello}`
  const nombreCancion = `${prueba} Canción ${sello}`
  const proyecto = await crearProyecto(dueno, nombreProyecto)
  const { codigoCancion, codigoCancionVersion } = await crearCancion(
    dueno,
    proyecto,
    nombreCancion,
    wavDePrueba(segundosAudio),
  )
  return {
    productor: dueno,
    proyecto,
    cancion: codigoCancion,
    versionInicial: codigoCancionVersion,
    nombreProyecto,
    nombreCancion,
  }
}

export const rutaDetalle = (c: CancionDePrueba): string =>
  `/proyectos/${c.proyecto}/canciones/${c.cancion}`
