import React from 'react';
import type { DialogueElement } from '../../types';
import { SPEAKER_COLORS } from '../../lib/speakerColors';

interface DialogueRendererProps {
  element: DialogueElement;
}

const COMMANDER_SPEAKERS = new Set(['COMMANDER', '지휘관']);

export const DialogueRenderer: React.FC<DialogueRendererProps> = ({ element }) => {
  const speaker = element.speaker;
  const isCommander = !!speaker && COMMANDER_SPEAKERS.has(speaker.trim().toUpperCase());
  // 니케는 인게임 기본색, 지휘관은 강조색, 그 밖의 화자(NPC 등)는 중립색 막대
  const speakerColor = speaker ? SPEAKER_COLORS[speaker.trim()] : undefined;
  const barColor = isCommander ? 'rgb(var(--nikke-accent))' : speakerColor ?? 'rgb(var(--nikke-border-strong))';

  return (
    <div
      className={`grid grid-cols-[112px_minmax(0,1fr)] gap-6 rounded-lg px-4 py-3.5 max-sm:grid-cols-1 max-sm:gap-1 max-sm:py-2 ${
        isCommander ? 'bg-nikke-accent/[0.07] max-sm:-mx-3 max-sm:px-3 max-sm:py-2.5' : 'max-sm:px-0'
      }`}
    >
      {/* 막대는 이름 칸 왼쪽 끝에 고정하고 이름은 그 옆에서 시작한다. 긴 이름은 막대 오른쪽에서 줄바꿈된다. */}
      <span
        className={`flex items-start gap-2 pt-[0.375em] font-sans text-[0.8125em] leading-[1.5] max-sm:pt-0 max-sm:text-[0.75em] ${
          isCommander ? 'font-semibold text-nikke-highlight' : 'font-medium text-nikke-text-secondary'
        }`}
      >
        {speaker && (
          <>
            {/* 아주 밝거나 어두운 캐릭터 색도 양쪽 테마에서 보이도록 옅은 윤곽을 둔다 */}
            <span
              aria-hidden="true"
              className="mt-[0.225em] h-[1.05em] w-[3px] flex-none rounded-full shadow-[0_0_0_1px_rgb(var(--nikke-text-primary)/0.1)]"
              style={{ backgroundColor: barColor }}
            />
            <span className="min-w-0">{speaker}</span>
          </>
        )}
      </span>
      <p className="whitespace-pre-wrap font-body text-[1.125em] leading-[var(--reader-leading,1.9)] text-nikke-text-primary max-sm:text-[1em]">
        {element.dialogue}
      </p>
    </div>
  );
};
