export function encodeUsername(username) {
  return username
    .split('')
    .map(char => {
      if (char >= 'A' && char <= 'Z') {
        const asciiHex = char.charCodeAt(0).toString(16);
        return `${char.toLowerCase()}0x${asciiHex}`;
      } else if (char === '_') {
        return '0x5f';
      } else {
        return char;
      }
    })
    .join('');
}

export function decodeUsername(encodedUsername) {
  return encodedUsername
    .replace(/([a-z])0x([0-9a-f]{2})/g, (match, p1, p2) => {
      const decodedChar = String.fromCharCode(parseInt(p2, 16));
      return p1.toLowerCase() === decodedChar.toLowerCase() ? decodedChar.toUpperCase() : match;
    })
    .replace(/0x5f/g, '_');
}

export function usernameAddress(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  let error;
  if (!/^[A-Za-z0-9_-]{1,63}$/.test(username)) {
    error = 'Enter one HN username using letters, numbers, underscores or hyphens.';
  }
  const encoded = encodeUsername(username);
  if (!error && encoded === 'www') {
    error = 'The www.at.hn address is reserved for the homepage. This username cannot have a profile subdomain.';
  }
  if (!error && (encoded.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(encoded))) {
    error = 'This username cannot be represented by an at.hn subdomain. It may be too long after encoding, or start or end with a hyphen.';
  }
  if (!error && decodeUsername(encoded) !== username) {
    error = 'This username conflicts with the existing at.hn address encoding. We cannot generate an unambiguous address for it.';
  }
  if (!error) {
    try {
      // DNS-shaped labels may still be invalid browser hostnames (e.g. xn--a).
      if (new URL(`https://${encoded}.at.hn`).hostname !== `${encoded}.at.hn`) throw new Error('Different hostname');
    } catch {
      error = 'This username cannot be represented by a valid at.hn web address.';
    }
  }
  return { username, encoded, error };
}
