import { useState, useCallback, useRef, useEffect } from 'react';

const BACKEND = 'http://localhost:4000';
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const EMAILS_PER_PAGE = 20;
const VERSION = '2.1.0';
const VERSION_HISTORY = [
  { version: '2.1.0', date: '2026-06-19', changes: 'Paginated email list (20/page); tabbed view for Emails, Results, and Log' },
  { version: '2.0.0', date: '2026-06-19', changes: 'AI vision analysis: optional Claude Haiku-powered photo analysis of PDF property images for house type classification; per-email selection' },
  { version: '1.9.0', date: '2026-06-19', changes: 'From/To date range; PDF house type classification (detached/bungalow/reject); downloadable processing log' },
  { version: '1.8.0', date: '2026-06-19', changes: 'Label filters: include/exclude labels when retrieving; toggle unread-only vs all emails' },
  { version: '1.7.0', date: '2026-06-19', changes: 'Show Newer / Show Older navigation buttons to page through emails; exclude already-processed emails' },
  { version: '1.6.0', date: '2026-06-19', changes: 'Date filter for retrieving emails newer than a chosen date' },
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
  const [afterDate, setAfterDate] = useState('');
  const [beforeDate, setBeforeDate] = useState('');
  const [allLabels, setAllLabels] = useState([]);
  const [includeLabels, setIncludeLabels] = useState([]);
  const [excludeLabels, setExcludeLabels] = useState([]);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState('');
  const [visionSelected, setVisionSelected] = useState(new Set());
  const [visionResults, setVisionResults] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [page, setPage] = useState(0);
  const [activeTab, setActiveTab] = useState('emails');
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
                try {
                  const labelsRes = await fetch(`${BACKEND}/labels`);
                  const labelsData = await labelsRes.json();
                  if (labelsData.ok) {
                    setAllLabels(labelsData.labels);
                    log(`Loaded ${labelsData.labels.length} labels.`);
                  }
                } catch {}
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

  const fetchEmails = async (after, before) => {
    setLoading(true);
    setSelected(new Set());
    setResults([]);
    setPage(0);
    setActiveTab('emails');
    log(`Retrieving emails${after ? ` after ${after}` : ''}${before ? ` before ${before}` : ''}...`);
    try {
      const res = await fetch(`${BACKEND}/retrieve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          afterDate: after || undefined,
          beforeDate: before || undefined,
          includeLabels: includeLabels.length ? includeLabels : undefined,
          excludeLabels: excludeLabels.length ? excludeLabels : undefined,
          unreadOnly,
        }),
      });
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

  const handleRetrieve = () => fetchEmails(afterDate, beforeDate);

  const handleNewer = () => {
    if (emails.length === 0) return;
    const dates = emails.map(e => new Date(e.date)).filter(d => !isNaN(d));
    if (dates.length === 0) return;
    const newest = new Date(Math.max(...dates));
    newest.setDate(newest.getDate() + 1);
    fetchEmails(newest.toISOString().split('T')[0], null);
  };

  const handleOlder = () => {
    if (emails.length === 0) return;
    const dates = emails.map(e => new Date(e.date)).filter(d => !isNaN(d));
    if (dates.length === 0) return;
    const oldest = new Date(Math.min(...dates));
    fetchEmails(afterDate || null, oldest.toISOString().split('T')[0]);
  };

  const toggleVision = (id) => {
    setVisionSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleVisionAnalyze = async () => {
    if (!anthropicKey) { log('Enter an Anthropic API key first.'); return; }
    const pdfEmails = [...visionSelected].filter(id => emails.find(e => e.id === id)?.hasPdf);
    if (pdfEmails.length === 0) { log('No emails with PDFs selected for vision analysis.'); return; }
    setAnalyzing(true);
    setVisionResults([]);
    log(`Running AI vision analysis on ${pdfEmails.length} email(s)...`);
    try {
      const res = await fetch(`${BACKEND}/vision-analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailIds: pdfEmails, anthropicApiKey: anthropicKey }),
      });
      const data = await res.json();
      if (data.ok) {
        setVisionResults(data.results);
        setActiveTab('results');
        log(`Vision analysis complete for ${data.results.length} email(s).`);
        data.results.forEach((r) => {
          if (r.error) {
            log(`  ${r.id} — Error: ${r.error}`);
          } else if (r.analysis) {
            const a = r.analysis;
            log(`  ${r.id} — ${a.overall_classification} (${a.overall_confidence}%) → label: ${a.label}`);
            if (a.images) {
              a.images.forEach((img) => {
                log(`    Image ${img.image_number}: ${img.classification} (${img.confidence}%) — ${img.reasoning}`);
              });
            }
            if (a.usage) {
              log(`    Tokens: ${a.usage.input_tokens} in / ${a.usage.output_tokens} out`);
            }
          }
        });
      } else {
        log(`Error: ${data.error}`);
      }
    } catch (err) {
      log(`Network error: ${err.message}`);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleDownloadLog = () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const lines = [`HousehuntLabeler Log — ${new Date().toLocaleString()}`, ''];
    results.forEach((r) => {
      lines.push(`Email: ${r.subject}`);
      lines.push(`ID: ${r.id}`);
      lines.push(`Labels: ${r.labels.join(', ')}`);
      r.reasoning.forEach((reason) => lines.push(`  - ${reason}`));
      lines.push('');
    });
    if (visionResults.length > 0) {
      lines.push('--- Vision Analysis ---', '');
      visionResults.forEach((r) => {
        lines.push(`Email: ${r.subject}`);
        lines.push(`ID: ${r.id}`);
        if (r.error) {
          lines.push(`Error: ${r.error}`);
        } else if (r.analysis) {
          const a = r.analysis;
          lines.push(`Overall: ${a.overall_classification} (${a.overall_confidence}%) → ${a.label}`);
          if (a.images) {
            a.images.forEach((img) => {
              lines.push(`  Image ${img.image_number}: ${img.classification} (${img.confidence}%) — ${img.reasoning}`);
            });
          }
          if (a.usage) lines.push(`  Tokens: ${a.usage.input_tokens} in / ${a.usage.output_tokens} out`);
        }
        lines.push('');
      });
    }
    lines.push('--- Console Log ---', '');
    logs.forEach((l) => lines.push(l));
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `househuntlabelerLog_${timestamp}.txt`;
    a.click();
    URL.revokeObjectURL(url);
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
        setActiveTab('results');
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

  const totalPages = Math.ceil(emails.length / EMAILS_PER_PAGE);
  const pagedEmails = emails.slice(page * EMAILS_PER_PAGE, (page + 1) * EMAILS_PER_PAGE);
  const hasResults = results.length > 0 || visionResults.length > 0;
  const hasLogs = logs.length > 0;

  return (
    <div>
      <h1>HousehuntLabeler</h1>

      {!authenticated ? (
        <button className="btn-google" onClick={handleSignIn}>Sign in with Google</button>
      ) : (
        <p className="status">Signed in</p>
      )}

      {authenticated && (
        <>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="date-label">
              From:
              <input type="date" value={afterDate} onChange={(e) => setAfterDate(e.target.value)} className="date-input" />
            </label>
            <label className="date-label">
              To:
              <input type="date" value={beforeDate} onChange={(e) => setBeforeDate(e.target.value)} className="date-input" />
            </label>
            <button className="btn-process" onClick={handleRetrieve} disabled={loading}>
              {loading ? 'Retrieving...' : 'Retrieve Emails'}
            </button>
            {emails.length > 0 && (
              <button className="btn-label" onClick={handleProcess} disabled={processing || selected.size === 0}>
                {processing ? 'Processing...' : `Process ${selected.size} Selected`}
              </button>
            )}
            {anthropicKey && visionSelected.size > 0 && (
              <button className="btn-vision" onClick={handleVisionAnalyze} disabled={analyzing}>
                {analyzing ? 'Analyzing...' : `Analyze ${visionSelected.size} with AI`}
              </button>
            )}
            <button className="btn-small" onClick={() => setShowFilters(!showFilters)}>
              {showFilters ? 'Hide Filters' : 'Filters'}
            </button>
          </div>
          {showFilters && (
            <div className="filter-panel">
              <div className="filter-row">
                <label className="filter-toggle">
                  <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
                  Unread only
                </label>
              </div>
              <div className="filter-section">
                <div className="filter-heading">AI Vision Analysis (optional):</div>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input
                    type="password"
                    placeholder="Anthropic API Key"
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    className="date-input"
                    style={{ flex: 1, maxWidth: '400px' }}
                  />
                  {anthropicKey && <span style={{ fontSize: '0.75rem', color: '#34a853' }}>Key set</span>}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '0.25rem' }}>
                  Uses Claude Haiku 4.5 to analyze property photos in PDFs. ~3 cents per 20 images.
                </div>
              </div>
              {allLabels.length > 0 && (
                <>
                  <div className="filter-section">
                    <div className="filter-heading">Include labels:</div>
                    <div className="filter-chips">
                      {allLabels.map((l) => (
                        <span
                          key={`inc-${l.name}`}
                          className={`filter-chip ${includeLabels.includes(l.name) ? 'chip-active-include' : ''}`}
                          onClick={() => setIncludeLabels((prev) =>
                            prev.includes(l.name) ? prev.filter(n => n !== l.name) : [...prev, l.name]
                          )}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="filter-section">
                    <div className="filter-heading">Exclude labels:</div>
                    <div className="filter-chips">
                      {allLabels.map((l) => (
                        <span
                          key={`exc-${l.name}`}
                          className={`filter-chip ${excludeLabels.includes(l.name) ? 'chip-active-exclude' : ''}`}
                          onClick={() => setExcludeLabels((prev) =>
                            prev.includes(l.name) ? prev.filter(n => n !== l.name) : [...prev, l.name]
                          )}
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {(emails.length > 0 || hasResults || hasLogs) && (
        <div className="tabs" style={{ marginTop: '1.5rem' }}>
          <div className="tab-bar">
            <button className={`tab ${activeTab === 'emails' ? 'tab-active' : ''}`} onClick={() => setActiveTab('emails')}>
              Emails {emails.length > 0 && `(${emails.length})`}
            </button>
            <button className={`tab ${activeTab === 'results' ? 'tab-active' : ''}`} onClick={() => setActiveTab('results')}>
              Results {(results.length + visionResults.length) > 0 && `(${results.length + visionResults.length})`}
            </button>
            <button className={`tab ${activeTab === 'log' ? 'tab-active' : ''}`} onClick={() => setActiveTab('log')}>
              Log {hasLogs && `(${logs.length})`}
            </button>
          </div>

          <div className="tab-content">
            {activeTab === 'emails' && emails.length > 0 && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button className="btn-small" onClick={toggleAll}>
                    {selected.size === emails.length ? 'Deselect All' : 'Select All'}
                  </button>
                  <button className="btn-nav" onClick={handleNewer} disabled={loading}>Show Newer</button>
                  <button className="btn-nav" onClick={handleOlder} disabled={loading}>Show Older</button>
                  <span style={{ fontSize: '0.8rem', color: '#888', marginLeft: 'auto' }}>
                    Page {page + 1} of {totalPages} ({emails.length} emails)
                  </span>
                </div>
                {pagedEmails.map((e) => (
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
                          {e.hasPdf && anthropicKey && (
                            <label className="vision-check" onClick={(ev) => ev.stopPropagation()}>
                              <input type="checkbox" checked={visionSelected.has(e.id)} onChange={() => toggleVision(e.id)} />
                              AI Vision
                            </label>
                          )}
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
                {totalPages > 1 && (
                  <div className="pagination">
                    <button className="btn-nav" onClick={() => setPage(0)} disabled={page === 0}>First</button>
                    <button className="btn-nav" onClick={() => setPage(p => p - 1)} disabled={page === 0}>Prev</button>
                    {Array.from({ length: totalPages }, (_, i) => (
                      <button
                        key={i}
                        className={`btn-nav ${i === page ? 'btn-nav-active' : ''}`}
                        onClick={() => setPage(i)}
                      >
                        {i + 1}
                      </button>
                    )).slice(Math.max(0, page - 3), page + 4)}
                    <button className="btn-nav" onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}>Next</button>
                    <button className="btn-nav" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>Last</button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'results' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button className="btn-small" onClick={handleDownloadLog}>Download Log</button>
                </div>
                {results.length > 0 && (
                  <>
                    <h3 style={{ fontSize: '1rem', margin: '0.5rem 0' }}>Processing Results</h3>
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
                  </>
                )}
                {visionResults.length > 0 && (
                  <>
                    <h3 style={{ fontSize: '1rem', margin: '0.5rem 0' }}>AI Vision Analysis</h3>
                    {visionResults.map((r) => (
                      <div key={r.id} className="result-card">
                        <strong>{r.subject}</strong>
                        <div style={{ fontSize: '0.8rem', color: '#888' }}>{r.id}</div>
                        {r.error ? (
                          <div style={{ color: '#d93025', marginTop: '0.4rem' }}>{r.error}</div>
                        ) : r.analysis ? (
                          <div style={{ marginTop: '0.4rem' }}>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                              <span className={`label-badge ${r.analysis.label === 'detached' ? 'badge-detached' : r.analysis.label === 'reject-housetype' ? 'badge-reject' : 'badge-review'}`}>
                                {r.analysis.label}
                              </span>
                              <span className="label-badge">{r.analysis.overall_classification}</span>
                              <span className="label-badge">{r.analysis.overall_confidence}% confidence</span>
                              {r.analysis.appliedLabel && <span className="label-badge badge-applied">label applied: {r.analysis.appliedLabel}</span>}
                            </div>
                            {r.analysis.images?.map((img) => (
                              <div key={img.image_number} className="vision-image-result">
                                <strong>Image {img.image_number}:</strong> {img.classification} ({img.confidence}%)
                                <div style={{ fontSize: '0.8rem', color: '#555' }}>{img.reasoning}</div>
                              </div>
                            ))}
                            {r.analysis.usage && (
                              <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.3rem' }}>
                                Tokens: {r.analysis.usage.input_tokens} input / {r.analysis.usage.output_tokens} output
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </>
                )}
                {!hasResults && <div style={{ color: '#888', padding: '2rem 0', textAlign: 'center' }}>No results yet. Process or analyze emails first.</div>}
              </div>
            )}

            {activeTab === 'log' && (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <button className="btn-small" onClick={handleDownloadLog}>Download Log</button>
                  <button className="btn-small" onClick={() => setLogs([])}>Clear</button>
                </div>
                {hasLogs ? (
                  <div className="log-panel">
                    {logs.map((l, i) => (
                      <div key={i}>{l}</div>
                    ))}
                  </div>
                ) : (
                  <div style={{ color: '#888', padding: '2rem 0', textAlign: 'center' }}>No log entries yet.</div>
                )}
              </div>
            )}
          </div>
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
