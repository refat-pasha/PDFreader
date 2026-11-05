import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { filterCommands, shortcutLabel, type Command } from "./commands";
import { useUi } from "./uiStore";
import { useModalFocus } from "./useModalFocus";

export function CommandPalette({
  commands,
  onClose,
}: {
  commands: Command[];
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => filterCommands(commands, query).slice(0, 9), [commands, query]);
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => setIndex(0), [query]);

  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal command-dialog" role="dialog" aria-modal="true" aria-label="Command palette" ref={dialogRef} tabIndex={-1}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <Search size={16} style={{ marginLeft: 14, color: "var(--text-muted)" }} />
          <input
            ref={inputRef}
            className="command-input"
            placeholder="Type a command…"
            aria-label="Search commands"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              else if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => Math.min(matches.length - 1, current + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => Math.max(0, current - 1));
              } else if (event.key === "Enter" && matches[index]) {
                event.preventDefault();
                onClose();
                matches[index].run();
              }
            }}
          />
          <button className="icon-button" style={{ marginRight: 10 }} aria-label="Close command palette" onClick={onClose}>
            <X size={15} />
          </button>
        </div>
        <div className="command-list" role="listbox" aria-label="Commands">
          {matches.length === 0 && <div className="command-empty">No commands match “{query}”.</div>}
          {matches.map((command, commandIndex) => (
            <button
              key={command.id}
              className="command-item"
              role="option"
              aria-selected={commandIndex === index}
              onMouseEnter={() => setIndex(commandIndex)}
              onClick={() => { onClose(); command.run(); }}
            >
              <span>{command.label}</span>
              {command.shortcut && <span className="command-shortcut">{shortcutLabel(command.shortcut)}</span>}
            </button>
          ))}
        </div>
        <div className="command-footer">
          <span>Enter to run</span><span>Esc to close</span><span>↑ ↓ to navigate</span>
        </div>
      </div>
    </div>
  );
}

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  const dialogRef = useModalFocus<HTMLDivElement>(onClose);
  const shortcuts: Array<[string, string]> = [
    ["Open / Save / Save As", "Ctrl+O / Ctrl+S / Ctrl+Shift+S"],
    ["Find / Go to page", "Ctrl+F / Ctrl+G"],
    ["Export / Print", "Ctrl+Shift+E / Ctrl+P"],
    ["Previous / next page", "Page Up / Page Down"],
    ["First / last page", "Ctrl+Home / Ctrl+End"],
    ["Zoom out / in / reset", "Ctrl+- / Ctrl++ / Ctrl+0"],
    ["Fit width / fit page", "Ctrl+1 / Ctrl+2"],
    ["Next / previous pane", "Ctrl+Tab / Ctrl+Shift+Tab"],
    ["Focus pane 1–4", "Alt+1 … Alt+4"],
    ["Split pane", "Ctrl+\\"],
    ["Close document", "Ctrl+W"],
    ["Undo / redo", "Ctrl+Z / Ctrl+Y"],
    ["Select / pen / highlighter", "V / D / H"],
    ["Note / text / rectangle", "N / T / M"],
    ["Leave tool / close dialog", "Esc"],
    ["Command palette", "Ctrl+K"],
    ["Shortcut help", "F1"],
    ["Distraction-free reading", "F11"],
  ];
  return (
    <div className="modal-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id="shortcuts-title">Keyboard shortcuts</h2>
            <p className="modal-description">Actions apply to the focused pane.</p>
          </div>
          <button className="icon-button" aria-label="Close shortcuts" onClick={onClose}><X size={17} /></button>
        </div>
        <div className="modal-content">
          <dl className="shortcut-grid">
            {shortcuts.map(([label, value]) => (
              <div key={label} style={{ display: "contents" }}>
                <dt>{label}</dt><dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
