import React from 'react';
import { AiAskPanel } from './AiAskPanel';

export const AiChatPage: React.FC = () => (
  <div className="mx-auto flex h-full w-full max-w-[1024px] flex-col pb-8 md:pb-10">
    <header className="mb-6 xl:mb-8">
      <p className="font-label text-[11px] uppercase tracking-[0.24em] text-nikke-accent">AI Chat</p>
      <h2 className="mt-2 font-headline text-3xl font-extrabold tracking-[-0.04em] text-nikke-text-primary sm:text-4xl lg:text-5xl xl:mt-3 xl:text-6xl">
        Archive Conversation
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-nikke-text-secondary md:text-base md:leading-7">
        스토리 아카이브를 근거로 질문하고, 관련 문서 출처를 함께 확인합니다.
      </p>
    </header>
    <AiAskPanel />
  </div>
);
