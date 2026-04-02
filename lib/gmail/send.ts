import { google } from 'googleapis';

function getGmailClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

function buildEmail(params: {
  to: string[];
  subject: string;
  html: string;
  from: string;
}): string {
  const headers = [
    `From: Watson by Adversary <${params.from}>`,
    `To: ${params.to.join(', ')}`,
    `Subject: ${params.subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
  ].join('\r\n');

  const message = `${headers}\r\n\r\n${params.html}`;
  return Buffer.from(message).toString('base64url');
}

export function buildMeetingEmailHtml(params: {
  title: string;
  date: string;
  duration: string;
  participantCount: number;
  toneRead: string;
  portalUrl: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Meeting Notes</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td style="background:#0a0a0a;padding:32px 40px;">
              <p style="margin:0;color:#666;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">Meeting Notes</p>
              <h1 style="margin:8px 0 0;color:#ffffff;font-size:22px;font-weight:600;line-height:1.3;">${params.title}</h1>
            </td>
          </tr>
          <!-- Meta -->
          <tr>
            <td style="padding:28px 40px 0;border-bottom:1px solid #f0f0f0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-bottom:20px;">
                    <p style="margin:0;color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Date</p>
                    <p style="margin:4px 0 0;color:#0a0a0a;font-size:14px;">${params.date}</p>
                  </td>
                  <td style="padding-bottom:20px;">
                    <p style="margin:0;color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Duration</p>
                    <p style="margin:4px 0 0;color:#0a0a0a;font-size:14px;">${params.duration}</p>
                  </td>
                  <td style="padding-bottom:20px;">
                    <p style="margin:0;color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Participants</p>
                    <p style="margin:4px 0 0;color:#0a0a0a;font-size:14px;">${params.participantCount}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Summary -->
          <tr>
            <td style="padding:28px 40px;">
              <p style="margin:0 0 8px;color:#999;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Summary</p>
              <p style="margin:0;color:#333;font-size:15px;line-height:1.6;">${params.toneRead}</p>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:0 40px 32px;">
              <a href="${params.portalUrl}" style="display:inline-block;background:#0a0a0a;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:6px;font-size:14px;font-weight:500;">View full notes and recording &rarr;</a>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background:#f9f9f9;border-top:1px solid #f0f0f0;">
              <p style="margin:0;color:#bbb;font-size:12px;">Watson by Adversary &middot; <a href="https://adversary.design" style="color:#bbb;text-decoration:none;">adversary.design</a></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export async function sendMeetingEmail(params: {
  to: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const gmail = getGmailClient();
  const raw = buildEmail({
    to: params.to,
    subject: params.subject,
    html: params.html,
    from: process.env.GMAIL_SENDER_EMAIL!,
  });

  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
}
