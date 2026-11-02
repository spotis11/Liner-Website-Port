import { writeFileSync } from 'fs';
import { renderWelcomeEmail, renderBannedEmail } from '/home/z/my-project/src/lib/emailTemplates';
const now = new Date();
const w = renderWelcomeEmail({ username: 'starmoss', displayName: 'Star', accountCreatedAt: now });
const b = renderBannedEmail({ username: 'starmoss', displayName: 'Star', reason: 'Cheating (aim-bot) — third-party software <script>alert(1)</script>', bannedAt: now, expiresAt: null });
writeFileSync('/home/z/my-project/download/email-previews/welcome.html', w.html);
writeFileSync('/home/z/my-project/download/email-previews/banned.html', b.html);
console.log('previews regenerated');
