# Pruebas end-to-end (PRU-01 a PRU-09)

Playwright contra el stack local real levantado con `./up.sh`. Los
resultados y la evidencia están documentados en
[`docs/pruebas/README.md`](../../docs/pruebas/README.md).

```bash
npm install
npx playwright test                 # las 9 pruebas (~1 min)
npx playwright test specs/pru-05    # una sola
npx playwright show-report          # reporte HTML con capturas y trazas
```

Requisitos: stack levantado, `ffmpeg` y Google Chrome (se usa
`channel: 'chrome'`, no hace falta `npx playwright install`).

- Lee el `.env` de la raíz de `stemhub-system` (base de datos, anon key).
  Las URLs se pueden cambiar con `E2E_FRONTEND_URL`, `E2E_API_URL`,
  `E2E_GOTRUE_URL` y `E2E_MAILPIT_URL`.
- Cada prueba crea sus propios usuarios (`qa-*@test.local`), proyectos y
  audios; no depende de datos existentes ni los borra.
- La evidencia (capturas numeradas por paso, requests/responses HTTP y
  consultas a la BD) se escribe en `docs/pruebas/evidencia/PRU-XX/` y
  reemplaza la de la corrida anterior.
- `support/` tiene los helpers: `api.ts` (backend y GoTrue), `db.ts`
  (Postgres), `mailpit.ts`, `audio.ts` (genera `.wav` con ffmpeg) y
  `evidencia.ts` (capturas y login por la UI).
