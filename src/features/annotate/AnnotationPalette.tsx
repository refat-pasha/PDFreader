import { Check, Highlighter, Minus, PenLine, X } from "lucide-react";
import type { Tool } from "../../types";
import { DEFAULT_COLORS, HIGHLIGHT_COLORS } from "./model";

type Props = {
  tool: Tool;
  color: string;
  width: number;
  opacity: number;
  onColor: (color: string) => void;
  onWidth: (width: number) => void;
  onOpacity: (opacity: number) => void;
  onClose: () => void;
};

const penSizes = [
  { value: 1, label: "Thin" },
  { value: 2, label: "Regular" },
  { value: 4, label: "Bold" },
  { value: 6, label: "Heavy" },
  { value: 10, label: "Marker" },
];

const highlighterSizes = [
  { value: 8, label: "Thin" },
  { value: 12, label: "Regular" },
  { value: 18, label: "Broad" },
  { value: 26, label: "Wide" },
  { value: 36, label: "Marker" },
];

export function AnnotationPalette({
  tool,
  color,
  width,
  opacity,
  onColor,
  onWidth,
  onOpacity,
  onClose,
}: Props) {
  const isHighlighter = tool === "highlighter";
  const colors = isHighlighter ? [...HIGHLIGHT_COLORS, ...DEFAULT_COLORS.filter((c) => !HIGHLIGHT_COLORS.includes(c))] : DEFAULT_COLORS;
  const sizes = isHighlighter ? highlighterSizes : penSizes;

  return (
    <div
      className="floating-palette"
      role="dialog"
      aria-label={`${tool} settings`}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="palette-header">
        <span className="palette-title">
          {isHighlighter ? <Highlighter size={14} /> : <PenLine size={14} />}
          {isHighlighter ? "Highlighter" : "Pen"}
        </span>
        <button className="icon-button" aria-label="Close tool settings" onClick={onClose}>
          <X size={15} />
        </button>
      </div>
      <div className="palette-body">
        <p className="palette-section-label">Size</p>
        <div className="size-options" role="group" aria-label="Stroke size">
          {sizes.map((size) => (
            <button
              key={size.value}
              className="size-option"
              aria-label={`${size.label} stroke, ${size.value} points`}
              aria-pressed={width === size.value}
              title={size.label}
              onClick={() => onWidth(size.value)}
            >
              <span
                className="size-dot"
                style={{
                  width: 21,
                  height: Math.max(1.5, Math.min(4, size.value / 2.5)),
                  borderRadius: 99,
                  background: width === size.value ? "var(--accent-strong)" : "var(--text-secondary)",
                }}
              />
            </button>
          ))}
        </div>
        <p className="palette-section-label">Color</p>
        <div className="color-grid" role="group" aria-label="Stroke color">
          {colors.slice(0, 20).map((swatch) => (
            <button
              key={swatch}
              className="swatch"
              style={{ backgroundColor: swatch }}
              aria-label={`Color ${swatch}`}
              aria-pressed={color === swatch}
              onClick={() => onColor(swatch)}
            >
              {color === swatch && (
                <span className="swatch-check">
                  <Check size={9} strokeWidth={3} />
                </span>
              )}
            </button>
          ))}
        </div>
        <p className="palette-tip" style={{ marginTop: 9 }}>
          Pick a size and color, then draw on the page. Esc returns to selection.
        </p>
      </div>
      <div className="palette-footer">
        <label>
          Opacity
          <input
            type="range"
            min="20"
            max="100"
            step="5"
            value={Math.round(opacity * 100)}
            onChange={(event) => onOpacity(Number(event.target.value) / 100)}
          />
          <span>{Math.round(opacity * 100)}%</span>
        </label>
        <button className="button-secondary" style={{ minHeight: 26, padding: "3px 8px", fontSize: 11 }} onClick={onClose}>
          <Minus size={11} /> Hide
        </button>
      </div>
    </div>
  );
}
