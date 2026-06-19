import { useState, useCallback, useRef, useEffect } from 'react';

const BACKEND = 'http://localhost:4000';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const VERSION = '1.5.0';
const VERSION_HISTORY = [
  { version: '1.5.0', date: '2026-06-19', changes: 'Broader property link detection via /property/ path; Suffolk location detection keeps emails unread' },
  { version: '1.4.0', date: '2026-06-19', changes: 'Property link detection and scraping: shows price, bedrooms, type, address as chips with direct links' },
  { version: '1.3.0', date: '2026-06-19', changes: 'New labeling rules: mark as read + "processed"; "reject" for keyword matches; "attachment" for PDFs; removed "to review" and "not detached"' },
  { version: '1.2.0', date: '2026-06-19', changes: 'Processing log with per-email reasoning for each label applied' },
  { version: '1.1.0', date: '2026-06-19', changes: 'Retrieve only unread inbox emails; two-step retrieve/process flow; version history' },
  { version: '1.0.0', date: '2026-06-19', changes: 'Initial release with Gmail OAuth, email labeling, PDF detection, keyword scanning' },
];

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [emails, setEmails] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [results, setResults] = useState([]);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const tokenClientRef = useRef(null);

  const log = useCallback((msg) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  useEffect(() => {
    if (!CLIENT_ID) return;
    const interval = setInterval(() => {
      if (window.google?.accounts?.oauth2) {
        clearInterval(interval);
        tokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: 'https://www.googleapis.com/auth/gmail.modify',
          callback: async (response) => {
            if (response.error) {
              log(`Auth error: ${response.error}`);
              return;
            }
            log('Access token received. Sending to backend...');
            try {
              const res = await fetch(`${BACKEND}/auth/token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ access_token: response.access_token }),
              });
              const data = await res.json();
              if (data.ok) {
                setAuthenticated(true);
                log('Authenticated successfully.');
              } else {
                log(`Backend error: ${data.error}`);
              }
            } catch (err) {
              log(`Network error: ${err.message}`);
            }
          },
        });
      }
    }, 200);
    return () => clearInterval(interval);
  }, [log]);

  const handleSignIn = () => {
    if (tokenClientRef.current) {
      tokenClientRef.current.requestAccessToken();
    } else {
      log('Google Identity Services not loaded yet.');
    }
  };

  const handleRetrieve = async () => {
    setLoading(true);
    setEmails([]);
    setSelected(new Set());
    setResults([]);
    log('Retrieving 10 oldest emails...');
    try {
      const res = await fetch(`${BACKEND}/retrieve`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setEmails(data.emails);
        log(`Retrieved ${data.emails.length} emails.`);
      } else {
        log(`Error: ${data.error}`);
      }
    } catch (err) {
      log(`Network error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === emails.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(emails.map((e) => e.id)));
    }
  };

  const handleProcess = async () => {
    if (selected.size === 0) {
      log('No emails selected.');
      return;
    }
    setProcessing(true);
    log(`Processing ${selected.size} selected emails...`);
    try {
      const res = await fetch(`${BACKEND}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds: [...selected] }),
      });
      const data = await res.json();
      if (data.ok) {
        setResults(data.results);
        log(`Done. Labeled ${data.results.length} emails.`);
        data.results.forEach((r) => {
          log(`  ${r.id} — labels: [${r.labels.join(', ')}]${r.hasPdf ? ' PDF' : ''}${r.matchedKeywords.length ? ` keywords: ${r.matchedKeywords.join(', ')}` : ''}`);
        });
      } else {
        log(`Error: ${data.error}`);
      }
    } catch (err) {
      log(`Network error: ${err.message}`);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div>
      <h1>HousehuntLabeler</h1>

      {!authenticated ? (
        <button className="btn-google" onClick={handleSignIn}>Sign in with Google</button>
      ) : (
        <p className="status">Signed in</p>
      )}

      {authenticated && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button className="btn-process" onClick={handleRetrieve} disabled={loading}>
            {loading ? 'Retrieving...' : 'Retrieve 10 Oldest Emails'}
          </button>
          {emails.length > 0 && (
            <button className="btn-label" onClick={handleProcess} disabled={processing || selected.size === 0}>
              {processing ? 'Processing...' : `Process ${selected.size} Selected`}
            </button>
          )}
        </div>
      )}

      {emails.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Emails</h2>
            <button className="btn-small" onClick={toggleAll}>
              {selected.size === emails.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>
          {emails.map((e) => (
            <div
              key={e.id}
              className={`email-card ${selected.has(e.id) ? 'email-selected' : ''}`}
              onClick={() => toggleSelect(e.id)}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={() => toggleSelect(e.id)}
                  onClick={(ev) => ev.stopPropagation()}
                  style={{ marginTop: '3px' }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{e.subject}</div>
                  <div style={{ fontSize: '0.8rem', color: '#666' }}>{e.from}</div>
                  <div style={{ fontSize: '0.8rem', color: '#999', marginTop: '2px' }}>{e.date}</div>
                  <div style={{ fontSize: '0.85rem', color: '#555', marginTop: '4px' }}>{e.snippet}</div>
                  <div style={{ marginTop: '4px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {e.hasPdf && <span className="label-badge badge-pdf">PDF</span>}
                    {e.inSuffolk && <span className="label-badge badge-suffolk">Suffolk</span>}
                    {e.matchedKeywords.map((kw) => (
                      <span key={kw} className="label-badge badge-keyword">{kw}</span>
                    ))}
                  </div>
                  {e.properties?.length > 0 && (
                    <div className="property-cards">
                      {e.properties.map((p, pi) => (
                        <a key={pi} href={p.url} target="_blank" rel="noopener noreferrer" className="property-card" onClick={(ev) => ev.stopPropagation()}>
                          {p.image && <img src={p.image} alt="" className="property-img" />}
                          <div className="property-info">
                            {p.price && <span className="property-chip chip-price">{p.price}</span>}
                            {p.bedrooms && <span className="property-chip chip-beds">{p.bedrooms}</span>}
                            {p.type && <span className="property-chip chip-type">{p.type}</span>}
                            {p.address && <div className="property-address">{p.address}</div>}
                            {!p.price && !p.address && p.description && <div className="property-address">{p.description.slice(0, 120)}</div>}
                            {p.error && <div className="property-address" style={{ color: '#d93025' }}>Could not fetch details</div>}
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Processing Log</h2>
          {results.map((r) => (
            <div key={r.id} className="result-card">
              <strong>{r.subject}</strong>
              <div style={{ fontSize: '0.8rem', color: '#888' }}>{r.id}</div>
              <div style={{ marginTop: '0.4rem' }}>
                {r.labels.map((l) => (
                  <span key={l} className="label-badge">{l}</span>
                ))}
              </div>
              <ul className="reasoning-list">
                {r.reasoning.map((reason, i) => (
                  <li key={i}>{reason}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {logs.length > 0 && (
        <div className="log-panel">
          {logs.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      <footer className="version-footer">
        <span className="version-link" onClick={() => setShowVersionHistory(!showVersionHistory)}>
          v{VERSION}
        </span>
        {showVersionHistory && (
          <div className="version-history">
            {VERSION_HISTORY.map((v) => (
              <div key={v.version} className="version-entry">
                <strong>v{v.version}</strong> <span style={{ color: '#999' }}>({v.date})</span>
                <div style={{ fontSize: '0.85rem', color: '#555' }}>{v.changes}</div>
              </div>
            ))}
          </div>
        )}
      </footer>
    </div>
  );
}
