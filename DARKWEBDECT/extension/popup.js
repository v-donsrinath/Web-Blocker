const DEFAULTS = {
  notifyThreshold: 70,
  pauseThreshold: 80,
  formWarnThreshold: 60
};

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);

  const notifyTh = document.getElementById('notifyTh');
  const pauseTh = document.getElementById('pauseTh');
  const formTh = document.getElementById('formTh');

  notifyTh.value = stored.notifyThreshold;
  pauseTh.value = stored.pauseThreshold;
  formTh.value = stored.formWarnThreshold;

  syncLabels();
}

function syncLabels() {
  document.getElementById('notifyVal').textContent = document.getElementById('notifyTh').value;
  document.getElementById('pauseVal').textContent = document.getElementById('pauseTh').value;
  document.getElementById('formVal').textContent = document.getElementById('formTh').value;
}

async function saveSettings() {
  await chrome.storage.sync.set({
    notifyThreshold: Number(document.getElementById('notifyTh').value),
    pauseThreshold: Number(document.getElementById('pauseTh').value),
    formWarnThreshold: Number(document.getElementById('formTh').value)
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();

  document.getElementById('notifyTh').addEventListener('input', syncLabels);
  document.getElementById('pauseTh').addEventListener('input', syncLabels);
  document.getElementById('formTh').addEventListener('input', syncLabels);

  document.getElementById('saveBtn').addEventListener('click', async () => {
    await saveSettings();
    const btn = document.getElementById('saveBtn');
    const old = btn.textContent;
    btn.textContent = 'Saved';
    setTimeout(() => (btn.textContent = old), 800);
  });
});

