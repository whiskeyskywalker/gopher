const http = require('http');
const net  = require('net');
const url  = require('url');

function corsHeaders(contentType) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': contentType || 'application/json',
  };
}

function parseMenu(raw) {
  const lines = raw.split('\n');
  const items = [];
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, '');
    if (trimmed === '.') break;
    if (!trimmed) continue;
    const type = trimmed[0];
    const rest = trimmed.slice(1);
    const parts = rest.split('\t');
    if (parts.length >= 4) {
      items.push({ type, text: parts[0], selector: parts[1], host: parts[2], port: parseInt(parts[3]) || 70 });
    } else {
      items.push({ type: 'i', text: rest, selector: '', host: '', port: 70 });
    }
  }
  return items;
}

function looksLikeMenu(raw) {
  const lines = raw.split('\n').slice(0, 30);
  let realMenuLines = 0;
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed || trimmed === '.') continue;
    const parts = trimmed.slice(1).split('\t');
    if (parts.length >= 4) {
      const host = parts[2].trim();
      if (host && host !== '(NULL)' && host !== 'error.host' && host !== 'fake' && host.includes('.')) {
        realMenuLines++;
      }
    }
  }
  return realMenuLines >= 2;
}

function gopherFetch(host, port, selector) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = Buffer.alloc(0);
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Timed out')); }, 15000);
    socket.connect(port, host, () => { socket.write((selector || '') + '\r\n'); });
    socket.on('data', chunk => { data = Buffer.concat([data, chunk]); });
    socket.on('end', () => { clearTimeout(timeout); resolve(data); });
    socket.on('error', err => { clearTimeout(timeout); reject(err); });
  });
}

function isPrivate(host) {
  return /^(localhost|127\.|10\.|192\.168\.|::1)/.test(host);
}

http.createServer(async (req, res) => {
  const h = corsHeaders();
  if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return; }

  const p = url.parse(req.url, true);

  if (p.pathname === '/' || p.pathname === '/health') {
    res.writeHead(200, h); res.end(JSON.stringify({ status: 'ok' })); return;
  }

  // ── /gopher — text/menu responses ──
  if (p.pathname === '/gopher') {
    const host = p.query.host || '';
    const port = parseInt(p.query.port) || 70;
    const selector = p.query.selector || '';
    if (!host) { res.writeHead(400, h); res.end(JSON.stringify({ error: 'Missing host' })); return; }
    if (isPrivate(host)) { res.writeHead(403, h); res.end(JSON.stringify({ error: 'Private addresses not allowed' })); return; }
    try {
      const raw = await gopherFetch(host, port, selector);
      const text = raw.toString('utf8');
      const result = looksLikeMenu(text)
        ? { type: 'menu', items: parseMenu(text) }
        : { type: 'text', content: text.includes('\uFFFD') ? raw.toString('latin1') : text };
      res.writeHead(200, h);
      res.end(JSON.stringify(result));
    } catch (err) {
      res.writeHead(502, h); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /binary — raw file, streamed back with content-disposition ──
  if (p.pathname === '/binary') {
    const host = p.query.host || '';
    const port = parseInt(p.query.port) || 70;
    const selector = p.query.selector || '';
    const filename = p.query.filename || 'download';
    if (!host || isPrivate(host)) { res.writeHead(403, h); res.end(JSON.stringify({ error: 'Forbidden' })); return; }
    try {
      const raw = await gopherFetch(host, port, selector);
      // Guess content type from filename
      const ext = filename.split('.').pop().toLowerCase();
      const mimeMap = {
        gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
        txt: 'text/plain', html: 'text/html', htm: 'text/html',
        mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
        pdf: 'application/pdf', zip: 'application/zip',
      };
      const mime = mimeMap[ext] || 'application/octet-stream';
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': mime,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': raw.length,
      });
      res.end(raw);
    } catch (err) {
      res.writeHead(502, corsHeaders()); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── /image — returns image as base64 JSON for inline display ──
  if (p.pathname === '/image') {
    const host = p.query.host || '';
    const port = parseInt(p.query.port) || 70;
    const selector = p.query.selector || '';
    if (!host || isPrivate(host)) { res.writeHead(403, h); res.end(JSON.stringify({ error: 'Forbidden' })); return; }
    try {
      const raw = await gopherFetch(host, port, selector);
      const ext = (selector.split('.').pop() || 'gif').toLowerCase();
      const mimeMap = { gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp' };
      const mime = mimeMap[ext] || 'image/gif';
      const b64 = raw.toString('base64');
      res.writeHead(200, h);
      res.end(JSON.stringify({ type: 'image', mime, data: b64 }));
    } catch (err) {
      res.writeHead(502, h); res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404, h); res.end(JSON.stringify({ error: 'Not found' }));

}).listen(process.env.PORT || 3000, () => console.log('Gopher proxy running'));
