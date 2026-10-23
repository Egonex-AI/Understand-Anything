import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface SearchableSelectOption {
  value: string;
  label: string;
  meta?: string;
  searchText?: string;
}

interface SearchableSelectProps {
  value: string;
  options: SearchableSelectOption[];
  placeholder: string;
  onChange: (value: string) => void;
}

export default function SearchableSelect({
  value,
  options,
  placeholder,
  onChange,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;

    return options.filter((option) => {
      const haystack = `${option.label} ${option.meta ?? ""} ${option.searchText ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    });
  }, [options, query]);

  const updatePosition = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    const dropdownMaxH = 256;
    const openUpward = spaceBelow < dropdownMaxH && rect.top > dropdownMaxH;
    setDropdownStyle(
      openUpward
        ? { position: "fixed", bottom: window.innerHeight - rect.top + 4, left: rect.left, width: rect.width }
        : { position: "fixed", top: rect.bottom + 4, left: rect.left, width: rect.width },
    );
  };

  useEffect(() => {
    if (!open) return;
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest("[data-searchable-select-dropdown]")) {
        return;
      }
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    };

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, []);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <div ref={containerRef} className="relative" data-searchable-select>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={open ? query : selected?.label ?? ""}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          placeholder={placeholder}
          className="w-full bg-elevated text-text-primary text-sm rounded-lg px-3 py-2 pr-9 border border-border-subtle focus:outline-none focus:border-gold/50 placeholder-text-muted"
        />
        <button
          type="button"
          onClick={() => {
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
          aria-label="Toggle options"
        >
          <svg
            className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {open &&
        createPortal(
          <div
            role="listbox"
            data-searchable-select-dropdown
            style={dropdownStyle}
            className="z-[9999] max-h-64 overflow-y-auto glass rounded-lg shadow-xl"
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-sm text-text-muted">No matches found</div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => selectOption(option.value)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                    option.value === value
                      ? "bg-gold/10 text-gold"
                      : "text-text-primary hover:bg-elevated"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{option.label}</span>
                  {option.meta && (
                    <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {option.meta}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
