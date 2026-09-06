export function FillGapsIcon({ max = false }: { readonly max?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="3.5" width="16" height="17" rx="1.5" />
      <path d="M6 7h4v5H6zM6 15h4v2H6z" />
      {!max && <path d="M13 15h2v2h-2z" />}
      <path d="M14 7h4v4h-4zM22 9h-3M21 7l-2 2 2 2" />
      {max ? <path className="fill-gaps-max-mark" strokeWidth="2" d="M12 16l3-3 3 3M12 20l3-3 3 3" /> : null}
    </svg>
  );
}
