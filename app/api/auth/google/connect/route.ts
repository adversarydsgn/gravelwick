import { NextResponse } from 'next/server';

/**
 * GET /api/auth/google/connect
 *
 * Initiates the Google OAuth flow for Calendar V2.
 * Redirects the user to Google's consent screen requesting
 * calendar.events.readonly + userinfo.email scopes.
 * The resulting refresh token is passed to Recall.ai in the callback.
 */
export async function GET() {
  const clientId = process.env.GMAIL_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json({ error: 'GMAIL_CLIENT_ID not configured' }, { status: 500 });
  }

  const redirectUri = `${process.env.APP_URL}/api/auth/google/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'https://www.googleapis.com/auth/calendar.events.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent', // Force consent to guarantee a refresh token
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return NextResponse.redirect(authUrl);
}
