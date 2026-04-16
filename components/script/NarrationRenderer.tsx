import React from 'react';
import type { NarrationElement } from '../../types';

interface NarrationRendererProps {
  element: NarrationElement;
}

export const NarrationRenderer: React.FC<NarrationRendererProps> = ({ element }) => {
  let narrationClass = 'whitespace-pre-wrap font-body text-base italic leading-[1.8] text-nikke-text-secondary';

  if (element.isSceneMarker) {
    return (
      <p className="my-4 rounded-full bg-nikke-surface-high px-5 py-2 text-center font-label text-[0.75rem] font-bold uppercase tracking-[0.22em] text-nikke-accent">
        {element.text}
      </p>
    );
  }

  const upperSpeakerForCheck = element.speaker?.toUpperCase() || '';

  if (upperSpeakerForCheck.includes('[ACTION]')) {
    const speakerName = element.speaker!.replace(/\[ACTION\]/i, '').trim();
    return (
      <div className="my-3 px-4 md:px-5">
        <p className={narrationClass}>{speakerName} : {element.text}</p>
      </div>
    );
  }

  const narrationKeywords = ['LOCATION', 'SOUND', 'NARRATION', 'MUSIC', 'EFFECTS', 'ACTION', 'TRANSITION', 'FADE IN', 'FADE OUT', 'CUT TO', 'INT', 'EXT', 'SYSTEM'];

  if (element.speaker && narrationKeywords.includes(upperSpeakerForCheck.replace(/\.$/, ''))) {
    narrationClass = 'block whitespace-pre-wrap rounded-[1.5rem] bg-nikke-surface-low/80 px-5 py-4 font-label text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-nikke-accent/90';
    if (upperSpeakerForCheck === 'SYSTEM' && element.text.startsWith('Error:')) {
      narrationClass = 'block whitespace-pre-wrap rounded-[1.5rem] bg-red-950/20 px-5 py-4 font-label text-[0.78rem] font-semibold uppercase tracking-[0.16em] text-red-400';
      return (
        <div className="my-5 px-5 md:px-6">
          <p className={narrationClass}>
            <span className="font-bold uppercase">{element.speaker}:</span> {element.text}
          </p>
        </div>
      );
    }
    return (
      <div className="my-3 px-4 md:px-5">
        <p className={narrationClass}>
          <span className="font-bold uppercase">{element.speaker}:</span> {element.text}
        </p>
      </div>
    );
  }

  return (
    <div className="my-3 px-4 md:px-5">
      <p className={narrationClass}>{element.text}</p>
    </div>
  );
};
