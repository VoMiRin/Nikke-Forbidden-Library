import React, { useEffect, useMemo, useState } from 'react';
import type { Script, ScriptCategory, SpeakerDetail, SpeakerSummary } from '../types';
import { loadSpeakerCatalog, loadSpeakerIndex } from '../lib/speakers';
import { normalizeSearchValue } from '../lib/search.mjs';
import { ChevronRightIcon, SearchIcon } from './Icons';

interface SpeakerIndexPageProps {
  scripts: Script[];
  categories: ScriptCategory[];
  speakerId: string | null;
  onSelectSpeaker: (id: string | null) => void;
  onSelectScript: (id: string, speaker: string) => void;
  onNavigateToSearch: () => void;
}

const ordinaryClick = (event: React.MouseEvent<HTMLAnchorElement>) => event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;

export const SpeakerIndexPage: React.FC<SpeakerIndexPageProps> = ({ scripts, categories, speakerId, onSelectSpeaker, onSelectScript, onNavigateToSearch }) => {
  const [speakers, setSpeakers] = useState<SpeakerSummary[]>([]);
  const [detail, setDetail] = useState<SpeakerDetail | null>(null);
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(60);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    setDetail(null);
    const task = speakerId
      ? loadSpeakerIndex().then(index => { if (current) { setDetail(index[speakerId] ?? null); if (!index[speakerId]) setError('이 화자의 기록을 찾을 수 없습니다.'); } })
      : loadSpeakerCatalog().then(value => { if (current) setSpeakers(value); });
    task.catch(() => { if (current) setError('화자 기록을 불러오지 못했습니다.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [speakerId, retry]);

  const matches = useMemo(() => speakers.filter(speaker => normalizeSearchValue(speaker.name).includes(normalizeSearchValue(filter))), [speakers, filter]);
  const groups = useMemo(() => {
    const scriptMap = new Map(scripts.map(script => [script.id, script]));
    const result = new Map<string, { title: string; categoryKey: string; scenes: { script: Script; dialogueCount: number }[] }>();
    for (const scene of detail?.scenes ?? []) {
      const script = scriptMap.get(scene.scriptId);
      if (!script) continue;
      const key = JSON.stringify([script.categoryKey, script.title]);
      if (!result.has(key)) result.set(key, { title: script.title, categoryKey: script.categoryKey, scenes: [] });
      result.get(key)!.scenes.push({ script, dialogueCount: scene.dialogueCount });
    }
    return [...result.values()];
  }, [detail, scripts]);
  const buttonClass = 'min-h-11 rounded-lg border border-nikke-border-strong px-4 text-sm text-nikke-text-primary hover:border-nikke-accent';

  return (
    <section className="max-w-[900px]">
      <nav className="flex flex-wrap items-center gap-2 text-[13px] text-nikke-text-muted" aria-label="화자 탐색">
        <button type="button" onClick={onNavigateToSearch} className="min-h-9 hover:text-nikke-text-primary">기록 검색</button>
        <span aria-hidden="true">/</span>
        {speakerId ? (
          <>
            <button type="button" onClick={() => onSelectSpeaker(null)} className="min-h-9 hover:text-nikke-text-primary">화자 목록</button>
            <span aria-hidden="true">/</span>
            <span aria-current="page" className="text-nikke-text-secondary">{detail?.name ?? '화자'}</span>
          </>
        ) : (
          <span aria-current="page" className="text-nikke-text-secondary">화자 목록</span>
        )}
      </nav>
      <h1 className="mt-4 font-headline text-[clamp(36px,4.4vw,52px)] font-bold leading-[1.1] tracking-[-0.01em] text-nikke-text-primary">
        {detail?.name ?? '화자별 기록'}
      </h1>
      <p className="mt-3 max-w-[640px] text-[15px] leading-[1.7] text-nikke-text-secondary">직접 대사가 기록된 장면을 모았습니다. 이름만 언급된 장면은 포함하지 않으며, 원문에서 이름이 다르게 표기된 화자는 따로 표시합니다.</p>
      {loading ? (
        <div role="status" className="flex flex-col items-center gap-[18px] py-16 text-center">
          <div aria-hidden="true" className="relative h-0.5 w-44 overflow-hidden rounded-sm bg-nikke-border">
            <span className="absolute inset-y-0 left-0 w-16 animate-pulse bg-nikke-accent" />
          </div>
          <p className="text-[15px] text-nikke-text-secondary">기록을 불러오는 중입니다</p>
        </div>
      ) : error ? (
        <div className="py-12 text-center">
          <p role="alert" className="text-[15px] text-nikke-text-secondary">{error}</p>
          <button type="button" className={`${buttonClass} mt-4`} onClick={() => setRetry(value => value + 1)}>다시 시도</button>
        </div>
      ) : detail ? (
        <>
          <p className="mt-6 text-[13px] tabular-nums text-nikke-text-muted">
            {detail.titleCount} 타이틀 · {detail.sceneCount} 장면 · 대사 {detail.dialogueCount.toLocaleString('ko-KR')}줄 (분기별 본문 포함)
          </p>
          {groups.map(group => {
            const category = categories.find(item => item.key === group.categoryKey);
            return (
              <section key={JSON.stringify([group.categoryKey, group.title])} className="mt-10">
                <p className="flex items-baseline gap-2 text-xs text-nikke-text-muted">
                  {category?.roman && <span className="font-headline text-nikke-accent">{category.roman}</span>}
                  {category?.name}
                </p>
                <h2 className="mb-3 mt-1.5 font-headline text-[22px] font-bold text-nikke-text-primary">{group.title}</h2>
                <ul className="border-t border-nikke-border">
                  {group.scenes.map(({ script, dialogueCount }) => (
                    <li key={script.id} className="border-b border-nikke-border">
                      <a href={`/?${new URLSearchParams({ view: 'script', category: script.categoryKey, script: script.id, focus: detail.name, focusMode: 'speaker' })}`}
                        onClick={event => { if (ordinaryClick(event)) { event.preventDefault(); onSelectScript(script.id, detail.name); } }}
                        className="group grid min-h-14 grid-cols-[minmax(0,1fr)_auto_18px] items-center gap-4 px-3 py-3.5 text-nikke-text-primary transition-colors duration-150 hover:bg-nikke-surface max-sm:px-1">
                        <span className="font-body text-[17px] leading-[1.6]">{script.subTitle || script.title}</span>
                        <span className="text-xs text-nikke-text-muted">대사 {dialogueCount}줄</span>
                        <ChevronRightIcon aria-hidden="true" className="h-[18px] w-[18px] text-nikke-text-muted transition-transform duration-150 group-hover:translate-x-[3px] group-hover:text-nikke-accent" />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      ) : (
        <>
          <div className="mt-8 flex flex-col gap-2">
            <label htmlFor="speaker-catalog-filter" className="text-xs text-nikke-text-muted">화자 이름으로 찾기</label>
            <div className="relative sm:max-w-md">
              <SearchIcon aria-hidden="true" className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-nikke-text-muted" strokeWidth={1.8} />
              <input id="speaker-catalog-filter" type="search" value={filter} onChange={event => { setFilter(event.target.value); setLimit(60); }}
                className="h-12 w-full rounded-[10px] border border-nikke-border-strong bg-nikke-surface pl-11 pr-4 text-[15px] text-nikke-text-primary outline-none placeholder:text-nikke-text-muted focus:border-nikke-accent" />
            </div>
          </div>
          <p role="status" className="mb-3 mt-6 text-[13px] text-nikke-text-muted">{matches.length.toLocaleString('ko-KR')}명</p>
          <ul className="grid grid-cols-1 gap-x-8 border-t border-nikke-border sm:grid-cols-2">
            {matches.slice(0, limit).map(speaker => (
              <li key={speaker.id} className="border-b border-nikke-border">
                <a href={`/?view=speakers&speakerId=${speaker.id}`} onClick={event => { if (ordinaryClick(event)) { event.preventDefault(); onSelectSpeaker(speaker.id); } }}
                  className="group flex min-h-14 items-center justify-between gap-3 px-2 py-3 text-nikke-text-primary transition-colors duration-150 hover:bg-nikke-surface">
                  <span className="font-headline text-lg font-semibold">{speaker.name}</span>
                  <span className="text-xs text-nikke-text-muted group-hover:text-nikke-text-secondary">{speaker.sceneCount} 장면</span>
                </a>
              </li>
            ))}
          </ul>
          {matches.length > limit && (
            <div className="mt-8 flex justify-center">
              <button type="button" className={buttonClass} onClick={() => setLimit(value => value + 60)}>더 보기</button>
            </div>
          )}
        </>
      )}
    </section>
  );
};
