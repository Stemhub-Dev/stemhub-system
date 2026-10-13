import { config } from './env'

// Mailpit es el SMTP de desarrollo de la Supabase CLI: el backend le manda
// el mail de invitación y su API permite leerlo.

export interface MailRecibido {
  ID: string
  Subject: string
  Text: string
  From: { Address: string }
  To: { Address: string }[]
}

export async function esperarMail(destinatario: string, limiteMs = 30_000): Promise<MailRecibido> {
  const fin = Date.now() + limiteMs
  for (;;) {
    const res = await fetch(
      `${config.mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:"${destinatario}"`)}`,
    )
    const { messages } = (await res.json()) as { messages: { ID: string }[] }
    if (messages[0]) {
      return (await (await fetch(`${config.mailpitUrl}/api/v1/message/${messages[0].ID}`)).json()) as MailRecibido
    }
    if (Date.now() > fin) {
      throw new Error(`No llegó ningún mail a ${destinatario} en ${limiteMs} ms`)
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
}
