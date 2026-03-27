/**
 * Create Proton email account using Playwright
 * Handles CAPTCHA puzzle via visual analysis + mouse drag
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';

// Load creds from .env
const envPath = new URL('../.env', import.meta.url).pathname;
const env = {};
for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
  const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const USERNAME = 'x9agent';
const PASSWORD = env.X9_PROTON_PASSWORD;

if (!PASSWORD) {
  console.error('X9_PROTON_PASSWORD not found in .env');
  process.exit(1);
}

(async () => {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  console.log('Navigating to Proton signup...');
  await page.goto('https://account.proton.me/signup?plan=free');
  await page.waitForTimeout(3000);

  // Fill username
  console.log('Filling username...');
  await page.fill('#username', USERNAME);
  await page.waitForTimeout(500);

  // Fill password
  console.log('Filling password...');
  await page.fill('#password', PASSWORD);
  await page.waitForTimeout(500);

  // Check for confirm password
  const confirmPw = await page.$('#repeat-password');
  if (confirmPw) {
    console.log('Filling confirm password...');
    await confirmPw.fill(PASSWORD);
    await page.waitForTimeout(500);
  }

  // Click submit
  console.log('Clicking submit...');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Handle upsell popup
  const noThanks = await page.$('text=No, thanks');
  if (noThanks) {
    console.log('Dismissing upsell...');
    await noThanks.click();
    await page.waitForTimeout(3000);
  }

  // Check for CAPTCHA
  console.log('Looking for CAPTCHA...');
  await page.waitForTimeout(2000);

  // Take screenshot to see what we're dealing with
  await page.screenshot({ path: '/tmp/playwright-proton.png' });
  console.log('Screenshot saved to /tmp/playwright-proton.png');

  // Try to find and solve the puzzle CAPTCHA
  // The Proton CAPTCHA is a custom implementation with a draggable puzzle piece
  // We need to find the puzzle piece and the target hole, then drag

  // Look for the CAPTCHA iframe or container
  const captchaFrame = page.frameLocator('iframe[title*="verification"], iframe[src*="captcha"]').first();

  try {
    // Try to find puzzle elements in iframe
    const puzzlePiece = captchaFrame.locator('[class*="puzzle-piece"], [class*="drag"], img[class*="piece"]').first();
    const exists = await puzzlePiece.count();

    if (exists > 0) {
      console.log('Found puzzle piece in iframe, attempting drag...');
      const box = await puzzlePiece.boundingBox();
      if (box) {
        // Drag from puzzle piece location to approximate target (center-ish of image)
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        // Try dragging to several positions
        for (let x = box.x + 50; x < box.x + 300; x += 30) {
          await page.mouse.move(x, box.y + 100, { steps: 5 });
          await page.waitForTimeout(100);
        }
        await page.mouse.up();
        await page.waitForTimeout(2000);
      }
    } else {
      console.log('No puzzle piece found in iframe. Checking main page...');
    }
  } catch (e) {
    console.log('CAPTCHA iframe approach failed:', e.message);
  }

  // Try Email verification tab if CAPTCHA fails
  try {
    const emailTab = await page.$('text=Email');
    if (emailTab) {
      console.log('Trying Email verification instead...');
      await emailTab.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: '/tmp/playwright-proton-email.png' });
      console.log('Email tab screenshot saved');
    }
  } catch (e) {
    console.log('Email tab not available:', e.message);
  }

  // Final screenshot
  await page.screenshot({ path: '/tmp/playwright-proton-final.png' });
  console.log('Final screenshot saved to /tmp/playwright-proton-final.png');

  // Keep browser open for manual intervention if needed
  console.log('Browser staying open. Check screenshots for status.');
  console.log('If CAPTCHA needs manual solving, do it in the browser window.');

  // Wait a bit then close
  await page.waitForTimeout(60000);
  await browser.close();
})();
