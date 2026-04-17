import React from 'react';
import { NikkeLogo } from './NikkeLogo';
import { MenuIcon } from './Icons';

interface HeaderProps {
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
  className?: string;
  onNavigateToSearch?: () => void;
  onNavigateToStories?: () => void;
  activeNav: 'stories' | 'search';
  themeMode: 'dark' | 'light';
  onToggleTheme: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onToggleSidebar,
  isSidebarOpen,
  className,
  onNavigateToSearch,
  onNavigateToStories,
  activeNav,
  themeMode,
  onToggleTheme,
}) => {
  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onNavigateToSearch) {
      e.preventDefault();
      onNavigateToSearch();
    }
  };

  const navClass = (navKey: 'stories' | 'search') => (
    activeNav === navKey
      ? 'border-b border-nikke-accent pb-1 font-label text-xs uppercase tracking-[0.18em] text-nikke-accent'
      : 'font-label text-xs uppercase tracking-[0.18em] text-nikke-text-secondary transition-colors duration-300 ease-editorial hover:text-nikke-text-primary'
  );

  return (
    <header className={`border-b border-transparent ${className}`}>
      <div className="border-b border-nikke-border/10 bg-nikke-bg/75 backdrop-blur-md shadow-glass">
        <div className="container mx-auto flex items-center justify-between gap-2 px-3 py-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center">
            {onToggleSidebar && (
              <button
                className="mr-2 shrink-0 rounded-full bg-nikke-surface-low/80 p-2 text-nikke-text-primary transition-colors duration-300 ease-editorial hover:bg-nikke-surface-high hover:text-nikke-accent focus:outline-none focus:ring-2 focus:ring-nikke-accent md:hidden"
                onClick={onToggleSidebar}
                aria-label={isSidebarOpen ? 'Close menu' : 'Open menu'}
                aria-expanded={isSidebarOpen}
                aria-controls="sidebar"
              >
                <MenuIcon className="h-6 w-6" />
              </button>
            )}
            <a
              href="#search"
              onClick={handleLogoClick}
              aria-label="Go to search page"
              className="group flex min-w-0 items-center rounded-full pr-1 focus:outline-none focus:ring-2 focus:ring-nikke-accent sm:pr-3"
            >
              <div className="mr-2 shrink-0 rounded-full bg-nikke-surface-high/80 p-2 transition-transform duration-300 ease-editorial group-hover:scale-105 sm:mr-3 sm:p-2.5">
                <NikkeLogo className="h-6 w-6 text-nikke-accent sm:h-7 sm:w-7" />
              </div>
              <div className="min-w-0">
                <p className="hidden font-label text-[11px] uppercase tracking-[0.24em] text-nikke-text-muted sm:block">The Archive Editorial</p>
                <h1 className="truncate font-headline text-sm font-extrabold tracking-[-0.02em] text-nikke-text-primary sm:text-2xl">
                  Nikke Forbidden Library
                </h1>
              </div>
            </a>
          </div>
          <nav className="hidden items-center gap-8 sm:flex">
            <button onClick={onNavigateToStories} className={navClass('stories')} type="button">
              Stories
            </button>
            <button onClick={onNavigateToSearch} className={navClass('search')} type="button">
              Search
            </button>
          </nav>
          <div className="hidden text-right lg:block">
            <p className="font-label text-[11px] uppercase tracking-[0.22em] text-nikke-text-muted">Curated Reading Mode</p>
            <p className="text-sm text-nikke-text-secondary">An editorial archive for reading story chapters and dialogue.</p>
          </div>
          <button
            onClick={onToggleTheme}
            type="button"
            className="flex shrink-0 items-center gap-2 rounded-full bg-nikke-surface-low/85 px-2.5 py-2 text-sm font-semibold text-nikke-text-primary transition-all duration-300 ease-editorial hover:bg-nikke-surface-high focus:outline-none focus:ring-2 focus:ring-nikke-accent sm:px-3"
            aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="hidden font-label text-[11px] uppercase tracking-[0.18em] text-nikke-text-muted sm:inline">
              {themeMode === 'dark' ? 'Dark' : 'Light'}
            </span>
            <span className="rounded-full bg-nikke-gradient px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-950 sm:px-3 sm:text-[11px] sm:tracking-[0.16em]">
              <span className="sm:hidden">{themeMode === 'dark' ? 'Light' : 'Dark'}</span>
              <span className="hidden sm:inline">{themeMode === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
