import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';

type Engine = 'auto' | 'yt-dlp' | 'aria2c' | 'gallery-dl' | 'generic' | 'you-get' | 'svtplay-dl' | 'get-sauce';
type Preset = { id: string; name: string; engine: Engine };
type Download = {
  id: string; url: string; owner_id: string; engine: string; status: string;
  progress: { percent?: number; state?: string; speed?: string };
  output_files: { filename: string; path: string; size_bytes: number; verified: boolean }[];
  error?: string | null; log_text?: string; created_at: string;
};
type Personal = {
  destination_folder: string; default_preset: string;
  engine_settings: Record<string, Record<string, unknown>>; app_password_configured: boolean;
};
const TYPES: Engine[] = ['auto', 'yt-dlp', 'aria2c', 'gallery-dl', 'generic', 'you-get', 'svtplay-dl', 'get-sauce'];
const API = window.location.pathname.replace(/\/user\/?$/, '/user/api');
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(API + path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* keep status */ }
  if (!response.ok) {
    const value = body as { detail?: string } | null;
    throw new Error(value?.detail || 'Nextcloud request failed (' + response.status + ')');
  }
  return body as T;
}
function json(method: string, data: object): RequestInit {
  return { method, body: JSON.stringify(data) };
}
function progress(job: Download): number {
  const number = Number(job.progress?.percent ?? 0);
  return Math.max(0, Math.min(100, Number.isFinite(number) ? number : 0));
}

export default function UserApp() {
  const [tabs, setTab] = useState<'downloads' | 'personal' | 'engines'>('downloads');
  const [me, setMe] = useState('');
  const [message, setMessage] = useState('');
  const [jobs, setJobs] = useState<Download[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('url') || '');
  const [engine, setEngine] = useState<Engine>('auto');
  const [presetId, setPresetId] = useState('');
  const [folder, setFolder] = useState(() => new URLSearchParams(window.location.search).get('folder') || '');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [personal, setPersonal] = useState<Personal>({
    destination_folder: 'Downloads', default_preset: '', engine_settings: {}, app_password_configured: false,
  });
  const [appPassword, setAppPassword] = useState('');
  const [engineJson, setEngineJson] = useState('{}');
  const [cookies, setCookies] = useState<{filename: string}[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const result = await request<Download[]>('/jobs?limit=100');
      setJobs(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not refresh jobs');
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    async function initialize() {
      try {
        const [identity, settings, presetList] = await Promise.all([
          request<{user_id: string}>('/me'),
          request<Personal>('/settings'),
          request<Preset[]>('/presets'),
        ]);
        if (!mounted) return;
        setMe(identity.user_id);
        setPersonal(settings);
        setEngineJson(JSON.stringify(settings.engine_settings, null, 2));
        setPresets(presetList);
        setCookies(await request<{filename: string}[]>('/cookies'));
        await reload();
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : 'Could not initialize Downloader');
      }
    }
    void initialize();
    const timer = window.setInterval(() => { if (mounted) void reload(); }, 3500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [reload]);
  const active = useMemo(() => jobs.find(job => job.id === selected), [jobs, selected]);
  const running = jobs.filter(job => !TERMINAL.has(job.status));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const job = await request<Download>('/jobs', json('POST', {
        url, engine, preset_id: presetId || undefined, folder: folder || personal.destination_folder,
      }));
      setUrl('');
      setJobs(items => [job, ...items]);
      setSelected(job.id);
      setTab('downloads');
      setMessage('Download submitted into your Nextcloud Files.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Submission failed');
    } finally { setBusy(false); }
  }
  async function action(job: Download, op: 'cancel' | 'retry' | 'redeliver') {
    setMessage('');
    try {
      const revised = await request<Download>('/jobs/' + encodeURIComponent(job.id) + '/' + op, { method: 'POST' });
      setJobs(items => items.map(item => item.id === job.id ? revised : item));
      setMessage(op === 'cancel' ? 'Cancellation requested.' : 'Job queued again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Job action failed');
    }
  }
  async function savePersonal(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const newSettings = await request<Personal>('/settings', json('PUT', {
        destination_folder: personal.destination_folder,
        default_preset: personal.default_preset,
        ...(appPassword ? { app_password: appPassword } : {}),
      }));
      setPersonal(newSettings);
      setAppPassword('');
      setMessage('Personal settings saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save preferences');
    } finally { setBusy(false); }
  }
  async function saveEngines(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const settings = JSON.parse(engineJson);
      const saved = await request<Personal>('/settings', json('PUT', { engine_settings: settings }));
      setPersonal(saved);
      setMessage('Your per-engine defaults were saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Invalid engine settings');
    } finally { setBusy(false); }
  }
  async function uploadCookies(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error('Cookie file exceeds the 1 MB limit');
      const encoded = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = () => reject(new Error('Could not read cookie file'));
        reader.readAsDataURL(file);
      });
      await request('/cookies/' + encodeURIComponent(file.name), json('PUT', {content_base64: encoded}));
      setCookies(await request<{filename: string}[]>('/cookies'));
      setMessage('Cookie file stored for your account only.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not upload cookies');
    }
  }
  async function deleteCookie(filename: string) {
    try {
      await request('/cookies/' + encodeURIComponent(filename), {method: 'DELETE'});
      setCookies(await request<{filename: string}[]>('/cookies'));
      setMessage('Cookie file deleted.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not delete cookies'); }
  }

  return <div className="shell user-downloader">
    <header className="topbar">
      <div className="brandmark">D</div>
      <div><div className="brand">Downloader</div><div className="subbrand">Your own downloads in Nextcloud Files · {me || 'Loading account'}</div></div>
      <div className="top-actions"><span className="user-running">{running.length} active</span></div>
    </header>
    {message && <p className="notice" role="status">{message}</p>}
    <nav className="tabs" aria-label="Downloader sections">
      <button className={tabs === 'downloads' ? 'active' : ''} onClick={() => setTab('downloads')}>Downloads</button>
      <button className={tabs === 'personal' ? 'active' : ''} onClick={() => setTab('personal')}>Personal settings</button>
      <button className={tabs === 'engines' ? 'active' : ''} onClick={() => setTab('engines')}>My engine settings</button>
    </nav>

    {tabs === 'downloads' && <div className="layout">
      <section className="panel submit-panel">
        <div className="eyebrow">NEW DOWNLOAD</div><h2>Download into my Files</h2>
        <form onSubmit={event => void submit(event)}>
          <label>Media URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste a downloadable URL" required /></label>
          <label>Engine<select value={engine} onChange={event => setEngine(event.target.value as Engine)}>
            {TYPES.map(item => <option key={item} value={item}>{item === 'auto' ? 'Automatic' : item}</option>)}
          </select></label>
          <label>Preset (optional)<select value={presetId} onChange={event => setPresetId(event.target.value)}>
            <option value="">Use my default</option>
            {presets.filter(preset => engine === 'auto' || preset.engine === engine).map(preset =>
              <option key={preset.id} value={preset.id}>{preset.name}</option>)}
          </select></label>
          <label>Folder in my Files<input value={folder} onChange={event => setFolder(event.target.value)}
            placeholder={personal.destination_folder || 'Root folder'} /></label>
          <p className="muted">Only your own Files. Existing destination folders only. Failed uploads stay visible here with a reason.</p>
          <button disabled={busy || !me} className="primary">Download to my Files</button>
        </form>
      </section>
      <section className="panel queue-panel">
        <div className="section-heading"><h2>History and progress</h2><button className="small secondary" onClick={() => void reload()}>Refresh</button></div>
        {!jobs.length && <div className="empty">You do not have any downloads yet.</div>}
        <div className="job-list">{jobs.map(job => <article key={job.id} className={'job ' + (selected === job.id ? 'selected' : '')}>
          <div className="job-head">
            <button className="user-job-name" onClick={() => setSelected(job.id)} title={job.url}>{job.url}</button>
            <span className={'status status-' + job.status}>{job.status}</span>
          </div>
          <div className="job-meta"><span>{job.engine}</span><span>{new Date(job.created_at).toLocaleString()}</span></div>
          {!TERMINAL.has(job.status) && <div className="progress-track" role="progressbar" aria-valuenow={progress(job)}
              aria-valuemin={0} aria-valuemax={100}><div className="progress-fill" style={{width: progress(job) + '%'}} /></div>}
          {job.status === 'failed' && <p className="error-box">{job.error || 'Download failed. Review details and retry.'}</p>}
          <div className="job-actions">
            {!TERMINAL.has(job.status) ? <button className="small danger" onClick={() => void action(job, 'cancel')}>Cancel</button>
              : <button className="small secondary" onClick={() => void action(job, job.status === 'completed' ? 'redeliver' : 'retry')}>Retry</button>}
            <button className="small secondary" onClick={() => setSelected(job.id)}>Details</button>
          </div>
        </article>)}</div>
      </section>
      <section className="panel details-panel">
        <h2>Selected download</h2>
        {!active ? <p className="muted">Select a download to see detailed progress, delivered files and logs.</p> : <>
          <dl><dt>Status</dt><dd>{active.status}</dd><dt>Source</dt><dd className="user-break">{active.url}</dd></dl>
          {active.error && <p className="error-box">{active.error}</p>}
          {!!active.output_files?.length && <div className="outputs">{active.output_files.map((file, index) => <p key={index} className="output-row">
            <strong>{file.filename}</strong> <span>{file.verified ? 'Verified delivery' : 'Pending verification'}</span>
          </p>)}</div>}
          <strong className="log-title">Job log</strong><pre className="log">{active.log_text || 'No logs yet.'}</pre>
        </>}
      </section>
    </div>}

    {tabs === 'personal' && <section className="panel delivery-panel">
      <h2>My Files and download defaults</h2>
      <p className="muted">These settings are stored in your Nextcloud account, not shared across users.</p>
      <form onSubmit={event => void savePersonal(event)}>
        <label>Default destination subfolder<input value={personal.destination_folder}
          onChange={event => setPersonal(old => ({ ...old, destination_folder: event.target.value }))} /></label>
        <label>Default preset<select value={personal.default_preset}
          onChange={event => setPersonal(old => ({ ...old, default_preset: event.target.value }))}>
          <option value="">None</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select></label>
        <label>My Nextcloud Files app password
          <input type="password" autoComplete="new-password" value={appPassword}
            onChange={event => setAppPassword(event.target.value)}
            placeholder={personal.app_password_configured ? 'Stored securely; leave blank to keep' : 'Create one in Nextcloud personal Security settings'} />
        </label>
        <p className="secure-note">A dedicated Nextcloud app password authorizes WebDAV delivery to your own Files. It is stored as a sensitive Nextcloud preference and never shown again. The downloader service API key never reaches this page.</p>
        <button className="primary" disabled={busy}>Save my settings</button>
      </form>
    </section>}

    {tabs === 'engines' && <div className="settings-layout">
      <section className="panel">
        <h2>My engine options</h2>
        <p className="muted">Set engine-specific job overrides as JSON. These affect only your own new jobs and do not change service-wide settings.</p>
        <form onSubmit={event => void saveEngines(event)}>
          <label>Engine defaults JSON<textarea rows={15} value={engineJson} onChange={event => setEngineJson(event.target.value)} /></label>
          <p className="muted">Example: {JSON.stringify({'yt-dlp': {'format': 'best'}})}.</p>
          <button className="primary" disabled={busy}>Save my engine defaults</button>
        </form>
      </section>
      <section className="panel">
        <h2>My cookies</h2>
        <p className="muted">Upload Netscape-format cookies for your own download jobs. Set the filename in the engine defaults JSON.</p>
        <label>Upload cookie file<input type="file" accept=".txt" onChange={event => void uploadCookies(event.target.files?.[0])} /></label>
        {!cookies.length && <p className="muted">No cookie files added.</p>}
        {cookies.map(cookie => <div className="output-row" key={cookie.filename}>
          <strong>{cookie.filename}</strong><button className="small danger" onClick={() => void deleteCookie(cookie.filename)}>Delete</button>
        </div>)}
      </section>
    </div>}
    <footer>Downloader · Personal Nextcloud integration · Download execution and WebDAV delivery occur in the separate server</footer>
  </div>;
}
