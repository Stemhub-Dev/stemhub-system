// Descarga y genera los audios de la prueba de subida (PSA) en .cache/audio/
// y muestra lo que ffprobe ve de cada uno. Se corre una vez antes de las
// specs psa-*: `npm run audios` (Node >= 23, que ejecuta TypeScript directo).
import { AUDIOS, infoAudio, prepararAudio } from '../support/audio.ts'

const filtro = process.argv.slice(2)
let fallas = 0

for (const audio of AUDIOS) {
  if (filtro.length > 0 && !filtro.includes(audio.id)) {
    continue
  }
  try {
    const info = infoAudio(await prepararAudio(audio.id))
    const mb = (info.bytes / 1024 / 1024).toFixed(1).padStart(6)
    const duracion = info.duracion === null ? '     ?' : `${info.duracion.toFixed(1).padStart(6)}s`
    console.log(`ok  ${audio.id.padEnd(20)} ${mb} MiB ${duracion}  esperado ${audio.esperado}  ${audio.archivo}`)
  } catch (err) {
    fallas += 1
    console.error(`ERR ${audio.id.padEnd(20)} ${(err as Error).message}`)
  }
}

process.exit(fallas > 0 ? 1 : 0)
