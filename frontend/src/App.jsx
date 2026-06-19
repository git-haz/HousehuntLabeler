import { useState, useCallback, useRef, useEffect } from 'react';

const BACKEND = 'http://localhost:4000';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
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
      log('Google Identity Services not loaded yet. Check VITE_GOOGLE_CLIENT_ID.');
    }
  };

  const handleProcess = async () => {
    setProcessing(true);
    setResults([]);
    log('Processing 10 oldest emails...');
    try {
      const res = await fetch(`${BACKEND}/process`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setResults(data.results);
        log(`Done. Processed ${data.results.length} emails.`);
        data.results.forEach((r) => {
          log(`  ${r.id} — labels: [${r.labels.join(', ')}]${r.hasPdf ? ' 📎PDF' : ''}${r.matchedKeywords.length ? ` ⚠️keywords: ${r.matchedKeywords.join(', ')}` : ''}`);
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
        <button className="btn-google" onClick={handleSignIn}>
          Sign in with Google
        </button>
      ) : (
        <p className="status">✓ Signed in</p>
      )}

      {authenticated && (
        <button className="btn-process" onClick={handleProcess} disabled={processing}>
          {processing ? 'Processing...' : 'Process 10 Oldest Emails'}
        </button>
      )}

      {results.length > 0 && (
        <div style={{ marginTop: '1.5rem' }}>
          <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Results</h2>
          {results.map((r) => (
            <div key={r.id} className="result-card">
              <strong>{r.subject}</strong>
              <div style={{ fontSize: '0.8rem', color: '#888' }}>{r.id}</div>
              <div style={{ marginTop: '0.4rem' }}>
                {r.labels.map((l) => (
                  <span key={l} className="label-badge">{l}</span>
                ))}
              </div>
              {r.hasPdf && <div style={{ marginTop: '0.3rem', fontSize: '0.85rem' }}>📎 PDF attachment detected</div>}
              {r.matchedKeywords.length > 0 && (
                <div style={{ marginTop: '0.3rem', fontSize: '0.85rem', color: '#d93025' }}>
                  ⚠️ Keywords found: {r.matchedKeywords.join(', ')}
                </div>
              )}
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
    </div>
  );
}
