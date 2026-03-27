#!/usr/bin/env node
/**
 * Create Alpaca Paper Trading Account
 *
 * Alpaca does NOT offer a public API for account creation — you must sign up
 * through the web UI. This script automates the browser-based signup using
 * Playwright, then extracts paper trading API keys.
 *
 * Email: x9agent@proton.me
 * No KYC required for paper trading accounts.
 *
 * Usage: node scripts/create-alpaca-paper.mjs
 */

import { chromium } from 'playwright';

const SIGNUP_URL = 'https://app.alpaca.markets/signup';
const EMAIL = 'x9agent@proton.me';
// Generate a strong random password
const PASSWORD = 'Alp' + Math.random().toString(36).slice(2, 10) + '!' + Math.floor(Math.random() * 900 + 100);

async function createPaperAccount() {
  console.log('=== Alpaca Paper Trading Account Creator ===');
  console.log(`Email: ${EMAIL}`);
  console.log(`Password: ${PASSWORD}`);
  console.log('');

  let browser;
  try {
    browser = await chromium.launch({ headless: false }); // Visible so we can handle CAPTCHAs
    const context = await browser.newContext();
    const page = await context.newPage();

    // Step 1: Navigate to signup
    console.log('[1/5] Navigating to Alpaca signup...');
    await page.goto(SIGNUP_URL, { waitUntil: 'networkidle', timeout: 30000 });

    // Step 2: Fill signup form
    console.log('[2/5] Filling signup form...');

    // Alpaca's signup form may vary — try common selectors
    const emailInput = page.locator('input[name="email"], input[type="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[name="password"], input[type="password"]').first();

    await emailInput.waitFor({ timeout: 15000 });
    await emailInput.fill(EMAIL);
    await passwordInput.fill(PASSWORD);

    // Look for submit button
    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign Up"), button:has-text("Create Account"), button:has-text("Get Started")').first();
    await submitBtn.click();

    console.log('[3/5] Submitted signup form. Waiting for verification...');
    console.log('');
    console.log('>>> ACTION REQUIRED: Check x9agent@proton.me for verification email <<<');
    console.log('>>> If CAPTCHA appeared, solve it in the browser window <<<');
    console.log('');

    // Wait for user to verify email — poll for dashboard
    console.log('[4/5] Waiting up to 5 minutes for email verification...');
    try {
      await page.waitForURL('**/dashboard**', { timeout: 300000 });
      console.log('Dashboard loaded — account verified!');
    } catch {
      console.log('Timed out waiting for dashboard. Check if manual steps are needed.');
      console.log('Current URL:', page.url());
    }

    // Step 3: Navigate to paper trading API keys
    console.log('[5/5] Attempting to get paper trading API keys...');
    try {
      await page.goto('https://app.alpaca.markets/paper/dashboard/overview', { waitUntil: 'networkidle', timeout: 30000 });

      // Try to find and click "Generate API Key" or similar
      const apiKeyLink = page.locator('a:has-text("API Keys"), button:has-text("API Keys"), [href*="api-keys"]').first();
      if (await apiKeyLink.isVisible({ timeout: 5000 })) {
        await apiKeyLink.click();
        await page.waitForTimeout(3000);

        const generateBtn = page.locator('button:has-text("Generate"), button:has-text("Regenerate"), button:has-text("New Key")').first();
        if (await generateBtn.isVisible({ timeout: 5000 })) {
          await generateBtn.click();
          await page.waitForTimeout(3000);

          // Try to extract key values from the page
          const pageText = await page.textContent('body');
          console.log('\n=== Check the browser window for your API keys ===');
          console.log('Copy them before closing — the secret is only shown once.\n');

          // Look for key pattern (PK followed by alphanumeric)
          const keyMatch = pageText.match(/PK[A-Za-z0-9]{16,}/);
          if (keyMatch) {
            console.log(`API Key ID: ${keyMatch[0]}`);
          }
        }
      }
    } catch (err) {
      console.log('Could not auto-navigate to API keys. Do it manually in the browser.');
    }

    console.log('\n=== Account Credentials ===');
    console.log(`Email:    ${EMAIL}`);
    console.log(`Password: ${PASSWORD}`);
    console.log('\n=== Next Steps ===');
    console.log('1. Log in at https://app.alpaca.markets/paper/dashboard/overview');
    console.log('2. Go to API Keys in the sidebar');
    console.log('3. Generate a new paper trading key pair');
    console.log('4. Add to .env:');
    console.log('   ALPACA_API_KEY=PK...');
    console.log('   ALPACA_SECRET_KEY=...');
    console.log('5. Run: node scripts/trading-bot.mjs');
    console.log('');

    // Keep browser open so user can interact
    console.log('Browser will stay open for 2 minutes for manual steps...');
    await page.waitForTimeout(120000);

  } catch (err) {
    console.error('Error:', err.message);
    console.log('\n=== Manual Signup Fallback ===');
    console.log('1. Go to https://app.alpaca.markets/signup');
    console.log(`2. Sign up with: ${EMAIL}`);
    console.log('3. No KYC needed for paper trading');
    console.log('4. Get paper trading API keys from the dashboard');
    console.log('5. Add ALPACA_API_KEY and ALPACA_SECRET_KEY to .env');
  } finally {
    if (browser) await browser.close();
  }
}

createPaperAccount();
