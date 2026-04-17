import React from 'react';
import type { NarrationElement } from '../../types';

interface NarrationRendererProps {
  element: NarrationElement;
}

export const NarrationRenderer: React.FC<NarrationRendererProps> = ({ element }) => {
  let narrationClass = 'whitespace-pre-wrap font-body text-[0.95rem] italic leading-[1.75] text-nikke-text-secondary md:text-base md:leading-[1.8]';

  if (element.isSceneMarker) {
    return (
      <p className="my-3 rounded-full bg-nikke-surface-high px-4 py-2 text-center font-label text-[0.68rem] font-bold uppercase tracking-[0.18em] text-nikke-accent md:my-4 md:px-5 md:text-[0.75rem] md:tracking-[0.22em]">
        {element.text}
      </p>
    );
  }

  const upperSpeakerForCheck = element.speaker?.toUpperCase() || '';

  if (upperSpeakerForCheck.includes('[ACTION]')) {
    const speakerName = element.speaker!.replace(/\[ACTION\]/i, '').trim();
    return (
      <div className="my-2.5 px-3 md:my-3 md:px-5">
        <p className={narrationClass}>{speakerName} : {element.text}</p>
      </div>
    );
  }

  const narrationKeywords = ['LOCATION', 'SOUND', 'NARRATION', 'MUSIC', 'EFFECTS', 'ACTION', 'TRANSITION', 'FADE IN', 'FADE OUT', 'CUT TO', 'INT', 'EXT', 'SYSTEM'];

  if (element.speaker && narrationKeywords.includes(upperSpeakerForCheck.replace(/\.$/, ''))) {
    narrationClass = 'block whitespace-pre-wrap rounded-[1.15rem] bg-nikke-surface-low/80 px-4 py-3 font-label text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-nikke-accent/90 md:rounded-[1.5rem] md:px-5 md:py-4 md:text-[0.78rem] md:tracking-[0.16em]';
    if (upperSpeakerForCheck === 'SYSTEM' && element.text.startsWith('Error:')) {
      narrationClass = 'block whitespace-pre-wrap rounded-[1.15rem] bg-red-950/20 px-4 py-3 font-label text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-red-400 md:rounded-[1.5rem] md:px-5 md:py-4 md:text-[0.78rem] md:tracking-[0.16em]';
      return (
        <div className="my-4 px-3 md:my-5 md:px-6">
          <p className={narrationClass}>
            <span className="font-bold uppercase">{element.speaker}:</span> {element.text}
          </p>
        </div>
      );
    }
    return (
      <div className="my-2.5 px-3 md:my-3 md:px-5">
        <p className={narrationClass}>
          <span className="font-bold uppercase">{element.speaker}:</span> {element.text}
        </p>
      </div>
    );
  }

  return (
    <div className="my-2.5 px-3 md:my-3 md:px-5">
      <p className={narrationClass}>{element.text}</p>
    </div>
  );
};
