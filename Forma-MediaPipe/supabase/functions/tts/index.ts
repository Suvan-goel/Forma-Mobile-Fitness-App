import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { createTtsHandler } from './handler.ts';

serve(createTtsHandler({
  createClient,
  fetch: globalThis.fetch.bind(globalThis),
  env: (name: string) => Deno.env.get(name) ?? undefined,
  now: () => performance.now(),
  waitUntil: (promise: Promise<unknown>) => {
    const edgeRuntime = (globalThis as unknown as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }).EdgeRuntime;
    if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(promise);
  },
  log: console.log,
  warn: console.warn,
  error: console.error,
}));
