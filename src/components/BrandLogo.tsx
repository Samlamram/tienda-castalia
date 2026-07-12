interface BrandLogoProps {
  alt?: string;
  className?: string;
  variant?: 'app' | 'login';
}

const logoSources = {
  app: '/brand/castalia-mark-192.png',
  login: '/brand/castalia-login-mark.png'
};

export function BrandLogo({ alt = '', className = '', variant = 'app' }: BrandLogoProps) {
  return (
    <img
      src={logoSources[variant]}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      className={`brand-logo${className ? ` ${className}` : ''}`}
      draggable={false}
    />
  );
}
