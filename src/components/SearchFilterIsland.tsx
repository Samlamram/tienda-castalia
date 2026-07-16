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
  const activeOption = options.find((option) => option.value === activeValue);
  const islandClassName = [
    'search-filter-island',
    compact ? 'compact' : 'expanded',
    className
  ].filter(Boolean).join(' ');

  // No modal overlay needed; removed scroll lock and overlay effect.

// Removed focus management for modal filter sheet.

// No modal filter actions required.

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
    </section>
  );
}
