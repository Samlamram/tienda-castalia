import { Check, Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';

function trapFocusWithin(event: ReactKeyboardEvent<HTMLElement>) {
  if (event.key !== 'Tab') return;

  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])')
  ).filter((element) => !element.hidden);
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface SearchFilterOption<Value extends string = string> {
  value: Value;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface SearchFilterIslandProps<Value extends string = string> {
  query: string;
  onQueryChange: (query: string) => void;
  options: readonly SearchFilterOption<Value>[];
  activeValue: Value;
  onActiveValueChange: (value: Value) => void;
  placeholder?: string;
  searchLabel?: string;
  filtersLabel?: string;
  compact?: boolean;
  className?: string;
  onFocusChange?: (focused: boolean) => void;
  onOverlayChange?: (open: boolean) => void;
  hideOnScroll?: boolean;
  showFilters?: boolean;
}

export function SearchFilterIsland<Value extends string>({
  query,
  onQueryChange,
  options,
  activeValue,
  onActiveValueChange,
  placeholder = 'Buscar...',
  searchLabel = 'Buscar',
  filtersLabel = 'Filtros',
  compact = false,
  showFilters = true,
  className,
  onFocusChange,
  onOverlayChange
}: SearchFilterIslandProps<Value>) {
  const [filterOpen, setFilterOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const activeOption = options.find((option) => option.value === activeValue);
  const islandClassName = [
    'search-filter-island',
    compact ? 'compact' : 'expanded',
    className
  ].filter(Boolean).join(' ');

  useBodyScrollLock(filterOpen);

  useEffect(() => {
    onOverlayChange?.(filterOpen);
    if (!filterOpen) return;

    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus());
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFilterOpen(false);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [filterOpen, onOverlayChange]);

  function selectOption(value: Value) {
    onActiveValueChange(value);
    setFilterOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <section className={islandClassName} aria-label={`${searchLabel} y ${filtersLabel.toLowerCase()}`}>
      <div className="search-filter-row">
        <div className="search-filter-field">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => onFocusChange?.(false)}
            placeholder={placeholder}
            aria-label={searchLabel}
          />
          {query ? (
            <button
              type="button"
              className="search-clear-button"
              onClick={() => onQueryChange('')}
              aria-label="Limpiar busqueda"
            >
              <X size={17} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        {showFilters !== false ? (
          <button
            ref={triggerRef}
            type="button"
            className="search-filter-button"
            onClick={() => setFilterOpen(true)}
            aria-label={`${filtersLabel}: ${activeOption?.label ?? ''}`}
            aria-haspopup="dialog"
            aria-expanded={filterOpen}
          >
            <SlidersHorizontal size={17} aria-hidden="true" />
            <span>{filtersLabel}</span>
            <strong>{activeOption?.label}</strong>
          </button>
        ) : null}
      </div>

      {/* Filter chips displayed directly below the search field */}
      {showFilters !== false && (
        <div className="search-filter-chips" aria-label={filtersLabel}>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={option.value === activeValue ? 'search-filter-chip active' : 'search-filter-chip'}
              onClick={() => onActiveValueChange(option.value)}
              aria-pressed={option.value === activeValue}
              disabled={option.disabled}
            >
              <span>{option.label}</span>
              {typeof option.count === 'number' ? <small>{option.count}</small> : null}
            </button>
          ))}
        </div>
      )}

      {filterOpen ? (
        <div
          className="filter-sheet-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target !== event.currentTarget) return;
            setFilterOpen(false);
            window.requestAnimationFrame(() => triggerRef.current?.focus());
          }}
        >
          <section
            className="filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={filtersLabel}
            onKeyDown={trapFocusWithin}
          >
            <header className="filter-sheet-header">
              <div>
                <span>Filtrar por</span>
                <h2>{filtersLabel}</h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="filter-sheet-close"
                onClick={() => {
                  setFilterOpen(false);
                  window.requestAnimationFrame(() => triggerRef.current?.focus());
                }}
                aria-label="Cerrar filtros"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </header>
            <div className="filter-sheet-options">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={option.value === activeValue ? 'filter-sheet-option active' : 'filter-sheet-option'}
                  onClick={() => selectOption(option.value)}
                  disabled={option.disabled}
                  aria-pressed={option.value === activeValue}
                >
                  <span>{option.label}</span>
                  {typeof option.count === 'number' ? <small>{option.count}</small> : null}
                  {option.value === activeValue ? <Check size={18} aria-hidden="true" /> : null}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
