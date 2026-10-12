import React from 'react';
import { AiAskPanel } from './AiAskPanel';

export const AiChatPage: React.FC = () => (
  <div className="max-w-[820px]">
    <h1 className="font-headline text-[clamp(36px,4.4vw,52px)] font-extrabold leading-[1.1] tracking-[-0.02em] text-nikke-text-primary">
      기록 질의
    </h1>
    <p className="mt-3 text-[15px] text-nikke-text-secondary">
      스토리 아카이브를 근거로 답하고, 참고한 기록을 함께 표시합니다.
    </p>
    <AiAskPanel />
  </div>
);
