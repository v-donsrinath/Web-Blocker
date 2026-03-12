const API_BASE = 'http://localhost:4001/api';

const DEFAULTS = {
  notifyThreshold: 70,
  pauseThreshold: 80,
  formWarnThreshold: 60
};

async function getSettings() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  return {
    notifyThreshold: Number(s.notifyThreshold),
    pauseThreshold: Number(s.pauseThreshold),
    formWarnThreshold: Number(s.formWarnThreshold)
  };
}

function navLooksRedirected(transitionQualifiers) {
  return Array.isArray(transitionQualifiers)
    ? transitionQualifiers.includes('server_redirect') || transitionQualifiers.includes('client_redirect')
    : false;
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon.svg'),
      title,
      message
    });
  } catch {
    // ignore
  }
}

function sendToTab(tabId, message) {
  chrome.tabs.sendMessage(tabId, message, () => {
    // Avoid "Receiving end does not exist" noise on restricted pages.
    // chrome.runtime.lastError is expected sometimes, we ignore it.
    void chrome.runtime.lastError;
  });
}

async function evaluateUrl(tabId, url, context = {}) {
  try {
    const resp = await fetch(`${API_BASE}/risk/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, context })
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data?.error || `API error (${resp.status})`);

    const payload = {
      url,
      risk_score: data.totalScore,
      risk_percent: data.riskPercent,
      safety_percent: data.safetyPercent,
      status: data.status,
      reasons: data.reasons,
      context
    };

    sendToTab(tabId, { type: 'RISK_RESULT', payload });

    // Device notification for high risk or redirect-to-risk
    const settings = await getSettings();
    const safety = typeof payload.safety_percent === 'number' ? payload.safety_percent : 100;
    const risk = typeof payload.risk_percent === 'number' ? payload.risk_percent : 0;

    // Your rule: 40–79 = yellow (alert), 0–39 = red (strong alert)
    if (safety < 80) {
      const level = safety < 40 ? 'DANGER' : 'CAUTION';
      notify('BrandShield', `${level} • Safety ${safety}% (Risk ${risk}%) • ${url}`);
    }
  } catch (e) {
    sendToTab(tabId, {
      type: 'RISK_RESULT',
      payload: {
        url,
        risk_score: null,
        risk_percent: null,
        safety_percent: null,
        status: 'offline',
        reasons: [e?.message || 'Backend not reachable'],
        context
      }
    });
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab?.url || !tab.url.startsWith('http')) return;

  evaluateUrl(tabId, tab.url, { redirected: false, source: 'tabs.onUpdated' });
});

chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (!details.url || !details.url.startsWith('http')) return;

  const redirected = navLooksRedirected(details.transitionQualifiers);
  evaluateUrl(details.tabId, details.url, {
    redirected,
    transitionType: details.transitionType,
    transitionQualifiers: details.transitionQualifiers,
    source: 'webNavigation.onCommitted'
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'EVALUATE_ACTIVE_TAB') {
    const tabId = sender?.tab?.id;
    const url = sender?.tab?.url;
    if (typeof tabId === 'number' && typeof url === 'string') {
      evaluateUrl(tabId, url, {
        redirected: false,
        source: msg?.source || 'content',
        ...(msg?.context || {})
      });
      sendResponse({ ok: true });
      return true;
    }
  }

  if (msg?.type === 'GO_BACK' && sender?.tab?.id) {
    const tabId = sender.tab.id;
    chrome.tabs.goBack(tabId, () => {
      // If there is no back history, close the tab instead.
      const err = chrome.runtime.lastError;
      if (err) {
        chrome.tabs.remove(tabId, () => {
          void chrome.runtime.lastError;
        });
      }
    });
    sendResponse({ ok: true });
    return true;
  }

  // Used by search results: evaluate a URL without tab messaging.
  if (msg?.type === 'EVALUATE_URL' && typeof msg.url === 'string') {
    (async () => {
      try {
        const resp = await fetch(`${API_BASE}/risk/evaluate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: msg.url, context: msg.context || {} })
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data?.error || `API error (${resp.status})`);
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err?.message || 'evaluate failed' });
      }
    })();
    return true;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'brandshield_safe_back') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || typeof tab.id !== 'number') return;
      const tabId = tab.id;
      chrome.tabs.goBack(tabId, () => {
        const err = chrome.runtime.lastError;
        if (err) {
          chrome.tabs.remove(tabId, () => {
            void chrome.runtime.lastError;
          });
        }
      });
    });
  }
});

