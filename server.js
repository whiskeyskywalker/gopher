const http = require('http');
const net  = require('net');
const url  = require('url');

const PORT = process.env.PORT || 3000;

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
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

// A real Gopher menu must have multiple lines where the host field
// is a non-empty, non-fake hostname (not 'error.host' or '(NULL)').
// Plain text files sometimes contain tabs but are NOT menus.
function looksLikeMenu(raw) {
  const lines = raw.split('\n').slice(0, 30);
  let realMenuLines = 0;
  for (const line of lines) {
    const trimmed = line.replace(/\r$/, '');
    if (!trimmed || trimmed === '.') continue;
    const parts = trimmed.slice(1).split('\t');
    if (parts.length >= 4) {
      const host = parts[2].trim();
      // Must have a real hostname — not empty, not a placeholder
      if (host && host !== '(NULL)' && host !== 'error.host' && host !== 'fake' && host.includes('.')) {
        realMenuLines++;
      }
    }
  }
  // Require at least 2 real menu lines to be considered a menu
  return realMenuLines >= 2;
}

function gopherFetch(host, port, selector) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let data = Buffer.alloc(0);
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('Timed out')); }, 10000);
    socket.connect(port, host, () => { socket.write((selector || '') + '\r\n'); });
    socket.on('data', chunk => { data = Buffer.concat([data, chunk]); });
    socket.on('end', () => { clearTimeout(timeout); resolve(data); });
    socket.on('error', err => { clearTimeout(timeout); reject(err); });
  });
}

http.createServer(async (req, res) => {
  const h = corsHeaders();
  if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return; }
  const p = url.parse(req.url, true);
  if (p.pathname === '/' || p.pathname === '/health') {
    res.writeHead(200, h); res.end(JSON.stringify({ status: 'ok' })); return;
  }
  if (p.pathname !== '/gopher') {
    res.writeHead(404, h); res.end(JSON.stringify({ error: 'Not found' })); return;
  }
  const host = p.query.host || '';
  const port = parseInt(p.query.port) || 70;
  const selector = p.query.selector || '';
  if (!host) { res.writeHead(400, h); res.end(JSON.stringify({ error: 'Missing host' })); return; }
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
}).listen(process.env.PORT || 3000, () => console.log('Gopher proxy running'));
