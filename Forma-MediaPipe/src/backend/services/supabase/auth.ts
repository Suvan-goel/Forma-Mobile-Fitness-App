/**
 * Supabase OAuth helpers for Google and Apple sign-in
 */
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import { supabase } from './client';

WebBrowser.maybeCompleteAuthSession();

const makeRedirectUri = () =>
  AuthSession.makeRedirectUri({ scheme: 'forma' });

/**
 * Extract a single param from a URL using regex.
 * Works with both query params (?key=val) and hash fragments (#key=val).
 * Avoids new URL() which fails on custom-scheme URLs without a host on JSC.
 */
function extractParam(url: string, key: string): string | null {
  const match = url.match(new RegExp(`[#?&]${key}=([^&#]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function handleOAuthResult(result: WebBrowser.WebBrowserAuthSessionResult): Promise<void> {
  if (result.type !== 'success' || !result.url) return;

  const url = result.url;

  // PKCE flow: code returned as query param (?code=...)
  const code = extractParam(url, 'code');
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return;
  }

  // Implicit flow: tokens returned in hash fragment (#access_token=...&refresh_token=...)
  const access_token = extractParam(url, 'access_token');
  const refresh_token = extractParam(url, 'refresh_token');
  if (access_token && refresh_token) {
    const { error } = await supabase.auth.setSession({ access_token, refresh_token });
    if (error) throw error;
    return;
  }

  throw new Error('No authorization code or tokens found in redirect URL');
}

export async function signInWithGoogle(): Promise<void> {
  const redirectTo = makeRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data.url) throw new Error('No OAuth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw Object.assign(new Error('Sign-in was cancelled'), { cancelled: true });
  }
  await handleOAuthResult(result);
}

export async function signInWithApple(): Promise<void> {
  const redirectTo = makeRedirectUri();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'apple',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
    },
  });

  if (error) throw error;
  if (!data.url) throw new Error('No OAuth URL returned');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw Object.assign(new Error('Sign-in was cancelled'), { cancelled: true });
  }
  await handleOAuthResult(result);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
