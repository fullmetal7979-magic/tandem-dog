/** One visibility listener; decorative effects never keep hidden windows busy. */
export function installWorkbenchFeedback(): () => void {
  try{document.documentElement.dataset.workbenchEffects=localStorage.getItem('cosmos.effects.v1')==='off'?'off':'subtle';}catch{}
  const refresh=()=>{document.documentElement.dataset.appHidden=String(document.visibilityState==='hidden');};
  refresh();document.addEventListener('visibilitychange',refresh);
  return()=>document.removeEventListener('visibilitychange',refresh);
}
