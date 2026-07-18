import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppToast } from './AppToast';

describe('AppToast', () => {
  afterEach(cleanup);

  it('respeta un tono explícito aunque el texto contenga palabras de error', () => {
    render(
      <AppToast
        message="No se pudo enviar todavía; la compra sigue pendiente."
        tone="warning"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('status')).toHaveClass('app-toast--warning');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
