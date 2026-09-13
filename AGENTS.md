# AGENTS.md — stemhub-system

Contexto para agentes/chats futuros que retomen este repo. Complementa a
`README.md` (que explica cómo levantar el proyecto) con la arquitectura
general, el estado real de implementación de cada parte, y detalles no
obvios para no repetir trabajo de descubrimiento.

## Qué es este repo: un monorepo-orquestador

`stemhub-system` **no contiene código de aplicación propio**. Es el
orquestador: define el `docker-compose.yml` raíz, los scripts `up`/`down`, y
`setup.sh`, que clona los repos reales de StemHub como subcarpetas:

```
stemhub-system/
├── docker-compose.yml          # orquesta todo el stack
├── setup.sh                    # clona/actualiza los 3 repos de abajo (rama main)
├── up.sh / down.sh / up.ps1 / down.ps1
├── Stem-Hub-BackEnd/            # repo propio: github.com/Stemhub-Dev/Stem-Hub-BackEnd
├── stemhub-frontend/            # repo propio: github.com/Stemhub-Dev/stemhub-frontend
└── stemhub-microservicio-IA/    # repo propio: github.com/Stemhub-Dev/stemhub-microservicio-IA
```

Cada carpeta es un **repositorio git independiente** (remoto propio, ramas
propias), no un submódulo ni un monorepo real con historia compartida. Esto
importa para cualquier agente que trabaje acá: `git status`/`git log` en la
raíz de `stemhub-system` **no refleja los cambios de Stem-Hub-BackEnd ni de
stemhub-frontend** — hay que pararse en cada subcarpeta y chequear su propio
estado de rama por separado.

**Gotcha operativo importante**: `setup.sh` clona/resetea cada repo a
`main`, pero el trabajo activo (features recientes, incluida esta sesión)
vive en la rama `dev` de cada repo, que suele estar *adelantada* respecto a
`main` (mergeada solo hacia `dev`, no promovida a `main` todavía). Si algo
"no está implementado" al levantar el stack, lo primero a chequear es en qué
rama está parada cada subcarpeta (`git -C Stem-Hub-BackEnd branch
--show-current`, ídem `stemhub-frontend`) antes de asumir que falta código.
El `docker-compose.yml` construye las imágenes desde el checkout local de
cada carpeta (`context: ./Stem-Hub-BackEnd`, `context: ./stemhub-frontend`),
así que la imagen refleja literalmente la rama que esté checked-out ahí en
ese momento, no un target fijo.

## Arquitectura general

```
Navegador ──► Frontend (React/Vite, :5173)
                 │                    │
                 │ REST/JSON+multipart│ REST directo (login/signup)
                 ▼                    ▼
             Backend (Go/Gin, :8080)  Supabase Auth/GoTrue local (:54321, vía Kong)
                 │        │
                 │        └──► MinIO (:9000/:9001) — storage de audio
                 ▼
             Postgres (:5432)

ML Service (Python/FastAPI, :8000) ──► MinIO (mismo bucket "stemhub-audio")
        │
        └──► spleeter-worker (interno, separación de pistas)
```

- **Backend Go** es dueño de todo el modelo de dominio (usuarios, proyectos,
  canciones, versiones, comentarios, permisos) y de Postgres. No delega
  persistencia a nadie.
- **Autenticación** está delegada a Supabase Auth (GoTrue) local, corrido
  aparte con la CLI de Supabase (`npx supabase start`, no es un servicio de
  este `docker-compose.yml` — por eso `up.sh`/`down.sh` orquestan ambos
  mundos en el orden correcto). El backend Go **no crea credenciales**, solo
  valida JWTs de GoTrue contra su JWKS y sincroniza un perfil de negocio
  (`usuario`+`integrante`) la primera vez que ve un `idautenticacion` nuevo.
- **MinIO** es el storage de archivos de audio, compartido entre el backend
  Go (canciones/versiones subidas por el usuario) y el microservicio de IA
  (stems separados por Spleeter). Mismo bucket (`stemhub-audio`), prefijos de
  key distintos por dominio para no colisionar.
- **Microservicio de IA** es *stateless* a propósito: no conoce Postgres ni
  el modelo de dominio, es una función de transformación (separación de
  pistas + insights de comentarios vía LLM). El backend Go orquesta las
  llamadas. Ver `stemhub-microservicio-IA/AGENTS.md` para el detalle interno
  de ese repo (ya tiene su propio AGENTS.md, no se duplica acá).

## Estado de implementación — Backend (Stem-Hub-BackEnd, rama `dev`)

Go + Gin + `pgx` (driver Postgres) + migraciones SQL versionadas
incrementales (`migrations/001...` a `010...`).

**Implementado y funcional:**
- Auth: middleware que valida JWT de Supabase contra JWKS
  (`internal/middleware`), `POST /usuarios/registrar` sincroniza
  usuario+integrante tras el primer login/signup.
- Roles y permisos: catálogo de roles (`GET /roles`), permisos por ámbito
  (SISTEMA/PROYECTO), asignación de rol a usuario, middleware
  `RequerirPermiso`.
- Perfil: `GET /perfil`.
- Proyectos: crear (`POST /proyectos/crear`) y listar (`GET /proyectos`),
  con géneros musicales y tipo de proyecto (Album/EP) como catálogos.
- Canciones y versiones — **recién reescrito en esta sesión**:
  - `POST /proyectos/:proyectoId/canciones` y
    `.../canciones/:cancionId/versiones` reciben ahora `multipart/form-data`
    (antes era JSON con URLs de texto plano ya resueltas — ver sección
    "Cambio reciente" abajo).
  - `GET /proyectos/:proyectoId/canciones` y `.../versiones` para listar.
  - Validación de nombre único por proyecto, permisos
    `GESTIONAR_CANCIONES`/`GESTIONAR_VERSIONES`, perfil requerido.
- Comentarios: crear y listar por versión de canción
  (`.../versiones/:versionId/comentarios`), con estado de comentario.
- Storage de audio: cliente MinIO propio (`internal/storage`), agregado en
  esta sesión — antes el backend Go no tenía ninguna integración con MinIO.

**Existe en el modelo de datos pero sin capa de servicio/handler/ruta**
(o sea: la tabla está, el código Go no):
- `stem` (`internal/model/stem.go`, tabla `stem` en
  `001esquemainicial.sql`): pensado para los stems separados por el
  microservicio de IA. No hay `StemRepository`/`StemService`/`StemHandler`
  ni ruta registrada — es la próxima pieza natural a construir si se conecta
  el backend con `stemhub-microservicio-IA`.

**No implementado / fuera de alcance actual:**
- Ningún endpoint llama al microservicio de IA todavía (ni separación de
  pistas ni insights de comentarios) — los dos sistemas existen pero no
  están conectados.
- No hay endpoint de lectura que devuelva una URL presignada de descarga
  para reproducir el audio subido — el backend guarda el *object key* de
  MinIO (no una URL), y no existe todavía un endpoint que la resuelva a una
  URL firmada temporal. Deuda explícita, no fue pedida aún.
- Analíticas y notificaciones: sin ningún endpoint (el frontend los tiene
  como placeholders vacíos, ver abajo).

## Estado de implementación — Frontend (stemhub-frontend, rama `dev`)

React + Vite + TypeScript + React Router + Axios. Sin Redux/Zustand — estado
local por feature con `useState`/`useEffect`, un `SessionProvider` de
contexto para sesión/perfil.

**Implementado y funcional:**
- Auth: `/login` con toggle Ingresar/Crear cuenta en un mismo formulario
  (`LoginPage.tsx`) — signup por email+password vía GoTrue REST directo
  (`src/lib/auth/gotrue.ts`, sin SDK `supabase-js`), más login con Google
  OAuth. `/registro` (`RegisterProfilePage.tsx`) cubre el caso de completar
  perfil tras login por Google (no pide nombre en el flujo OAuth).
- Home, listado de proyectos (`/proyectos`), crear proyecto
  (`/proyectos/nuevo`) con selección de género/tipo de proyecto.
- Canciones: listado por proyecto (`SongsPage`), "Mis canciones"
  (`MySongsPage`), detalle de canción (`SongDetailPage`, con reproductor
  visual **mockeado** — tiempos hardcodeados, sin audio real todavía), crear
  canción (`/proyectos/:id/canciones/nueva`) y agregar nueva versión inline
  (`AddVersionForm`) — **recién reescritos en esta sesión** para subir un
  archivo real (mp3/wav/flac) en vez de pegar una URL de texto.
- Comentarios sobre una versión de canción (mostrados en `SongDetailPage`).

**Placeholders / mockups sin backend real** (rutas registradas, pantalla
existe, pero es maqueta o está vacía):
- `/stems` (`StemsPage.tsx`): maqueta con datos mockeados siguiendo diseño
  de Figma, comentario explícito en el código de que no hay endpoint de
  stems en el backend todavía.
- `/analiticas` (`AnalyticsPage.tsx`) y `/notificaciones`
  (`NotificationsPage.tsx`): placeholders vacíos (`<div>...placeholder</div>`),
  sin ningún diseño ni lógica.

**Cliente HTTP**: instancia única de Axios (`src/lib/http/client.ts`) con un
interceptor que agrega `Authorization: Bearer <token>` y maneja refresh en
401. Soporta `multipart/form-data` sin configuración adicional — Axios
detecta `FormData` automáticamente y setea el `Content-Type` con boundary.

## Cambio reciente: upload real de audio (esta sesión)

Antes de esta sesión, "crear canción"/"crear versión" en el backend
aceptaban únicamente JSON con `urlVersionWav`/`urlVersionMp3` como strings
— el cliente debía haber subido el archivo a algún lugar externo por su
cuenta y pasar la URL ya resuelta. No existía upload de archivo real en
ningún punto del sistema (ni backend, ni frontend), pese a que MinIO ya
estaba definido en el `docker-compose.yml` raíz y en uso por el
microservicio de IA.

Se implementó upload real end-to-end:

1. **Esquema de datos** (`Stem-Hub-BackEnd/migrations/010cancionversionarchivounico.sql`):
   `cancionversion` tenía `urlversionwavcancionver` + `urlversionmp3cancionver`
   (una columna nullable por formato, sin soporte FLAC, pensado para "puede
   tener wav Y mp3 a la vez"). Se reemplazaron por `urlarchivocancionver`
   (el *object key* de MinIO, no una URL presignada) +
   `formatoarchivocancionver` (`CHECK IN ('mp3','wav','flac')`), ya que en la
   práctica cada versión es un único archivo subido por el usuario.
2. **Transporte**: `POST /proyectos/:id/canciones` y
   `.../versiones` pasaron de `application/json` a `multipart/form-data`
   (`c.FormFile("archivo")` + `c.PostForm("nombre")`), con validación de
   extensión (mp3/wav/flac) y tamaño máximo (100 MB,
   `service.TamanoMaximoArchivoAudio`).
3. **Storage** (`Stem-Hub-BackEnd/internal/storage/minio_client.go`): cliente
   MinIO nuevo para el backend Go (antes solo lo usaba el microservicio
   Python), con auto-creación del bucket `stemhub-audio` en el boot si no
   existe (`BucketExists`/`MakeBucket`). Variables `MINIO_*` agregadas al
   servicio `backend` del `docker-compose.yml` raíz (antes solo las tenía
   `ml-service`).
4. **Orquestación transaccional** (`internal/service/cancion_service.go`):
   se inserta primero la fila `cancion` (para obtener el ID real y armar la
   key `proyectos/{id}/canciones/{id}/v{n}.{ext}`), se sube el archivo a
   MinIO, y recién después se inserta `cancionversion` y se hace commit. Si
   el upload a MinIO falla, se hace `ROLLBACK` de la fila `cancion` (no
   queda huérfana en Postgres). Si el upload tiene éxito pero el commit
   posterior falla, puede quedar un objeto huérfano en MinIO — riesgo
   aceptado explícitamente, sin job de limpieza automática (ver plan
   original si se retoma esta decisión).
5. **Frontend**: `CreateSongPage.tsx` y `AddVersionForm.tsx` ahora tienen un
   único `<input type="file" accept=".mp3,.wav,.flac,...">` (helper
   compartido en `src/lib/audioFile.ts`), con validación de extensión
   client-side antes de enviar. `CreateSongPage.tsx` además muestra un campo
   "Versión" con `value="v1"` fijo y `disabled` — puramente informativo, no
   se envía en el payload (el backend sigue generando `numeroVersion=1`
   automáticamente). `api/canciones.ts` arma `FormData` en vez de un objeto
   JS plano.

**Alcance explícitamente NO cubierto por este cambio** (deuda anotada, no
fue pedida): no hay endpoint que devuelva una URL presignada de descarga
para reproducir el audio — el frontend hoy no reproduce archivos reales, el
reproductor de `SongDetailPage` sigue siendo visual/mockeado. `CrearVersion`
se actualizó a nivel API (mismo multipart) para no dejar el backend en
estado inconsistente/roto, pero no se construyó ninguna pantalla nueva de
frontend para "nueva versión" más allá del form inline ya existente.

## Notas operativas para agentes

- Para tocar código de Stem-Hub-BackEnd o stemhub-frontend, `cd` a la
  subcarpeta correspondiente y verificar rama con `git branch --show-current`
  antes de asumir nada — no confiar en el estado de la raíz `stemhub-system`.
- No hay Go instalado en el entorno local de desarrollo en algunos casos —
  usar `docker run --rm -v "$(pwd)":/app -w /app golang:1.26-alpine sh -c
  "go build ./..."` (o `go vet`, `gofmt`) contra `Stem-Hub-BackEnd` cuando
  falte el toolchain nativo.
- Las migraciones SQL solo se aplican automáticamente al inicializar un
  volumen de Postgres **vacío** (`docker-entrypoint-initdb.d`). Si ya existe
  un volumen con datos, una migración nueva hay que aplicarla a mano
  (`docker compose exec -T postgres psql -U <user> -d <db> < migrations/0XX...sql`)
  o recrear el volumen — no asume que un `docker compose up` posterior la
  vaya a correr sola.
- El `.env` real (no versionado) vive en la raíz de `stemhub-system` y lo
  comparten todos los servicios del `docker-compose.yml` — variables nuevas
  que necesite el backend o el microservicio (como las de MinIO) se agregan
  ahí y en `.env.example` como referencia, no en un `.env` por subcarpeta.
