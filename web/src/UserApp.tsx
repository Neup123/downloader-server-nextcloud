import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { PersonalAutosave, type SaveStatus } from './personal-autosave';

type Engine = 'auto' | 'yt-dlp' | 'aria2c' | 'gallery-dl' | 'generic' | 'you-get' | 'svtplay-dl' | 'get-sauce';
type Preset = { id: string; name: string; engine: Engine; settings: Record<string, unknown>; description?: string; is_shared?: boolean };
type Download = {
  id: string; url: string; owner_id: string; engine: string; status: string;
  progress: { percent?: number; state?: string; speed?: string };
  output_files: { filename: string; path: string; size_bytes: number; verified: boolean }[];
  error?: string | null; log_text?: string; created_at: string;
};
type Personal = {
  destination_folder: string; default_preset: string;
  engine_settings: Record<string, Record<string, unknown>>; app_password_configured: boolean;
  first_download_verified?: boolean; notify_finished?: boolean; notify_failed?: boolean;
};
type SafePersonal = {
  destination_folder: string; default_preset: string;
  notify_finished: boolean; notify_failed: boolean;
};
type FolderChoice = {name: string; path: string};
type FolderListing = {path: string; folders: FolderChoice[]; offset: number; has_more: boolean};
const ordinaryPreferences = (value: Personal): SafePersonal => ({
  destination_folder: value.destination_folder,
  default_preset: value.default_preset,
  notify_finished: value.notify_finished !== false,
  notify_failed: value.notify_failed !== false,
});
function validateFolderDraft(folder: string): void {
  const normalized = folder.trim().replace(/^\/+|\/+$/g, '');
  if (folder.length > 512 || /[\x00-\x1f\\]/.test(folder)
      || (normalized && normalized.split('/').some(part =>
        !part || part === '.' || part === '..'))) {
    throw new Error('Choose a valid folder in your Files (without parent paths).');
  }
}
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
  const [selected, setSelected] = useState<string>(() => new URLSearchParams(window.location.search).get('job') || '');
  const [url, setUrl] = useState(() => new URLSearchParams(window.location.search).get('url') || '');
  const [engine, setEngine] = useState<Engine>('auto');
  const [presetId, setPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [presetEngine, setPresetEngine] = useState<Engine>('yt-dlp');
  const [presetJson, setPresetJson] = useState('{}');
  const [editingPreset, setEditingPreset] = useState('');
  const [folder, setFolder] = useState(() => new URLSearchParams(window.location.search).get('folder') || '');
  const [presets, setPresets] = useState<Preset[]>([]);
  const [personal, setPersonal] = useState<Personal>({
    destination_folder: 'Downloads', default_preset: '', engine_settings: {}, app_password_configured: false,
    notify_finished: true, notify_failed: true,
  });
  const [appPassword, setAppPassword] = useState('');
  const [engineJson, setEngineJson] = useState('{}');
  const [cookies, setCookies] = useState<{filename: string}[]>([]);
  const [busy, setBusy] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const personalAutosave = useRef<PersonalAutosave<SafePersonal> | null>(null);
  const [personalSaveState, setPersonalSaveState] = useState<SaveStatus>('loading');
  const [personalValidationError, setPersonalValidationError] = useState('');
  const [connectingFiles, setConnectingFiles] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderBrowserPath, setFolderBrowserPath] = useState('');
  const [folderOptions, setFolderOptions] = useState<FolderChoice[]>([]);
  const [folderOffset, setFolderOffset] = useState(0);
  const [folderHasMore, setFolderHasMore] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);

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
        // Never place the write-only DAV app password in this snapshot.
        const autosave = new PersonalAutosave<SafePersonal>(
          async values => { await request('/settings', json('PUT', values)); },
          setPersonalSaveState,
          700,
        );
        personalAutosave.current?.dispose();
        autosave.hydrate(ordinaryPreferences(settings));
        personalAutosave.current = autosave;
        setEngineJson(JSON.stringify(settings.engine_settings, null, 2));
        setPresets(presetList);
        setCookies(await request<{filename: string}[]>('/cookies'));
        await reload();
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : 'Could not open Downloader. Try again.');
      } finally {
        if (mounted) setInitializing(false);
      }
    }
    void initialize();
    const timer = window.setInterval(() => { if (mounted) void reload(); }, 3500);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      personalAutosave.current?.dispose();
      personalAutosave.current = null;
    };
  }, [reload]);
  // Hydration alone never causes a PUT. Edits are serialized and only ordinary
  // owner settings are included; connection credentials have a separate action.
  useEffect(() => {
    if (initializing || !me || !personalAutosave.current) return;
    try {
      validateFolderDraft(personal.destination_folder);
      setPersonalValidationError('');
      personalAutosave.current.change(ordinaryPreferences(personal));
    } catch (error) {
      setPersonalValidationError(
        error instanceof Error ? error.message : 'Choose a valid Files folder.',
      );
      personalAutosave.current.pause();
    }
  }, [initializing, me, personal.destination_folder, personal.default_preset,
    personal.notify_finished, personal.notify_failed]);

  const active = useMemo(() => jobs.find(job => job.id === selected), [jobs, selected]);
  const running = jobs.filter(job => !TERMINAL.has(job.status));
  const hasVerifiedDownload = Boolean(personal.first_download_verified)
    || jobs.some(job => job.status === 'completed' && job.output_files?.length
      && job.output_files.every(file => file.verified));
  const showGuide = Boolean(me) && (!personal.app_password_configured || !hasVerifiedDownload);
  const exampleUrl = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const job = await request<Download>('/jobs', json('POST', {
        url, engine, preset_id: presetId || undefined, ...(folder ? {folder} : {}),
      }));
      setUrl('');
      setJobs(items => [job, ...items]);
      setSelected(job.id);
      setTab('downloads');
      setMessage('Download submitted into your Nextcloud Files.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start this download. Check your Files connection and try again.');
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
        notify_finished: personal.notify_finished !== false,
        notify_failed: personal.notify_failed !== false,
        ...(appPassword ? { app_password: appPassword } : {}),
      }));
      setPersonal(newSettings);
      setAppPassword('');
      setMessage('Saved ✓ Your new downloads will use these settings.');
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


  async function savePreset(event: FormEvent) {
    event.preventDefault();
    try {
      const settings = JSON.parse(presetJson);
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        throw new Error('Preset settings must be an object');
      }
      const url = '/presets' + (editingPreset ? '/' + encodeURIComponent(editingPreset) : '');
      await request<Preset>(url, json(editingPreset ? 'PUT' : 'POST',
        {name: presetName, engine: presetEngine, settings}));
      setPresets(await request<Preset[]>('/presets'));
      setEditingPreset(''); setPresetName(''); setPresetJson('{}');
      setMessage('Your preset has been saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save preset');
    }
  }

  async function deletePreset(id: string) {
    try {
      await request('/presets/' + encodeURIComponent(id), {method:'DELETE'});
      setPresets(await request<Preset[]>('/presets'));
      setMessage('Your preset was deleted.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete preset');
    }
  }

  return <div className="shell user-downloader">
    <header className="topbar">
      <div className="brandmark">D</div>
      <div><div className="brand">Downloader</div><div className="subbrand">Your own downloads in Nextcloud Files · {me || 'Loading account'}</div></div>
      <div className="top-actions"><span className="user-running">{running.length} active</span></div>
    </header>
    {message && <p className="notice" role="status">{message}</p>}
    {initializing && <section className="panel user-loading" role="status" aria-label="Loading Downloader">
      <div className="skeleton skeleton-title" /><div className="skeleton" /><div className="skeleton" />
    </section>}
    {showGuide && <section className="panel user-onboarding" aria-label="Get started with Downloader">
      <h2>Get started with Downloader</h2>
      <p className="muted">Two steps to your first verified download.</p>
      <ol>
        <li><strong>{personal.app_password_configured ? '✓ ' : '① '}Connect your Files</strong>
          <p>Connect a dedicated Nextcloud app password so downloads go into your own Files.</p>
          {!personal.app_password_configured && <button type="button" className="primary" onClick={() => setTab('personal')}>Connect your Files</button>}
        </li>
        <li><strong>{hasVerifiedDownload ? '✓ ' : '② '}Download something first</strong>
          <p>Try a small public example PDF. You can choose another link at any time.</p>
          {personal.app_password_configured && !hasVerifiedDownload &&
            <button type="button" className="primary" onClick={() => { setUrl(exampleUrl); setTab('downloads'); }}>Use example download</button>}
        </li>
      </ol>
      <p className="muted">The guide disappears after your first verified file delivery.</p>
    </section>}
    <nav className="tabs" aria-label="Downloader sections">
      <button className={tabs === 'downloads' ? 'active' : ''} onClick={() => setTab('downloads')}>Download</button>
      <button className={tabs === 'personal' ? 'active' : ''} onClick={() => setTab('personal')}>My settings</button>
      <button className={tabs === 'engines' ? 'active' : ''} onClick={() => setTab('engines')}>Advanced</button>
    </nav>

    {tabs === 'downloads' && <div className="layout">
      <section className="panel submit-panel">
        <div className="eyebrow">NEW DOWNLOAD</div><h2>Download</h2>
        <form onSubmit={event => void submit(event)}>
          <label>Media URL<input value={url} onChange={event => setUrl(event.target.value)} placeholder="Paste a downloadable URL" required /></label>
          <label>Engine<select value={engine} onChange={event => setEngine(event.target.value as Engine)}>
            {TYPES.map(item => <option key={item} value={item}>{item === 'auto' ? 'Automatic' : item}</option>)}
          </select></label>
          <label>Preset (optional)<select value={presetId} onChange={event => setPresetId(event.target.value)}>
            <option value="">Use my default</option>
            {presets.filter(preset => engine === 'auto' || preset.engine === engine).map(preset =>
              <option key={preset.id} value={preset.id}>{preset.name}{preset.is_shared ? ' · Shared by administrator' : ' · My preset'}</option>)}
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
      <h2>My settings</h2>
      <p className="muted">These settings are stored in your Nextcloud account, not shared across users.</p>
      <form onSubmit={event => void savePersonal(event)}>
        <h3>Where your downloads go</h3><p className="muted">Delivered files appear in this folder in your own Nextcloud Files. The default is Downloads.</p>
        <label>Destination folder<input value={personal.destination_folder}
          onChange={event => setPersonal(old => ({ ...old, destination_folder: event.target.value }))} /></label>
        <h3>Your defaults</h3><p className="muted">Choose a preset for new downloads; you can still change it for each link.</p>
        <label>Default preset<select value={personal.default_preset}
          onChange={event => setPersonal(old => ({ ...old, default_preset: event.target.value }))}>
          <option value="">None</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}{preset.is_shared ? ' · Shared by administrator' : ' · My preset'}</option>)}
        </select></label>
        <h3>Files connection</h3><p className="muted" role="status">{personal.app_password_configured ? 'Connected ✓' : 'Not connected — create an app password to let Downloader deliver files.'}</p>
        <p className="muted"><a href="/settings/user/security" target="_blank" rel="noreferrer">Create an app password in Nextcloud Security</a>, then paste it below.</p>
        <label>My Nextcloud Files app password
          <input type="password" autoComplete="new-password" value={appPassword}
            onChange={event => setAppPassword(event.target.value)}
            placeholder={personal.app_password_configured ? 'Stored securely; leave blank to keep' : 'Create one in Nextcloud personal Security settings'} />
        </label>
        <p className="secure-note">A dedicated Nextcloud app password authorizes WebDAV delivery to your own Files. It is stored as a sensitive Nextcloud preference and never shown again. The downloader service API key never reaches this page.</p>
        <h3>Notifications</h3>
        <p className="muted">Choose which download outcomes should send native Nextcloud notifications. Your download history is kept either way.</p>
        <label className="check"><input type="checkbox" checked={personal.notify_finished !== false}
          onChange={event => setPersonal(old => ({...old, notify_finished: event.target.checked}))} />
          Notify me when a download finishes</label>
        <label className="check"><input type="checkbox" checked={personal.notify_failed !== false}
          onChange={event => setPersonal(old => ({...old, notify_failed: event.target.checked}))} />
          Notify me when a download fails or is cancelled</label>
        <button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save my settings'}</button>
      </form>
    </section>}

    {tabs === 'engines' && <div className="settings-layout">
      <section className="panel">
        <h2>My presets</h2>
        <p className="muted">Presets you create here stay private to your Nextcloud account. Your administrator may also make safe shared presets available to entitled Downloader users; those are read-only.</p>
        <form onSubmit={event => void savePreset(event)}>
          <label>Name<input required maxLength={120} value={presetName} onChange={event => setPresetName(event.target.value)} /></label>
          <label>Engine<select value={presetEngine} onChange={event => setPresetEngine(event.target.value as Engine)}>
            {TYPES.filter(type => type !== 'auto').map(type => <option key={type} value={type}>{type}</option>)}
          </select></label>
          <label>Preset settings JSON<textarea rows={6} value={presetJson} onChange={event => setPresetJson(event.target.value)} /></label>
          <button className="primary">{editingPreset ? 'Update my preset' : 'Save my preset'}</button>
        </form>
        {presets.map(preset => <div className="output-row" key={preset.id}>
          <strong>{preset.name} ({preset.engine})</strong>
          {preset.is_shared ? <span className="muted">Shared by administrator · Read-only</span> : <>
            <button className="small secondary" onClick={() => {
              setEditingPreset(preset.id); setPresetName(preset.name); setPresetEngine(preset.engine);
              setPresetJson(JSON.stringify(preset.settings, null, 2));
            }}>Edit</button>
            <button className="small danger" onClick={() => void deletePreset(preset.id)}>Delete</button>
          </>}
        </div>)}
      </section>

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
