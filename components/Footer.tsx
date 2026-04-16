import React from 'react';

interface FooterProps {
  className?: string;
}

export const Footer: React.FC<FooterProps> = ({ className }) => {
  return (
    <footer className={`mt-auto ${className}`}>
      <div className="border-t border-nikke-border/10 bg-nikke-bg/75 backdrop-blur-md">
        <div className="container mx-auto px-4 py-5 text-center sm:px-6">
          <p className="font-label text-[11px] uppercase tracking-[0.2em] text-nikke-text-muted">
            The Archive Editorial
          </p>
          <p className="mt-2 text-sm text-nikke-text-secondary">
            Nikke Forbidden Library &copy; {new Date().getFullYear()}. All game content and trademarks belong to their respective owners.
          </p>
          <p className="mt-1 text-xs text-nikke-text-muted">
            This fan-made archive is intended for browsing and documentation only.
          </p>
        </div>
      </div>
    </footer>
  );
};
