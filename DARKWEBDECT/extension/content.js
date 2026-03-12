function removeIfExists(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

let lastResult = null;
let allowedOrigins = new Set();
let settings = { notifyThreshold: 70, pauseThreshold: 80, formWarnThreshold: 60 };
let warnedOnFocus = false;

function scoreToPercentLocal(score) {
  const MAX_SCORE = 40;
  const pct = Math.round((Math.max(0, score) / MAX_SCORE) * 100);
  return Math.max(0, Math.min(100, pct));
}

async function loadSettings() {
  try {
    const s = await chrome.storage.sync.get({
      notifyThreshold: 70,
      pauseThreshold: 80,
      formWarnThreshold: 60
    });
    settings = {
      notifyThreshold: Number(s.notifyThreshold),
      pauseThreshold: Number(s.pauseThreshold),
      formWarnThreshold: Number(s.formWarnThreshold)
    };
  } catch {
    // ignore
  }
}

async function loadAllowedOrigins() {
  try {
    const stored = await chrome.storage.local.get({ brandshieldAllowedOrigins: [] });
    const arr = Array.isArray(stored.brandshieldAllowedOrigins) ? stored.brandshieldAllowedOrigins : [];
    allowedOrigins = new Set(arr);
  } catch {
    allowedOrigins = new Set();
  }
}

async function rememberAllowedOrigin() {
  try {
    const origin = window.location.origin;
    if (!origin) return;
    allowedOrigins.add(origin);
    await chrome.storage.local.set({ brandshieldAllowedOrigins: Array.from(allowedOrigins) });
  } catch {
    // ignore
  }
}

function createFloatingMeter(status, score) {
  removeIfExists('brandshield-meter');

  const badge = document.createElement('div');
  badge.id = 'brandshield-meter';
  badge.style.position = 'fixed';
  badge.style.bottom = '16px';
  badge.style.right = '16px';
  badge.style.padding = '6px 12px';
  badge.style.borderRadius = '999px';
  badge.style.fontSize = '12px';
  badge.style.fontFamily = 'system-ui, sans-serif';
  badge.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
  badge.style.zIndex = 2147483647;
  badge.style.display = 'flex';
  badge.style.alignItems = 'center';
  badge.style.gap = '6px';
  badge.style.backgroundColor = '#f9fafb';

  // score here represents SAFETY % (0–100)
  const color =
    status === 'offline'
      ? '#64748b'
      : typeof score === 'number' && score >= 80
        ? '#10b981'
        : typeof score === 'number' && score >= 40
          ? '#f59e0b'
          : '#ef4444';

  const dot = document.createElement('span');
  dot.style.width = '8px';
  dot.style.height = '8px';
  dot.style.borderRadius = '50%';
  dot.style.backgroundColor = color;

  const text = document.createElement('span');
  let label;
  if (status === 'offline') {
    label = 'OFFLINE';
  } else if (typeof score === 'number') {
    const level = score >= 80 ? 'SAFE' : score >= 40 ? 'RISK' : 'DANGER';
    label = `${level} (${score}% safety)`;
  } else {
    label = 'CHECKING';
  }
  text.textContent = `BrandShield: ${label}`;
  text.style.color = '#111827';

  badge.appendChild(dot);
  badge.appendChild(text);
  document.body.appendChild(badge);
}

function createOverlay({ score, status, redirected, transitionType }) {
  removeIfExists('brandshield-overlay');

  const overlay = document.createElement('div');
  overlay.id = 'brandshield-overlay';
  overlay.style.position = 'fixed';
  overlay.style.top = 0;
  overlay.style.left = 0;
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.5)';
  overlay.style.backdropFilter = 'blur(4px)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.zIndex = 2147483647;
  overlay.style.fontFamily = 'system-ui, sans-serif';

  const box = document.createElement('div');
  box.style.background = '#111827';
  box.style.color = '#f9fafb';
  box.style.padding = '18px 20px';
  box.style.borderRadius = '16px';
  box.style.maxWidth = '440px';
  box.style.width = 'calc(100% - 28px)';
  box.style.boxShadow = '0 18px 50px rgba(0,0,0,0.6)';
  box.style.transform = 'translateY(12px)';
  box.style.opacity = '0';
  box.style.transition = 'opacity 160ms ease-out, transform 200ms ease-out';

  const title = document.createElement('div');
  title.textContent = 'BrandShield Protection';
  title.style.fontSize = '18px';
  title.style.fontWeight = '700';
  title.style.marginBottom = '8px';

  const subtitle = document.createElement('div');
  const safety = typeof score === 'number' ? score : 0;
  let line;
  if (safety >= 80) {
    line = `This website looks safe (${safety}% safety).`;
  } else if (safety >= 40) {
    line = `Some risk signals found (${safety}% safety).`;
  } else {
    line = `High risk detected (${safety}% safety).`;
  }
  if (redirected) {
    line += ' Opened via redirect.';
  }
  subtitle.textContent = line;
  subtitle.style.color = '#d1d5db';
  subtitle.style.fontSize = '13px';
  subtitle.style.marginBottom = '12px';

  const q = document.createElement('div');
  let question;
  if (redirected) {
    question = 'This page was opened through a redirect. Do you want to continue?';
  } else if (transitionType === 'typed') {
    question = 'You typed this website address. Do you recognise and trust it?';
  } else {
    question = 'Do you want to open and continue on this website?';
  }
  q.textContent = question;
  q.style.fontSize = '13px';
  q.style.marginBottom = '10px';

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '8px';
  row.style.flexWrap = 'wrap';

  const primary = document.createElement('button');
  const secondary = document.createElement('button');

  function styleBtn(btn, kind) {
    btn.style.flex = '1';
    btn.style.minWidth = '140px';
    btn.style.padding = '8px 10px';
    btn.style.borderRadius = '10px';
    btn.style.border = '1px solid #374151';
    btn.style.cursor = 'pointer';
    btn.style.color = '#e5e7eb';
    if (kind === 'primary') {
      btn.style.background = '#0b3b2e';
    } else {
      btn.style.background = '#1f2937';
    }
  }

  if (redirected) {
    primary.textContent = 'Continue to site';
    secondary.textContent = 'Go back !!';
  } else if (transitionType === 'typed') {
    primary.textContent = 'Yes, continue';
    secondary.textContent = 'Go back !!';
  } else {
    primary.textContent = 'Open website';
    secondary.textContent = 'Go back !!';
  }

  styleBtn(primary, 'primary');
  styleBtn(secondary, 'secondary');

  primary.onclick = () => {
    void rememberAllowedOrigin();
    overlay.remove();
  };

  secondary.onclick = () => {
    overlay.remove();
    chrome.runtime.sendMessage({ type: 'GO_BACK' });
  };

  row.appendChild(primary);
  row.appendChild(secondary);

  box.appendChild(title);
  box.appendChild(subtitle);
  box.appendChild(q);
  box.appendChild(row);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // play enter animation
  requestAnimationFrame(() => {
    box.style.opacity = '1';
    box.style.transform = 'translateY(0)';
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'RISK_RESULT') return;
  const { status, risk_score, risk_percent, safety_percent, context } = message.payload || {};
  if (!status) return;

  const riskPct =
    typeof risk_percent === 'number'
      ? risk_percent
      : typeof risk_score === 'number'
        ? scoreToPercentLocal(risk_score)
        : 0;
  const safetyPct = typeof safety_percent === 'number' ? safety_percent : Math.max(0, 100 - riskPct);

  lastResult = { status, safetyPct, riskPct, context: context || {} };
  createFloatingMeter(status, safetyPct);

  const redirected = !!(context && context.redirected);
  // Your rule:
  // - Green 80–100: no warning (but if redirected, ask "continue?" softly)
  // - Yellow 40–79: alert + allow choice
  // - Red 0–39: strong pause
  const sameOriginAllowed = allowedOrigins.has(window.location.origin);
  const shouldPause =
    !sameOriginAllowed &&
    (safetyPct < 40 || (safetyPct < 80 && redirected) || (safetyPct < 80 && status !== 'safe'));

  if (shouldPause) {
    createOverlay({
      score: safetyPct,
      status,
      redirected,
      transitionType: context?.transitionType
    });
  }
});

// Credential-entry protection: if user submits a password form, pause if risk is not safe.
document.addEventListener(
  'submit',
  (e) => {
    try {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      const hasPassword = !!form.querySelector('input[type="password"]');
      if (!hasPassword) return;

      // If we don't have a result yet, ask background to evaluate now.
      if (!lastResult) {
        e.preventDefault();
        chrome.runtime.sendMessage({ type: 'EVALUATE_ACTIVE_TAB', source: 'password_form_submit' });
        createFloatingMeter('checking', null);
        return;
      }

      // While filling sensitive data: if safety < 80, pause.
      if (lastResult.safetyPct < 80) {
        e.preventDefault();
        createOverlay({
          score: lastResult.safetyPct,
          status: lastResult.status,
          redirected: !!lastResult?.context?.redirected,
          transitionType: lastResult?.context?.transitionType
        });
      }
    } catch {
      // ignore
    }
  },
  true
);

// Warn while user is filling data (focus on inputs), based on threshold.
document.addEventListener(
  'focusin',
  (e) => {
    try {
      if (warnedOnFocus) return;
      const el = e.target;
      const isField =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement;
      if (!isField) return;

      if (lastResult && lastResult.safetyPct < 80) {
        warnedOnFocus = true;
        createOverlay({
          score: lastResult.safetyPct,
          status: lastResult.status,
          redirected: !!lastResult?.context?.redirected,
          transitionType: lastResult?.context?.transitionType
        });
      }
    } catch {
      // ignore
    }
  },
  true
);

// When content script loads, ask background to evaluate (avoids "no receiver" timing issues).
try {
  loadSettings();
  loadAllowedOrigins();
  // Send referrer info so we can guess "external app link"
  chrome.runtime.sendMessage({
    type: 'EVALUATE_ACTIVE_TAB',
    source: 'content_loaded',
    context: {
      referrer: document.referrer || '',
      externalLikely: !document.referrer
    }
  });
  chrome.runtime.sendMessage({ type: 'EVALUATE_ACTIVE_TAB', source: 'content_loaded' });
} catch {
  // ignore
}

// (Popup / new-tab spam detection via inline script was removed to avoid CSP errors on strict sites like Google.)

