// @ts-nocheck (código já verificado na origem)
// Dream Board · função "sync" (gerado por scripts/bundle-functions.mjs; edite em supabase/functions/sync/)

// supabase/functions/_shared/rest.ts
function makeDb(url, key) {
  const h = key.startsWith("sb_") ? { apikey: key, "Content-Type": "application/json" } : { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const call = async (method, path, body, extra = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...h, ...extra }, body: body === void 0 ? void 0 : JSON.stringify(body) });
    const t = await r.text();
    if (!r.ok) throw new Error(`db ${method} ${path.split("?")[0]} ${r.status}: ${t.slice(0, 300)}`);
    return t ? JSON.parse(t) : null;
  };
  return {
    rpc: (fn, args) => call("POST", `rpc/${fn}`, args),
    get: (path) => call("GET", path),
    /** Lê tudo, em páginas de 1000. */
    getAll: async (path) => {
      const out = [];
      for (let from = 0; ; from += 1e3) {
        const page = await call("GET", path, void 0, { Range: `${from}-${from + 999}`, "Range-Unit": "items" });
        out.push(...page);
        if (page.length < 1e3) return out;
      }
    },
    upsert: (table, rows, onConflict) => call("POST", `${table}?on_conflict=${onConflict}`, rows, { Prefer: "resolution=merge-duplicates,return=minimal" }),
    insert: (table, rows) => call("POST", table, rows, { Prefer: "return=minimal" }),
    patch: (path, body) => call("PATCH", path, body, { Prefer: "return=minimal" }),
    del: (path) => call("DELETE", path, void 0, { Prefer: "return=minimal" })
  };
}
var inList = (xs) => `(${xs.map((x) => `"${x.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")})`;
function projectKeys(env2) {
  const pick = (json2) => {
    try {
      const o = JSON.parse(json2);
      return o.default ?? Object.values(o)[0] ?? "";
    } catch {
      return "";
    }
  };
  return {
    service: env2("SUPABASE_SERVICE_ROLE_KEY") || pick(env2("SUPABASE_SECRET_KEYS")),
    anon: env2("SUPABASE_ANON_KEY") || pick(env2("SUPABASE_PUBLISHABLE_KEYS"))
  };
}

// supabase/functions/_shared/time.ts
function offsetMinutes(at, tz) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at);
  const m = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return (Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second) - at.getTime()) / 6e4;
}
function zonedIso(ymd, hhmm, tz) {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let t = guess - offsetMinutes(new Date(guess), tz) * 6e4;
  const again = guess - offsetMinutes(new Date(t), tz) * 6e4;
  if (again !== t) t = again;
  return new Date(t).toISOString();
}
function ymdIn(at, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
function addDaysYmd(ymd, n) {
  const d = /* @__PURE__ */ new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function graphDate(v) {
  if (!v?.dateTime) return null;
  const s = v.dateTime.replace(/\.\d+$/, "");
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s + "Z");
}

// supabase/functions/_shared/google.ts
var API = "https://www.googleapis.com/calendar/v3";
var calKey = (calId) => `gcal:${calId}`.slice(0, 300);
var eventKey = (calId, evId) => `gcal:${calId}:${evId}`.slice(0, 300);
function toRow(e, c, tz) {
  if (e.status === "cancelled" || e.eventType === "workingLocation" || !e.start || !e.end) return null;
  const allDay = !!e.start.date;
  let starts, ends;
  if (allDay) {
    const last = addDaysYmd(e.end.date, -1);
    starts = zonedIso(e.start.date, "00:00", tz);
    ends = zonedIso(last < e.start.date ? e.start.date : last, "23:59", tz);
  } else {
    if (!e.start.dateTime || !e.end.dateTime) return null;
    starts = new Date(e.start.dateTime).toISOString();
    ends = new Date(e.end.dateTime).toISOString();
    if (ends <= starts) ends = new Date(new Date(starts).getTime() + 30 * 6e4).toISOString();
  }
  const notes = [c.primary ? "" : `Agenda: ${c.summaryOverride || c.summary}`, e.description ?? ""].filter(Boolean).join("\n\n");
  return {
    external_id: eventKey(c.id, e.id),
    title: (e.summary || "(sem t\xEDtulo)").slice(0, 200),
    starts_at: starts,
    ends_at: ends,
    all_day: allDay,
    kind: "appointment",
    location: e.location ? e.location.slice(0, 200) : null,
    notes: notes ? notes.slice(0, 5e3) : null
  };
}
function calendarRow(c, i) {
  return {
    external_id: calKey(c.id),
    name: (c.summaryOverride || c.summary || "Agenda").slice(0, 200),
    color: /^#[0-9a-fA-F]{6}$/.test(c.backgroundColor ?? "") ? c.backgroundColor : null,
    position: i,
    visible: !!(c.selected || c.primary)
  };
}
async function get(token, path, params) {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Google ${path.split("/")[1]} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function listCalendars(token) {
  const out = [];
  let pageToken = "";
  do {
    const r = await get(token, "/users/me/calendarList", { maxResults: "250", ...pageToken ? { pageToken } : {} });
    out.push(...r.items);
    pageToken = r.nextPageToken ?? "";
  } while (pageToken);
  return out;
}
async function listEvents(token, cal, timeMin, timeMax, updatedMin) {
  const items = [];
  let pageToken = "";
  do {
    const r = await get(token, `/calendars/${encodeURIComponent(cal.id)}/events`, {
      singleEvents: "true",
      timeMin,
      timeMax,
      maxResults: "2500",
      ...updatedMin ? { updatedMin, showDeleted: "true" } : {},
      ...pageToken ? { pageToken } : {}
    });
    items.push(...r.items);
    pageToken = r.nextPageToken ?? "";
  } while (pageToken);
  return items;
}
async function refreshGoogle(clientId, clientSecret, refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error === "invalid_grant" ? "O Google desligou o acesso. Ligue de novo em Configura\xE7\xF5es." : `Google token ${r.status}`);
  return j.access_token;
}

// supabase/functions/_shared/microsoft.ts
var MS_SCOPE = "offline_access User.Read Tasks.ReadWrite";
var GRAPH = "https://graph.microsoft.com/v1.0";
var listKey = (listId) => `ms:${listId}`;
var taskKey = (listId, taskId) => `ms:${listId}:${taskId}`;
function parseTaskKey(ext) {
  if (!ext?.startsWith("ms:")) return null;
  const [, listId, taskId] = ext.split(":");
  return listId && taskId ? { listId, taskId } : null;
}
var WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var WEEKDAYS = WEEK.slice(1, 6);
function ruleFromMs(rec) {
  const p = rec?.pattern;
  if (!p?.type) return null;
  if ((p.interval ?? 1) !== 1) return void 0;
  if (p.type === "daily") return "daily";
  if (p.type === "weekly") {
    const days = (p.daysOfWeek ?? []).map((d) => d.toLowerCase()).sort();
    if (days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return "weekdays";
    return days.length <= 1 ? "weekly" : void 0;
  }
  if (p.type === "absoluteMonthly") return "monthly";
  if (p.type === "absoluteYearly") return "yearly";
  return void 0;
}
function ruleToMs(rule, dueYmd) {
  const d = /* @__PURE__ */ new Date(dueYmd + "T12:00:00Z");
  const range = { type: "noEnd", startDate: dueYmd };
  switch (rule) {
    case "daily":
      return { pattern: { type: "daily", interval: 1 }, range };
    case "weekdays":
      return { pattern: { type: "weekly", interval: 1, daysOfWeek: WEEKDAYS, firstDayOfWeek: "monday" }, range };
    case "weekly":
      return { pattern: { type: "weekly", interval: 1, daysOfWeek: [WEEK[d.getUTCDay()]], firstDayOfWeek: "monday" }, range };
    case "monthly":
      return { pattern: { type: "absoluteMonthly", interval: 1, dayOfMonth: d.getUTCDate() }, range };
    case "yearly":
      return { pattern: { type: "absoluteYearly", interval: 1, dayOfMonth: d.getUTCDate(), month: d.getUTCMonth() + 1 }, range };
  }
}
function msToApp(t, listId, isDefault, tz) {
  const due = graphDate(t.dueDateTime);
  const rem = t.isReminderOn ? graphDate(t.reminderDateTime) : null;
  const done = t.status === "completed" ? graphDate(t.completedDateTime) ?? new Date(t.lastModifiedDateTime ?? Date.now()) : null;
  const rule = ruleFromMs(t.recurrence);
  const notes = (t.body?.content ?? "").trim();
  return {
    external_id: taskKey(listId, t.id),
    list_external_id: isDefault ? null : listKey(listId),
    title: (t.title || "(sem t\xEDtulo)").slice(0, 300),
    notes: notes ? notes.slice(0, 5e3) : null,
    important: t.importance === "high",
    due_on: due ? ymdIn(due, tz) : null,
    remind_at: rem ? rem.toISOString() : null,
    completed_at: done ? done.toISOString() : null,
    ...rule === void 0 ? {} : { repeat_rule: rule },
    modified_at: t.lastModifiedDateTime ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
var utcPlain = (iso) => new Date(iso).toISOString().replace("Z", "");
function appToMs(t, todayYmd) {
  const body = {
    title: t.title,
    status: t.completed_at ? "completed" : "notStarted",
    importance: t.important ? "high" : "normal",
    body: { content: t.notes ?? "", contentType: "text" },
    // meio-dia em UTC: o dia não muda em nenhum fuso de -11h a +11h
    dueDateTime: t.due_on || t.repeat_rule ? { dateTime: `${t.due_on ?? todayYmd}T12:00:00`, timeZone: "UTC" } : null,
    isReminderOn: !!t.remind_at,
    reminderDateTime: t.remind_at ? { dateTime: utcPlain(t.remind_at), timeZone: "UTC" } : null
  };
  if (t.completed_at) body.completedDateTime = { dateTime: utcPlain(t.completed_at), timeZone: "UTC" };
  if (t.repeat_rule) body.recurrence = ruleToMs(t.repeat_rule, t.due_on ?? todayYmd);
  return body;
}
async function refreshMicrosoft(clientId, clientSecret, refreshToken) {
  const r = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token", scope: MS_SCOPE })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error === "invalid_grant" ? "A Microsoft desligou o acesso. Ligue de novo em Configura\xE7\xF5es." : `Microsoft token ${r.status}: ${j.error_description?.slice(0, 160) ?? ""}`);
  return { access: j.access_token, refresh: j.refresh_token ?? refreshToken };
}
async function graph(token, method, pathOrUrl, body) {
  const url = pathOrUrl.startsWith("http") ? pathOrUrl : GRAPH + pathOrUrl;
  const r = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' },
    body: body === void 0 ? void 0 : JSON.stringify(body)
  });
  if (r.status === 404) return null;
  if (r.status === 204) return {};
  if (!r.ok) {
    const txt = await r.text();
    const err = new Error(`Microsoft ${method} ${r.status}: ${txt.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

// supabase/functions/_shared/core.ts
var chunks = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
var DAY = 864e5;
async function syncGoogle(db2, owner, tz, access, last, forceFull = false) {
  const now = Date.now();
  const cals = await listCalendars(access);
  const existing = await db2.getAll(
    `calendars?select=id,external_id,name,color,position&owner_id=eq.${owner}&external_id=like.gcal:*`
  );
  const seen = /* @__PURE__ */ new Set();
  const fresh = [];
  for (const [i, c] of cals.entries()) {
    const row = calendarRow(c, i);
    seen.add(row.external_id);
    const ex = existing.find((x) => x.external_id === row.external_id);
    if (!ex) fresh.push({ owner_id: owner, ...row });
    else if (ex.name !== row.name || ex.color !== row.color || ex.position !== row.position)
      await db2.patch(`calendars?id=eq.${ex.id}`, { name: row.name, color: row.color, position: row.position });
  }
  if (fresh.length) await db2.insert("calendars", fresh);
  const gone = existing.filter((x) => !seen.has(x.external_id)).map((x) => x.id);
  if (gone.length) await db2.del(`calendars?id=in.(${gone.join(",")})`);
  const timeMin = new Date(now - 31 * DAY).toISOString();
  const timeMax = new Date(now + 365 * DAY).toISOString();
  const full = forceFull || !last.last_sync_at || !last.last_full_sync_at || now - Date.parse(last.last_full_sync_at) > DAY;
  const updatedMin = full ? void 0 : new Date(Date.parse(last.last_sync_at) - 10 * 6e4).toISOString();
  const rows = [];
  const cancelled = [];
  for (const c of cals) {
    for (const e of await listEvents(access, c, timeMin, timeMax, updatedMin)) {
      if (e.status === "cancelled") {
        cancelled.push(eventKey(c.id, e.id));
        continue;
      }
      const r = toRow(e, c, tz);
      if (r) rows.push({ owner_id: owner, ...r });
    }
  }
  for (const part of chunks(rows, 500)) await db2.upsert("events", part, "owner_id,external_id");
  for (const part of chunks(cancelled, 80)) await db2.del(`events?owner_id=eq.${owner}&external_id=in.${encodeURIComponent(inList(part))}`);
  let removed = cancelled.length;
  if (full) {
    const keep = new Set(rows.map((r) => r.external_id));
    const have = await db2.getAll(
      `events?select=id,external_id&owner_id=eq.${owner}&external_id=like.gcal:*&starts_at=gte.${encodeURIComponent(timeMin)}&starts_at=lt.${encodeURIComponent(timeMax)}`
    );
    const stale = have.filter((e) => !keep.has(e.external_id)).map((e) => e.id);
    for (const part of chunks(stale, 100)) await db2.del(`events?id=in.(${part.join(",")})`);
    removed += stale.length;
  }
  return { full, saved: rows.length, removed, calendars: cals.length };
}
async function graphAll(token, path) {
  const out = [];
  let next = path;
  while (next) {
    const page = await graph(token, "GET", next);
    if (!page) break;
    out.push(...page.value);
    next = page["@odata.nextLink"];
  }
  return out;
}
var TASK_COLS = "id,list_id,title,notes,important,due_on,remind_at,repeat_rule,completed_at,external_id";
async function msListOf(db2, t, state) {
  if (!t.list_id) return state.defaultList ?? null;
  const [l] = await db2.get(`lists?select=external_id&id=eq.${t.list_id}`);
  return l?.external_id?.startsWith("ms:") ? l.external_id.slice(3) : null;
}
async function pushTask(db2, access, state, t, today) {
  const target = await msListOf(db2, t, state);
  if (!target) return;
  const cur = parseTaskKey(t.external_id);
  const body = appToMs(t, today);
  if (cur && cur.listId === target) {
    const ok = await graph(access, "PATCH", `/me/todo/lists/${target}/tasks/${cur.taskId}`, body);
    if (ok) return;
  }
  const created = await graph(access, "POST", `/me/todo/lists/${target}/tasks`, body);
  if (!created) return;
  await db2.rpc("sync_link", { p_kind: "task", p_id: t.id, p_external: taskKey(target, created.id) });
  if (cur && cur.listId !== target) await graph(access, "DELETE", `/me/todo/lists/${cur.listId}/tasks/${cur.taskId}`);
}
async function pushList(db2, access, l) {
  if (l.external_id?.startsWith("ms:")) {
    const ok = await graph(access, "PATCH", `/me/todo/lists/${l.external_id.slice(3)}`, { displayName: l.name });
    if (ok) return;
  }
  const created = await graph(access, "POST", "/me/todo/lists", { displayName: l.name });
  if (created) await db2.rpc("sync_link", { p_kind: "list", p_id: l.id, p_external: listKey(created.id) });
}
async function pushOutbox(db2, owner, access, state, today) {
  let sent = 0;
  for (let round = 0; round < 10; round++) {
    const items = await db2.rpc("sync_take_outbox", { p_owner: owner, p_limit: 200 });
    if (!items?.length) break;
    const last = /* @__PURE__ */ new Map();
    for (const it of items) last.set(`${it.kind}:${it.entity_id}`, { ...it, external_id: it.external_id ?? last.get(`${it.kind}:${it.entity_id}`)?.external_id ?? null });
    const all = [...last.values()];
    const deletedLists = new Set(all.filter((x) => x.kind === "list" && x.op === "delete" && x.external_id).map((x) => x.external_id.slice(3)));
    const order = (x) => x.kind === "list" && x.op === "upsert" ? 0 : x.kind === "task" && x.op === "upsert" ? 1 : x.kind === "task" ? 2 : 3;
    for (const it of all.sort((a, b) => order(a) - order(b))) {
      try {
        if (it.kind === "list" && it.op === "upsert") {
          const [l] = await db2.get(`lists?select=id,name,external_id&id=eq.${it.entity_id}`);
          if (l) await pushList(db2, access, l);
        } else if (it.kind === "task" && it.op === "upsert") {
          const [t] = await db2.get(`tasks?select=${TASK_COLS}&id=eq.${it.entity_id}`);
          if (t) await pushTask(db2, access, state, t, today);
        } else if (it.kind === "task") {
          const k = parseTaskKey(it.external_id);
          if (k && !deletedLists.has(k.listId)) await graph(access, "DELETE", `/me/todo/lists/${k.listId}/tasks/${k.taskId}`);
        } else if (it.external_id?.startsWith("ms:") && it.external_id.slice(3) !== state.defaultList) {
          await graph(access, "DELETE", `/me/todo/lists/${it.external_id.slice(3)}`);
        }
        sent++;
      } catch (e) {
        const status = e.status;
        if (status === 401 || status === 403) throw e;
        console.error("push", it.kind, it.op, e.message);
      }
    }
  }
  return sent;
}
async function syncMicrosoft(db2, owner, tz, access, state) {
  const today = ymdIn(/* @__PURE__ */ new Date(), tz);
  const lists = (await graphAll(access, "/me/todo/lists")).filter((l) => l.wellknownListName !== "flaggedEmails");
  const def = lists.find((l) => l.wellknownListName === "defaultList");
  state.defaultList = def?.id;
  state.delta ??= {};
  const sent = state.linked ? await pushOutbox(db2, owner, access, state, today) : 0;
  const removed = (state.lists ?? []).filter((id) => !lists.some((l) => l.id === id)).map(listKey);
  const listRows = lists.filter((l) => l.id !== def?.id).map((l, i) => ({ external_id: listKey(l.id), name: l.displayName.slice(0, 60), position: i }));
  await db2.rpc("sync_apply_ms", { p_owner: owner, p_lists: listRows, p_tasks: [], p_removed: removed });
  for (const id of state.lists ?? []) if (!lists.some((l) => l.id === id)) delete state.delta[id];
  const tasks = [];
  for (const l of lists) {
    let link = state.delta[l.id] ?? `/me/todo/lists/${l.id}/tasks/delta`;
    for (let reset = 0; link; ) {
      let page;
      try {
        page = await graph(access, "GET", link);
      } catch (e) {
        if ((e.status === 410 || /syncStateNotFound|resync/i.test(e.message)) && reset++ === 0) {
          link = `/me/todo/lists/${l.id}/tasks/delta`;
          continue;
        }
        throw e;
      }
      if (!page) break;
      for (const t of page.value) {
        if (t["@removed"]) {
          removed.push(taskKey(l.id, t.id));
          continue;
        }
        const row = msToApp(t, l.id, l.id === def?.id, tz);
        if (!state.linked && row.completed_at && Date.now() - Date.parse(row.completed_at) > 60 * DAY) continue;
        tasks.push(row);
      }
      if (page["@odata.nextLink"]) link = page["@odata.nextLink"];
      else {
        if (page["@odata.deltaLink"]) state.delta[l.id] = page["@odata.deltaLink"];
        link = void 0;
      }
    }
  }
  if (!state.linked && tasks.length) {
    const appLists = await db2.getAll(`lists?select=id,external_id&owner_id=eq.${owner}`);
    const appTasks = await db2.getAll(`tasks?select=id,title,list_id&owner_id=eq.${owner}&external_id=is.null`);
    const used = /* @__PURE__ */ new Set();
    for (const t of tasks) {
      const listId = t.list_external_id ? appLists.find((l) => l.external_id === t.list_external_id)?.id ?? "x" : null;
      const m = appTasks.find((a) => !used.has(a.id) && a.list_id === listId && a.title.trim().toLowerCase() === t.title.trim().toLowerCase());
      if (m) {
        used.add(m.id);
        await db2.rpc("sync_link", { p_kind: "task", p_id: m.id, p_external: t.external_id });
      }
    }
  }
  for (const part of chunks(tasks, 300)) await db2.rpc("sync_apply_ms", { p_owner: owner, p_lists: [], p_tasks: part, p_removed: [] });
  if (removed.length) await db2.rpc("sync_apply_ms", { p_owner: owner, p_lists: [], p_tasks: [], p_removed: removed });
  state.lists = lists.map((l) => l.id);
  let created = 0;
  if (!state.linked) {
    const mine = await db2.getAll(`lists?select=id,name,external_id&owner_id=eq.${owner}&external_id=is.null`);
    for (const l of mine) {
      await pushList(db2, access, l);
      created++;
    }
    const open = await db2.getAll(`tasks?select=${TASK_COLS}&owner_id=eq.${owner}&external_id=is.null&completed_at=is.null&step_id=is.null`);
    for (const t of open) {
      await pushTask(db2, access, state, t, today);
      created++;
    }
    state.linked = true;
    await db2.rpc("sync_take_outbox", { p_owner: owner, p_limit: 1e4 });
  }
  return { sent, received: tasks.length, removed: removed.length, created };
}

// supabase/functions/sync/index.ts
var env = (k) => Deno.env.get(k) ?? "";
var SUPABASE_URL = env("SUPABASE_URL");
var KEYS = projectKeys(env);
var db = makeDb(SUPABASE_URL, KEYS.service);
var ORIGINS = ["https://planmaxxing.vercel.app", "http://localhost:5173"];
var cors = (req) => ({
  "Access-Control-Allow-Origin": ORIGINS.includes(req.headers.get("Origin") ?? "") ? req.headers.get("Origin") : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin"
});
var json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });
async function userOf(req) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEYS.anon, Authorization: auth } });
  return r.ok ? await r.json() : null;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method" });
  const body = await req.json().catch(() => ({}));
  let owners = null;
  let manual = false;
  const secret = req.headers.get("x-sync-secret");
  if (secret) {
    if (!await db.rpc("sync_secret_ok", { p_secret: secret })) return json(req, 401, { error: "secret" });
    if (body.owner && /^[0-9a-f-]{36}$/.test(body.owner)) owners = [body.owner];
  } else {
    const user = await userOf(req);
    if (!user) return json(req, 401, { error: "login" });
    owners = [user.id];
    manual = true;
  }
  const filter = owners ? `&owner_id=in.(${owners.join(",")})` : "";
  const provider = body.provider === "google" || body.provider === "microsoft" ? `&provider=eq.${body.provider}` : "";
  const integs = await db.get(`integrations?select=owner_id,provider,status,state,last_sync_at,last_full_sync_at${filter}${provider}`);
  const report = [];
  for (const it of integs) {
    const since = it.last_sync_at ? Date.now() - Date.parse(it.last_sync_at) : Infinity;
    if (!manual && it.provider === "google" && since < 14 * 6e4) continue;
    if (!manual && it.status === "error" && since < 60 * 6e4) continue;
    if (!await db.rpc("sync_lease", { p_owner: it.owner_id, p_provider: it.provider, p_seconds: 140 })) continue;
    const where = `integrations?owner_id=eq.${it.owner_id}&provider=eq.${it.provider}`;
    try {
      const [p] = await db.get(`profiles?select=timezone&id=eq.${it.owner_id}`);
      const tz = p?.timezone || "Europe/Lisbon";
      const token = await db.rpc("integration_token", { p_owner: it.owner_id, p_provider: it.provider });
      if (!token) throw new Error("Sem chave guardada. Ligue de novo em Configura\xE7\xF5es.");
      if (it.provider === "google") {
        const access = await refreshGoogle(env("GOOGLE_CLIENT_ID"), env("GOOGLE_CLIENT_SECRET"), token);
        const r = await syncGoogle(db, it.owner_id, tz, access, it, manual);
        await db.patch(where, { last_sync_at: (/* @__PURE__ */ new Date()).toISOString(), ...r.full ? { last_full_sync_at: (/* @__PURE__ */ new Date()).toISOString() } : {}, status: "active", last_error: null });
        report.push({ provider: "google", ...r });
      } else {
        const { access, refresh } = await refreshMicrosoft(env("MS_CLIENT_ID"), env("MS_CLIENT_SECRET"), token);
        if (refresh !== token) await db.rpc("integration_save", { p_owner: it.owner_id, p_provider: "microsoft", p_email: null, p_token: refresh });
        const state = { ...it.state ?? {} };
        const r = await syncMicrosoft(db, it.owner_id, tz, access, state);
        await db.patch(where, { state, last_sync_at: (/* @__PURE__ */ new Date()).toISOString(), status: "active", last_error: null });
        report.push({ provider: "microsoft", ...r });
      }
    } catch (e) {
      const msg = e.message.slice(0, 1e3);
      console.error(it.provider, msg);
      await db.patch(where, { status: "error", last_error: msg }).catch(() => {
      });
      report.push({ provider: it.provider, error: msg });
    } finally {
      await db.rpc("sync_lease", { p_owner: it.owner_id, p_provider: it.provider, p_seconds: 0 }).catch(() => {
      });
    }
  }
  return json(req, 200, { ok: true, report: manual ? report : void 0 });
});
