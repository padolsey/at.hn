import net from 'node:net';

// Empty configuration trusts the socket peer only. Supply verified ingress
// CIDRs explicitly; neither a boolean nor an assumed hop count is accepted.
export function trustedProxyCidrs(value = '') {
  if (!value.trim()) return false;
  const ranges = value.split(',').map(range => range.trim());
  for (const range of ranges) {
    const [address, prefix, extra] = range.split('/');
    const family = net.isIP(address);
    const bits = family === 4 ? 32 : 128;
    const canonical = family === 6 ? new net.SocketAddress({ address, family: 'ipv6' }).address : address;
    if (!family || extra !== undefined || (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > bits)) ||
        (canonical.toLowerCase().startsWith('::ffff:') && prefix !== undefined && Number(prefix) <= 96)) {
      throw new Error('TRUSTED_PROXY_CIDRS must contain explicit IP addresses or valid CIDRs');
    }
  }
  return ranges;
}
