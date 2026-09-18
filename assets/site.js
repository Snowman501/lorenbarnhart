document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
  const kind=button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));
  document.querySelectorAll('[data-genre]').forEach(card=>{card.hidden=kind!=='all'&&card.dataset.genre!==kind});
  const status=document.querySelector('#filter-status');
  if(status)status.textContent=kind==='all'?'Showing all books.':`Showing ${kind==='fiction'?'fiction':'memoir'} books.`;
}));
