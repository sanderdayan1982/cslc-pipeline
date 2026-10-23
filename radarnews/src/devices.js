import { execFile } from 'node:child_process';
import QRCode from 'qrcode';

const CANDIDATES = [
  process.env.TAILSCALE_BIN,
  'tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
].filter(Boolean);

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  });
}

// Pure so it can be tested without Tailscale installed.
export function parseTailscale(statusJson, serveJson, port) {
  const status = typeof statusJson === 'string' ? JSON.parse(statusJson) : statusJson;
  const dns = status?.Self?.DNSName?.replace(/\.$/, '') || null;
  const running = status?.BackendState === 'Running';
  const serve = typeof serveJson === 'string' ? serveJson : JSON.stringify(serveJson ?? {});
  const serving = !!dns && new RegExp(`(127\\.0\\.0\\.1|localhost):${port}\\b`).test(serve);
  return { installed: true, running, dns, serving, url: dns && serving ? `https://${dns}` : null };
}

let cache = { at: 0, value: null };

export async function tailscaleInfo(port) {
  if (Date.now() - cache.at < 30_000 && cache.value) return cache.value;
  let value = { installed: false, running: false, dns: null, serving: false, url: null };
  for (const bin of CANDIDATES) {
    try {
      const status = await run(bin, ['status', '--json']);
      const serve = await run(bin, ['serve', 'status', '--json']).catch(() => '{}');
      value = parseTailscale(status, serve, port);
      break;
    } catch (err) {
      if (err.code !== 'ENOENT') {
        value = { ...value, installed: true };
        break;
      }
    }
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function devicesInfo(port, requestOrigin) {
  const ts = await tailscaleInfo(port);
  const url = ts.url || (requestOrigin?.startsWith('https://') ? requestOrigin : null);
  return {
    tailscale: ts,
    url,
    secure: !!url,
    qr: url ? await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0a0d11', light: '#ffffff' } }) : null,
    command: `tailscale serve --bg ${port}`,
  };
}
