/**
 * Shared capture-button overlay injected by all content scripts.
 * Renders a floating "Capture Listing" button in the top-right of the page.
 */

export interface ListingData {
  source:        'zillow';
  mlsNumber?:    string;
  address:       string;
  city:          string;
  state:         string;
  zip:           string;
  price?:        number;          // in cents
  beds?:         number;
  baths?:        number;
  sqft?:         number;
  lotSqft?:      number;
  yearBuilt?:    number;
  propertyType?: string;
  status?:       string;
  daysOnMarket?: number;
  description?:  string;
  photoUrls?:    string[];
  agentName?:    string;
  agentPhone?:   string;
  agentEmail?:   string;
  listingUrl?:   string;
}

const CAPTURE_PORT = 7474; // AICut listing capture server (AICUT_CAPTURE_PORT)

export function injectCaptureButton(extractor: () => ListingData | null) {
  // Avoid double-inject
  if (document.getElementById('aicut-capture-btn')) return;

  const btn = document.createElement('button');
  btn.id        = 'aicut-capture-btn';
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
    <span>Capture Listing</span>
  `;

  Object.assign(btn.style, {
    position:        'fixed',
    top:             '80px',
    right:           '16px',
    zIndex:          '999999',
    display:         'flex',
    alignItems:      'center',
    gap:             '6px',
    padding:         '8px 14px',
    background:      '#34d399',
    color:           '#041d1a',
    border:          'none',
    borderRadius:    '8px',
    fontFamily:      'system-ui, sans-serif',
    fontSize:        '13px',
    fontWeight:      '600',
    cursor:          'pointer',
    boxShadow:       '0 4px 12px rgba(0,0,0,0.25)',
    transition:      'all 0.15s ease',
  });

  btn.addEventListener('mouseenter', () => {
    btn.style.background = '#10b981';
    btn.style.transform  = 'scale(1.03)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#34d399';
    btn.style.transform  = 'scale(1)';
  });

  btn.addEventListener('click', async () => {
    btn.innerHTML = '<span>Capturing…</span>';
    btn.style.opacity = '0.7';
    btn.style.cursor = 'default';

    const listing = extractor();
    if (!listing) {
      showToast('Could not extract listing data from this page.', 'error');
      resetButton();
      return;
    }

    try {
      const res = await fetch(`http://localhost:${CAPTURE_PORT}/api/listings/capture`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(listing),
      });
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      showToast('✓ Listing captured! Open USCut to view it.', 'success');
      btn.innerHTML = '✓ Captured';
      btn.style.background = '#22c55e';
    } catch {
      showToast('USCut must be running. Please open the app.', 'error');
      resetButton();
    }
  });

  function resetButton() {
    btn.innerHTML = `<span>Capture Listing</span>`;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    btn.style.background = '#34d399';
  }

  document.body.appendChild(btn);
  watchForNavigation(resetButton);
}

/**
 * Zillow (and similar Next.js sites) navigate between listings via
 * history.pushState/replaceState without a full page load, so this content
 * script instance and its button never re-run or get recreated — left alone,
 * the button keeps showing "✓ Captured" from whichever listing was captured
 * first, on every listing visited afterward.
 *
 * Patching the History API is the standard way to observe this (no native
 * browser event exists for it), but it only catches navigations that
 * literally call history.pushState/replaceState through the property this
 * patch replaced — if Zillow's router bound or cached a reference to the
 * original function before this content script ran, or navigates some other
 * way internally, the patch silently sees nothing. Rather than depend on
 * getting that timing/internals assumption right, back the patch with a
 * plain interval poll of location.href — can't miss any navigation
 * mechanism, whatever Zillow uses, at the cost of at most ~750ms of lag on
 * a purely cosmetic button reset. check() is idempotent (compares against
 * the last seen URL) so having both fire is harmless.
 */
function watchForNavigation(onNavigate: () => void): void {
  let lastUrl = location.href;
  const check = () => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      onNavigate();
    }
  };

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method];
    history[method] = function (...args: Parameters<History[typeof method]>) {
      const result = original.apply(this, args);
      check();
      return result;
    };
  }
  window.addEventListener('popstate', check);
  setInterval(check, 750);
}

function showToast(msg: string, type: 'success' | 'error') {
  const toast = document.createElement('div');
  toast.textContent = msg;
  Object.assign(toast.style, {
    position:     'fixed',
    bottom:       '24px',
    right:        '16px',
    zIndex:       '9999999',
    padding:      '12px 16px',
    borderRadius: '8px',
    fontFamily:   'system-ui, sans-serif',
    fontSize:     '13px',
    fontWeight:   '500',
    color:        '#fff',
    background:   type === 'success' ? '#22c55e' : '#ef4444',
    boxShadow:    '0 4px 12px rgba(0,0,0,0.3)',
    maxWidth:     '320px',
    transition:   'opacity 0.3s ease',
  });
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 3500);
  setTimeout(() => { toast.remove(); }, 4000);
}
