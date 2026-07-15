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
  className,
  onFocusChange,
  onOverlayChange
}: SearchFilterIslandProps<Value>) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const headingId = useId();
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeOption = options.find((option) => option.value === activeValue);
  const islandClassName = [
    'search-filter-island',
    compact ? 'compact' : 'expanded',
    className
  ].filter(Boolean).join(' ');

  useBodyScrollLock(filtersOpen);

  useEffect(() => {
    onOverlayChange?.(filtersOpen);
    return () => {
      if (filtersOpen) onOverlayChange?.(false);
    };
  }, [filtersOpen, onOverlayChange]);

  useEffect(() => {
    if (!filtersOpen) return;

    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFiltersOpen(false);
      window.requestAnimationFrame(() => filterButtonRef.current?.focus());
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [filtersOpen]);

  function closeFilters(restoreFocus = true) {
    setFiltersOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => filterButtonRef.current?.focus());
    }
  }

  function selectFilter(value: Value) {
    onActiveValueChange(value);
    closeFilters();
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

        <button
          ref={filterButtonRef}
          type="button"
          className="search-filter-button"
          onClick={() => setFiltersOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          aria-label={`${filtersLabel}: ${activeOption?.label ?? activeValue}`}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
          <span>{filtersLabel}</span>
          <strong>{activeOption?.label ?? activeValue}</strong>
        </button>
      </div>

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

      {filtersOpen ? (
        <div
          className="filter-sheet-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeFilters();
          }}
        >
          <section
            className="filter-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby={headingId}
            onKeyDown={trapFocusWithin}
          >
            <header className="filter-sheet-header">
              <div>
                <span>Mostrar por</span>
                <h2 id={headingId}>{filtersLabel}</h2>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                className="filter-sheet-close"
                onClick={() => closeFilters()}
                aria-label="Cerrar filtros"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </header>

            <div className="filter-sheet-options">
              {options.map((option) => {
                const selected = option.value === activeValue;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={selected ? 'filter-sheet-option active' : 'filter-sheet-option'}
                    onClick={() => selectFilter(option.value)}
                    aria-pressed={selected}
                    disabled={option.disabled}
                  >
                    <span>{option.label}</span>
                    {typeof option.count === 'number' ? <small>{option.count}</small> : null}
                    {selected ? <Check size={19} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
