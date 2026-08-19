import { useState, useEffect, useRef } from "react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ShortcutItem {
  keys: string[];
  description: string;
  category: "Playback" | "Volume & Audio" | "Navigation & Search" | "General";
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: ["Space", "K"], description: "Play / Pause toggle", category: "Playback" },
  { keys: ["Shift + →", "N"], description: "Next track", category: "Playback" },
  { keys: ["Shift + ←", "P"], description: "Previous track / Restart", category: "Playback" },
  { keys: ["→"], description: "Seek forward 5 seconds", category: "Playback" },
  { keys: ["←"], description: "Seek backward 5 seconds", category: "Playback" },
  { keys: ["L"], description: "Seek forward 10 seconds", category: "Playback" },
  { keys: ["J"], description: "Seek backward 10 seconds", category: "Playback" },
  { keys: ["S"], description: "Toggle shuffle mode", category: "Playback" },
  { keys: ["R"], description: "Cycle repeat mode (Off / All / One)", category: "Playback" },

  { keys: ["↑"], description: "Volume up (+5%)", category: "Volume & Audio" },
  { keys: ["↓"], description: "Volume down (-5%)", category: "Volume & Audio" },
  { keys: ["M"], description: "Mute / Unmute audio", category: "Volume & Audio" },

  { keys: ["/", "Ctrl + F"], description: "Focus library search", category: "Navigation & Search" },
  { keys: ["F"], description: "Favorite / Unfavorite current track", category: "Navigation & Search" },
  { keys: ["Esc"], description: "Clear search / Close modal", category: "Navigation & Search" },

  { keys: ["?"], description: "Open shortcuts cheat sheet", category: "General" },
  { keys: ["H"], description: "Toggle shortcuts help", category: "General" },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const [search, setSearch] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const filtered = search.trim()
    ? SHORTCUTS.filter(
        (s) =>
          s.description.toLowerCase().includes(search.toLowerCase()) ||
          s.keys.some((k) => k.toLowerCase().includes(search.toLowerCase())) ||
          s.category.toLowerCase().includes(search.toLowerCase())
      )
    : SHORTCUTS;

  const categories = Array.from(new Set(filtered.map((s) => s.category)));

  return (
    <div
      className="shortcuts-modal-overlay"
      onClick={(e) => {
        if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
          onClose();
        }
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="shortcuts-modal-card" ref={modalRef}>
        <header className="shortcuts-modal-header">
          <div className="flex items-center gap-2.5">
            <div className="shortcuts-icon-box">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 5H4c-1.1 0-1.99.9-1.99 2L2 17c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-9 3h2v2h-2V8zm0 3h2v2h-2v-2zM8 8h2v2H8V8zm0 3h2v2H8v-2zm-1 2H5v-2h2v2zm0-3H5V8h2v2zm9 7H8v-2h8v2zm0-4h-2v-2h2v2zm0-3h-2V8h2v2zm3 3h-2v-2h2v2zm0-3h-2V8h2v2z" />
              </svg>
            </div>
            <div>
              <h2 id="shortcuts-title" className="text-base font-semibold tracking-tight text-text">
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-text-faint">Speed up your flow with instant hotkeys</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shortcuts-close-btn"
            title="Close (Esc)"
            aria-label="Close shortcuts modal"
          >
            &times;
          </button>
        </header>

        <div className="shortcuts-search-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter shortcuts..."
            className="shortcuts-search-input"
            autoFocus
          />
        </div>

        <div className="shortcuts-list-container">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-xs text-text-faint">No shortcuts found</p>
          ) : (
            categories.map((category) => (
              <div key={category} className="shortcuts-category-section">
                <h3 className="shortcuts-category-title">{category}</h3>
                <div className="shortcuts-grid">
                  {filtered
                    .filter((s) => s.category === category)
                    .map((shortcut, idx) => (
                      <div key={idx} className="shortcut-row">
                        <span className="shortcut-desc">{shortcut.description}</span>
                        <div className="shortcut-keys">
                          {shortcut.keys.map((key, kIdx) => (
                            <span key={kIdx} className="flex items-center gap-1">
                              {kIdx > 0 && <span className="text-[10px] text-text-faint">or</span>}
                              <kbd className="kbd-badge">{key}</kbd>
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            ))
          )}
        </div>

        <footer className="shortcuts-modal-footer">
          <span className="text-xs text-text-faint">
            Tip: Press <kbd className="kbd-badge text-[10px]">?</kbd> anywhere to open this dialog
          </span>
          <button onClick={onClose} className="shortcuts-done-btn">
            Got it
          </button>
        </footer>
      </div>
    </div>
  );
}
