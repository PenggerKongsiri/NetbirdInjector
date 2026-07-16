import dns from 'node:dns';
import net from 'node:net';

function ipv4ToBigInt(value) {
  const parts = value.split('.');
  if (parts.length !== 4) throw new Error(`invalid IPv4 address: ${value}`);
  let result = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) throw new Error(`invalid IPv4 address: ${value}`);
    result = (result << 8n) + BigInt(part);
  }
  return result;
}

function ipv6ToBigInt(value) {
  let text = value.toLowerCase().split('%')[0];
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const v4 = ipv4ToBigInt(text.slice(lastColon + 1));
    text = `${text.slice(0, lastColon)}:${Number((v4 >> 16n) & 0xffffn).toString(16)}:${Number(v4 & 0xffffn).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) throw new Error(`invalid IPv6 address: ${value}`);
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) throw new Error(`invalid IPv6 address: ${value}`);
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    throw new Error(`invalid IPv6 address: ${value}`);
  }
  return groups.reduce((result, part) => (result << 16n) + BigInt(`0x${part}`), 0n);
}

export function parseCidr(value) {
  const parts = String(value).split('/');
  if (parts.length > 2) throw new Error(`invalid CIDR prefix: ${value}`);
  const [address, prefixText] = parts;
  if (address.includes('%')) throw new Error(`scoped IPv6 addresses are not valid CIDRs: ${value}`);
  const family = net.isIP(address);
  if (!family) throw new Error(`invalid CIDR address: ${value}`);
  const bits = family === 4 ? 32 : 128;
  const prefix = prefixText === undefined ? bits : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) throw new Error(`invalid CIDR prefix: ${value}`);
  const integer = family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  const shift = BigInt(bits - prefix);
  const network = shift === 0n ? integer : (integer >> shift) << shift;
  return { source: value, family, prefix, bits, network, shift };
}

export function addressInCidrs(address, cidrs) {
  const family = net.isIP(address);
  if (!family) return false;
  const integer = family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  return cidrs.some((cidr) => cidr.family === family && (cidr.shift === 0n ? integer : (integer >> cidr.shift) << cidr.shift) === cidr.network);
}

export class NetworkPolicy {
  constructor({ allowedTargetCidrs = [], trustedIngressCidrs = [], allowedPorts = [] } = {}) {
    this.allowedTargetCidrs = allowedTargetCidrs.map(parseCidr);
    this.trustedIngressCidrs = trustedIngressCidrs.map(parseCidr);
    const ports = allowedPorts.map(Number);
    if (!ports.length || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('allowed ports must contain integers from 1 to 65535');
    this.allowedPorts = new Set(ports);
  }

  assertPort(port) {
    if (!this.allowedPorts.has(Number(port))) throw new Error(`upstream port ${port} is not in the global allowlist`);
  }

  assertAddress(address) {
    const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
    if (!addressInCidrs(normalized, this.allowedTargetCidrs)) {
      throw new Error(`resolved upstream address ${normalized} is outside the global target CIDR allowlist`);
    }
  }

  isTrustedIngress(address) {
    const normalized = String(address ?? '').startsWith('::ffff:') ? address.slice(7) : address;
    return addressInCidrs(normalized, this.trustedIngressCidrs);
  }

  lookup() {
    return (hostname, options, callback) => {
      dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
        if (error) return callback(error);
        try {
          if (!addresses.length) throw new Error('upstream hostname returned no addresses');
          for (const entry of addresses) this.assertAddress(entry.address);
          const selected = addresses[0];
          callback(null, selected.address, selected.family);
        } catch (policyError) {
          callback(policyError);
        }
      });
    };
  }
}
