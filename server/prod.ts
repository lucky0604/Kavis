import http from 'http';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import type { IncomingMessage, ServerResponse } from 'http';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.resolve(__dirname, '..', 'dist');

const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // Health check
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // Serve static files
  let filePath = path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname);

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.svg': 'image/svg+xml',
      '.json': 'application/json',
      '.png': 'image/png',
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // SPA fallback
  res.writeHead(200, { 'Content-Type': 'text/html' });
  fs.createReadStream(path.join(DIST_DIR, 'index.html')).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Janus production server running on http://localhost:${PORT}`);
});
