# Login con Google

El botón "Google" del login usa el OAuth de **Supabase Auth** (GoTrue) con
PKCE. No hay SDK ni backend propio de por medio: el frontend redirige a
Supabase, Supabase a Google, y la vuelta llega a `/auth/callback` del
frontend con un `?code=` que se canjea por la sesión. El backend Go no
cambia: valida el JWT de Supabase igual que con email/contraseña, y la
primera vez el usuario pasa por `/registro` (con el nombre de Google ya
sugerido).

Si una persona ya tenía cuenta con email/contraseña y entra con Google con
el mismo email, Supabase vincula las dos identidades al mismo usuario: entra
a su cuenta de siempre, sin registrarse de nuevo.

Para que funcione hay que configurar tres cosas fuera del código: un cliente
OAuth en Google, el proveedor en Supabase Cloud (prod) y las credenciales en
la Supabase CLI (local).

## URLs de referencia

| Qué | Producción | Local |
|---|---|---|
| Frontend (origen JavaScript) | `https://app.stemhub.live` | `http://127.0.0.1:5173`, `http://localhost:5173` |
| Callback de Supabase (la que se carga en Google) | `https://<project-ref>.supabase.co/auth/v1/callback` | `http://127.0.0.1:54321/auth/v1/callback` |
| Callback del frontend (la que se carga en Supabase) | `https://app.stemhub.live/auth/callback` | `http://127.0.0.1:5173/auth/callback` (ya en `config.toml`) |

`<project-ref>` es el subdominio del proyecto de Supabase Cloud (el de
`SUPABASE_URL` en `.env.production`).

## 1. Cliente OAuth en Google Cloud Console

En <https://console.cloud.google.com>:

1. Crear un proyecto (por ejemplo "StemHub") o elegir uno existente.
2. **Google Auth Platform → Branding**: nombre de la app, mail de soporte y
   logo. En *Dominios autorizados* agregar `stemhub.live` y
   `<project-ref>.supabase.co`.
3. **Audience**: tipo *External*. Mientras la app esté en modo *Testing*
   solo pueden entrar los mails cargados como *Test users* (hasta 100). Para
   abrirla a cualquiera, *Publish app*: con los permisos básicos que usa
   Supabase (`openid`, `email`, `profile`) no hace falta verificación de
   Google.
4. **Clients → Create client**, tipo *Web application*:
   - *Authorized JavaScript origins*: los orígenes del frontend de la tabla.
   - *Authorized redirect URIs*: las dos callbacks de Supabase de la tabla
     (prod y local).
5. Guardar el **Client ID** y el **Client secret**. El secret no se commitea
   ni se pega en chats o issues.

Un solo cliente sirve para prod y local. Si se prefiere separar, crear dos
clientes con las URLs de cada entorno.

## 2. Producción: Supabase Cloud

En el dashboard del proyecto de Supabase:

1. **Authentication → Sign In / Providers → Google**: habilitar, pegar el
   Client ID y el Client secret, guardar.
2. **Authentication → URL Configuration**:
   - *Site URL*: `https://app.stemhub.live`.
   - *Redirect URLs*: agregar `https://app.stemhub.live/auth/callback`.

No hace falta tocar Coolify ni variables de entorno: el frontend ya apunta a
Supabase Cloud (`VITE_GOTRUE_URL`) y el backend no cambia. Para comprobar
que quedó habilitado (la anon key es pública, es la misma que usa el
frontend):

```bash
curl -s "https://<project-ref>.supabase.co/auth/v1/settings" \
  -H "apikey: <anon key>" | grep -o '"google":[a-z]*'
# "google":true
```

## 3. Local: Supabase CLI

`Stem-Hub-BackEnd/supabase/config.toml` ya tiene `[auth.external.google]`
habilitado y lee las credenciales de variables de entorno:

```bash
cd Stem-Hub-BackEnd
cp supabase/.env.example supabase/.env   # completar CLIENT_ID y SECRET
npx supabase stop && npx supabase start  # la CLI lee config y .env al arrancar
```

Sin `supabase/.env`, `supabase start` levanta igual y el resto del login
funciona; solo el botón de Google termina en un error de Google
(`invalid_client`).

## Problemas comunes

| Síntoma | Causa |
|---|---|
| "El ingreso con Google no está habilitado todavía." | El proveedor está apagado en Supabase (paso 2.1 o falta `supabase/.env` en local). |
| Google muestra `redirect_uri_mismatch` | Falta la callback **de Supabase** en *Authorized redirect URIs* de Google. |
| Después de Google vuelve al *Site URL* (home o login) en vez de a `/auth/callback`, sin sesión | Falta `…/auth/callback` en las *Redirect URLs* de Supabase: GoTrue descarta un `redirect_to` que no esté en la lista. |
| Google dice que la app no está disponible o que el acceso está bloqueado | App en modo *Testing* y el mail no está en *Test users*. |
| El botón de Google muestra un error sin salir del login | La app se abrió por `http://` con una IP de la red local: el navegador no expone `crypto.subtle` fuera de https/localhost y no se puede generar el PKCE. |
