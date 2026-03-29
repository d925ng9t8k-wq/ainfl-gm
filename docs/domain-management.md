# Domain Management Protocol

Last updated: March 28, 2026

---

## All Owned Domains

| Domain | Registrar | Registered | Expires | Auto-Renew | Purpose | Status |
|--------|-----------|------------|---------|------------|---------|--------|
| ainflgm.com | Unknown | Unknown | Unknown | Unknown | AiNFL GM product site | ACTIVE (GitHub Pages) |
| get9.ai | Cloudflare Registrar | March 25, 2026 (claimed) | March 25, 2028 | Verify | 9 Enterprises flagship | VERIFY — zone initializing as of March 28 |
| playaigm.com | — | Not registered | — | — | AiGM product branding | AVAILABLE — needs registration |

---

## get9.ai — Current Status (March 28, 2026)

- Cloudflare zone exists: Zone ID `f3f940669800b65abc2e67fc86803fb3`
- Zone status: `initializing` — waiting for nameservers
- Required nameservers: `daphne.ns.cloudflare.com` / `kolton.ns.cloudflare.com`
- Email routing pre-configured: `9@get9.ai` → `emailfishback@gmail.com`
- Email goes live the moment nameservers are active

### Owner Action Required
1. Log in: dash.cloudflare.com (use Apple SSO — emailfishback@gmail.com)
2. Go to Domain Registration → Manage Domains
3. Confirm get9.ai shows as registered. If not, register it ($80/yr)
4. Confirm nameservers are set to daphne + kolton
5. Test: send email to 9@get9.ai, confirm it arrives at emailfishback@gmail.com

---

## playaigm.com — Registration Plan

Available as of March 28, 2026. Priority: register before someone else takes it.

### Steps
1. Log in: dash.cloudflare.com (Apple SSO)
2. Go to Domain Registration → Register Domains
3. Search `playaigm.com` — confirm available (~$10-12/yr for .com)
4. Register with auto-renew ON
5. After registration: Add zone in Cloudflare → DNS → point to GitHub Pages
   - CNAME `www` → `jassonfishback.github.io`
   - A records for apex (GitHub Pages IPs)
6. Add custom domain in GitHub Pages settings for AiNFL GM repo

---

## Cloudflare Token Gap

Current token (`CLOUDFLARE_API_TOKEN` in .env) has DNS/Zone permissions only.
Does NOT have Registrar scope.

To get registrar access programmatically:
1. Log in: dash.cloudflare.com (Apple SSO — Owner provides 2FA)
2. My Profile → API Tokens → Edit existing token
3. Add permission: `Account - Registrar: Edit`
4. Save → update token in .env

---

## Renewal Monitoring Process

### Automated Checks (9's responsibility)
- DOC runs a domain expiry check at the start of every session
- Alert threshold: 60 days before expiry → notify Owner on Telegram
- Alert threshold: 30 days before expiry → URGENT notification + calendar reminder
- Alert threshold: 14 days before expiry → escalate to highest priority

### Check Command
```bash
# Run this to check expiry for all domains
for domain in ainflgm.com get9.ai playaigm.com; do
  echo "=== $domain ===" && whois $domain 2>/dev/null | grep -i "expir" | head -3
done
```

### Cloudflare API Check
```bash
CF_TOKEN=$(grep "^CLOUDFLARE_API_TOKEN=" /Users/jassonfishback/Projects/BengalOracle/.env | cut -d= -f2)
CF_ACCOUNT="021566fbf92e32ec5081822305d1623f"
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/registrar/domains" \
  -H "Authorization: Bearer $CF_TOKEN" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for domain in d.get('result',[]):
    print(domain.get('name'), '| expires:', domain.get('expires_at'), '| auto_renew:', domain.get('auto_renew'))
"
```
Note: requires token with Registrar scope.

---

## Auto-Renewal Recommendations

| Domain | Recommendation | Reason |
|--------|---------------|--------|
| get9.ai | AUTO-RENEW ON | Core brand. Losing this would be catastrophic. $80/yr. |
| ainflgm.com | AUTO-RENEW ON | Active product. Revenue-generating. Never let lapse. |
| playaigm.com | AUTO-RENEW ON | Once registered — product branding, low cost. |

**Rule:** Every domain we own gets auto-renew enabled at registration. No exceptions.

---

## Never-Lose-a-Domain Protocol

1. **Registration:** Always register via Cloudflare Registrar when possible. One dashboard, one login, already integrated with DNS.
2. **Payment method:** Keep a valid credit card on file in Cloudflare. Check annually.
3. **Auto-renew:** Always ON. Never OFF.
4. **Alert stack:** 60 days → 30 days → 14 days → 7 days. Each level escalates.
5. **Backup notification:** For critical domains (get9.ai, ainflgm.com), also set expiry reminder in Owner's phone calendar.
6. **No manual renewals:** Relying on remembering to renew is how domains get lost. Auto-renew is the only safe model.
7. **Registrar lock:** Enable domain lock on all registered domains to prevent unauthorized transfers.
8. **If a domain is accidentally lost:** Act within 30-day redemption grace period. Registrar can usually restore for a fee ($50-200). After that, it goes to auction.

---

## Contacts & Logins

- Cloudflare: dash.cloudflare.com → Apple SSO (emailfishback@gmail.com + Apple 2FA)
- Account ID: 021566fbf92e32ec5081822305d1623f
- get9.ai Zone ID: f3f940669800b65abc2e67fc86803fb3
