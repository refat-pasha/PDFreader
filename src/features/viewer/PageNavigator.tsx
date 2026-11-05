import { useEffect, useState } from "react";

type Props = {
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
};

export function PageNavigator({ page, pageCount, onChange }: Props) {
  const [value, setValue] = useState(String(page));

  useEffect(() => setValue(String(page)), [page]);

  const commit = () => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
      setValue(String(page));
      return;
    }
    const next = Math.min(pageCount, Math.max(1, parsed));
    setValue(String(next));
    onChange(next);
  };

  return (
    <div className="pane-navigation">
      <input
        className="pane-page-box"
        aria-label="Current page"
        value={value}
        inputMode="numeric"
        onChange={(event) => setValue(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
            (event.currentTarget as HTMLInputElement).blur();
          }
        }}
      />
      <span className="pane-page-total">/ {pageCount}</span>
      <button
        className="icon-button"
        aria-label="Previous page"
        title="Previous page (PageUp)"
        disabled={page <= 1}
        onClick={() => onChange(Math.max(1, page - 1))}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
      </button>
      <button
        className="icon-button"
        aria-label="Next page"
        title="Next page (PageDown)"
        disabled={page >= pageCount}
        onClick={() => onChange(Math.min(pageCount, page + 1))}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
      </button>
    </div>
  );
}
