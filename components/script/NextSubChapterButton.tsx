import React from 'react';
import { ArrowRightIcon, FourPointStarIcon } from '../Icons';

interface NextSubChapterButtonProps {
  buttonText: string;
  onNavigate: () => void;
}

export const NextSubChapterButton: React.FC<NextSubChapterButtonProps> = ({ buttonText, onNavigate }) => {
  return (
    <div className="mb-4">
      <div role="separator" className="mb-10 mt-12 flex justify-center text-nikke-border-strong">
        <FourPointStarIcon aria-hidden="true" className="h-3.5 w-3.5" />
      </div>
      <div className="flex justify-center">
        <button
          onClick={onNavigate}
          className="inline-flex min-h-14 items-center gap-3.5 rounded-[10px] bg-nikke-accent px-7 font-sans text-base font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent focus-visible:ring-offset-2 focus-visible:ring-offset-nikke-bg"
          aria-label={`다음 장면: ${buttonText}`}
        >
          {buttonText}
          <ArrowRightIcon aria-hidden="true" className="h-[18px] w-[18px]" />
        </button>
      </div>
    </div>
  );
};

export interface BranchRouteButton {
  /** 예: "A 선택 시", "그 외" */
  label: string;
  targetScriptId: string;
  /** 넘어가는 장면 이름 (예: "03 여학교의 함정") */
  destination?: string;
}

interface BranchNextButtonsProps {
  buttonText: string;
  routes: BranchRouteButton[];
  onNavigate: (targetScriptId: string) => void;
}

/** 모든 분기 보기에서, 고른 선택지에 따라 다음 장면이 달라질 때 경우별 이동 버튼을 모두 보여 준다 */
export const BranchNextButtons: React.FC<BranchNextButtonsProps> = ({ buttonText, routes, onNavigate }) => (
  <div className="mb-4">
    <div role="separator" className="mb-10 mt-12 flex justify-center text-nikke-border-strong">
      <FourPointStarIcon aria-hidden="true" className="h-3.5 w-3.5" />
    </div>
    <p className="mb-4 text-center font-sans text-[13px] text-nikke-text-muted">고른 선택지에 따라 다음 장면이 달라집니다</p>
    <ul className="mx-auto flex max-w-lg flex-col gap-2 font-sans">
      {routes.map(route => (
        <li key={`${route.label}-${route.targetScriptId}`}>
          <button
            type="button"
            onClick={() => onNavigate(route.targetScriptId)}
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[10px] border border-nikke-border-strong px-4 text-left text-[15px] text-nikke-text-primary hover:border-nikke-accent hover:bg-nikke-accent/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-nikke-accent"
            aria-label={`${route.label}: ${route.destination ?? buttonText}`}
          >
            <span className="flex min-w-0 flex-col py-2">
              <span className="truncate text-xs font-semibold text-nikke-accent">{route.label}</span>
              <span className="truncate">{route.destination ?? buttonText}</span>
            </span>
            <ArrowRightIcon aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-nikke-text-muted" />
          </button>
        </li>
      ))}
    </ul>
  </div>
);
