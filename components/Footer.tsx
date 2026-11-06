import React from 'react';
import { SITE_NAME } from '../lib/seo.mjs';

interface FooterProps {
  className?: string;
}

export const Footer: React.FC<FooterProps> = ({ className }) => {
  return (
    <footer className={`mt-auto border-t border-nikke-border ${className}`}>
      <p className="mx-auto max-w-[1320px] px-[clamp(16px,3vw,32px)] py-7 text-[13px] leading-[1.7] text-nikke-text-muted">
        {SITE_NAME} &copy; {new Date().getFullYear()}. 모든 게임 콘텐츠와 상표의 권리는 각 권리자에게 있습니다. 이 사이트는 열람과 기록을 목적으로 만든 팬 사이트입니다.
      </p>
    </footer>
  );
};
