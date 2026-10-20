import pg from 'pg'
import { config } from './env'

// Acceso directo a Postgres para los pasos "consultar la BD" de las pruebas y
// para preparar datos que la API no deja fijar (fechas de alta).
const pool = new pg.Pool({ ...config.db, max: 2 })

export interface ConsultaDb {
  sql: string
  parametros: unknown[]
  filas: Record<string, unknown>[]
}

export async function consultar(sql: string, parametros: unknown[] = []): Promise<ConsultaDb> {
  const { rows } = await pool.query(sql, parametros)
  return { sql: sql.replace(/\s+/g, ' ').trim(), parametros, filas: rows }
}

export async function cerrarDb(): Promise<void> {
  await pool.end()
}
