// Junta cada Edge Function num arquivo único (supabase/functions-dist/<nome>.ts),
// para colar no editor do painel do Supabase. Uso: node scripts/bundle-functions.mjs
import { build } from 'esbuild'
for (const name of ['connect', 'sync']) {
  await build({
    entryPoints: [`supabase/functions/${name}/index.ts`],
    outfile: `supabase/functions-dist/${name}.ts`,
    bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    banner: { js: `// @ts-nocheck (código já verificado na origem)\n// Dream Board · função "${name}" (gerado por scripts/bundle-functions.mjs; edite em supabase/functions/${name}/)` },
    logLevel: 'warning',
  })
}
console.log('ok')
