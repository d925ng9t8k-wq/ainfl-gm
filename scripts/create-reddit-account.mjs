/**
 * Create Reddit account using Playwright
 *
 * Prerequisites:
 *   - Playwright installed: npm install playwright
 *   - Chromium browser installed: npx playwright install chromium
 *   - .env file with X9_PROTON_EMAIL and X9_PROTON_PASSWORD
 *
 * Usage:
 *   node scripts/create-reddit-account.mjs
 *
 * Flow:
 *   1. Navigate to reddit.com/register
 *   2. Enter email (x9agent@proton.me)
 *   3. Reddit sends verification code to email
 *   4. PAUSE — user must enter verification code (or integrate CAPTCHA solver)
 *   5. Choose username (x9_ainflgm) and password
 *   6. Complete signup
 *
 * CAPTCHA Notes:
 *   Reddit uses hCaptcha or custom shadow DOM CAPTCHAs.
 *   For automated solving, integrate CapMonster Cloud or 2Captcha.
 *   See docs/solutions-account-creation.md section 3 for details.
 *   Environment variable: CAPMONSTER_API_KEY or TWO_CAPTCHA_API_KEY
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, appendFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as readline from 'readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

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

// ─── Prompt user for input (verification code, etc.) ─────────────────────────
function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─── Solve CAPTCHA via CapMonster Cloud (if API key available) ───────────────
async function solveHCaptcha(siteKey, pageUrl, apiKey) {
  console.log('  Sending hCaptcha to CapMonster Cloud...');
  const createResp = await fetch('https://api.capmonster.cloud/createTask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientKey: apiKey,
      task: {
        type: 'HCaptchaTaskProxyless',
        websiteURL: pageUrl,
        websiteKey: siteKey,
      },
    }),
  });
  const createData = await createResp.json();
  if (createData.errorId !== 0) {
    throw new Error(`CapMonster createTask error: ${createData.errorDescription}`);
  }
  const taskId = createData.taskId;
  console.log(`  Task created: ${taskId}. Polling for result...`);

  // Poll for result (max 120s)
  const start = Date.now();
  while (Date.now() - start < 120_000) {
    await new Promise((r) => setTimeout(r, 3000));
    const resultResp = await fetch('https://api.capmonster.cloud/getTaskResult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientKey: apiKey, taskId }),
    });
    const resultData = await resultResp.json();
    if (resultData.status === 'ready') {
      console.log('  CAPTCHA solved!');
      return resultData.solution.gRecaptchaResponse;
    }
    process.stdout.write('.');
  }
  throw new Error('CAPTCHA solve timed out after 120s');
}

// ─── Main ────────────────────────────────────────────────────────────────────
const env = loadEnv();
const EMAIL = env.X9_PROTON_EMAIL || 'x9agent@proton.me';
const PASSWORD = env.X9_PROTON_PASSWORD;
const CAPMONSTER_KEY = env.CAPMONSTER_API_KEY || '';
const USERNAME = 'x9_ainflgm';

if (!PASSWORD) {
  console.error('ERROR: X9_PROTON_PASSWORD not found in .env');
  process.exit(1);
}

console.log('=== Reddit Account Creation ===');
console.log(`Email:    ${EMAIL}`);
console.log(`Username: ${USERNAME}`);
console.log(`CAPTCHA:  ${CAPMONSTER_KEY ? 'CapMonster Cloud' : 'MANUAL (no CAPMONSTER_API_KEY)'}`);
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
  // ─── Step 1: Navigate to Reddit registration ──────────────────────────────
  console.log('[1/6] Navigating to reddit.com/register...');
  await page.goto('https://www.reddit.com/register/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // Take screenshot for debugging
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-step1-loaded.png') });
  console.log('  Screenshot saved: data/reddit-step1-loaded.png');

  // ─── Step 2: Enter email ──────────────────────────────────────────────────
  console.log('[2/6] Entering email...');

  // Reddit's signup flow may use different selectors depending on the version
  // Try multiple approaches
  const emailSelectors = [
    'input[name="email"]',
    'input[type="email"]',
    '#regEmail',
    'input[placeholder*="email" i]',
    'input[placeholder*="Email" i]',
    // Shadow DOM piercing
    'faceplate-text-input[name="email"] input',
    'shreddit-signup input[type="email"]',
  ];

  let emailInput = null;
  for (const sel of emailSelectors) {
    try {
      emailInput = page.locator(sel).first();
      if (await emailInput.isVisible({ timeout: 1000 })) {
        console.log(`  Found email input: ${sel}`);
        break;
      }
      emailInput = null;
    } catch {
      emailInput = null;
    }
  }

  if (!emailInput) {
    // Try evaluating inside potential shadow roots
    console.log('  Trying shadow DOM approach...');
    const found = await page.evaluate(() => {
      // Check for Reddit's custom elements with shadow roots
      const hosts = document.querySelectorAll('*');
      for (const host of hosts) {
        if (host.shadowRoot) {
          const input = host.shadowRoot.querySelector('input[type="email"], input[name="email"]');
          if (input) {
            input.focus();
            return true;
          }
        }
      }
      return false;
    });
    if (found) {
      emailInput = page.locator(':focus');
      console.log('  Found email input via shadow DOM');
    }
  }

  if (emailInput) {
    // Type with human-like delays
    await emailInput.click();
    await emailInput.fill('');
    for (const char of EMAIL) {
      await emailInput.type(char, { delay: 50 + Math.random() * 80 });
    }
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-step2-email.png') });
    console.log('  Email entered. Screenshot: data/reddit-step2-email.png');

    // Look for Continue/Next button
    const continueSelectors = [
      'button:has-text("Continue")',
      'button:has-text("Next")',
      'button[type="submit"]',
      'faceplate-button:has-text("Continue")',
    ];
    for (const sel of continueSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          console.log('  Clicked continue button');
          break;
        }
      } catch {
        // try next
      }
    }
  } else {
    console.log('  WARNING: Could not find email input. Taking screenshot for manual review.');
    await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-step2-no-email-input.png') });
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-step3-after-email.png') });

  // ─── Step 3: Verification code ────────────────────────────────────────────
  console.log('[3/6] Waiting for verification code...');
  console.log('  Reddit will send a verification code to your email.');
  console.log('  Check x9agent@proton.me for the code.');
  console.log('');

  const verificationCode = await prompt('  Enter the verification code from email: ');
  console.log(`  Code entered: ${verificationCode}`);

  // Find and fill verification code input
  const codeSelectors = [
    'input[name="code"]',
    'input[name="verificationCode"]',
    'input[placeholder*="code" i]',
    'input[placeholder*="verification" i]',
    'input[type="text"]',
    'input[inputmode="numeric"]',
  ];

  let codeInput = null;
  for (const sel of codeSelectors) {
    try {
      codeInput = page.locator(sel).first();
      if (await codeInput.isVisible({ timeout: 1000 })) {
        console.log(`  Found code input: ${sel}`);
        break;
      }
      codeInput = null;
    } catch {
      codeInput = null;
    }
  }

  if (codeInput) {
    await codeInput.click();
    await codeInput.fill('');
    for (const char of verificationCode) {
      await codeInput.type(char, { delay: 80 + Math.random() * 50 });
    }
    await page.waitForTimeout(500);

    // Submit code
    for (const sel of ['button:has-text("Continue")', 'button:has-text("Verify")', 'button[type="submit"]']) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          console.log('  Submitted verification code');
          break;
        }
      } catch {
        // try next
      }
    }
  } else {
    console.log('  WARNING: Could not find code input. Check screenshots.');
  }

  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-step4-after-code.png') });

  // ─── Step 4: Choose username ──────────────────────────────────────────────
  console.log('[4/6] Setting username...');
  const usernameSelectors = [
    'input[name="username"]',
    'input[placeholder*="username" i]',
    '#regUsername',
  ];

  let usernameInput = null;
  for (const sel of usernameSelectors) {
    try {
      usernameInput = page.locator(sel).first();
      if (await usernameInput.isVisible({ timeout: 1000 })) {
        console.log(`  Found username input: ${sel}`);
        break;
      }
      usernameInput = null;
    } catch {
      usernameInput = null;
    }
  }

  if (usernameInput) {
    await usernameInput.click();
    await usernameInput.fill('');
    for (const char of USERNAME) {
      await usernameInput.type(char, { delay: 60 + Math.random() * 60 });
    }
    console.log(`  Username set: ${USERNAME}`);
  }

  // ─── Step 5: Set password ─────────────────────────────────────────────────
  console.log('[5/6] Setting password...');
  const passwordSelectors = [
    'input[name="password"]',
    'input[type="password"]',
    '#regPassword',
  ];

  let passwordInput = null;
  for (const sel of passwordSelectors) {
    try {
      passwordInput = page.locator(sel).first();
      if (await passwordInput.isVisible({ timeout: 1000 })) {
        console.log(`  Found password input: ${sel}`);
        break;
      }
      passwordInput = null;
    } catch {
      passwordInput = null;
    }
  }

  if (passwordInput) {
    await passwordInput.click();
    await passwordInput.fill('');
    for (const char of PASSWORD) {
      await passwordInput.type(char, { delay: 40 + Math.random() * 60 });
    }
    console.log('  Password set');
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-step5-credentials.png') });

  // ─── Step 6: Handle CAPTCHA and submit ────────────────────────────────────
  console.log('[6/6] Looking for CAPTCHA...');

  // Check for hCaptcha
  const hcaptchaFrame = page.frameLocator('iframe[src*="hcaptcha"]');
  let hcaptchaFound = false;
  try {
    const checkbox = hcaptchaFrame.locator('.check');
    hcaptchaFound = await checkbox.isVisible({ timeout: 2000 });
  } catch {
    // no hcaptcha
  }

  if (hcaptchaFound && CAPMONSTER_KEY) {
    console.log('  hCaptcha detected. Solving via CapMonster Cloud...');
    // Extract sitekey
    const siteKey = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[src*="hcaptcha"]');
      if (iframe) {
        const src = iframe.getAttribute('src') || '';
        const match = src.match(/sitekey=([^&]+)/);
        return match ? match[1] : null;
      }
      // Check for hcaptcha div
      const div = document.querySelector('[data-sitekey]');
      return div ? div.getAttribute('data-sitekey') : null;
    });

    if (siteKey) {
      const token = await solveHCaptcha(siteKey, page.url(), CAPMONSTER_KEY);
      // Inject solution
      await page.evaluate((token) => {
        const textarea = document.querySelector('[name="h-captcha-response"]') ||
                          document.querySelector('[name="g-recaptcha-response"]');
        if (textarea) textarea.value = token;
        // Trigger callback
        if (typeof window.hcaptcha !== 'undefined') {
          window.hcaptcha.execute();
        }
      }, token);
      console.log('  CAPTCHA token injected');
    }
  } else if (hcaptchaFound) {
    console.log('  hCaptcha detected but no CAPMONSTER_API_KEY. Solve manually in the browser.');
    await prompt('  Press Enter after solving CAPTCHA manually...');
  } else {
    console.log('  No hCaptcha detected (may use different CAPTCHA or none)');
  }

  // Try to click final signup/submit button
  const submitSelectors = [
    'button:has-text("Sign Up")',
    'button:has-text("Sign up")',
    'button:has-text("Create Account")',
    'button:has-text("Submit")',
    'button[type="submit"]',
  ];

  for (const sel of submitSelectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        console.log(`  Clicked: ${sel}`);
        break;
      }
    } catch {
      // try next
    }
  }

  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-step6-final.png') });

  // ─── Check result ─────────────────────────────────────────────────────────
  const currentUrl = page.url();
  console.log('');
  console.log(`Final URL: ${currentUrl}`);

  if (currentUrl.includes('reddit.com') && !currentUrl.includes('register')) {
    console.log('SUCCESS: Reddit account appears to be created!');
    console.log(`  Username: ${USERNAME}`);
    console.log(`  Email:    ${EMAIL}`);

    // Save to .env
    const envLine = `\nX9_REDDIT_USERNAME=${USERNAME}\n`;
    appendFileSync(join(PROJECT_ROOT, '.env'), envLine);
    console.log('  Saved X9_REDDIT_USERNAME to .env');
  } else {
    console.log('Account creation may not be complete. Check the browser window.');
    console.log('Screenshots saved in data/ directory for debugging.');
  }

  console.log('');
  console.log('Browser will stay open for 60 seconds for manual inspection...');
  await page.waitForTimeout(60_000);

} catch (err) {
  console.error('ERROR:', err.message);
  await page.screenshot({ path: join(PROJECT_ROOT, 'data/reddit-error.png') }).catch(() => {});
  console.log('Error screenshot saved: data/reddit-error.png');
} finally {
  await browser.close();
  console.log('Browser closed.');
}
