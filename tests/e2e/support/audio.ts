import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Sin imports de otros módulos de support/: scripts/preparar-audios.ts lo
// corre Node directo (sin el loader de Playwright).

const cache = resolve(dirname(fileURLToPath(import.meta.url)), '../.cache')

// Genera (una vez) un .wav estéreo de `segundos` con bajo, melodía, ruido
// rítmico tipo hi-hat y un pulso tipo bombo, para que la forma de onda y la
// separación de Spleeter tengan contenido de distinta frecuencia. Requiere
// ffmpeg en el PATH.
export function wavDePrueba(segundos: number, tono = 220): string {
  const ruta = resolve(cache, `prueba-${segundos}s-${tono}hz.wav`)
  if (existsSync(ruta)) {
    return ruta
  }
  mkdirSync(cache, { recursive: true })
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `sine=frequency=55:duration=${segundos}`,
    '-f', 'lavfi', '-i', `sine=frequency=${tono}:duration=${segundos}`,
    '-f', 'lavfi', '-i', `anoisesrc=duration=${segundos}:color=white:amplitude=0.3`,
    '-f', 'lavfi', '-i', `sine=frequency=60:duration=${segundos}`,
    '-filter_complex',
    [
      '[0]volume=0.6[bajo]',
      `[1]volume='0.4*(0.6+0.4*sin(2*PI*t/4))':eval=frame[melodia]`,
      `[2]highpass=f=6000,volume='if(lt(mod(t,0.5),0.05),1,0)':eval=frame[hihat]`,
      `[3]volume='if(lt(mod(t,1),0.12),1.2,0)':eval=frame[bombo]`,
      '[bajo][melodia][hihat][bombo]amix=inputs=4:normalize=0,aformat=channel_layouts=stereo',
    ].join(';'),
    '-ar', '44100', '-c:a', 'pcm_s16le',
    ruta,
  ])
  return ruta
}

// --- Catálogo de audios de la prueba de subida (PSA) ------------------------
//
// Reales: descargados de Wikimedia Commons (dominio público o Creative
// Commons), verificados por sha256. Sintéticos: generados con ffmpeg o
// derivados de los reales, para cubrir variantes de formato, el límite de
// tamaño y contenido inválido. Todos quedan en .cache/audio/ (ignorado por
// git); se preparan con `npm run audios`.

const dirDescargas = resolve(cache, 'audio/descargas')
const dirGenerados = resolve(cache, 'audio/generados')

// Límite del backend (TAMANO_MAXIMO_CANCION_MB, 100 por defecto) en bytes:
// el service compara contra MB de 1024 * 1024.
export const LIMITE_BYTES = 100 * 1024 * 1024

// Lo que se espera hoy del POST: 201 lo acepta, 400/413 lo rechaza. Para el
// contenido inválido el resultado correcto sería 400, pero el backend solo
// valida la extensión: ver PSA-20.
export type Esperado = 201 | 400 | 413

export interface AudioPrueba {
  id: string
  // Nombre con el que se sube (el backend saca el formato de la extensión).
  archivo: string
  descripcion: string
  esperado: Esperado
  // Contenido que no es el audio que dice ser la extensión.
  contenidoInvalido?: boolean
  // Formato que debería guardar el backend (urlarchivocancionver/formato).
  formato?: 'mp3' | 'wav' | 'flac'
  real?: { url: string; pagina: string; licencia: string; sha256: string; bytes: number }
  generar?: (destino: string) => void
  // Audio real del que se deriva (se descarga antes de generar este).
  depende?: string
}

const ffmpeg = (...args: string[]): void => {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
}

// Tono estéreo de `segundos` con el códec y la frecuencia de muestreo dados.
const tono = (segundos: number, frecuencia: number, salida: string[]) => (destino: string) =>
  ffmpeg(
    '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${frecuencia}:duration=${segundos}`,
    '-f', 'lavfi', '-i', `sine=frequency=660:sample_rate=${frecuencia}:duration=${segundos}`,
    '-filter_complex', '[0][1]amerge=inputs=2',
    ...salida, '-bitexact', '-map_metadata', '-1', destino,
  )

// WAV PCM 16-bit estéreo 44.1 kHz de exactamente `bytes` (44 de header +
// frames de 4 bytes), para probar el borde del límite.
const wavDeBytes = (bytes: number) => (destino: string) => {
  const frames = (bytes - 44) / 4
  if (!Number.isInteger(frames)) {
    throw new Error(`${bytes} bytes no es un WAV 16-bit estéreo válido`)
  }
  ffmpeg(
    '-f', 'lavfi', '-i', 'sine=frequency=330:sample_rate=44100',
    '-af', `atrim=end_sample=${frames}`, '-ac', '2', '-c:a', 'pcm_s16le',
    '-bitexact', '-map_metadata', '-1', destino,
  )
  const generado = statSync(destino).size
  if (generado !== bytes) {
    throw new Error(`${destino}: se esperaban ${bytes} bytes y se generaron ${generado}`)
  }
}

const copiaDe = (id: string) => (destino: string) => copyFileSync(rutaAudio(id), destino)

const real = (
  id: string,
  extension: 'mp3' | 'wav' | 'flac',
  descripcion: string,
  datos: NonNullable<AudioPrueba['real']>,
): AudioPrueba => ({
  id,
  archivo: `${id}.${extension}`,
  descripcion,
  esperado: 201,
  formato: extension,
  real: datos,
})

const commons = (archivo: string) => ({
  url: `https://upload.wikimedia.org/wikipedia/commons/${archivo}`,
  pagina: `https://commons.wikimedia.org/wiki/File:${archivo.split('/').pop()}`,
})

export const AUDIOS: AudioPrueba[] = [
  real('R-MP3-CORTO', 'mp3', 'MP3 320 kbps, 55 s, 2,2 MB', {
    ...commons('0/03/Music_to_Delight_%28ISRC_USUAN1200023%29.mp3'),
    licencia: 'CC BY 3.0',
    sha256: 'f2c84f9d36840a86acf52a5f9be5dbdcef1d0bf77bf4620cf5a298bd5371f33d',
    bytes: 2222415,
  }),
  real('R-MP3-MEDIO', 'mp3', 'MP3 128 kbps con carátula PNG embebida, 3:54, 3,8 MB', {
    ...commons('4/44/Let_the_Music_Send_Me_-_Systems_Go_-_United_States_Air_Force_Band_of_Flight.mp3'),
    licencia: 'Dominio público',
    sha256: '0994ba179036b917cd8c6679ad9dc95ab7da00f8c1e6066c27a335dc96fc0e6a',
    bytes: 3786795,
  }),
  real('R-MP3-LARGO', 'mp3', 'MP3 320 kbps, 17:36, 42 MB', {
    ...commons('4/4b/Music_for_Manatees_%28ISRC_USUAN1400009%29.mp3'),
    licencia: 'CC BY 3.0',
    sha256: '83813e1fbeab933a4fe3895e4f64d0a11ddf7c7f357cbc68b36c503bb9aaf664',
    bytes: 42244303,
  }),
  real('R-MP3-MUY-LARGO', 'mp3', 'MP3 256 kbps con carátula JPEG, 41:17, 79,7 MB', {
    ...commons('9/95/Garden_Music_%28ISRC_USUAN1500081%29.mp3'),
    licencia: 'CC BY 3.0',
    sha256: '36e34a936ced21466a242774d7ceb55bc88587aaa019bd4a2662215436b27a14',
    bytes: 79665939,
  }),
  real('R-WAV-MEDIO', 'wav', 'WAV PCM 16-bit 44.1 kHz estéreo, 2:44, 28,9 MB', {
    ...commons('0/0e/%D7%92%D7%90%D6%B8%D7%98%D7%B3%D7%A1_%D7%95%D7%95%D7%90%D7%95%D7%A0%D7%93%D7%A2%D7%A8%2C_Gott%27s_vunder.wav'),
    licencia: 'Dominio público',
    sha256: '4356ff3cfa85f701b015832e12fd48f57fd03abe9e3885b5d54563cd8c96540d',
    bytes: 28938630,
  }),
  real('R-WAV-GRANDE', 'wav', 'WAV PCM 24-bit 44.1 kHz estéreo, 4:17, 68 MB', {
    ...commons('6/6a/Flight_Hymn_by_Ross_Bugden.wav'),
    licencia: 'CC BY 4.0',
    sha256: 'c3cc5162e2d5cf740569dba784a9f5a252a9548868e6015854b674aac53fa07c',
    bytes: 67991518,
  }),
  real('R-FLAC-MEDIO', 'flac', 'FLAC 16-bit 44.1 kHz, 2:31, 9,7 MB', {
    ...commons('5/5f/Opus_One_audio.flac'),
    licencia: 'Dominio público',
    sha256: '21874b3dfaf0663e807e91fbe8e7167514f496b062c8f03f60bcb942daf6e6af',
    bytes: 9709546,
  }),
  real('R-FLAC-GRANDE', 'flac', 'FLAC 24-bit 48 kHz con carátula JPEG, 4:46, 52 MB', {
    ...commons('f/fd/Tilted.flac'),
    licencia: 'CC BY-SA 4.0',
    sha256: '0ce2e416288348d0c1a4336dd4b77a2408b9256ae2fcbf2ca585e8de54816f21',
    bytes: 52214304,
  }),

  {
    id: 'S-WAV-1S',
    archivo: 'S-WAV-1S.wav',
    descripcion: 'WAV 16-bit estéreo de 1 s (mínimo)',
    esperado: 201,
    formato: 'wav',
    generar: (destino) => copyFileSync(wavDePrueba(1), destino),
  },
  {
    id: 'S-WAV-100MIB',
    archivo: 'S-WAV-100MIB.wav',
    descripcion: `WAV 16-bit estéreo de exactamente ${LIMITE_BYTES} bytes (el límite, ~9:54)`,
    esperado: 201,
    formato: 'wav',
    generar: wavDeBytes(LIMITE_BYTES),
  },
  {
    id: 'S-WAV-100MIB-MAS-1',
    archivo: 'S-WAV-100MIB-MAS-1.wav',
    descripcion: 'WAV con un frame (4 bytes) más que el límite',
    esperado: 413,
    generar: wavDeBytes(LIMITE_BYTES + 4),
  },
  {
    id: 'S-WAV-24-96K',
    archivo: 'S-WAV-24-96K.wav',
    descripcion: 'WAV PCM 24-bit 96 kHz estéreo, 60 s',
    esperado: 201,
    formato: 'wav',
    generar: tono(60, 96000, ['-c:a', 'pcm_s24le']),
  },
  {
    id: 'S-WAV-F32',
    archivo: 'S-WAV-F32.wav',
    descripcion: 'WAV float 32-bit 44.1 kHz estéreo, 60 s',
    esperado: 201,
    formato: 'wav',
    generar: tono(60, 44100, ['-c:a', 'pcm_f32le']),
  },
  {
    id: 'S-WAV-MONO-22K',
    archivo: 'S-WAV-MONO-22K.wav',
    descripcion: 'WAV 16-bit mono 22.05 kHz, 60 s',
    esperado: 201,
    formato: 'wav',
    generar: tono(60, 22050, ['-ac', '1', '-c:a', 'pcm_s16le']),
  },
  {
    id: 'S-WAV-6CH',
    archivo: 'S-WAV-6CH.wav',
    descripcion: 'WAV 16-bit 5.1 (WAVE_FORMAT_EXTENSIBLE), 60 s',
    esperado: 201,
    formato: 'wav',
    generar: (destino) =>
      ffmpeg(
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=60',
        '-ac', '6', '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', destino,
      ),
  },
  {
    id: 'S-FLAC-24-96K',
    archivo: 'S-FLAC-24-96K.flac',
    descripcion: 'FLAC 24-bit 96 kHz estéreo, 60 s',
    esperado: 201,
    formato: 'flac',
    generar: tono(60, 96000, ['-c:a', 'flac', '-sample_fmt', 's32', '-bits_per_raw_sample', '24']),
  },
  {
    id: 'S-MP3-8K-MONO',
    archivo: 'S-MP3-8K-MONO.mp3',
    descripcion: 'MP3 16 kbps mono 8 kHz, 60 s',
    esperado: 201,
    formato: 'mp3',
    generar: tono(60, 8000, ['-ac', '1', '-c:a', 'libmp3lame', '-b:a', '16k']),
  },
  {
    id: 'S-NOMBRE-RARO',
    archivo: 'Mi Canción (final) ñ.v2.MP3',
    descripcion: 'R-MP3-CORTO con espacios, acentos, doble punto y extensión en mayúsculas',
    esperado: 201,
    formato: 'mp3',
    depende: 'R-MP3-CORTO',
    generar: copiaDe('R-MP3-CORTO'),
  },
  {
    id: 'S-SIN-EXTENSION',
    archivo: 'pista-sin-extension',
    descripcion: 'R-MP3-CORTO sin extensión',
    esperado: 400,
    depende: 'R-MP3-CORTO',
    generar: copiaDe('R-MP3-CORTO'),
  },
  {
    id: 'S-TXT',
    archivo: 'notas.txt',
    descripcion: 'Texto plano con extensión .txt',
    esperado: 400,
    generar: (destino) => writeFileSync(destino, 'esto no es un audio\n'),
  },
  {
    id: 'S-CORRUPTO-MP3',
    archivo: 'corrupto.mp3',
    descripcion: '1 MiB de bytes pseudoaleatorios con extensión .mp3',
    esperado: 201,
    contenidoInvalido: true,
    formato: 'mp3',
    generar: (destino) => {
      // Determinístico: el mismo archivo en cada máquina.
      const bloques: Buffer[] = []
      let semilla = Buffer.from('stemhub-psa')
      for (let i = 0; i < 1024 * 1024 / 32; i++) {
        semilla = createHash('sha256').update(semilla).digest()
        bloques.push(semilla)
      }
      writeFileSync(destino, Buffer.concat(bloques))
    },
  },
  {
    id: 'S-VACIO-WAV',
    archivo: 'vacio.wav',
    descripcion: 'Archivo de 0 bytes con extensión .wav',
    esperado: 201,
    contenidoInvalido: true,
    formato: 'wav',
    generar: (destino) => writeFileSync(destino, ''),
  },
  {
    id: 'S-TRUNCADO-WAV',
    archivo: 'truncado.wav',
    descripcion: 'Primera mitad de R-WAV-MEDIO (el header declara el largo completo)',
    esperado: 201,
    contenidoInvalido: true,
    formato: 'wav',
    depende: 'R-WAV-MEDIO',
    generar: (destino) => {
      const original = readFileSync(rutaAudio('R-WAV-MEDIO'))
      writeFileSync(destino, original.subarray(0, Math.floor(original.length / 2)))
    },
  },
  {
    id: 'S-AAC-COMO-MP3',
    archivo: 'aac-renombrado.mp3',
    descripcion: 'AAC en contenedor MP4 (m4a) renombrado a .mp3',
    esperado: 201,
    contenidoInvalido: true,
    formato: 'mp3',
    depende: 'R-MP3-CORTO',
    generar: (destino) =>
      ffmpeg('-i', rutaAudio('R-MP3-CORTO'), '-vn', '-c:a', 'aac', '-b:a', '128k', '-f', 'mp4', destino),
  },
  {
    id: 'S-MP3-COMO-WAV',
    archivo: 'mp3-renombrado.wav',
    descripcion: 'R-MP3-CORTO renombrado a .wav (se guarda con Content-Type audio/wav)',
    esperado: 201,
    contenidoInvalido: true,
    formato: 'wav',
    depende: 'R-MP3-CORTO',
    generar: copiaDe('R-MP3-CORTO'),
  },
]

// Audios que el backend acepta y el navegador debería reproducir.
export const AUDIOS_VALIDOS = AUDIOS.filter((a) => a.esperado === 201 && !a.contenidoInvalido)

export function audioPrueba(id: string): AudioPrueba {
  const audio = AUDIOS.find((a) => a.id === id)
  if (!audio) {
    throw new Error(`No existe el audio de prueba ${id}`)
  }
  return audio
}

export function sha256(ruta: string): string {
  return createHash('sha256').update(readFileSync(ruta)).digest('hex')
}

// Ruta local del audio, sin descargarlo ni generarlo (ver prepararAudio).
export function rutaAudio(id: string): string {
  const audio = audioPrueba(id)
  return resolve(audio.real ? dirDescargas : dirGenerados, audio.archivo)
}

// Devuelve la ruta del audio, descargándolo o generándolo si falta. Las
// descargas van a un archivo temporal y solo se aceptan si el sha256 coincide.
export async function prepararAudio(id: string): Promise<string> {
  const audio = audioPrueba(id)
  const ruta = rutaAudio(id)
  if (existsSync(ruta)) {
    return ruta
  }
  mkdirSync(dirname(ruta), { recursive: true })

  if (audio.real) {
    const res = await fetch(audio.real.url, {
      headers: { 'User-Agent': 'stemhub-e2e/1.0 (fixtures de pruebas)' },
    })
    if (!res.ok) {
      throw new Error(`Descarga de ${id} falló: HTTP ${res.status}`)
    }
    const temporal = `${ruta}.descargando`
    writeFileSync(temporal, Buffer.from(await res.arrayBuffer()))
    const hash = sha256(temporal)
    if (hash !== audio.real.sha256) {
      throw new Error(`${id}: sha256 ${hash} no coincide con ${audio.real.sha256}`)
    }
    renameSync(temporal, ruta)
    return ruta
  }

  if (audio.depende) {
    await prepararAudio(audio.depende)
  }
  audio.generar?.(ruta)
  return ruta
}

export interface InfoAudio {
  bytes: number
  sha256: string
  duracion: number | null
  ffprobe: string
}

// Duración y códec según ffprobe (null si no lo puede leer: contenido
// inválido).
export function infoAudio(ruta: string): InfoAudio {
  let salida = ''
  let duracion: number | null = null
  try {
    salida = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=format_name,duration:stream=codec_name,sample_rate,channels,bits_per_raw_sample',
      '-of', 'compact', ruta,
    ], { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    const coincidencia = /duration=([\d.]+)/.exec(salida)
    duracion = coincidencia ? Number(coincidencia[1]) : null
  } catch (err) {
    salida = `ffprobe falló: ${(err as Error).message.split('\n')[0]}`
  }
  return { bytes: statSync(ruta).size, sha256: sha256(ruta), duracion, ffprobe: salida }
}
