const TITLE = {
  unclear: 'Ek decision chahiye',
  waiting: 'Client se ye jaankari chahiye',
  testing: 'Test ya check ke liye kuch chahiye',
};

/**
 * Everything an input form shows, in Hinglish: the message above the box (title, what is needed) and the labels
 * around it. `request` = { kind: 'unclear' | 'waiting', during?: 'testing', unclear, needHi? } where `needHi` is the
 * Hinglish need written by Auto-fix; older tasks without it show their own text.
 */
export function inputGuide(request) {
  const kind = request?.during === 'testing' ? 'testing' : request?.kind === 'waiting' ? 'waiting' : 'unclear';
  return {
    title: TITLE[kind],
    needLabel: 'Kya chahiye',
    need: request?.needHi || request?.unclear || '',
    optionsLabel: 'Koi ek chunein ya apna jawab likhein',
    placeholder: 'Jawab yahan likhein',
    submit: 'Submit karein',
    toDeveloper: 'Developer ka jawab (sirf task list me)',
    toClient: 'Report chat me client se poochein',
    started: 'Jawab save ho gaya. Auto-fix ne ye task shuru kar diya hai aur fix check karega.',
    queued: 'Jawab save ho gaya. Auto-fix abhi shuru nahi ho saka; agli baar sabse pehle yahi task hoga.',
    asked: 'Sawal client ko bhej diya. Task unke jawab ka intezaar karega.',
    replied: 'Jawab isi message ke reply me bhej diya.',
    empty: 'Jawab ka box khali hai. Iske bina ye task aage nahi badh sakta.',
  };
}
