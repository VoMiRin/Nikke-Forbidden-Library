import React from 'react';
import { NikkeLogo } from './NikkeLogo';
import { MenuIcon, MoonIcon, SunIcon } from './Icons';

interface HeaderProps {
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  className?: string;
  onNavigateToHome?: () => void;
  onNavigateToSearch?: () => void;
  onNavigateToStories?: () => void;
  onNavigateToAiChat?: () => void;
  activeNav: 'stories' | 'search' | 'ai_chat';
  themeMode: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const NAV_ITEMS: { key: 'stories' | 'search' | 'ai_chat'; label: string }[] = [
  { key: 'stories', label: '스토리' },
  { key: 'search', label: '검색' },
  { key: 'ai_chat', label: 'AI 채팅' },
];

export const ArchiveStatus: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`flex items-center gap-2 text-xs text-nikke-text-muted ${className}`}>
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-nikke-accent ring-[3px] ring-nikke-accent/20" />
    관리자 아르카나 · 열람 승인
  </span>
);

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  isSidebarOpen,
  className,
  onNavigateToHome,
  onNavigateToSearch,
  onNavigateToStories,
  onNavigateToAiChat,
  activeNav,
  themeMode,
  onToggleTheme,
}) => {
  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const navigate = onNavigateToHome ?? onNavigateToSearch;
    if (navigate) {
      e.preventDefault();
      navigate();
    }
  };

  const navHandlers = {
    stories: onNavigateToStories,
    search: onNavigateToSearch,
    ai_chat: onNavigateToAiChat,
  };

  return (
    <header className={`border-b border-nikke-border bg-nikke-bg/[0.92] backdrop-blur-md ${className}`}>
      <div className="mx-auto flex min-h-16 max-w-[1320px] items-center gap-x-9 gap-y-2 px-[clamp(16px,3vw,32px)] max-sm:gap-x-1 max-sm:pl-1 max-sm:pr-2">
        <div className="flex min-w-0 items-center gap-2 max-sm:flex-1 max-sm:gap-1">
          {onToggleSidebar && (
            <button
              id="sidebar-toggle"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-nikke-text-primary hover:text-nikke-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent md:hidden"
              onClick={onToggleSidebar}
              aria-label={isSidebarOpen ? '메뉴 닫기' : '메뉴 열기'}
              aria-expanded={isSidebarOpen}
              aria-controls="sidebar"
              type="button"
            >
              <MenuIcon className="h-[22px] w-[22px]" />
            </button>
          )}
          <a
            href="/"
            onClick={handleLogoClick}
            aria-label="금서고 홈"
            className="flex min-w-0 items-center gap-3 rounded-lg text-nikke-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent max-sm:flex-1 max-sm:gap-2.5"
          >
            <NikkeLogo aria-hidden="true" className="h-6 w-4 shrink-0 sm:h-8 sm:w-[22px]" />
            <span className="flex min-w-0 items-baseline gap-2.5">
              <span className="font-headline text-lg font-bold sm:text-xl">금서고</span>
              <span className="hidden truncate text-[13px] text-nikke-text-muted sm:inline">Nikke Forbidden Library</span>
            </span>
          </a>
        </div>
        <nav aria-label="주 메뉴" className="hidden gap-7 self-stretch sm:flex">
          {NAV_ITEMS.map(item => {
            const isActive = activeNav === item.key;
            return (
              <button
                key={item.key}
                onClick={navHandlers[item.key]}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                className={`border-b-2 pb-[19px] pt-[21px] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent ${
                  isActive
                    ? 'border-nikke-accent font-semibold text-nikke-text-primary'
                    : 'border-transparent font-medium text-nikke-text-secondary hover:text-nikke-text-primary'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-4">
          <ArchiveStatus className="hidden lg:flex" />
          <button
            onClick={onToggleTheme}
            type="button"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-nikke-text-secondary hover:border-nikke-accent hover:text-nikke-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent sm:border sm:border-nikke-border-strong"
            aria-label={themeMode === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
          >
            {themeMode === 'dark' ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
    </header>
  );
};
