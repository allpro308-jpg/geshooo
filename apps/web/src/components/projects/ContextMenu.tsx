import type { ReactNode } from "react";
import { useEffect } from "react";

export type MenuItem =
  | { kind: "item"; label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; onSelect: () => void }
  | { kind: "separator" };

type ContextMenuProps = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  useEffect(() => {
    function handleClick() {
      onClose();
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const style = clampedPosition(x, y);

  return (
    <div
      style={style}
      onMouseDown={(event) => event.stopPropagation()}
      className="fixed z-50 min-w-[180px] overflow-hidden rounded-lg border border-line bg-elevated p-1 shadow-2xl shadow-black/60"
    >
      {items.map((item, index) => {
        if (item.kind === "separator") {
          return <div key={index} className="my-1 h-px bg-hairline" />;
        }
        return (
          <button
            key={index}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? "text-danger hover:bg-danger/10"
                : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            {item.icon ? <span className="shrink-0">{item.icon}</span> : <span className="w-3.5" />}
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function clampedPosition(x: number, y: number) {
  const padding = 8;
  const maxX = (typeof window !== "undefined" ? window.innerWidth : 1200) - 220;
  const maxY = (typeof window !== "undefined" ? window.innerHeight : 800) - 240;
  return {
    left: `${Math.min(Math.max(x, padding), maxX)}px`,
    top: `${Math.min(Math.max(y, padding), maxY)}px`
  };
}
