interface BrandLogoProps {
  alt?: string;
  className?: string;
}

const logoSource = '/brand/logo.png';

export function BrandLogo({ alt = '', className = '' }: BrandLogoProps) {
  return (
    <img
      src={logoSource}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={`brand-logo${className ? ` ${className}` : ''}`}
      draggable={false}
    />
  );
}
