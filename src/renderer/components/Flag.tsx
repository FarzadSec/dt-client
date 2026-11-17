export function Flag({ code }: { code: string }) {
  if (!/^[A-Za-z]{2}$/.test(code)) return <span className="flag flag-empty" aria-hidden />;
  return <span className={`flag fi fi-${code.toLowerCase()}`} aria-hidden />;
}
