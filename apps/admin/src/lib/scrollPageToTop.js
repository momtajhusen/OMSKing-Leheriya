// #root and each layout's <main> are the real scroll containers, so window.scrollTo alone does nothing.
export function scrollPageToTop() {
  window.scrollTo(0, 0);
  const root = document.getElementById('root');
  if (root) root.scrollTop = 0;
  document.querySelectorAll('main').forEach((el) => {
    el.scrollTop = 0;
  });
}
