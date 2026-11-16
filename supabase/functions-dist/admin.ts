// @ts-nocheck (código já verificado na origem)
// Dream Board · função "admin" (gerado por scripts/bundle-functions.mjs; edite em supabase/functions/admin/)

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

// supabase/functions/_shared/admin.ts
function toPerson(u, displayName, admin, now = Date.now()) {
  return {
    id: u.id,
    email: u.email ?? "",
    name: displayName || u.user_metadata?.full_name || u.user_metadata?.name || null,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
    blocked: !!u.banned_until && Date.parse(u.banned_until) > now,
    pending: !u.last_sign_in_at,
    admin
  };
}
function inviteError(msg) {
  if (/already been registered|already registered|email_exists|User already/i.test(msg)) return "Esta pessoa j\xE1 tem conta.";
  if (/rate limit/i.test(msg)) return "Muitos convites seguidos. Espere um pouco.";
  return "N\xE3o deu para criar o convite agora.";
}

// supabase/functions/admin/index.ts
var env = (k) => Deno.env.get(k) ?? "";
var SUPABASE_URL = env("SUPABASE_URL");
var KEYS = projectKeys(env);
var db = makeDb(SUPABASE_URL, KEYS.service);
var APP = env("APP_URL") || "https://twelvefold-app.vercel.app";
var ORIGINS = ["https://twelvefold-app.vercel.app", "http://localhost:5173"];
var BAN = "876000h";
var cors = (req) => ({
  "Access-Control-Allow-Origin": ORIGINS.includes(req.headers.get("Origin") ?? "") ? req.headers.get("Origin") : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin"
});
var json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });
var authHeaders = () => KEYS.service.startsWith("sb_") ? { apikey: KEYS.service, "Content-Type": "application/json" } : { apikey: KEYS.service, Authorization: `Bearer ${KEYS.service}`, "Content-Type": "application/json" };
async function gotrue(method, path, body) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, { method, headers: authHeaders(), body: body === void 0 ? void 0 : JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) {
    const e = new Error(t.slice(0, 300));
    e.status = r.status;
    throw e;
  }
  return t ? JSON.parse(t) : null;
}
async function userOf(req) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEYS.anon, Authorization: auth } });
  return r.ok ? await r.json() : null;
}
var isAdmin = async (id) => (await db.get(`app_admins?select=user_id&user_id=eq.${id}`)).length > 0;
var UUID = /^[0-9a-f-]{36}$/;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return json(req, 405, { error: "method" });
  const me = await userOf(req);
  if (!me) return json(req, 401, { error: "login" });
  if (!await isAdmin(me.id)) return json(req, 403, { error: "S\xF3 a dona do app pode fazer isso." });
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "list") {
      const users = [];
      for (let page = 1; page <= 10; page++) {
        const r = await gotrue("GET", `users?page=${page}&per_page=200`);
        users.push(...r.users);
        if (r.users.length < 200) break;
      }
      const admins = new Set((await db.get("app_admins?select=user_id")).map((a) => a.user_id));
      const names = new Map((await db.getAll("profiles?select=id,display_name")).map((p) => [p.id, p.display_name]));
      const people = users.map((u) => toPerson(u, names.get(u.id) ?? null, admins.has(u.id))).sort((a, b) => Number(b.admin) - Number(a.admin) || b.created_at.localeCompare(a.created_at));
      return json(req, 200, { people });
    }
    if (body.action === "invite") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return json(req, 400, { error: "Confira o e-mail." });
      try {
        const r = await gotrue("POST", "generate_link", { type: "invite", email, redirect_to: APP });
        const link = r.action_link ?? r.properties?.action_link;
        if (!link) throw new Error("sem link");
        return json(req, 200, { link });
      } catch (e) {
        return json(req, 400, { error: inviteError(e.message) });
      }
    }
    if (body.action === "block" || body.action === "unblock" || body.action === "delete") {
      const id = String(body.id ?? "");
      if (!UUID.test(id)) return json(req, 400, { error: "id" });
      if (id === me.id || await isAdmin(id)) return json(req, 400, { error: "N\xE3o d\xE1 para fazer isso com a conta de quem administra o app." });
      if (body.action === "delete") {
        const u = await gotrue("GET", `users/${id}`);
        if (!toPerson(u, null, false).blocked) return json(req, 400, { error: "Bloqueie a conta antes de apagar." });
        await gotrue("DELETE", `users/${id}`);
        return json(req, 200, { ok: true });
      }
      await gotrue("PUT", `users/${id}`, { ban_duration: body.action === "block" ? BAN : "none" });
      return json(req, 200, { ok: true });
    }
    return json(req, 400, { error: "action" });
  } catch (e) {
    console.error("admin", body.action, e.message);
    return json(req, 500, { error: "N\xE3o deu certo agora. Tente de novo em instantes." });
  }
});
