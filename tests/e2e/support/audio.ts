import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
