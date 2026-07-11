interface BrandLogoProps {
  alt?: string;
  className?: string;
}

export function BrandLogo({ alt = '', className = '' }: BrandLogoProps) {
  return (
    <img
      src="/brand/castalia-mark-192.png"
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={`brand-logo${className ? ` ${className}` : ''}`}
      draggable={false}
    />
  );
}
