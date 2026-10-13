import type { AppView, SearchMode } from '../hooks';
import { categoryPath, scenePath, parsePagePath } from './pageRoutes.mjs';

export type ViewerSearchFocus = {
  term: string;
  mode: SearchMode;
  speakerTerm?: string;
};

export type BrowserHistoryState = {
  view: AppView;
  categoryKey: string | null;
  scriptId: string | null;
  searchTerm: string;
  speakerSearchTerm: string;
  viewerSearchFocus: ViewerSearchFocus | null;
  searchCategoryKey: string | null;
  chapterTitle: string | null;
  /** 분류 안의 소분류 (예: 블라블라 개인/단체방) */
  section: string | null;
  speakerId: string | null;
};

export const parseHistoryStateFromLocation = (locationSearch: string, pathname = '/'): BrowserHistoryState => {
  const params = new URLSearchParams(locationSearch);
  const route = parsePagePath(pathname);
  if (route) {
    params.set('view', route.scriptId ? 'script' : 'stories');
    params.set('category', route.categoryKey);
    if (route.scriptId) params.set('script', route.scriptId);
    else params.delete('script');
  }
  const rawQuery = params.get('q')?.trim() ?? '';
  const legacySearchMode: SearchMode = params.get('mode') === 'speaker' ? 'speaker' : 'content';
  const searchTerm = legacySearchMode === 'speaker' && !params.has('speaker') ? '' : rawQuery;
  const speakerSearchTerm = params.get('speaker')?.trim() ?? (legacySearchMode === 'speaker' ? rawQuery : '');
  const focusTerm = params.get('focus')?.trim() ?? '';
  const focusMode: SearchMode = params.get('focusMode') === 'speaker' ? 'speaker' : 'content';
  const focusSpeakerTerm = params.get('focusSpeaker')?.trim() ?? '';
  const categoryKey = params.get('category')?.trim() || null;
  const scriptId = params.get('script')?.trim() || null;
  const rawView = params.get('view');
  const hasSearchTerm = !!(searchTerm || speakerSearchTerm);

  let view: AppView = 'stories';
  if (rawView === 'speakers') {
    view = 'speakers';
  } else if (rawView === 'search') {
    view = 'search';
  } else if (rawView === 'stories') {
    view = 'stories';
  } else if (rawView === 'ai_chat' || rawView === 'ai') {
    view = 'ai_chat';
  } else if (rawView === 'script' || rawView === 'script_viewer') {
    view = 'script_viewer';
  } else if (scriptId) {
    view = 'script_viewer';
  } else if (hasSearchTerm) {
    view = 'search';
  }

  return {
    view,
    searchCategoryKey: view === 'search' ? categoryKey : null,
    chapterTitle: view === 'stories' && categoryKey ? params.get('title')?.trim() || null : null,
    section: view === 'stories' && categoryKey ? params.get('section')?.trim() || null : null,
    speakerId: view === 'speakers' ? params.get('speakerId')?.trim() || null : null,
    categoryKey: view === 'stories' || view === 'script_viewer' ? categoryKey : null,
    scriptId: view === 'script_viewer' ? scriptId : null,
    searchTerm: view === 'search' ? searchTerm : '',
    speakerSearchTerm: view === 'search' ? speakerSearchTerm : '',
    viewerSearchFocus: view === 'script_viewer' && focusTerm
      ? { term: focusTerm, mode: focusMode, speakerTerm: focusSpeakerTerm || undefined }
      : null,
  };
};

export const buildHistoryUrl = (state: BrowserHistoryState): string => {
  const params = new URLSearchParams();
  let pathname = '/';

  // 스토리 홈이 기본 화면이므로 분류가 없으면 파라미터 없이 둔다
  if (state.view === 'stories' && state.categoryKey) {
    pathname = categoryPath(state.categoryKey);
    if (state.section) params.set('section', state.section);
    if (state.chapterTitle) params.set('title', state.chapterTitle);
  }

  if (state.view === 'speakers') {
    params.set('view', 'speakers');
    if (state.speakerId) params.set('speakerId', state.speakerId);
  }

  if (state.view === 'ai_chat') {
    params.set('view', 'ai_chat');
  }

  if (state.view === 'script_viewer') {
    if (state.categoryKey && state.scriptId) pathname = scenePath(state.categoryKey, state.scriptId);
    if (state.viewerSearchFocus?.term) {
      params.set('focus', state.viewerSearchFocus.term);
      if (state.viewerSearchFocus.mode === 'speaker') {
        params.set('focusMode', state.viewerSearchFocus.mode);
      }
      if (state.viewerSearchFocus.speakerTerm) {
        params.set('focusSpeaker', state.viewerSearchFocus.speakerTerm);
      }
    }
  }

  if (state.view === 'search') {
    params.set('view', 'search');
    if (state.searchCategoryKey) params.set('category', state.searchCategoryKey);
    if (state.searchTerm) {
      params.set('q', state.searchTerm);
    }
    if (state.speakerSearchTerm) {
      params.set('speaker', state.speakerSearchTerm);
    }
  }

  const queryString = params.toString();
  return queryString ? `${pathname}?${queryString}` : pathname;
};
