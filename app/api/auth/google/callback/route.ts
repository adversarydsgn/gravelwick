import { NextRequest, NextResponse } from 'next/server';
import { createCalendarV2 } from '@/lib/recall/client';

/**
 * GET /api/auth/google/callback
 *
 * Google OAuth callback for Calendar V2 setup.
 * Exchanges the authorization code for a refresh token,
 * then registers the calendar with Recall.ai via their V2 API.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const error = req.nextUrl.searchParams.get('error');

  if (error) {
    console.error('[auth/google/callback] OAuth error:', error);
    return NextResponse.json(
      { error: 'OAuth authorization denied', detail: error },
      { status: 400 },
    );
  }

  if (!code) {
    return NextResponse.json({ error: 'Missing authorization code' }, { status: 400 });
  }

  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: 'GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET not configured' },
      { status: 500 },
    );
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;

  // Exchange authorization code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    console.error('[auth/google/callback] Token exchange failed:', err);
    return NextResponse.json(
      { error: 'Token exchange failed', detail: err },
      { status: 502 },
    );
  }

  const tokens = await tokenRes.json();
  const refreshToken: string | undefined = tokens.refresh_token;

  if (!refreshToken) {
    console.error('[auth/google/callback] No refresh_token in response. Was prompt=consent set?');
    return NextResponse.json(
      { error: 'No refresh token received. Re-authorize with prompt=consent.' },
      { status: 400 },
    );
  }

  // Get the user's email from the access token
  let email: string | undefined;
  try {
    const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (userinfoRes.ok) {
      const userinfo = await userinfoRes.json();
      email = userinfo.email;
    }
  } catch {
    // Non-fatal — email is optional for Recall calendar creation
    console.warn('[auth/google/callback] Failed to fetch userinfo');
  }

  // Create the calendar in Recall.ai via V2 API
  try {
    const calendar = await createCalendarV2({
      clientId,
      clientSecret,
      refreshToken,
      email,
    });

    console.log('[auth/google/callback] Calendar created in Recall.ai:', calendar.id);

    return NextResponse.json({
      ok: true,
      calendar_id: calendar.id,
      email,
      message: 'Google Calendar connected to Recall.ai Calendar V2 successfully.',
    });
  } catch (err) {
    console.error('[auth/google/callback] Recall calendar creation failed:', err);
    return NextResponse.json(
      { error: 'Failed to register calendar with Recall.ai', detail: String(err) },
      { status: 502 },
    );
  }
}
