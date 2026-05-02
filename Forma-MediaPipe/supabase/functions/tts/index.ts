import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_TEXT_LENGTH = 240;
const ALLOWED_VOICE_IDS = new Set([
  '21m00Tcm4TlvDq8ikWAM',
  '8N2ng9i2uiUWqstgmWlH',
  'l4Coq6695JDX9xtLqXDE',
  'uJCs8Cm3vdGWEkXI6wUX',
  'c6SfcYrb2t09NHXiT80T',
  'l30f87tf05uxyknGdDw6',
  'MdeqL1TMyZWz86QOELK8',
]);

function jsonResponse(body: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function sanitizeVoiceSettings(value: unknown) {
  const settings = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    stability: boundedNumber(settings.stability, 0.45, 0, 1),
    similarity_boost: boundedNumber(settings.similarity_boost, 0.8, 0, 1),
    speed: boundedNumber(settings.speed, 0.9, 0.7, 1.2),
    style: boundedNumber(settings.style, 0.0, 0, 1),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    // Verify caller is an authenticated Forma user
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { text, voiceId, voiceSettings } = await req.json();
    if (typeof text !== 'string' || text.trim().length === 0 || typeof voiceId !== 'string') {
      return jsonResponse({ error: 'Missing text or voiceId' }, 400);
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return jsonResponse({ error: `Text must be ${MAX_TEXT_LENGTH} characters or fewer` }, 400);
    }
    if (!ALLOWED_VOICE_IDS.has(voiceId)) {
      return jsonResponse({ error: 'Voice not allowed' }, 400);
    }

    const apiKey = Deno.env.get('ELEVENLABS_API_KEY');
    if (!apiKey) {
      return jsonResponse({ error: 'TTS service not configured' }, 503);
    }

    const elevenLabsRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify({
          text: text.trim(),
          model_id: 'eleven_flash_v2_5',
          voice_settings: sanitizeVoiceSettings(voiceSettings),
        }),
      }
    );

    if (!elevenLabsRes.ok) {
      const upstreamBody = await elevenLabsRes.text().catch(() => '');
      console.warn('ElevenLabs TTS request failed', {
        status: elevenLabsRes.status,
        body: upstreamBody.slice(0, 500),
      });
      return jsonResponse({ error: `ElevenLabs error: ${elevenLabsRes.status}` }, elevenLabsRes.status);
    }

    return new Response(elevenLabsRes.body, {
      headers: { ...corsHeaders, 'Content-Type': 'audio/mpeg' },
    });
  } catch (e) {
    console.error('TTS function failed', e);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});
