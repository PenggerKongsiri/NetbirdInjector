import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export class NetBirdClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.cache = new Map();
  }

  enabled() {
    return this.config.mode === 'api';
  }

  token() {
    const stat = statSync(this.config.tokenFile);
    if (!stat.isFile() || (process.platform !== 'win32' && (stat.mode & 0o007) !== 0)) throw new Error('NetBird token file must be a regular file and inaccessible to other users');
    const value = readFileSync(this.config.tokenFile, 'utf8').trim();
    if (!value || value.length > 8192) throw new Error('NetBird token file is empty or invalid');
    return value;
  }

  async request(path) {
    if (!this.enabled()) throw new Error('NetBird API integration is in manual mode');
    const cached = this.cache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const base = this.config.apiBaseUrl.endsWith('/') ? this.config.apiBaseUrl : `${this.config.apiBaseUrl}/`;
    const url = new URL(String(path).replace(/^\/+/, ''), base);
    const value = await requestJson(url, {
      accept: 'application/json', authorization: `Token ${this.token()}`, 'user-agent': 'netbird-injector-manager/0.1',
    }, this.config.caFile ? readCaFile(this.config.caFile) : undefined);
    this.cache.set(path, { value, expiresAt: Date.now() + this.config.cacheSeconds * 1000 });
    return value;
  }

  async peers() {
    const rows = await this.request('/api/peers');
    if (!Array.isArray(rows)) throw new Error('NetBird peers response has an unexpected shape');
    return rows.slice(0, 10_000).map((peer) => ({
      id: String(peer.id ?? ''),
      name: String(peer.name ?? peer.hostname ?? ''),
      hostname: String(peer.hostname ?? ''),
      ip: String(peer.ip ?? ''),
      ipv6: String(peer.ipv6 ?? ''),
      dnsName: String(peer.dns_label ?? ''),
      connected: Boolean(peer.connected),
      lastSeen: peer.last_seen ?? null,
      os: String(peer.os ?? ''),
      version: String(peer.version ?? ''),
      accessiblePeersCount: Number(peer.accessible_peers_count ?? 0),
    }));
  }

  async clusters() {
    const rows = await this.request('/api/reverse-proxies/clusters');
    if (!Array.isArray(rows)) throw new Error('NetBird clusters response has an unexpected shape');
    return rows.slice(0, 1000).map((cluster) => ({
      address: String(cluster.address ?? cluster.domain ?? ''),
      type: String(cluster.type ?? ''),
      online: Boolean(cluster.online ?? cluster.connected),
      features: Array.isArray(cluster.features) ? cluster.features.map(String) : [],
    }));
  }

  async localStatus() {
    try {
      const { stdout } = await execFileAsync(this.config.cliPath, ['status', '--json'], {
        timeout: 5000, windowsHide: true, maxBuffer: 1_048_576, encoding: 'utf8', shell: false,
      });
      const status = JSON.parse(stdout);
      return {
        available: true,
        managementConnected: Boolean(status.management?.connected ?? status.management?.Connected),
        signalConnected: Boolean(status.signal?.connected ?? status.signal?.Connected),
        fqdn: status.fqdn ?? status.FQDN ?? null,
        netbirdIp: status.netbirdIp ?? status.ip ?? status.IP ?? null,
      };
    } catch (error) {
      this.logger.debug('netbird.local_status_unavailable', { reason: error.message });
      return { available: false, reason: 'NetBird CLI status is unavailable' };
    }
  }
}

function readCaFile(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 262_144) throw new Error('NetBird API CA file is invalid or too large');
  const value = readFileSync(path, 'utf8');
  if (!value.includes('-----BEGIN CERTIFICATE-----') || /PRIVATE KEY/.test(value)) throw new Error('NetBird API CA file must contain certificates only');
  return value;
}

function requestJson(url, headers, ca) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`,
      method: 'GET', headers, agent: false, maxHeaderSize: 16_384, insecureHTTPParser: false,
      ...(url.protocol === 'https:' ? { rejectUnauthorized: true, minVersion: 'TLSv1.2', ca } : {}),
    }, (response) => {
      if (response.statusCode < 200 || response.statusCode > 299) {
        response.resume();
        reject(new Error(`NetBird API returned HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > 10_485_760) response.destroy(new Error('NetBird API response exceeds 10 MiB'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('NetBird API returned invalid JSON')); }
      });
      response.on('error', reject);
    });
    request.setTimeout(10_000, () => request.destroy(new Error('NetBird API request timed out')));
    request.on('error', reject);
    request.end();
  });
}
