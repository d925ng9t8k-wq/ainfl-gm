/**
 * Create X.com (Twitter) account using Playwright
 *
 * Prerequisites:
 *   - Playwright installed: npm install playwright
 *   - Chromium browser installed: npx playwright install chromium
 *   - .env file with X9_PROTON_EMAIL and X9_PROTON_PASSWORD
 *
 * Usage:
 *   node scripts/create-x-account.mjs
 *   node scripts/create-x-account.mjs --check-only   (just check if X is up)
 *
 * Account details:
 *   - Name: X9
 *   - Email: x9agent@proton.me
 *   - DOB: December 24, 1977
 *
 * Known issues (March 2026):
 *   - X.com has had multiple major outages (10,000+ Downdetector reports)
 *   - Signup silently fails with "Can't complete your signup right now"
 *   - VoIP numbers (Twilio) are blocked; need SIM-based numbers
 *   - IP-based blocking on datacenter/VPN IPs
 *
 * See docs/solutions-account-creation.md for full mitigation guide.
 */

import { chromium } from 'playwright';
import { readFileSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check-only');

// ─── Load .env ───────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = join(PROJECT_ROOT, '.env');
  const env = {};
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
  }
  return env;
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const env = loadEnv();
const EMAIL = env.X9_PROTON_EMAIL || 'x9agent@proton.me';
const NAME = 'X9';
const DOB_MONTH = 'December';
const DOB_DAY = '24';
const DOB_YEAR = '1977';

console.log('=== X.com Account Creation ===');
console.log(`Mode: ${CHECK_ONLY ? 'CHECK ONLY' : 'FULL SIGNUP'}`);
console.log('');

const browser = await chromium.launch({
  headless: false,
  args: ['--disable-blink-features=AutomationControlled'],
});

const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  viewport: { width: 1280, height: 800 },
});

const page = await context.newPage();

try {
  // ─── Step 1: Check if X.com is up ─────────────────────────────────────────
  console.log('[1] Checking if X.com is accessible...');

  let xIsUp = false;
  try {
    const response = await page.goto('https://x.com', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    const status = response?.status();
    console.log(`  Response status: ${status}`);
    await page.waitForTimeout(3000);

    // Check for error indicators
    const bodyText = await page.textContent('body').catch(() => '');
    const hasError =
      bodyText.includes('Something went wrong') ||
      bodyText.includes('Try again') ||
      bodyText.includes('over capacity') ||
      bodyText.includes('rate limit') ||
      status >= 500;

    if (hasError) {
      console.log('  X.com is UP but showing errors.');
      console.log(`  Page text snippet: ${bodyText.substring(0, 200)}`);
    } else {
      console.log('  X.com appears to be working.');
      xIsUp = true;
    }
  } catch (err) {
    console.log(`  X.com is DOWN or unreachable: ${err.message}`);
  }

  await page.screenshot({ path: join(PROJECT_ROOT, 'data/x-step1-homepage.png') });
  console.log('  Screenshot: data/x-step1-homepage.png');

  if (CHECK_ONLY) {
    console.log('');
    console.log(`Result: X.com is ${xIsUp ? 'UP' : 'DOWN/ERRORING'}`);
    console.log('Run without --check-only to attempt signup.');
    await page.waitForTimeout(5000);
    await browser.close();
    process.exit(0);
  }

  if (!xIsUp) {
    console.log('');
    console.log('X.com is not working properly. Signup will likely fail.');
    const proceed = await prompt('Attempt signup anyway? (y/n): ');
    if (proceed.toLowerCase() !== 'y') {
      console.log('Aborting. Try again later when X.com is stable.');
      await browser.close();
      process.exit(0);
    }
  }

  // ─── Step 2: Navigate to signup ───────────────────────────────────────────
  console.log('[2] Navigating to X.com signup...');
  await page.goto('https://x.com/i/flow/signup', {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/x-step2-signup-page.png') });

  // ─── Step 3: Fill signup form ─────────────────────────────────────────────
  console.log('[3] Filling signup form...');

  // Look for "Create your account" step
  // X signup is a multi-step modal flow

  // Name field
  const nameInput = page.locator('input[name="name"]').first();
  if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
    await nameInput.click();
    for (const char of NAME) {
      await nameInput.type(char, { delay: 60 + Math.random() * 80 });
    }
    console.log(`  Name: ${NAME}`);
  } else {
    console.log('  WARNING: Name input not found');
  }

  // Email field — X may show phone first; look for "Use email instead" link
  const useEmailLink = page.locator('text=Use email instead').first();
  if (await useEmailLink.isVisible({ timeout: 2000 }).catch(() => false)) {
    await useEmailLink.click();
    await page.waitForTimeout(1000);
  }

  const emailInput = page.locator('input[name="email"]').first();
  if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await emailInput.click();
    for (const char of EMAIL) {
      await emailInput.type(char, { delay: 50 + Math.random() * 70 });
    }
    console.log(`  Email: ${EMAIL}`);
  } else {
    console.log('  WARNING: Email input not found');
  }

  // Date of birth
  // X uses three select dropdowns for DOB
  const monthSelect = page.locator('select[name="month"], select#SELECTOR_1').first();
  if (await monthSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await monthSelect.selectOption({ label: DOB_MONTH });
    console.log(`  Month: ${DOB_MONTH}`);
  }

  const daySelect = page.locator('select[name="day"], select#SELECTOR_2').first();
  if (await daySelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await daySelect.selectOption({ label: DOB_DAY });
    console.log(`  Day: ${DOB_DAY}`);
  }

  const yearSelect = page.locator('select[name="year"], select#SELECTOR_3').first();
  if (await yearSelect.isVisible({ timeout: 2000 }).catch(() => false)) {
    await yearSelect.selectOption({ label: DOB_YEAR });
    console.log(`  Year: ${DOB_YEAR}`);
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/x-step3-form-filled.png') });
  console.log('  Screenshot: data/x-step3-form-filled.png');

  // ─── Step 4: Click Next ───────────────────────────────────────────────────
  console.log('[4] Clicking Next...');
  const nextBtn = page.locator('button:has-text("Next"), div[role="button"]:has-text("Next")').first();
  if (await nextBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await nextBtn.click();
    await page.waitForTimeout(3000);
  }
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/x-step4-after-next.png') });

  // ─── Step 5: Handle verification / CAPTCHA ────────────────────────────────
  console.log('[5] Checking for verification or CAPTCHA...');
  await page.waitForTimeout(2000);

  const bodyText = await page.textContent('body').catch(() => '');

  if (bodyText.includes("Can't complete your signup")) {
    console.log('');
    console.log('BLOCKED: X.com says "Can\'t complete your signup right now"');
    console.log('This is likely due to:');
    console.log('  - Platform instability / ongoing outage');
    console.log('  - IP-based blocking');
    console.log('  - Rate limiting from previous attempts');
    console.log('');
    console.log('Recommended: Wait 24h, use mobile hotspot, try off-peak hours.');
    await page.screenshot({ path: join(PROJECT_ROOT, 'data/x-step5-blocked.png') });
  } else if (bodyText.includes('verification') || bodyText.includes('Verify')) {
    console.log('  Verification step detected. Check email or phone.');
    const code = await prompt('  Enter verification code: ');
    const codeInput = page.locator('input[name="verfication_code"], input[type="text"]').first();
    if (await codeInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await codeInput.fill(code);
      const submitBtn = page.locator('button:has-text("Next"), button:has-text("Verify")').first();
      if (await submitBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await submitBtn.click();
      }
    }
  } else {
    console.log('  No obvious blocker. Continuing...');
    // X may ask to set a password
    const passwordInput = page.locator('input[name="password"]').first();
    if (await passwordInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log('  Password step found. Setting password...');
      const pw = env.X9_PROTON_PASSWORD; // Reuse for now
      for (const char of pw) {
        await passwordInput.type(char, { delay: 40 + Math.random() * 60 });
      }
      const nextBtn2 = page.locator('button:has-text("Next"), button:has-text("Sign up")').first();
      if (await nextBtn2.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nextBtn2.click();
      }
    }
  }

  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/x-step5-final.png') });

  // ─── Result ───────────────────────────────────────────────────────────────
  const finalUrl = page.url();
  console.log('');
  console.log(`Final URL: ${finalUrl}`);

  if (finalUrl.includes('/home') || finalUrl.includes('/onboarding')) {
    console.log('SUCCESS: X.com account appears to be created!');
    console.log(`  Name:  ${NAME}`);
    console.log(`  Email: ${EMAIL}`);

    const envLine = `\nX9_X_USERNAME=${NAME}\nX9_X_EMAIL=${EMAIL}\n`;
    appendFileSync(join(PROJECT_ROOT, '.env'), envLine);
    console.log('  Saved X9_X_USERNAME and X9_X_EMAIL to .env');
  } else {
    console.log('Signup may not be complete. Check browser and screenshots in data/');
  }

  console.log('');
  console.log('Browser will stay open for 60 seconds for manual inspection...');
  await page.waitForTimeout(60_000);

} catch (err) {
  console.error('ERROR:', err.message);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/x-error.png') }).catch(() => {});
  console.log('Error screenshot saved: data/x-error.png');
} finally {
  await browser.close();
  console.log('Browser closed.');
}
