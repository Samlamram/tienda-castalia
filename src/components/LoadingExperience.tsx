import { LoaderCircle } from 'lucide-react';
import { BrandLogo } from './BrandLogo';

export interface LoadingExperienceProps {
  label: string;
  detail?: string;
  variant?: 'brand' | 'surface';
  skeleton?: boolean;
}

const skeletonRows = ['primary', 'secondary', 'tertiary'] as const;

export function LoadingExperience({
  label,
  detail,
  variant = 'brand',
  skeleton = false
}: LoadingExperienceProps) {
  return (
    <section
      className={`loading-experience loading-experience--${variant}${
        skeleton ? ' loading-experience--with-skeleton' : ''
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy={true}
    >
      <div className="loading-experience__identity" aria-hidden="true">
        <span className="loading-experience__logo-frame">
          <BrandLogo className="loading-experience__logo" />
        </span>
        <span className="loading-experience__spinner">
          <LoaderCircle size={22} strokeWidth={2.25} />
        </span>
      </div>

      <div className="loading-experience__copy">
        <strong className="loading-experience__label">{label}</strong>
        {detail ? <p className="loading-experience__detail">{detail}</p> : null}
      </div>

      {skeleton ? (
        <div className="loading-experience__skeleton" aria-hidden="true">
          <span className="loading-experience__skeleton-heading" />
          <span className="loading-experience__skeleton-subheading" />
          <div className="loading-experience__skeleton-grid">
            {skeletonRows.map((row) => (
              <span className={`loading-experience__skeleton-card loading-experience__skeleton-card--${row}`} key={row}>
                <span className="loading-experience__skeleton-media" />
                <span className="loading-experience__skeleton-line" />
                <span className="loading-experience__skeleton-line loading-experience__skeleton-line--short" />
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
