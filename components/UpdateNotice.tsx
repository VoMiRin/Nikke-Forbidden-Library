import React from 'react';
import { XIcon } from './Icons';

interface UpdateNoticeProps {
  onReload: () => void;
  onDismiss: () => void;
}

/** 새 배포 안내. 읽던 화면이 갑자기 바뀌지 않도록 새로고침은 사용자가 누를 때만 한다. */
export const UpdateNotice: React.FC<UpdateNoticeProps> = ({ onReload, onDismiss }) => (
  <div
    role="status"
    className="fixed inset-x-4 bottom-[max(16px,env(safe-area-inset-bottom))] z-[80] mx-auto flex max-w-md items-center gap-3 rounded-[10px] border border-nikke-border-strong bg-nikke-surface py-2 pl-4 pr-2 text-sm text-nikke-text-primary shadow-lg shadow-black/20"
  >
    <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-nikke-accent ring-[3px] ring-nikke-accent/20" />
    <p className="min-w-0 flex-1">새 버전이 배포되었습니다.</p>
    <button
      type="button"
      onClick={onReload}
      className="min-h-10 shrink-0 rounded-lg bg-nikke-accent px-3.5 text-[13px] font-semibold text-nikke-accent-ink hover:bg-nikke-accent-strong"
    >
      새로고침
    </button>
    <button
      type="button"
      onClick={onDismiss}
      aria-label="알림 닫기"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-nikke-text-muted hover:text-nikke-text-primary"
    >
      <XIcon className="h-4 w-4" />
    </button>
  </div>
);
