import type { SpeakerDetail, SpeakerSummary } from '../types';

let catalogPromise: Promise<SpeakerSummary[]> | null = null;
let indexPromise: Promise<Record<string, SpeakerDetail>> | null = null;

export const loadSpeakerCatalog = (): Promise<SpeakerSummary[]> => {
  if (!catalogPromise) {
    catalogPromise = fetch('/speakers.json')
      .then(async response => {
        if (!response.ok) throw new Error('화자 목록을 불러오지 못했습니다.');
        return response.json() as Promise<SpeakerSummary[]>;
      })
      .catch(error => { catalogPromise = null; throw error; });
  }
  return catalogPromise;
};

export const loadSpeakerIndex = (): Promise<Record<string, SpeakerDetail>> => {
  if (!indexPromise) {
    indexPromise = fetch('/speaker-index.json')
      .then(async response => {
        if (!response.ok) throw new Error('화자의 장면 목록을 불러오지 못했습니다.');
        return response.json() as Promise<Record<string, SpeakerDetail>>;
      })
      .catch(error => { indexPromise = null; throw error; });
  }
  return indexPromise;
};
