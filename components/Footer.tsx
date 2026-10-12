import React from 'react';

interface FooterProps {
  className?: string;
}

export const Footer: React.FC<FooterProps> = ({ className }) => {
  return (
    <footer className={`mt-auto border-t border-nikke-border ${className}`}>
      <p className="mx-auto max-w-[1320px] px-[clamp(16px,3vw,32px)] py-7 text-[13px] leading-[1.7] text-nikke-text-muted">
        Nikke Forbidden Library &copy; {new Date().getFullYear()}. All game content and trademarks belong to their respective owners. This fan-made archive is intended for browsing and documentation only.
      </p>
    </footer>
  );
};
