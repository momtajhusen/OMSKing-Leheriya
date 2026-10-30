// The textarea copy runs first, while the click still counts as a user gesture; some embedded browsers deny navigator.clipboard.
export async function copyText(text) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand('copy');
  area.remove();
  if (!copied) await navigator.clipboard.writeText(text);
}
