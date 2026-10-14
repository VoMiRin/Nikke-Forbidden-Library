import React from 'react';
import { AiAskPanel } from './AiAskPanel';

interface AiChatPageProps {
  onNavigateToSearch?: () => void;
}

export const AiChatPage: React.FC<AiChatPageProps> = ({ onNavigateToSearch }) => (
  <div className="max-w-[820px]">
    <h1 className="font-headline text-[clamp(36px,4.4vw,52px)] font-bold leading-[1.1] tracking-[-0.01em] text-nikke-text-primary">
      기록 질의
    </h1>
    <p className="mt-3 text-[15px] text-nikke-text-secondary">
      스토리 아카이브를 근거로 답하고, 참고한 기록을 함께 표시합니다.
    </p>
    {/* AI 호출은 느리고 한도가 있으므로, 단순 찾기는 즉시 결과가 나오는 검색으로 안내한다 */}
    {onNavigateToSearch && (
      <p className="mt-2 text-sm leading-[1.7] text-nikke-text-muted">
        특정 대사나 화자를 찾을 때는{' '}
        <button
          type="button"
          onClick={onNavigateToSearch}
          className="font-medium text-nikke-highlight underline underline-offset-4 hover:text-nikke-accent-strong"
        >
          기록 검색
        </button>
        이 기다림 없이 바로 결과를 보여 줍니다. AI 질의는 줄거리 요약이나 인물·세계관 맥락을 물을 때 활용해 주세요.
      </p>
    )}
    <AiAskPanel />
  </div>
);
