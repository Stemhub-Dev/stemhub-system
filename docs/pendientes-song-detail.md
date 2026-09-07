# Pendientes de `/proyectos/:id/canciones/:id`

Este documento lista lo que sigue mockeado en `stemhub-frontend/src/features/songs/SongDetailPage.tsx` después de conectar la funcionalidad core (sidebar de versiones real + reproducción de audio de la versión seleccionada, con onda visual vía `wavesurfer.js`). No implementado en esta iteración — reportado para priorizar a futuro.

## 1. Notas de versión y tags

- Mock: `NOTAS_VERSION_MOCK` (texto libre) y `TAGS_VERSION_MOCK` (chips tipo "+ guitarra rítmica", "batería -2dB", "pendiente: solo 2:30").
- Estado backend: no existe. La tabla `cancionversion` no tiene columna para notas ni para tags/etiquetas libres.
- Para implementar: agregar columna `notas` (text) a `cancionversion`, y una tabla `cancionversion_tag` (o similar) si se quiere soportar múltiples tags por versión con variante (neutro/alerta). Exponer en `POST .../versiones` (al crear) y en el DTO de listado.

## 2. Stems disponibles y "Separar Pistas"

- Mock: `STEMS_MOCK` (Batería, Bajo, Guitarra, Voz) y botón "Separar Pistas" sin handler.
- Estado backend: el modelo `Stem` ya existe en la base de datos (tabla `stem`, con `codigocancionversion`, `nombrestem`, `urlversionwav`, `urlversionmp3`), pero no hay repository/service/handler que lo exponga, y no hay ningún proceso de separación de audio (requeriría un servicio externo tipo Spleeter, que ya aparece mencionado en el README del repo para otro contexto).
- Para implementar: (a) endpoint `GET .../versiones/:versionId/stems` para listar stems ya generados, con su propia URL de descarga presignada (mismo patrón que el endpoint de audio de versión ya implementado); (b) un endpoint/job asincrónico que dispare la separación y genere los stems.

## 3. "Comparar Versiones"

- Mock: botón visible sin handler ni diseño de datos definido.
- Estado backend: no existe. Habría que definir qué significa "comparar" (¿diff de audio? ¿reproducir dos versiones en paralelo? ¿comparar notas/tags?) antes de diseñar el endpoint.

## 4. Comentarios con rango de tiempo y estado

- Mock: `COMENTARIOS_MOCK` con `rango` (ej. "en 2:31") y `estado: 'PENDIENTE' | 'HECHO' | null`.
- Estado backend: existen `POST` y `GET .../versiones/:versionId/comentarios`, con DTO `ComentarioListadoResponse` (`texto`, `estado`, `fechaHoraAlta`, `autor`, `esPropio`). El campo `estado` es un catálogo (`estado_comentario`) — hay que confirmar contra la tabla real qué valores tiene, no necesariamente coinciden con "PENDIENTE"/"HECHO" del mock.
- Falta: campo de rango de tiempo (inicio/fin en segundos dentro del audio) en el modelo de comentario — hoy no existe. Sin esto no se puede anclar un comentario a un punto de la onda.
- Nota: el input de comentario en el sidebar sigue deshabilitado (`disabled`) en el código actual — no se tocó en esta iteración porque el pedido se enfocó en la sección principal (reproductor).

## 5. Autor de la versión

- Mock: "subida hoy 14:22 por **Martín**".
- Estado backend: `VersionCancionListadoResponse` ya expone `fechaHoraAlta` (usado ahora en el front), pero no expone quién subió la versión. Si se quiere mostrar el autor, hay que agregar `codigoIntegranteAlta`/autor al modelo `cancionversion` y al DTO.

## 6. Refresco de URL presignada

- El nuevo endpoint `GET .../versiones/:versionId/audio` devuelve una URL de MinIO presignada con `expiraEnSegundos` (hoy 15 minutos, `service.VigenciaURLDescargaAudio` en el backend).
- El frontend no refresca la URL proactivamente antes de que expire — si el usuario deja la pestaña abierta más de 15 minutos sin recargar la versión, la reproducción puede fallar. Hoy no hay manejo de "URL vencida, reintentar" más allá del mensaje de error genérico que ya cae si `wavesurfer`/la petición fallan.
- Mejora futura: refrescar la URL automáticamente unos segundos antes del vencimiento, o reintentar transparente ante un error de carga de audio.
