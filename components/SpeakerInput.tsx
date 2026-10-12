import React, { useEffect, useMemo, useState } from 'react';
import type { SpeakerSummary } from '../types';
import { loadSpeakerCatalog } from '../lib/speakers';
import { normalizeSearchValue } from '../lib/search.mjs';

interface SpeakerInputProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  className: string;
  disabled?: boolean;
  placeholder?: string;
}

export const SpeakerInput: React.FC<SpeakerInputProps> = ({ id, value, onChange, ...inputProps }) => {
  const [open, setOpen] = useState(false);
  const [speakers, setSpeakers] = useState<SpeakerSummary[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const listId = `${id}-suggestions`;

  useEffect(() => {
    if (!open || speakers.length) return;
    let current = true;
    setLoading(true);
    setError(false);
    loadSpeakerCatalog().then(value => { if (current) setSpeakers(value); })
      .catch(() => { if (current) setError(true); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [open, speakers.length]);

  useEffect(() => { setActiveIndex(-1); }, [value]);
  const suggestions = useMemo(() => {
    const query = normalizeSearchValue(value);
    return speakers.filter(speaker => normalizeSearchValue(speaker.name).includes(query))
      .sort((a, b) => {
        const aPrefix = normalizeSearchValue(a.name).startsWith(query);
        const bPrefix = normalizeSearchValue(b.name).startsWith(query);
        return Number(bPrefix) - Number(aPrefix) || b.sceneCount - a.sceneCount || a.name.localeCompare(b.name, 'ko');
      }).slice(0, 8);
  }, [speakers, value]);

  const select = (speaker: SpeakerSummary) => {
    onChange(speaker.name);
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <>
      <input
        {...inputProps}
        id={id}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && suggestions[activeIndex] ? `${listId}-${suggestions[activeIndex].id}` : undefined}
        value={value}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onChange={event => { onChange(event.target.value); setOpen(true); setActiveIndex(-1); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
            setActiveIndex(index => !suggestions.length ? -1 : event.key === 'ArrowDown'
              ? (index + 1) % suggestions.length
              : (index <= 0 ? suggestions.length - 1 : index - 1));
          } else if (event.key === 'Enter' && open && suggestions[activeIndex]) {
            event.preventDefault();
            select(suggestions[activeIndex]);
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <ul id={listId} role="listbox" aria-label="화자 후보" className="absolute inset-x-0 top-full z-40 mt-1 overflow-hidden rounded-lg border border-nikke-border-strong bg-nikke-surface shadow-lg">
          {suggestions.map((speaker, index) => (
            <li
              id={`${listId}-${speaker.id}`}
              key={speaker.id}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={event => event.preventDefault()}
              onClick={() => select(speaker)}
              className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-nikke-surface-high ${index === activeIndex ? 'bg-nikke-surface-high' : ''}`}
            >
              <span>{speaker.name}</span><span className="shrink-0 text-xs text-nikke-text-muted">{speaker.sceneCount} 장면</span>
            </li>
          ))}
          {!suggestions.length && <li role="presentation" className="px-4 py-3 text-sm text-nikke-text-muted">{loading ? '화자 목록을 불러오는 중…' : error ? '후보를 불러오지 못했습니다. 이름을 직접 입력할 수 있습니다.' : '일치하는 화자가 없습니다.'}</li>}
        </ul>
      )}
    </>
  );
};
