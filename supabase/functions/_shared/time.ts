/** Utilidades de data sem dependências (rodam no Deno das funções e no Node dos testes). */

function offsetMinutes(at: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return (Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second) - at.getTime()) / 60000
}

/** "2026-11-12" + "09:30" no fuso da pessoa → ISO em UTC. */
export function zonedIso(ymd: string, hhmm: string, tz: string) {
  const [y, mo, d] = ymd.split('-').map(Number)
  const [h, mi] = hhmm.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi)
  let t = guess - offsetMinutes(new Date(guess), tz) * 60000
  const again = guess - offsetMinutes(new Date(t), tz) * 60000
  if (again !== t) t = again
  return new Date(t).toISOString()
}

/** Instante → "YYYY-MM-DD" no fuso da pessoa. */
export function ymdIn(at: Date, tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export function addDaysYmd(ymd: string, n: number) {
  const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** dateTime do Graph ("2026-11-12T00:00:00.0000000" + timeZone "UTC") → Date. */
export function graphDate(v?: { dateTime: string; timeZone?: string } | null): Date | null {
  if (!v?.dateTime) return null
  const s = v.dateTime.replace(/\.\d+$/, '')
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s + 'Z')
}
