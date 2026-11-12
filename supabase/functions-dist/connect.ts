// @ts-nocheck (código já verificado na origem)
// Dream Board · função "connect" (gerado por scripts/bundle-functions.mjs; edite em supabase/functions/connect/)

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

// supabase/functions/_shared/google.ts
var GOOGLE_SCOPE = "openid email https://www.googleapis.com/auth/calendar.readonly";

// supabase/functions/_shared/microsoft.ts
var MS_SCOPE = "offline_access User.Read Tasks.ReadWrite";
var WEEK = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
var WEEKDAYS = WEEK.slice(1, 6);

// supabase/functions/_shared/state.ts
var enc = new TextEncoder();
var b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
var fromB64u = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));
async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode("dreamboard-oauth-state:" + secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
async function signState(secret, owner, provider, now = Date.now()) {
  const payload = b64u(enc.encode(JSON.stringify({ u: owner, p: provider, e: now + 10 * 60 * 1e3, n: crypto.randomUUID() })));
  return `${payload}.${await hmac(secret, payload)}`;
}
async function verifyState(secret, state, now = Date.now()) {
  const [payload, sig] = state.split(".");
  if (!payload || !sig) return null;
  const expected = await hmac(secret, payload);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const v = JSON.parse(fromB64u(payload));
    return v.e > now && /^[0-9a-f-]{36}$/.test(v.u) && (v.p === "google" || v.p === "microsoft") ? { u: v.u, p: v.p } : null;
  } catch {
    return null;
  }
}

// supabase/functions/connect/index.ts
var env = (k) => Deno.env.get(k) ?? "";
var SUPABASE_URL = env("SUPABASE_URL");
var KEYS = projectKeys(env);
var KEY = KEYS.service;
var db = makeDb(SUPABASE_URL, KEY);
var APP = env("APP_URL") || "https://planmaxxing.vercel.app";
var REDIRECT = `${SUPABASE_URL}/functions/v1/connect`;
var ORIGINS = ["https://planmaxxing.vercel.app", "http://localhost:5173"];
var cors = (req) => ({
  "Access-Control-Allow-Origin": ORIGINS.includes(req.headers.get("Origin") ?? "") ? req.headers.get("Origin") : ORIGINS[0],
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin"
});
var json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });
var back = (q) => new Response(null, { status: 302, headers: { Location: `${APP}/config?${q}`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
async function userOf(req) {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEYS.anon, Authorization: auth } });
  return r.ok ? await r.json() : null;
}
function authUrl(provider, state) {
  if (provider === "google") {
    return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      redirect_uri: REDIRECT,
      response_type: "code",
      scope: GOOGLE_SCOPE,
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state
    });
  }
  return "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + new URLSearchParams({
    client_id: env("MS_CLIENT_ID"),
    redirect_uri: REDIRECT,
    response_type: "code",
    response_mode: "query",
    scope: MS_SCOPE,
    prompt: "select_account",
    state
  });
}
async function exchange(provider, code) {
  if (provider === "google") {
    const r2 = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: REDIRECT, grant_type: "authorization_code" })
    });
    const j2 = await r2.json();
    if (!r2.ok || !j2.refresh_token) throw new Error(j2.error ?? "sem chave permanente");
    if (!String(j2.scope ?? "").includes("calendar.readonly")) throw new Error("permiss\xE3o da agenda n\xE3o marcada");
    let email = null;
    try {
      email = JSON.parse(atob(j2.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? null;
    } catch {
    }
    return { refresh: j2.refresh_token, email };
  }
  const r = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env("MS_CLIENT_ID"), client_secret: env("MS_CLIENT_SECRET"), redirect_uri: REDIRECT, grant_type: "authorization_code", scope: MS_SCOPE })
  });
  const j = await r.json();
  if (!r.ok || !j.refresh_token) throw new Error(j.error_description?.slice(0, 120) ?? j.error ?? "sem chave permanente");
  const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName", { headers: { Authorization: `Bearer ${j.access_token}` } });
  const mj = me.ok ? await me.json() : {};
  return { refresh: j.refresh_token, email: mj.mail || mj.userPrincipalName || null };
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const st = await verifyState(KEY, url.searchParams.get("state") ?? "");
    if (!st) return back("conexao=erro&motivo=expirou");
    const provider = st.p;
    if (url.searchParams.get("error")) return back(`conexao=erro&servico=${provider}&motivo=cancelado`);
    try {
      const { refresh, email } = await exchange(provider, url.searchParams.get("code") ?? "");
      await db.rpc("integration_save", { p_owner: st.u, p_provider: provider, p_email: email, p_token: refresh });
      await db.rpc("sync_ping", { p_owner: st.u }).catch(() => {
      });
      return back(`conectado=${provider}`);
    } catch (e) {
      console.error("connect", provider, e.message);
      return back(`conexao=erro&servico=${provider}&motivo=${encodeURIComponent(e.message.slice(0, 80))}`);
    }
  }
  if (req.method === "POST") {
    const user = await userOf(req);
    if (!user) return json(req, 401, { error: "login" });
    const { provider } = await req.json().catch(() => ({}));
    if (provider !== "google" && provider !== "microsoft") return json(req, 400, { error: "provider" });
    if (!env(provider === "google" ? "GOOGLE_CLIENT_ID" : "MS_CLIENT_ID")) return json(req, 500, { error: "Falta configurar as chaves do servidor." });
    return json(req, 200, { url: authUrl(provider, await signState(KEY, user.id, provider)) });
  }
  return json(req, 405, { error: "method" });
});
