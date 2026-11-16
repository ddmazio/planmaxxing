/** Peças puras da função "admin" (testadas em admin.test.ts). */
export interface AuthUser {
  id: string; email?: string; created_at: string; last_sign_in_at?: string | null
  banned_until?: string | null; invited_at?: string | null; email_confirmed_at?: string | null
  user_metadata?: { full_name?: string; name?: string }
}
export interface Person {
  id: string; email: string; name: string | null; created_at: string; last_sign_in_at: string | null
  blocked: boolean; pending: boolean; admin: boolean
}

/** Só o necessário para administrar: quem é, desde quando, se entrou, se está bloqueada. Nada dos dados da pessoa. */
export function toPerson(u: AuthUser, displayName: string | null, admin: boolean, now = Date.now()): Person {
  return {
    id: u.id,
    email: u.email ?? '',
    name: displayName || u.user_metadata?.full_name || u.user_metadata?.name || null,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    blocked: !!u.banned_until && Date.parse(u.banned_until) > now,
    pending: !u.last_sign_in_at,
    admin,
  }
}

export function inviteError(msg: string) {
  if (/already been registered|already registered|email_exists|User already/i.test(msg)) return 'Esta pessoa já tem conta.'
  if (/rate limit/i.test(msg)) return 'Muitos convites seguidos. Espere um pouco.'
  return 'Não deu para criar o convite agora.'
}
