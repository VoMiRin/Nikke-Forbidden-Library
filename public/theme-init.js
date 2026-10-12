(() => {
  // 저장된 선택이 없으면 기기 설정(prefers-color-scheme)을 따른다
  let theme = 'dark';
  try {
    const storedTheme = localStorage.getItem('nikke-theme');
    if (storedTheme === 'light' || storedTheme === 'dark') {
      theme = storedTheme;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      theme = 'light';
    }
  } catch {
    // 저장소를 읽을 수 없으면 기본 다크
  }
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.dataset.theme = theme;
})();
