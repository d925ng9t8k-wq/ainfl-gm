# get9.ai — DNS Live Day Setup Checklist

Run these in order when DNS goes live. Each step has the exact command or URL.

---

## 1. DNS Records

Log into Cloudflare (or your registrar's DNS panel) and add these records:

### A Record — Root domain to server
```
Type:  A
Name:  @
Value: [YOUR_SERVER_IP]
TTL:   Auto
Proxy: On (orange cloud)
```

### A Record — www subdomain
```
Type:  A
Name:  www
Value: [YOUR_SERVER_IP]
TTL:   Auto
Proxy: On (orange cloud)
```

### MX Record — Email routing
```
Type:     MX
Name:     @
Value:    mail.get9.ai   (or your mail provider's hostname)
Priority: 10
TTL:      Auto
```
If using Google Workspace:
```
Type:     MX
Name:     @
Value:    ASPMX.L.GOOGLE.COM
Priority: 1
TTL:      Auto
```
(Add all 5 Google MX records — full list at https://admin.google.com/u/0/ac/apps/gmail/setup)

### SPF Record — Authorize sending servers
```
Type:  TXT
Name:  @
Value: v=spf1 include:_spf.google.com ~all
TTL:   Auto
```
Adjust `include:` value to match your mail provider.

### DKIM Record — Email signature verification
Get your DKIM key from your mail provider, then add:
```
Type:  TXT
Name:  google._domainkey   (or whatever selector your provider gives you)
Value: v=DKIM1; k=rsa; p=[PUBLIC_KEY]
TTL:   Auto
```
Google Workspace DKIM setup: https://admin.google.com/u/0/ac/apps/gmail/authenticateemail

### DMARC Record — Policy enforcement
```
Type:  TXT
Name:  _dmarc
Value: v=DMARC1; p=none; rua=mailto:admin@get9.ai
TTL:   Auto
```
Start with `p=none` (monitor only), tighten to `p=quarantine` or `p=reject` after 30 days of clean reports.

---

## 2. Email Setup — Gmail Send-As

Lets you send from `jasson@get9.ai` inside your existing Gmail inbox.

1. Go to https://mail.google.com/mail/u/0/#settings/accounts
2. Under "Send mail as" click **Add another email address**
3. Enter: `Jasson Fishback` and `jasson@get9.ai`
4. SMTP server: `smtp.gmail.com`, Port: `587`
5. Use your Gmail address as the username, and an **App Password** (not your main password)
   - Generate App Password at: https://myaccount.google.com/apppasswords
6. Check the verification email sent to `jasson@get9.ai` and click confirm
7. Set as default sender if preferred

---

## 3. Landing Page Deployment

If deploying via Cloudflare Pages:
```bash
# From project root
npm run build
npx wrangler pages deploy ./dist --project-name=get9ai
```

If deploying via the existing cloud-worker setup:
```bash
cd /Users/jassonfishback/Projects/BengalOracle/cloud-worker
./deploy.sh
```

Verify the page is live:
```bash
curl -I https://get9.ai
# Expect: HTTP/2 200
```

---

## 4. SSL Verification

If using Cloudflare proxy (orange cloud on A records), SSL is handled automatically — no action needed. Verify with:
```bash
curl -vI https://get9.ai 2>&1 | grep -E "SSL|TLS|certificate|expire"
```

Or check in browser: look for the padlock, click it, confirm cert issuer is Cloudflare or your CA and expiry is 12+ months out.

If using your own cert (not Cloudflare proxy), renew with:
```bash
certbot renew --dry-run
```

---

## 5. Post-Launch Verification Checklist

```
[ ] https://get9.ai loads with SSL (padlock in browser)
[ ] https://www.get9.ai redirects to root
[ ] Send test email FROM jasson@get9.ai — confirm it arrives and shows correct sender
[ ] Reply to that email — confirm it lands in inbox
[ ] Check MX records resolved: dig MX get9.ai
[ ] Check SPF resolved: dig TXT get9.ai | grep spf
[ ] Check DKIM resolved: dig TXT google._domainkey.get9.ai
[ ] Submit domain to Google Search Console: https://search.google.com/search-console
[ ] Test email deliverability score: https://mail-tester.com
```

---

## Notes

- DNS propagation takes 5 minutes to 48 hours depending on TTL settings. Cloudflare is typically under 5 minutes.
- Do not turn off the Cloudflare proxy (orange cloud) — it handles SSL, DDoS protection, and caching.
- If you hit a Cloudflare Turnstile/CAPTCHA during DNS setup, see `reference_cloudflare_auth.md` for the Apple SSO bypass.
