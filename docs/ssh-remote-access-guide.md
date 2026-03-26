# SSH Remote Access Guide
## iPhone to MacBook — Setup for Jasson

**Research Date:** March 25, 2026
**Prepared by:** UNO (Research Team Lead)
**Confidence Level:** High

---

## Summary

You can access your Mac's Terminal from your iPhone using SSH (Secure Shell). This requires enabling Remote Login on your Mac, setting up port forwarding on your router, and installing an SSH app on your iPhone. The whole setup takes about 30-45 minutes. Claude Code CAN be launched over SSH — it runs in the terminal like any other program.

---

## Step 1: Enable Remote Login on Your Mac

This is the switch that lets other devices connect to your Mac's Terminal.

1. Click the Apple menu (top-left corner)
2. Go to **System Settings**
3. Click **General** in the left sidebar
4. Click **Sharing**
5. Find **Remote Login** and toggle it ON
6. When prompted, enter your Mac password or use Touch ID
7. Under "Allow access for:" choose **All users** (easier) or **Administrators only** (more secure)
8. Note the SSH address it shows — looks like: `ssh jasson@192.168.1.X`

That IP is your local address (inside your home network). You'll need a different address for remote access — covered in Step 3.

---

## Step 2: Set Up SSH Keys (Skip Passwords — Use Keys)

SSH keys are like a digital ID badge. Way more secure than a password, and you won't have to type a password every time.

**On your Mac, open Terminal and run these commands one at a time:**

```bash
# Generate a key pair
ssh-keygen -t ed25519 -C "iphone-access"

# Press Enter to accept the default save location
# Enter a passphrase (optional but recommended — you'll enter this on your phone)

# Add the public key to your Mac's authorized list
cat ~/.ssh/id_ed25519.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**Then copy the private key to your iPhone** — the SSH app (Termius or Prompt) will import it. You can AirDrop the `~/.ssh/id_ed25519` file to your iPhone, then import it in the app.

---

## Step 3: Get a Stable Address to Connect From Outside Your Home

Your home IP address changes periodically. You have two options:

### Option A: Dynamic DNS (Free, ~10 min setup)
Services like **No-IP** (noip.com) or **DuckDNS** (duckdns.org) give you a permanent hostname that always points to your current home IP.

1. Sign up at duckdns.org (free)
2. Create a subdomain (e.g., `jasson-mac.duckdns.org`)
3. Download the DuckDNS updater app for Mac — it runs silently in the background and keeps your hostname current
4. Use `jasson-mac.duckdns.org` as your hostname in your SSH app

### Option B: Tailscale (Recommended — Zero Port Forwarding Needed)
Tailscale is a free VPN that connects your Mac and iPhone directly, no router configuration required. Much simpler and more secure.

1. Install Tailscale on your Mac: `brew install tailscale` or from tailscale.com
2. Install Tailscale on your iPhone (free App Store app)
3. Sign in to both with the same account
4. Your Mac gets a permanent private IP (like `100.X.X.X`) — use that in your SSH app
5. No port forwarding, no firewall changes, no router touching

**Tailscale is the recommended approach for non-technical users.** Skip Steps 4 and 5 if you use Tailscale.

---

## Step 4: Configure Port Forwarding on Your Router (Only if NOT using Tailscale)

This tells your router to send SSH traffic to your Mac.

1. Log into your router (usually at `192.168.1.1` in a browser)
2. Find **Port Forwarding** (sometimes under "Advanced" or "NAT")
3. Create a new rule:
   - External Port: `2222` (do NOT use 22 — too many hackers scan that port)
   - Internal IP: your Mac's local IP (the one shown in Step 1)
   - Internal Port: `22`
   - Protocol: TCP
4. Save the rule

You'll connect from your iPhone to `your-ddns-hostname.duckdns.org` on port `2222`.

---

## Step 5: Choose an iPhone SSH App

### Recommendation for Jasson: Termius

**Termius** is the best balance of ease-of-use and features for non-technical users.

| App | Price | Best For | Notes |
|-----|-------|----------|-------|
| **Termius** | Free (Pro: $10/mo) | Best overall — easy setup | Cloud sync, cross-device, Touch/Face ID. Free tier covers basic SSH. |
| **Prompt 3** (by Panic) | $14.99 one-time | Clean, polished UI | No subscription. No Mosh. Good for straightforward use. |
| **Blink Shell** | $7.99/mo or $19.99/yr | Power users, developers | Mosh support (stays connected on cell), VS Code integration. Overkill for basic use. |

**Termius free tier covers everything you need.** Pro ($10/mo) adds cloud sync across devices — probably not necessary for one Mac.

**Prompt 3 ($14.99 one-time)** is a strong alternative if you don't want a subscription — clean interface, no monthly fee, very polished.

---

## Step 6: Connect From Your iPhone

In Termius (or Prompt):
1. Add a new host
2. Hostname: your DuckDNS address OR Tailscale IP
3. Port: `2222` (or `22` if using Tailscale)
4. Username: your Mac username (run `whoami` in Terminal to check)
5. Authentication: select your SSH key file
6. Connect

You should see your Mac's Terminal prompt on your phone.

---

## Can You Run Claude Code Over SSH?

**Yes.** Claude Code is a terminal program — it runs wherever you have a terminal session.

Once connected via SSH:
```bash
# Launch Claude Code interactively
claude

# Or run a one-shot command with -p flag (prints result and exits)
claude -p "Check the status of the project"

# Resume a previous session
claude -c
```

**Important:** For long Claude Code sessions over SSH, use **tmux**. It keeps your session alive even if your phone disconnects.

```bash
# Start a named tmux session
tmux new -s claude-session

# Reconnect to it later
tmux attach -t claude-session
```

This means you could start a Claude Code task on your phone, close the app, and reconnect later to see the results — the session keeps running on your Mac.

---

## Security Summary

| Risk | How to Handle It |
|------|-----------------|
| Brute force attacks on port 22 | Use a non-standard port (2222) or use Tailscale (no open ports) |
| Password guessing | Disable password auth — use SSH keys only |
| Hackers scanning your IP | Tailscale eliminates this entirely — no public-facing ports |
| SSH key theft | Protect private key with a passphrase |

**Recommended security config** (add to `/etc/ssh/sshd_config` on Mac):
```
PasswordAuthentication no
PermitRootLogin no
```
Restart SSH after: `sudo launchctl stop com.openssh.sshd && sudo launchctl start com.openssh.sshd`

---

## Quick Start Recommendation

For Jasson — fastest, simplest, most secure path:

1. Enable Remote Login (Step 1) — 2 minutes
2. Install Tailscale on Mac + iPhone — 5 minutes
3. Generate SSH keys (Step 2) — 5 minutes
4. Install Termius on iPhone, import key, connect — 10 minutes

**Total: ~20 minutes. No router configuration. No open ports. Fully secure.**

---

## Sources
- [Apple Support: Allow remote computer to access your Mac](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)
- [JumpCloud: How to Enable SSH on Mac](https://jumpcloud.com/blog/how-to-enable-ssh-mac)
- [nixCraft: macOS SSH Key-Based Authentication](https://www.cyberciti.biz/faq/howto-macos-configuring-ssh-key-based-authentication/)
- [Tailscale: SSH Security Best Practices](https://tailscale.com/learn/ssh-security-best-practices-protecting-your-remote-access-infrastructure)
- [Geekflare: Best Terminals/SSH Apps for iPhone](https://geekflare.com/dev/best-terminals-ssh-apps/)
- [Moshi: Best iOS Terminal App for AI Coding Agents](https://getmoshi.app/articles/best-ios-terminal-app-coding-agent)
- [Dev.to: Remote AI Coding with Claude Code and ShellHub](https://dev.to/gustavosbarreto/remote-ai-coding-with-claude-code-and-shellhub-25)
- [Harper Reed: Claude Code is better on your phone](https://harper.blog/2026/01/05/claude-code-is-better-on-your-phone/)
- [Termius Pricing](https://termius.com/pricing)
