/**
 * premium-gate.js
 * PlayAiGM Premium Content Gate
 *
 * Usage: Include this script in premium articles. Add data attributes to the
 * article container element:
 *   <div class="article-body" data-premium="true" data-article="slug">
 *     ... full content ...
 *   </div>
 *
 * The gate will:
 *   1. Show the first paragraph (teaser) unblocked.
 *   2. Blur/hide the rest of the content.
 *   3. Overlay a "Go Premium" CTA.
 *   4. On successful checkout return (session_id in URL), verify with backend
 *      and unlock for the session.
 *
 * Backend: POST /create-checkout-session on STRIPE_BACKEND_URL
 */

(function() {
  'use strict';

  // ─── Config ───────────────────────────────────────────────────────────────
  // In production, set window.AINFLGM_STRIPE_URL to point to your Railway backend.
  // Default falls back to localhost for local testing.
  var BACKEND_URL = (window.AINFLGM_STRIPE_URL || 'https://ainflgm-stripe.railway.app').replace(/\/$/, '');
  var PREMIUM_SESSION_KEY = 'ainflgm_premium_session';
  var PREMIUM_VERIFIED_KEY = 'ainflgm_premium_verified';

  // ─── Styles injected by JS (no external CSS dependency) ──────────────────
  var style = document.createElement('style');
  style.textContent = [
    '.pg-gate-wrapper { position: relative; }',
    '.pg-blur { filter: blur(4px); user-select: none; pointer-events: none; max-height: 220px; overflow: hidden; transition: filter 0.3s; }',
    '.pg-overlay {',
    '  position: absolute; bottom: 0; left: 0; right: 0;',
    '  background: linear-gradient(to bottom, transparent 0%, #0a0a0a 40%);',
    '  padding: 120px 24px 40px;',
    '  text-align: center;',
    '  border-radius: 0 0 16px 16px;',
    '}',
    '.pg-overlay-card {',
    '  background: #111; border: 1px solid rgba(251,79,20,0.35);',
    '  border-radius: 16px; padding: 32px 28px; max-width: 480px; margin: 0 auto;',
    '  box-shadow: 0 0 40px rgba(251,79,20,0.08);',
    '}',
    '.pg-lock { font-size: 2rem; margin-bottom: 12px; }',
    '.pg-title { font-size: 1.25rem; font-weight: 800; color: #fff; margin-bottom: 8px; letter-spacing: -0.02em; }',
    '.pg-subtitle { font-size: 0.9rem; color: #888; line-height: 1.55; margin-bottom: 24px; }',
    '.pg-btn {',
    '  display: inline-block; padding: 14px 32px;',
    '  background: #FB4F14; color: #fff; border: none; border-radius: 10px;',
    '  font-size: 1rem; font-weight: 700; cursor: pointer; text-decoration: none;',
    '  transition: background 0.2s, transform 0.1s; letter-spacing: -0.01em;',
    '}',
    '.pg-btn:hover { background: #e04412; transform: translateY(-1px); }',
    '.pg-btn:active { transform: translateY(0); }',
    '.pg-loading { opacity: 0.6; pointer-events: none; }',
    '.pg-price { font-size: 0.8rem; color: #666; margin-top: 10px; }',
    '.pg-features { list-style: none; padding: 0; margin: 0 0 24px; text-align: left; }',
    '.pg-features li { font-size: 0.88rem; color: #aaa; padding: 5px 0; display: flex; gap: 8px; }',
    '.pg-features li::before { content: ""; color: #FB4F14; flex-shrink: 0; }',
    '.pg-unlocked-banner {',
    '  background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3);',
    '  border-radius: 8px; padding: 10px 16px; margin-bottom: 20px;',
    '  font-size: 0.85rem; color: #22c55e; display: flex; align-items: center; gap: 8px;',
    '}',
  ].join('\n');
  document.head.appendChild(style);

  // ─── Premium verification ─────────────────────────────────────────────────
  function isPremiumActive() {
    try {
      var verified = sessionStorage.getItem(PREMIUM_VERIFIED_KEY);
      if (verified === 'true') return true;
    } catch (e) { /* storage may be blocked */ }
    return false;
  }

  function setPremiumActive() {
    try {
      sessionStorage.setItem(PREMIUM_VERIFIED_KEY, 'true');
      localStorage.setItem(PREMIUM_VERIFIED_KEY, JSON.stringify({ ts: Date.now(), exp: Date.now() + 30 * 24 * 60 * 60 * 1000 }));
    } catch (e) { /* non-fatal */ }
  }

  function isPremiumStoredLocally() {
    try {
      var stored = localStorage.getItem(PREMIUM_VERIFIED_KEY);
      if (!stored) return false;
      var obj = JSON.parse(stored);
      return obj && obj.exp && obj.exp > Date.now();
    } catch (e) { return false; }
  }

  // ─── Check session_id on success return ──────────────────────────────────
  function checkSessionIdFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get('session_id');
    if (!sessionId) return false;

    // Verify with backend
    fetch(BACKEND_URL + '/premium-status?session_id=' + encodeURIComponent(sessionId))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.active) {
          setPremiumActive();
          window.location.reload();
        }
      })
      .catch(function() { /* network failure — non-fatal */ });
    return false;
  }

  // ─── Apply gate to premium content ───────────────────────────────────────
  function applyGate(container) {
    var articleSlug = container.getAttribute('data-article') || window.location.pathname;
    var children = Array.from(container.children);

    // Find the teaser: everything after the first two block elements gets gated
    var teaserCutoff = 2;
    if (children.length <= teaserCutoff) return; // content too short to gate

    // Wrap gated content
    var gatedWrapper = document.createElement('div');
    gatedWrapper.className = 'pg-gate-wrapper';

    var blurDiv = document.createElement('div');
    blurDiv.className = 'pg-blur';

    // Move elements after cutoff into blurDiv
    for (var i = teaserCutoff; i < children.length; i++) {
      blurDiv.appendChild(children[i].cloneNode(true));
    }

    // Remove originals after cutoff
    for (var j = children.length - 1; j >= teaserCutoff; j--) {
      container.removeChild(container.children[j]);
    }

    // Build overlay CTA
    var overlay = document.createElement('div');
    overlay.className = 'pg-overlay';
    overlay.innerHTML = [
      '<div class="pg-overlay-card">',
      '  <div class="pg-lock">&#128274;</div>',
      '  <div class="pg-title">This is Premium Content</div>',
      '  <div class="pg-subtitle">Get full access to every dynasty ranking, cap analysis, and AI GM tool on PlayAiGM.</div>',
      '  <ul class="pg-features">',
      '    <li>Post-draft dynasty rankings (all positions)</li>',
      '    <li>Buy/Sell/Hold alerts after every major move</li>',
      '    <li>AI-powered trade analyzer with dynasty scoring</li>',
      '    <li>Full cap space breakdowns for all 32 teams</li>',
      '  </ul>',
      '  <button class="pg-btn" id="pg-checkout-btn" data-article="' + articleSlug + '">Go Premium — $9.99/mo</button>',
      '  <div class="pg-price">Cancel anytime &bull; Secure checkout by Stripe</div>',
      '</div>',
    ].join('\n');

    gatedWrapper.appendChild(blurDiv);
    gatedWrapper.appendChild(overlay);
    container.appendChild(gatedWrapper);

    // Wire checkout button
    var btn = document.getElementById('pg-checkout-btn');
    if (btn) {
      btn.addEventListener('click', function() {
        btn.textContent = 'Loading...';
        btn.classList.add('pg-loading');

        fetch(BACKEND_URL + '/create-checkout-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'source_article=' + encodeURIComponent(articleSlug)
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.url) {
            window.location.href = data.url;
          } else {
            btn.textContent = 'Error — try again';
            btn.classList.remove('pg-loading');
            console.error('Stripe checkout error:', data.error);
          }
        })
        .catch(function(err) {
          btn.textContent = 'Error — try again';
          btn.classList.remove('pg-loading');
          console.error('Stripe checkout fetch error:', err);
        });
      });
    }
  }

  // ─── Main ─────────────────────────────────────────────────────────────────
  function init() {
    // 1. Check for return from Stripe checkout (session_id in URL)
    checkSessionIdFromUrl();

    // 2. Check if premium is already active
    var active = isPremiumActive() || isPremiumStoredLocally();
    if (active) {
      // Set session flag so sub-pages don't re-check
      try { sessionStorage.setItem(PREMIUM_VERIFIED_KEY, 'true'); } catch (e) { /* */ }

      // Show unlocked banner if on a premium article
      var containers = document.querySelectorAll('[data-premium="true"]');
      containers.forEach(function(c) {
        var banner = document.createElement('div');
        banner.className = 'pg-unlocked-banner';
        banner.innerHTML = '<span>&#10003;</span> <span>Premium unlocked &mdash; enjoy full access</span>';
        c.insertBefore(banner, c.firstChild);
      });
      return;
    }

    // 3. Apply gate to all premium containers
    var containers = document.querySelectorAll('[data-premium="true"]');
    if (containers.length === 0) return;
    containers.forEach(applyGate);
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
