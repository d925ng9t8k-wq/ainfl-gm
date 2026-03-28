#!/usr/bin/env python3
"""
Cloudflare Domain Registration via SeleniumBase UC Mode
Bypasses Turnstile CAPTCHA using undetected browser automation.

Usage:
    source .venv/bin/activate
    python scripts/cf-domain-register.py get9.ai
    python scripts/cf-domain-register.py playaigm.com
"""

import sys
import time
from seleniumbase import SB

CLOUDFLARE_DASHBOARD = "https://dash.cloudflare.com"
ACCOUNT_ID = "021566fbf92e32ec5081822305d1623f"

# Registrant info
REGISTRANT = {
    "firstName": "Jasson",
    "lastName": "Fishback",
    "organization": "9 Enterprises LLC",
    "email": "emailfishback@gmail.com",
    "phone": "5137692083",
    "address1": "7466 Wooster Pike",
    "city": "Cincinnati",
    "state": "OH",
    "zip": "45227",
    "country": "United States",
}


def register_domain(domain_name):
    """Register a domain via Cloudflare Registrar using UC Mode."""

    purchase_url = f"{CLOUDFLARE_DASHBOARD}/{ACCOUNT_ID}/registrar/purchase"

    with SB(uc=True, headed=True) as sb:
        print(f"[1/6] Navigating to Cloudflare login...")
        sb.open(f"{CLOUDFLARE_DASHBOARD}/login")

        # UC Mode should handle Turnstile automatically
        # If CAPTCHA appears, this clicks it
        try:
            sb.uc_gui_click_captcha()
        except Exception:
            pass

        time.sleep(3)

        # Check if we need to log in via Apple SSO
        if "login" in sb.get_current_url():
            print("[2/6] Clicking 'Continue with Apple'...")
            try:
                sb.click("button:contains('Apple')", timeout=5)
            except Exception:
                sb.click("a:contains('Apple')", timeout=5)

            time.sleep(3)

            # Apple ID login
            print("[2b/6] Entering Apple ID credentials...")
            # Note: This may require 2FA from Owner's device
            print(">>> WAITING FOR APPLE 2FA - Owner must approve on their device <<<")

            # Wait for manual 2FA approval (up to 60 seconds)
            time.sleep(60)

        print(f"[3/6] Navigating to domain purchase page...")
        sb.open(purchase_url)
        time.sleep(3)

        # Handle any Turnstile on the purchase page
        try:
            sb.uc_gui_click_captcha()
        except Exception:
            pass

        time.sleep(3)

        print(f"[4/6] Searching for {domain_name}...")
        # Find search input and type domain
        sb.type("input[type='text']", domain_name)
        sb.click("button:contains('Search')")
        time.sleep(5)

        print(f"[5/6] Clicking Purchase for {domain_name}...")
        sb.click("button:contains('Purchase')")
        time.sleep(3)

        print(f"[6/6] Filling registration form...")
        # Fill form fields
        for field, value in REGISTRANT.items():
            if field == "country":
                continue  # Handle separately
            try:
                sb.type(f"input[name='{field}']", value)
            except Exception as e:
                print(f"  Warning: Could not fill {field}: {e}")

        # Handle country dropdown
        try:
            sb.click("input[placeholder='Select...']")
            time.sleep(1)
            sb.type("input[placeholder='Select...']", "United States")
            time.sleep(1)
            # Click the United States option
            sb.click("div:contains('United States'):not(:contains('Minor'))")
        except Exception as e:
            print(f"  Warning: Country dropdown issue: {e}")

        # Select payment method (Card)
        try:
            sb.click("input[name='stripe']")
        except Exception:
            pass

        print(f"\n=== Form filled for {domain_name} ===")
        print("Review the form in the browser and click 'Complete purchase' manually if needed.")
        print("Keeping browser open for 120 seconds...")

        # Keep browser open for manual review/completion
        time.sleep(120)

        print("Done.")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python cf-domain-register.py <domain_name>")
        print("Example: python cf-domain-register.py get9.ai")
        sys.exit(1)

    domain = sys.argv[1]
    print(f"\n{'='*50}")
    print(f"  Cloudflare Domain Registration: {domain}")
    print(f"{'='*50}\n")
    register_domain(domain)
