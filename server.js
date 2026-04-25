// Gopher Proxy Server
// Bridges HTTP (from the PWA) to raw TCP Gopher protocol
//
// Deploy to: Render.com, Railway.app, Fly.io (all have free tiers)
// Then set PROXY_URL in index.html to your deployment URL.

const http  = require(‘http’);
const net   = require(‘net’);
const url   = require(‘url’);

const PORT = process.env.PORT || 3000;

// ── Allowed origins (set to your deployed PWA domain) ──
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
? process.env.ALLOWED_ORIGINS.split(’,’)
: [’*’];

function corsHeaders(origin) {
const allow = ALLOWED_ORIGINS.includes(’*’) || ALLOWED_ORIGINS.includes(origin)
? origin || ’*’
: ‘’;
return {
‘Access-Control-Allow-Origin’: allow,
‘Access-Control-Allow-Methods’: ‘GET, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type’,
‘Content-Type’: ‘application/json’,
};
}

// ── Gopher item parser ──
function parseMenu(raw) {
const lines = raw.split(’\n’);
const items = [];
for (const line of lines) {
const trimmed = line.replace(/\r$/, ‘’);
if (trimmed === ‘.’) break;
if (!trimmed) continue;
const type = trimmed[0];
const rest = trimmed.slice(1);
const parts = rest.split(’\t’);
if (parts.length >= 4) {
items.push({
type,
text:     parts[0],
selector: parts[1],
host:     parts[2],
port:     parseInt(parts[3]) || 70,
});
} else {
items.push({ type: ‘i’, text: rest, selector: ‘’, host: ‘’, port: 70 });
}
}
return items;
}

// ── Detect if response is a menu ──
function looksLikeMenu(raw) {
const lines = raw.split(’\n’).slice(0, 10);
return lines.some(l => l.length > 1 && l.includes(’\t’));
}

// ── Fetch from Gopher server ──
function gopherFetch(host, port, selector) {
return new Promise((resolve, reject) => {
const socket = new net.Socket();
let data = Buffer.alloc(0);
const timeout = setTimeout(() => {
socket.destroy();
reject(new Error(‘Connection timed out’));
}, 10000);

```
socket.connect(port, host, () => {
  socket.write((selector || '') + '\r\n');
});

socket.on('data', chunk => {
  data = Buffer.concat([data, chunk]);
});

socket.on('end', () => {
  clearTimeout(timeout);
  resolve(data);
});

socket.on('error', err => {
  clearTimeout(timeout);
  reject(err);
});
```

});
}

// ── HTTP Server ──
const server = http.createServer(async (req, res) => {
const origin = req.headers[‘origin’] || ‘’;
const headers = corsHeaders(origin);

if (req.method === ‘OPTIONS’) {
res.writeHead(204, headers);
res.end();
return;
}

if (req.method !== ‘GET’) {
res.writeHead(405, headers);
res.end(JSON.stringify({ error: ‘Method not allowed’ }));
return;
}

const parsed = url.parse(req.url, true);

if (parsed.pathname !== ‘/gopher’) {
res.writeHead(404, headers);
res.end(JSON.stringify({ error: ‘Not found. Use /gopher?host=&port=&selector=’ }));
return;
}

const host     = parsed.query.host     || ‘’;
const port     = parseInt(parsed.query.port) || 70;
const selector = parsed.query.selector || ‘’;

if (!host) {
res.writeHead(400, headers);
res.end(JSON.stringify({ error: ‘Missing host parameter’ }));
return;
}

// Basic security: block private/loopback addresses
if (/^(localhost|127.|10.|192.168.|::1)/.test(host)) {
res.writeHead(403, headers);
res.end(JSON.stringify({ error: ‘Private addresses not allowed’ }));
return;
}

try {
const raw = await gopherFetch(host, port, selector);
const text = raw.toString(‘utf8’);

```
let result;
if (looksLikeMenu(text)) {
  result = { type: 'menu', items: parseMenu(text) };
} else {
  // Try UTF-8, fall back to latin1
  const content = raw.toString('utf8').includes('\uFFFD')
    ? raw.toString('latin1')
    : text;
  result = { type: 'text', content };
}

res.writeHead(200, headers);
res.end(JSON.stringify(result));
```

} catch (err) {
res.writeHead(502, headers);
res.end(JSON.stringify({ error: err.message }));
}
});

server.listen(PORT, () => {
console.log(`Gopher proxy listening on port ${PORT}`);
});
