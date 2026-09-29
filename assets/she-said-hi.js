const count = document.querySelector('#days-since');
if (count) {
  const now = new Date();
  const todayUTC = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.floor((todayUTC - Date.UTC(1999, 1, 14)) / 86400000));
  count.textContent = `${new Intl.NumberFormat('en-US').format(days)} days since “Hi.”`;
}
const shareButton = document.querySelector('#share-story');
shareButton?.addEventListener('click', async () => {
  const url = 'https://lorenbarnhart.vercel.app/she-said-hi/';
  const status = document.querySelector('#share-status');
  try {
    if (navigator.share) await navigator.share({title:'She Said Hi — Loren Barnhart',text:'Sometimes the rest of your life begins with one word.',url});
    else {await navigator.clipboard.writeText(url);status.textContent='Story link copied.';}
  } catch (error) {
    if (error?.name !== 'AbortError') status.textContent=`Copy this link: ${url}`;
  }
});
