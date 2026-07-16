import { Search, X } from 'lucide-react';

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
  onFocusChange
}: SearchFilterIslandProps<Value>) {
  const islandClassName = [
    'search-filter-island',
    compact ? 'compact' : 'expanded',
    className
  ].filter(Boolean).join(' ');

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
