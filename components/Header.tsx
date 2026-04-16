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
        <div className="container mx-auto flex items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center">
            {onToggleSidebar && (
              <button
                className="mr-2 rounded-full bg-nikke-surface-low/80 p-2 text-nikke-text-primary transition-colors duration-300 ease-editorial hover:bg-nikke-surface-high hover:text-nikke-accent focus:outline-none focus:ring-2 focus:ring-nikke-accent md:hidden"
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
              className="group flex items-center rounded-full pr-3 focus:outline-none focus:ring-2 focus:ring-nikke-accent"
            >
              <div className="mr-3 rounded-full bg-nikke-surface-high/80 p-2.5 transition-transform duration-300 ease-editorial group-hover:scale-105">
                <NikkeLogo className="h-7 w-7 text-nikke-accent" />
              </div>
              <div>
                <p className="font-label text-[11px] uppercase tracking-[0.24em] text-nikke-text-muted">The Archive Editorial</p>
                <h1 className="font-headline text-lg font-extrabold tracking-[-0.02em] text-nikke-text-primary sm:text-2xl">
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
            className="flex items-center gap-2 rounded-full bg-nikke-surface-low/85 px-3 py-2 text-sm font-semibold text-nikke-text-primary transition-all duration-300 ease-editorial hover:bg-nikke-surface-high focus:outline-none focus:ring-2 focus:ring-nikke-accent"
            aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <span className="font-label text-[11px] uppercase tracking-[0.18em] text-nikke-text-muted">
              {themeMode === 'dark' ? 'Dark' : 'Light'}
            </span>
            <span className="rounded-full bg-nikke-gradient px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-950">
              {themeMode === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
