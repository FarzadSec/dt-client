// A site the user locks, as a plain host name.
const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

// What the user typed (a name, a link, "*.site.com") as a host name, or null.
export function siteName(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s === '') return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '');
  s = s.split(/[/?#:\s]/)[0].replace(/\.$/, '');
  if (s.startsWith('www.')) s = s.slice(4);
  if (s.length > 200 || !s.includes('.')) return null;
  return s.split('.').every((l) => label.test(l)) && !/^\d+(\.\d+)*$/.test(s) ? s : null;
}

