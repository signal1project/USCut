const statusEl = document.getElementById('status')!;

async function checkApp() {
  try {
    const res = await fetch('http://localhost:7474/health', { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      statusEl.textContent = '✓ USCut is running';
      statusEl.className   = 'status';
    } else throw new Error();
  } catch {
    statusEl.textContent = '✗ App not running — please open USCut';
    statusEl.className   = 'status error';
  }
}

document.getElementById('open-app')?.addEventListener('click', (e) => {
  e.preventDefault();
  // On macOS/Windows the protocol handler would open the Electron app
  // For now, just show instructions
  alert('Open the USCut app on your computer to get started.');
});

checkApp();
