import type { MouseEvent } from 'react';

// Preserve browser features such as Ctrl/Cmd-click, middle-click and opening a new tab.
export const followInApp = (event: MouseEvent<HTMLAnchorElement>, navigate: () => void) => {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate();
};
