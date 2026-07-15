import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchFilterIsland } from './SearchFilterIsland';

const options = [
  { value: 'all', label: 'Todos' },
  { value: 'food', label: 'Comida' },
] as const;

describe('SearchFilterIsland', () => {
  afterEach(() => {
    document.documentElement.classList.remove('modal-scroll-locked');
    document.body.classList.remove('modal-scroll-locked');
  });

  it('conserva la consulta y permite limpiarla', () => {
    const onQueryChange = vi.fn();
    render(
      <SearchFilterIsland
        query="cafe"
        onQueryChange={onQueryChange}
        options={options}
        activeValue="all"
        onActiveValueChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('searchbox')).toHaveValue('cafe');
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar busqueda' }));
    expect(onQueryChange).toHaveBeenCalledWith('');
  });

  it('aplica categorias desde chips y desde el bottom sheet compacto', () => {
    const onActiveValueChange = vi.fn();
    render(
      <SearchFilterIsland
        query=""
        onQueryChange={vi.fn()}
        options={options}
        activeValue="all"
        onActiveValueChange={onActiveValueChange}
        compact
        filtersLabel="Categorias"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Comida' }));
    expect(onActiveValueChange).toHaveBeenCalledWith('food');

    fireEvent.click(screen.getByRole('button', { name: 'Categorias: Todos' }));
    expect(screen.getByRole('dialog', { name: 'Categorias' })).toBeInTheDocument();

    const dialog = screen.getByRole('dialog', { name: 'Categorias' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Comida' }));
    expect(onActiveValueChange).toHaveBeenLastCalledWith('food');
    expect(screen.queryByRole('dialog', { name: 'Categorias' })).not.toBeInTheDocument();
  });
});
