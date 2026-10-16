import { spawn, type ChildProcess } from 'node:child_process';

type EmbeddedEngine = {
  name: 'ddgs' | 'searxng' | 'openserp';
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  health: string;
  sample: string;
  method?: 'POST';
  body?: string;
};

const engines: EmbeddedEngine[] = [
  {
    name: 'ddgs',
    command: '/opt/lexara-ddgs/bin/uvicorn',
    args: ['ddgs.api_server:fastapi_app', '--host', '127.0.0.1', '--port', '14479', '--log-level', 'warning'],
    health: 'http://127.0.0.1:14479/health',
    sample: 'http://127.0.0.1:14479/search/text',
    method: 'POST',
    body: JSON.stringify({ query: 'NASA', backend: 'wikipedia,grokipedia', max_results: 2 }),
  },
  {
    name: 'searxng',
    command: '/opt/lexara-searxng/bin/granian',
    args: ['searx.webapp:app'],
    cwd: '/opt/lexara-searxng/source',
    env: {
      PYTHONPATH: '/opt/lexara-searxng/source',
      PYTHONDONTWRITEBYTECODE: '1',
      SEARXNG_SETTINGS_PATH: '/opt/lexara-searxng/settings.yml',
      GRANIAN_INTERFACE: 'wsgi',
      GRANIAN_HOST: '127.0.0.1',
      GRANIAN_PORT: '18080',
      GRANIAN_WORKERS: '1',
      GRANIAN_BLOCKING_THREADS: '2',
    },
    health: 'http://127.0.0.1:18080/healthz',
    sample: 'http://127.0.0.1:18080/search?q=NASA&format=json&engines=bing,yahoo',
  },
  {
    name: 'openserp',
    command: '/usr/local/bin/openserp',
    args: ['serve', '-a', '127.0.0.1', '-p', '17000', '--raw=false', '--insecure=false', '--timeout', '4'],
    cwd: '/opt/lexara-openserp',
    env: { OPENSERP_APP_BROWSER_PATH: '/usr/bin/chromium', OPENSERP_APP_MAX_PROCESSES: '2' },
    health: 'http://127.0.0.1:17000/health',
    sample: 'http://127.0.0.1:17000/mega/search?text=NASA&engines=bing&mode=fast&limit=2',
  },
];

let started = false;
let shuttingDown = false;
const children = new Set<ChildProcess>();

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function checkEngine(engine: EmbeddedEngine, child: ChildProcess): Promise<void> {
  for (let attempt = 0; attempt < 30 && !shuttingDown && child.exitCode === null; attempt++) {
    await sleep(1_000);
    try {
      const response = await fetch(engine.health, { signal: AbortSignal.timeout(900) });
      if (!response.ok) continue;
      console.info('[LEXARA Embedded Search]', JSON.stringify({ engine: engine.name, healthy: true }));
      try {
        const sample = await fetch(engine.sample, {
          method: engine.method || 'GET',
          headers: engine.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
          body: engine.body,
          signal: AbortSignal.timeout(engine.name === 'openserp' ? 16_000 : 9_000),
        });
        const json = await sample.json() as { results?: unknown[]; data?: { results?: unknown[] } };
        const liveResults = (json.results || json.data?.results || []).length;
        const message = JSON.stringify({ engine: engine.name, searchStatus: sample.status, liveResults });
        if (sample.ok && liveResults > 0) console.info('[LEXARA Embedded Search]', message);
        else console.warn('[LEXARA Embedded Search]', message);
      } catch (error) {
        console.warn('[LEXARA Embedded Search]', JSON.stringify({
          engine: engine.name, searchStatus: 'unavailable',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return;
    } catch {
      // A starting engine never blocks the legal assistant or the website.
    }
  }
  if (!shuttingDown && child.exitCode === null) {
    console.warn('[LEXARA Embedded Search]', JSON.stringify({ engine: engine.name, healthy: false }));
  }
}

/** Only the Bad-Blue image has these binaries; other services are never changed or started. */
export function startLexaraEmbeddedSearchEngines(): void {
  if (started || process.env.NODE_ENV !== 'production' || process.env.LEXARA_EMBEDDED_SEARCH !== 'true') return;
  started = true;
  for (const engine of engines) {
    const launch = () => {
      if (shuttingDown) return;
      const child = spawn(engine.command, engine.args, {
        cwd: engine.cwd, env: { ...process.env, ...engine.env },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      children.add(child);
      let reported = 0;
      child.stderr?.on('data', (data: Buffer) => {
        if (reported++ < 3) console.warn('[LEXARA Embedded Search]', engine.name, String(data).slice(0, 400));
      });
      console.info('[LEXARA Embedded Search]', JSON.stringify({ engine: engine.name, starting: true }));
      void checkEngine(engine, child);
      let exited = false;
      const restart = (detail: string) => {
        if (exited) return;
        exited = true;
        children.delete(child);
        if (!shuttingDown) {
          console.warn('[LEXARA Embedded Search]', JSON.stringify({ engine: engine.name, restart: true, detail }));
          setTimeout(launch, 10_000).unref();
        }
      };
      child.once('error', error => restart(error.message));
      child.once('exit', (code, signal) => restart('exit:' + (code ?? signal ?? 'unknown')));
    };
    launch();
  }
  const stop = () => {
    shuttingDown = true;
    for (const child of children) child.kill('SIGTERM');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
