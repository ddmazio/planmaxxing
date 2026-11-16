// @ts-nocheck (código já verificado na origem)
// Dream Board · função "notify" (gerado por scripts/bundle-functions.mjs; edite em supabase/functions/notify/)

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

// supabase/functions/_shared/webpush.ts
var enc = new TextEncoder();
var enc8 = (t) => new Uint8Array(enc.encode(t));
var b64u = (b) => {
  const a = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (const x of a) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
var fromB64u = (s) => {
  const p = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
var concat = (...xs) => {
  const o = new Uint8Array(xs.reduce((a, x) => a + x.length, 0));
  let i = 0;
  for (const x of xs) {
    o.set(x, i);
    i += x.length;
  }
  return o;
};
async function newVapid(subject) {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  return { publicKey: b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), privateJwk: await crypto.subtle.exportKey("jwk", kp.privateKey), subject };
}
async function vapidAuth(endpoint, v, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(enc8(JSON.stringify({ aud, exp: Math.floor(now / 1e3) + 12 * 3600, sub: v.subject })));
  const key = await crypto.subtle.importKey("jwk", v.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc8(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${v.publicKey}`;
}
async function hkdf(ikm, salt, info, len) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8));
}
async function encrypt(payload, p256dh, auth, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const ua = fromB64u(p256dh);
  const secret = fromB64u(auth);
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(shared, secret, concat(enc8("WebPush: info\0"), ua, asPub), 32);
  const cek = await hkdf(ikm, salt, enc8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, enc8("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc8(payload), new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}
async function sendPush(sub, message, v, ttl = 3600) {
  const body = await encrypt(JSON.stringify(message), sub.p256dh, sub.auth);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: { Authorization: await vapidAuth(sub.endpoint, v), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", TTL: String(ttl), Urgency: "normal" },
    body
  });
  await r.body?.cancel().catch(() => {
  });
  return r.status;
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

// supabase/functions/_shared/notify.ts
var DEFAULT_PREFS = {
  plan: { on: true, time: "18:00" },
  close: { on: true, time: "20:30" },
  checkin: { on: true, before: 15 },
  morning: { on: true, time: "08:00" },
  habits: { on: true },
  events: { on: true },
  cheers: { on: true },
  scores: { on: false },
  quiet: { on: true, from: "23:00", to: "07:30" }
};
function prefsOf(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = { ...DEFAULT_PREFS };
  for (const k of Object.keys(DEFAULT_PREFS)) out[k] = { ...DEFAULT_PREFS[k], ...r[k] ?? {} };
  return out;
}
var WINDOW = 10 * 6e4;
var inWindow = (iso, now) => {
  const t = Date.parse(iso);
  return t <= now && t > now - WINDOW;
};
var hm = (d, tz) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d);
var dow = (ymd) => (/* @__PURE__ */ new Date(ymd + "T12:00:00Z")).getUTCDay();
var toMin = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};
function inQuiet(p, at, tz) {
  if (!p.quiet.on) return false;
  const n = toMin(hm(at, tz)), a = toMin(p.quiet.from), b = toMin(p.quiet.to);
  return a <= b ? n >= a && n < b : n >= a || n < b;
}
function due(people, d, nowMs = Date.now()) {
  const out = [];
  const now = new Date(nowMs);
  for (const person of people) {
    const tz = person.timezone || "Europe/Lisbon";
    const p = prefsOf(person.notify);
    const today = ymdIn(now, tz);
    const wd = dow(today);
    const at = (time, day = today) => zonedIso(day, time.slice(0, 5), tz);
    const cyc = d.cycles.find((c) => c.owner_id === person.id);
    const week = cyc ? Math.floor((Date.parse(today) - Date.parse(cyc.starts_on)) / (7 * 864e5)) + 1 : null;
    const quiet = inQuiet(p, now, tz);
    const push = (o) => {
      if (!quiet || o.strong) out.push({ owner: person.id, ...o });
    };
    if (wd === 0 && p.plan.on && inWindow(at(p.plan.time), nowMs))
      push({ kind: "plan", key: today, title: week && week < 12 ? `Vamos planejar a semana ${week + 1}?` : "Vamos planejar a semana?", body: "Uns 10 minutos: o que ficou para tr\xE1s, a sua semana e a agenda.", url: "/ciclo/ritual" });
    if (wd === 0 && p.close.on && inWindow(at(p.close.time), nowMs))
      push({ kind: "close", key: today, title: week && week <= 12 ? `Hora de fechar a semana ${week}` : "Hora de fechar a semana", body: "Veja o seu placar e fa\xE7a o check-in.", url: "/ciclo/ritual" });
    if (p.morning.on && inWindow(at(p.morning.time), nowMs)) {
      const steps = week ? d.steps.filter((s) => s.owner_id === person.id && s.week === week && !s.done_at).length : 0;
      const habits = d.habits.filter((h) => h.owner_id === person.id && h.days.includes(wd)).length;
      const first = d.events.filter((e) => e.owner_id === person.id && !e.all_day && ymdIn(new Date(e.starts_at), tz) === today && Date.parse(e.starts_at) > nowMs).sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
      const parts = [steps && `${steps} passo${steps === 1 ? "" : "s"}`, habits && `${habits} h\xE1bito${habits === 1 ? "" : "s"}`].filter(Boolean);
      push({ kind: "morning", key: today, title: "Bom dia", body: [parts.length ? `${parts.join(" e ")} hoje.` : "Dia livre no plano.", first && `Primeiro bloco: ${first.title} \xE0s ${hm(new Date(first.starts_at), tz)}.`].filter(Boolean).join(" "), url: "/" });
    }
    if (p.habits.on) {
      for (const h of d.habits.filter((x) => x.owner_id === person.id && x.reminder_time && x.days.includes(wd)))
        if (inWindow(at(h.reminder_time), nowMs)) push({ kind: "habit", key: `${h.id}:${today}`, title: h.title, body: "Hora do seu h\xE1bito.", url: `/habito/${h.id}` });
    }
    if (p.events.on) for (const e of d.events.filter((x) => x.owner_id === person.id && x.reminder_minutes != null && !x.all_day)) {
      const t = new Date(Date.parse(e.starts_at) - e.reminder_minutes * 6e4).toISOString();
      if (inWindow(t, nowMs)) push({ kind: "event", key: `${e.id}:${e.starts_at}`, title: e.title, body: e.reminder_minutes ? `Daqui a ${e.reminder_minutes} min, \xE0s ${hm(new Date(e.starts_at), tz)}.` : "Agora.", url: `/agenda?evento=${e.id}`, strong: true });
    }
    for (const t of d.tasks.filter((x) => x.owner_id === person.id && inWindow(x.remind_at, nowMs)))
      push({ kind: "task", key: `${t.id}:${t.remind_at}`, title: t.title, body: "Lembrete da tarefa.", url: `/tarefa/${t.id}`, strong: true });
    if (p.checkin.on) {
      for (const g of d.groups.filter((x) => x.user_id === person.id && x.checkin_weekday === wd))
        if (inWindow(new Date(Date.parse(at("09:00")) - p.checkin.before * 6e4).toISOString(), nowMs))
          push({ kind: "checkin", key: `${g.group_id}:${today}`, title: `Check-in do grupo ${g.name}`, body: p.checkin.before ? `Daqui a ${p.checkin.before} min. Como foi a semana?` : "Como foi a semana?", url: "/grupo" });
    }
    if (p.cheers.on) for (const c of d.cheers.filter((x) => x.to_id === person.id && inWindow(x.created_at, nowMs)))
      push({ kind: "cheer", key: c.id, title: `${c.from_name} te mandou um incentivo \u{1F44F}`, url: "/grupo" });
    if (p.scores.on) {
      const mine = new Set(d.groups.filter((g) => g.user_id === person.id).map((g) => g.group_id));
      for (const c of d.checkins.filter((x) => x.visible && x.owner_id !== person.id && mine.has(x.group_id) && inWindow(x.created_at, nowMs)))
        push({ kind: "score", key: c.id, title: `${c.owner_name} fez o check-in${c.score != null ? `: ${c.score}%` : ""}`, url: "/grupo" });
    }
  }
  return out;
}

// supabase/functions/notify/index.ts
var env = (k) => Deno.env.get(k) ?? "";
var SUPABASE_URL = env("SUPABASE_URL");
var KEYS = projectKeys(env);
var db = makeDb(SUPABASE_URL, KEYS.service);
var APP = env("APP_URL") || "https://twelvefold-app.vercel.app";
var ORIGINS = ["https://twelvefold-app.vercel.app", "http://localhost:5173"];
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
async function vapid() {
  const raw = await db.rpc("push_vapid", {});
  if (raw) return JSON.parse(raw);
  await db.rpc("push_vapid_init", { p_value: JSON.stringify(await newVapid(APP)) });
  return JSON.parse(await db.rpc("push_vapid", {}));
}
var inList = (ids) => `in.(${ids.join(",")})`;
async function claim(owner, kind, key) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/notify_log?on_conflict=owner_id,kind,key`, {
    method: "POST",
    headers: { apikey: KEYS.service, ...KEYS.service.startsWith("sb_") ? {} : { Authorization: `Bearer ${KEYS.service}` }, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ owner_id: owner, kind, key })
  });
  return r.ok && (await r.json()).length > 0;
}
async function deliver(subs, msg, v) {
  let sent = 0;
  for (const s of subs) {
    try {
      const st = await sendPush(s, msg, v);
      if (st === 404 || st === 410) await db.del(`push_subscriptions?id=eq.${s.id}`);
      else if (st < 300) sent++;
      else console.error("push", st, new URL(s.endpoint).host);
    } catch (e) {
      console.error("push", e.message);
    }
  }
  return sent;
}
async function gather(owners) {
  const now = Date.now();
  const since = new Date(now - 15 * 6e4).toISOString();
  const until = new Date(now + 26 * 36e5).toISOString();
  const O = inList(owners);
  const people = await db.get(`profiles?select=id,timezone,notify&id=${O}`);
  const cycles = await db.get(`cycles?select=id,owner_id,starts_on&status=eq.active&owner_id=${O}&order=starts_on.desc`);
  const cyc = owners.map((o) => cycles.find((c) => c.owner_id === o)).filter(Boolean);
  const goals = cyc.length ? await db.get(`goals?select=id,owner_id,cycle_id&cycle_id=${inList(cyc.map((c) => c.id))}`) : [];
  const stepRows = goals.length ? await db.getAll(`steps?select=goal_id,week,done_at&goal_id=${inList(goals.map((g) => g.id))}`) : [];
  const habits = await db.get(`habits?select=id,owner_id,title,days,reminder_time&archived=eq.false&owner_id=${O}`);
  const events = await db.get(`events?select=id,owner_id,title,starts_at,all_day,reminder_minutes&owner_id=${O}&starts_at=gte.${since}&starts_at=lt.${until}&order=starts_at`);
  const tasks = await db.get(`tasks?select=id,owner_id,title,remind_at&completed_at=is.null&owner_id=${O}&remind_at=gte.${since}&remind_at=lte.${new Date(now).toISOString()}`);
  const gm = await db.get(`group_members?select=user_id,group_id,share,groups(name,checkin_weekday)&user_id=${O}`);
  const groupIds = [...new Set(gm.map((g) => g.group_id))];
  const cheersRaw = await db.get(`cheers?select=id,to_id,from_id,created_at&to_id=${O}&created_at=gte.${since}`);
  const checkRaw = groupIds.length ? await db.get(`checkins?select=id,group_id,owner_id,score,created_at&group_id=${inList(groupIds)}&created_at=gte.${since}`) : [];
  const shares = groupIds.length ? await db.get(`group_members?select=group_id,user_id,share&group_id=${inList(groupIds)}`) : [];
  const nameIds = [.../* @__PURE__ */ new Set([...cheersRaw.map((c) => c.from_id), ...checkRaw.map((c) => c.owner_id)])];
  const names = nameIds.length ? await db.get(`profiles?select=id,display_name&id=${inList(nameIds)}`) : [];
  const nameOf = (id) => names.find((n) => n.id === id)?.display_name?.split(" ")[0] || "Algu\xE9m";
  return {
    people,
    data: {
      cycles: cyc.map((c) => ({ owner_id: c.owner_id, starts_on: c.starts_on })),
      steps: stepRows.map((s) => {
        const g = goals.find((x) => x.id === s.goal_id);
        const c = cyc.find((x) => x.id === g.cycle_id);
        return { owner_id: g.owner_id, week: s.week, starts_on: c.starts_on, done_at: s.done_at };
      }),
      habits,
      events,
      tasks,
      groups: gm.map((g) => ({ user_id: g.user_id, group_id: g.group_id, name: g.groups?.name ?? "grupo", checkin_weekday: g.groups?.checkin_weekday ?? 1 })),
      cheers: cheersRaw.map((c) => ({ id: c.id, to_id: c.to_id, from_name: nameOf(c.from_id), created_at: c.created_at })),
      checkins: checkRaw.map((c) => ({ ...c, owner_name: nameOf(c.owner_id), visible: shares.some((s) => s.group_id === c.group_id && s.user_id === c.owner_id && s.share !== "nothing") }))
    }
  };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method" });
  const body = await req.json().catch(() => ({}));
  const secret = req.headers.get("x-sync-secret");
  if (!secret) {
    const user = await userOf(req);
    if (!user) return json(req, 401, { error: "login" });
    const v2 = await vapid();
    if (body.action === "test") {
      const subs2 = await db.get(`push_subscriptions?select=id,owner_id,endpoint,p256dh,auth&owner_id=eq.${user.id}`);
      const sent2 = await deliver(subs2, { title: "Notifica\xE7\xF5es ligadas \u2713", body: "\xC9 assim que os avisos do Twelvefold chegam.", url: "/config/notificacoes", tag: "teste" }, v2);
      return json(req, 200, { sent: sent2, devices: subs2.length });
    }
    return json(req, 200, { publicKey: v2.publicKey });
  }
  if (!await db.rpc("sync_secret_ok", { p_secret: secret })) return json(req, 401, { error: "secret" });
  const subs = await db.getAll("push_subscriptions?select=id,owner_id,endpoint,p256dh,auth");
  const owners = [...new Set(subs.map((s) => s.owner_id))];
  if (!owners.length) return json(req, 200, { sent: 0 });
  const v = await vapid();
  const { people, data } = await gather(owners);
  let sent = 0;
  for (const o of due(people, data)) {
    if (!await claim(o.owner, o.kind, o.key)) continue;
    sent += await deliver(subs.filter((s) => s.owner_id === o.owner), { title: o.title, body: o.body, url: o.url, tag: `${o.kind}:${o.key}` }, v);
  }
  return json(req, 200, { sent });
});
