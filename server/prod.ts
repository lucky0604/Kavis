import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { IncomingMessage, ServerResponse } from 'http';
import { handleApiRequest } from './router';
import { registerAllAgents } from './handlers/agents-handler';

// Register all tools (side-effect imports)
import './shared/tools/read-file';
import './shared/tools/list-dir-tree';
import './shared/tools/search-content';
import './shared/tools/write-file';
import './shared/tools/patch-file';
import './shared/tools/shell-exec';
import './shared/tools/git-ops';
import './shared/tools/web/web-search';
import './shared/tools/web/web-fetch';
import './shared/tools/evolve';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Server factory: used by both standalone prod and Electron ----

export interface KavisServer {
  server: http.Server;
  port: number;
  close: () => Promise<void>;
}

export function createKavisServer(distDir?: string, port?: number, promptsDir?: string): Promise<KavisServer> {
  const DIST = distDir || path.resolve(__dirname, '..', 'dist');
  const PROMPTS = promptsDir || path.join(__dirname, 'agents', 'prompts');

  registerAllAgents(PROMPTS);

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    // API routes take priority
    if (url.pathname.startsWith('/api/')) {
      req.url = url.pathname.slice('/api'.length) + url.search;
      handleApiRequest(req, res).catch(() => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
      return;
    }

    // Static file serving
    let filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : url.pathname);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2',
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA fallback
    res.writeHead(200, { 'Content-Type': 'text/html' });
    fs.createReadStream(path.join(DIST, 'index.html')).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);

    server.listen(port || 0, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : (port || 3000);
      console.log(`[Kavis] Server running on http://localhost:${actualPort}`);

      resolve({
        server,
        port: actualPort,
        close: () => new Promise((res, rej) => server.close((err) => err ? rej(err) : res())),
      });
    });
  });
}

// ---- Vite dev server integration ----

export function configureApiRoutes(viteServer: { middlewares: { use: (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => void } }) {
  registerAllAgents(path.join(__dirname, 'agents', 'prompts'));
  viteServer.middlewares.use('/api', (req: IncomingMessage, res: ServerResponse) => {
    handleApiRequest(req, res).catch(() => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });
}

// ---- Direct execution entrypoint ----
const isDirectRun = (() => {
  try {
    const thisModulePath = fileURLToPath(import.meta.url);
    return process.argv[1] && path.resolve(process.argv[1]) === thisModulePath;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  const port = parseInt(process.env.PORT || '3000', 10);
  createKavisServer(undefined, port).catch((err: Error) => {
    console.error('[Kavis] Failed to start standalone server:', err);
    process.exit(1);
  });
}
