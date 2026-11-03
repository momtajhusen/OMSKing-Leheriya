/**
 * Records the page (with the screen's sound and the microphone) for the Report chat.
 * Lives outside React so the recording keeps going after the report closes; the Report button shows the controls.
 */
export const MAX_SCREEN_SEC = 5 * 60;
const VIDEO_BPS = 1_200_000;
const AUDIO_BPS = 64_000;
const TICK_MS = 500;

const SCREEN_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export function screenMime(Recorder = globalThis.MediaRecorder) {
  if (!Recorder?.isTypeSupported) return '';
  return SCREEN_TYPES.find((type) => Recorder.isTypeSupported(type)) || '';
}

export function clipFile(chunks, mime, now = Date.now()) {
  const type = (mime || 'video/webm').split(';')[0];
  const ext = type.includes('mp4') ? 'mp4' : 'webm';
  return new File(chunks, `screen-${now}.${ext}`, { type });
}

export function canRecordScreen() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof MediaRecorder !== 'undefined';
}

export function canCaptureScreen() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
}

/** Waits for the shared page to paint (and any menu that was just closed to disappear), then copies one frame. */
async function grabVideoFrame(stream) {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  await new Promise((resolve) => setTimeout(resolve, 300));
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  video.srcObject = null;
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not capture the screenshot'))), 'image/png');
  });
}

function browserEnv() {
  return {
    grabFrame: grabVideoFrame,
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    MediaRecorder: globalThis.MediaRecorder,
    MediaStream: globalThis.MediaStream,
    AudioContext: globalThis.AudioContext || globalThis.webkitAudioContext,
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id),
  };
}

/** Screen sound and microphone become one track; a recorder only keeps the first audio track it is given. */
function mixAudio(env, streams) {
  const sources = streams.filter((s) => s && s.getAudioTracks().length);
  const tracks = sources.flatMap((s) => s.getAudioTracks());
  if (tracks.length <= 1 || !env.AudioContext) return { tracks: tracks.slice(0, 1), ctx: null };
  const ctx = new env.AudioContext();
  const dest = ctx.createMediaStreamDestination();
  sources.forEach((s) => ctx.createMediaStreamSource(s).connect(dest));
  return { tracks: dest.stream.getAudioTracks(), ctx };
}

const IDLE = { status: 'idle', elapsed: 0, target: null, kept: null };

export function createScreenRecorder(envOverride) {
  let env = envOverride || null;
  let state = IDLE;
  let session = null;
  let keptClip = null;
  const listeners = new Set();

  const set = (patch) => {
    state = { ...state, ...patch };
    listeners.forEach((fn) => fn());
  };
  const elapsedOf = (s) => (s.acc + (s.since ? env.now() - s.since : 0)) / 1000;

  function release(s) {
    env.clearInterval(s.timer);
    s.streams.forEach((stream) => stream?.getTracks().forEach((t) => t.stop()));
    s.ctx?.close?.().catch?.(() => {});
  }

  /** Stops the recorder and resolves the clip; repeated calls share the same stop. */
  function stop(s) {
    if (s.stopping) return s.stopping;
    s.stopping = new Promise((resolve) => {
      const elapsed = elapsedOf(s);
      s.since = 0;
      s.recorder.onstop = () => {
        release(s);
        resolve({
          file: clipFile(s.chunks, s.recorder.mimeType || s.mime, env.now()),
          durationSec: Math.round(elapsed * 10) / 10,
          target: s.target,
        });
      };
      if (s.recorder.state === 'inactive') s.recorder.onstop();
      else s.recorder.stop();
    });
    return s.stopping;
  }

  /** The clip waits for the report to reopen on its chat (browser "Stop sharing" bar or the time limit). */
  async function keep(s) {
    const clip = await stop(s);
    if (session !== s) return;
    session = null;
    keptClip = clip;
    set({ ...IDLE, kept: clip.target });
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getState: () => state,

    /** `target` = { postUrl, label, thread? }. Rejects when the user cancels the share picker. */
    async start(target) {
      if (session) throw new Error('A screen recording is already running');
      env = env || browserEnv();
      const screen = await env.getDisplayMedia({
        video: { displaySurface: 'browser', frameRate: 15 },
        audio: true,
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
      });
      let mic = null;
      try {
        mic = await env.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        /* no microphone: record the screen without voice */
      }
      const { tracks: audio, ctx } = mixAudio(env, [screen, mic]);
      const mime = screenMime(env.MediaRecorder);
      const stream = new env.MediaStream([...screen.getVideoTracks(), ...audio]);
      const recorder = new env.MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: VIDEO_BPS,
        audioBitsPerSecond: AUDIO_BPS,
      });
      const s = { recorder, mime, target, chunks: [], streams: [screen, mic], ctx, acc: 0, since: env.now(), timer: null, stopping: null };
      recorder.ondataavailable = (e) => { if (e.data?.size) s.chunks.push(e.data); };
      screen.getVideoTracks()[0]?.addEventListener('ended', () => { if (session === s) keep(s); });
      s.timer = env.setInterval(() => {
        if (session !== s) return;
        const elapsed = elapsedOf(s);
        if (elapsed >= MAX_SCREEN_SEC) keep(s);
        else set({ elapsed });
      }, TICK_MS);
      session = s;
      keptClip = null;
      recorder.start(1000);
      set({ status: 'recording', elapsed: 0, target, kept: null });
    },

    pause() {
      const s = session;
      if (!s || s.recorder.state !== 'recording') return;
      s.recorder.pause();
      s.acc += env.now() - s.since;
      s.since = 0;
      set({ status: 'paused', elapsed: elapsedOf(s) });
    },

    resume() {
      const s = session;
      if (!s || s.recorder.state !== 'paused') return;
      s.recorder.resume();
      s.since = env.now();
      set({ status: 'recording' });
    },

    /** Ends the recording and hands back { file, durationSec, target }, or null when nothing is running. */
    async finish() {
      const s = session;
      if (!s) return null;
      session = null;
      const clip = await stop(s);
      set(IDLE);
      return clip;
    },

    /**
     * Puts a finished clip (or `{ files, target, markup }` from the header photo menu) back so the chat for
     * `target.postUrl` can stage it. A null postUrl means whichever chat opens next.
     */
    keepClip(clip) {
      keptClip = clip;
      set({ kept: clip.target });
    },

    /** The kept clip, once, for the chat it belongs to. */
    takeClip(postUrl) {
      if (!keptClip) return null;
      if (keptClip.target?.postUrl && keptClip.target.postUrl !== postUrl) return null;
      const clip = keptClip;
      keptClip = null;
      set({ kept: null });
      return clip;
    },

    cancel() {
      const s = session;
      if (!s) return;
      session = null;
      s.recorder.onstop = () => release(s);
      if (s.recorder.state === 'inactive') release(s);
      else s.recorder.stop();
      keptClip = null;
      set(IDLE);
    },
  };
}

/**
 * Takes the kept clip for a chat as it mounts and hands it over on the next tick. If the chat unmounts first
 * (React StrictMode mounts twice in development and revokes the first mount's blob URLs), the clip goes back.
 */
export function claimClip(recorder, postUrl, onClip, defer = (fn) => { const t = setTimeout(fn); return () => clearTimeout(t); }) {
  const clip = recorder.takeClip(postUrl);
  if (!clip) return () => {};
  let delivered = false;
  const cancel = defer(() => { delivered = true; onClip(clip); });
  return () => {
    cancel();
    if (!delivered) recorder.keepClip(clip);
  };
}

/** One PNG of the page through the browser's share picker; the share ends as soon as the frame is taken. */
export async function captureScreenshot(envOverride) {
  const env = envOverride || browserEnv();
  const stream = await env.getDisplayMedia({
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
    selfBrowserSurface: 'include',
  });
  try {
    const blob = await env.grabFrame(stream);
    return new File([blob], `screenshot-${env.now()}.png`, { type: blob.type || 'image/png' });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

const screenRecorder = createScreenRecorder();
export default screenRecorder;
