import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

export function createClientIpKey({ source = 'proxy', trustPeer, warn = value => console.warn(JSON.stringify(value)) } = {}) {
  if (!['proxy', 'railway-edge'].includes(source)) throw new Error('CLIENT_IP_SOURCE must be proxy or railway-edge');
  if (source === 'railway-edge' && typeof trustPeer !== 'function') throw new Error('railway-edge requires an explicit socket-peer trust predicate');
  const warned = new Set();
  return req => {
    if (source === 'proxy') return ipKeyGenerator(req.ip, 56);
    const peer = req.socket.remoteAddress;
    const value = req.headers['x-real-ip'];
    const trusted = trustPeer(peer, 0);
    if (trusted && typeof value === 'string' && isIP(value)) return ipKeyGenerator(value, 56);
    const reason = trusted ? 'missing_or_invalid_real_ip' : 'untrusted_socket_peer';
    const warningKey = `${reason}:${peer}`;
    if (warned.size < 16 && !warned.has(warningKey)) {
      warned.add(warningKey);
      warn({ event: 'client_ip_fallback', reason, peer });
    }
    // Unknown ingress must not gain a fresh quota by rotating proxy sockets.
    // This shared bucket trades availability for a bounded request rate.
    return 'railway-unverified-ingress';
  };
}
