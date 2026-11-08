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
}

export interface TaskItem extends Base { task_id: string; title: string; done: boolean; position: number }

export interface CalEvent extends Owned {
  title: string; starts_at: string; ends_at: string; all_day: boolean; kind: 'plan' | 'appointment'
  area_id: string | null; location: string | null; notes: string | null; reminder_minutes: number | null
}

export interface Habit extends Owned { area_id: string | null; title: string; days: number[]; archived: boolean }
export interface HabitLog extends Owned { habit_id: string; day: string }

export interface Expense extends Owned {
  item: string; amount_cents: number; category: 'needs' | 'wants' | 'savings'; recurring: boolean; spent_on: string
  original_amount_cents?: number | null; original_currency?: string | null; notes?: string | null
}

export type TableName =
  | 'profiles' | 'areas' | 'lists' | 'tasks' | 'task_items' | 'events' | 'habits' | 'habit_logs'
  | 'cycles' | 'goals' | 'steps' | 'reflections' | 'expenses' | 'incomes' | 'pots' | 'subscriptions' | 'budget_rules'

export interface Query {
  eq?: Record<string, string | number | boolean | null>
  gte?: Record<string, string | number>
  lt?: Record<string, string | number>
  order?: { column: string; ascending?: boolean }
}

export interface Cycle extends Owned {
  name: string; starts_on: string; ends_on: string; status: 'planning' | 'active' | 'closed'
  words: string[]; who_is_she: string[]
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
