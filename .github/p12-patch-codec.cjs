// Public verification patch transport only. No source or gate changes.
const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#';
const values = new Map([...alphabet].map((ch, i) => [ch, i]));

function encode85(input) {
  const bytes = Buffer.from(input);
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4);
  bytes.copy(padded);
  let text = '';
  for (let at = 0; at < padded.length; at += 4) {
    let value = padded.readUInt32BE(at), group = '';
    for (let i = 0; i < 5; i++) { group = alphabet[value % 85] + group; value = Math.floor(value / 85); }
    text += group;
  }
  return `${bytes.length}:${text}`;
}

function decode85(text) {
  if (typeof text !== 'string') throw Error('Patch transport must be a string');
  const colon = text.indexOf(':'), prefix = text.slice(0, colon);
  if (colon < 0 || !/^(0|[1-9][0-9]*)$/.test(prefix)) throw Error('Invalid patch byte length');
  const length = Number(prefix), encoded = text.slice(colon + 1);
  if (!Number.isSafeInteger(length) || length > 4 * 1024 * 1024 || encoded.length !== Math.ceil(length / 4) * 5) throw Error('Invalid patch transport length');
  const bytes = Buffer.alloc(Math.ceil(length / 4) * 4);
  for (let at = 0; at < encoded.length; at += 5) {
    let value = 0;
    for (const ch of encoded.slice(at, at + 5)) {
      const digit = values.get(ch);
      if (digit === undefined) throw Error('Invalid patch transport character');
      value = value * 85 + digit;
    }
    if (value > 0xffffffff) throw Error('Patch transport group exceeds four bytes');
    bytes.writeUInt32BE(value, at / 5 * 4);
  }
  if (bytes.subarray(length).some(byte => byte !== 0)) throw Error('Nonzero patch transport padding');
  return bytes.subarray(0, length);
}

module.exports = { encode85, decode85 };
