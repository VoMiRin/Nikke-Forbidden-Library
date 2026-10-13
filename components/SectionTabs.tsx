import React from 'react';
import { followInApp } from '../lib/linkNavigation';
import type { SectionSummary } from '../lib/sections';

interface SectionTabsProps {
  sections: SectionSummary[];
  activeSection: string;
  hrefFor: (section: string) => string;
  onSelect: (section: string) => void;
  /** 'sm'은 사이드바처럼 좁은 곳에서 쓴다 */
  size?: 'md' | 'sm';
  label?: string;
}

const formatCount = (value: number) => value.toLocaleString('ko-KR');

/** 분류 안의 소분류(예: 개인/단체방)를 고르는 탭 */
export const SectionTabs: React.FC<SectionTabsProps> = ({ sections, activeSection, hrefFor, onSelect, size = 'md', label = '소분류' }) => (
  <nav aria-label={label}>
    <ul className={`flex gap-1 rounded-lg border border-nikke-border bg-nikke-surface p-1 ${size === 'md' ? 'w-fit max-sm:w-full' : 'w-full'}`}>
      {sections.map(section => {
        const isActive = section.name === activeSection;
        return (
          <li key={section.name} className={size === 'md' ? 'max-sm:flex-1' : 'flex-1'}>
            <a
              href={hrefFor(section.name)}
              onClick={event => followInApp(event, () => onSelect(section.name))}
              aria-current={isActive ? 'page' : undefined}
              className={`flex items-baseline justify-center gap-2 rounded-md font-semibold transition-colors duration-150 ${
                size === 'md' ? 'min-h-11 px-5 py-2.5 text-[15px]' : 'min-h-9 px-3 py-2 text-[13px]'
              } ${
                isActive
                  ? 'bg-nikke-accent text-nikke-accent-ink'
                  : 'text-nikke-text-secondary hover:bg-nikke-bg hover:text-nikke-text-primary'
              }`}
            >
              {section.name}
              <span className={`font-mono text-xs font-normal ${isActive ? 'opacity-80' : 'text-nikke-text-muted'}`}>
                {formatCount(section.titleCount)}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  </nav>
);
