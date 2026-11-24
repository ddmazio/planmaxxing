export type AreaColor = 'trabalho' | 'estudos' | 'saude' | 'relacoes' | 'financas' | 'eu' | 'neutro'

export interface Base { id: string; created_at?: string; updated_at?: string }
export interface Owned extends Base { owner_id?: string }

export interface Profile {
  id: string
  display_name: string
  birth_date: string | null
  gender: string | null
  timezone: string
  currency_main: string
  currencies_extra: string[]
  week_starts_on: number
  onboarded: boolean
  /** preferências de aviso e consentimentos (ver supabase/functions/_shared/notify.ts) */
  notify?: Record<string, unknown>
}

export interface Area extends Owned {
  name: string; color: AreaColor; icon: string; position: number; is_fixed: boolean; focus: boolean
  score_now: number | null; score_goal: number | null; why: string | null; improve: string | null; archived: boolean
}

export interface List extends Owned { name: string; icon: string; position: number }

export interface Task extends Owned {
  list_id: string | null; title: string; notes: string | null; important: boolean; my_day: string | null
  due_on: string | null; due_time: string | null; remind_at: string | null
  repeat_rule: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays' | null
  area_id: string | null; step_id: string | null; completed_at: string | null; position: number
  external_id?: string | null
}

export interface TaskItem extends Base { task_id: string; title: string; done: boolean; position: number; assignee?: string | null }

export interface CalEvent extends Owned {
  title: string; starts_at: string; ends_at: string; all_day: boolean; kind: 'plan' | 'appointment'
  area_id: string | null; location: string | null; notes: string | null; reminder_minutes: number | null
  external_id?: string | null
  sync_google?: boolean; remote_updated?: string | null
}

export interface Habit extends Owned { area_id: string | null; title: string; days: number[]; archived: boolean; reminder_time?: string | null }
export interface HabitLog extends Owned { habit_id: string; day: string }

export interface Expense extends Owned {
  item: string; amount_cents: number; category: 'needs' | 'wants' | 'savings'; recurring: boolean; spent_on: string
  original_amount_cents?: number | null; original_currency?: string | null; fx_rate?: number | null; notes?: string | null
  pot_id?: string | null
}
export interface Income extends Owned {
  item: string; amount_cents: number; recurring: boolean; received_on: string
  original_amount_cents?: number | null; original_currency?: string | null; fx_rate?: number | null
}
export interface Pot extends Owned { name: string; target_cents: number; goal_id: string | null }
export interface Subscription extends Owned { name: string; amount_cents: number; billing_day: number; last_used_on: string | null }
export interface BudgetRule { owner_id?: string; needs_pct: number; wants_pct: number; savings_pct: number }
export interface Group extends Base { name: string; created_by: string; checkin_weekday: number }
export interface GroupMember { group_id: string; user_id: string; role: 'admin' | 'member'; share: 'nothing' | 'score' | 'goals' | 'all'; hidden_area_ids: string[]; shown_goal_area_ids?: string[]; joined_at: string }
export interface PushSub { id: string; owner_id: string; endpoint: string; p256dh: string; auth: string; device: string | null; created_at: string }
export interface Cheer { id: string; group_id: string; week: number; from_id: string; to_id: string; emoji: string; created_at: string }
export interface TaskComment { id: string; task_id: string; author_id: string; body: string; created_at: string }
export interface GroupInvite { id: string; group_id: string; created_at: string; expires_at: string; used_at: string | null; used_by?: string | null }
export interface Checkin extends Owned { group_id: string; week: number; score: number | null; intention: string | null; worked?: string | null }
export interface ListMember { list_id: string; user_id: string }

export type TableName =
  | 'profiles' | 'areas' | 'lists' | 'tasks' | 'task_items' | 'events' | 'habits' | 'habit_logs'
  | 'cycles' | 'goals' | 'steps' | 'reflections' | 'expenses' | 'incomes' | 'pots' | 'subscriptions' | 'budget_rules'
  | 'groups' | 'group_members' | 'checkins' | 'list_members' | 'calendars' | 'integrations' | 'cheers' | 'task_comments' | 'group_invites' | 'push_subscriptions' | 'event_conflicts'

export interface Query {
  columns?: string
  eq?: Record<string, string | number | boolean | null>
  gte?: Record<string, string | number>
  lt?: Record<string, string | number>
  order?: { column: string; ascending?: boolean }
}

export interface Cycle extends Owned {
  name: string; starts_on: string; ends_on: string; status: 'planning' | 'active' | 'closed'
  words: string[]; who_is_she: string[]
  /** recompensas por área de foco e a lista de ideias (prêmios), definidas no ritual */
  rewards?: { t: string; area: string }[]; ideas?: string[]
}
export interface Goal extends Owned {
  cycle_id: string; area_id: string | null; title: string; done_definition: string | null
  kind: 'project' | 'habit' | 'both'; position: number
}
export interface Step extends Owned {
  goal_id: string; title: string; week: number; detail: string | null; done_at: string | null; position: number
}
export interface Reflection extends Owned {
  cycle_id: string | null; kind: 'review' | 'checkin' | 'journal' | 'reset'; week: number | null
  prompt: string | null; answers: string[]; title: string | null; score: number | null
}

export interface Calendar extends Owned { external_id: string; name: string; color: string | null; visible: boolean; position: number }

export interface Integration { owner_id: string; provider: 'google' | 'microsoft'; account_email: string | null; status: 'active' | 'error'; last_sync_at: string | null; last_error: string | null; created_at: string; can_write?: boolean; two_way?: boolean }

export interface ConflictSide { title: string; starts_at: string; ends_at: string; all_day: boolean; location: string | null; notes: string | null; updated?: string }
export interface EventConflict { id: string; owner_id: string; event_id: string; local: ConflictSide; remote: ConflictSide; created_at: string }
