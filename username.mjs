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
