import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureScreenshot, claimClip, clipFile, createScreenRecorder, screenMime, MAX_SCREEN_SEC } from './screenRecorder.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

function fakeTrack(kind) {
  const track = { kind, stopped: false, listeners: {} };
  track.stop = () => { track.stopped = true; };
  track.addEventListener = (name, fn) => { track.listeners[name] = fn; };
  return track;
}

function fakeStream(tracks) {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  };
}

class FakeRecorder {
  static isTypeSupported(type) { return type === 'video/webm;codecs=vp8,opus' || type === 'video/webm'; }
  constructor(stream, options) { this.stream = stream; this.options = options; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  pause() { this.state = 'paused'; }
  resume() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['frames'], { type: 'video/webm' }) });
    this.onstop?.();
  }
}

function setup({ denied = false } = {}) {
  let now = 1_000_000;
  const ticks = [];
  const screen = fakeStream([fakeTrack('video'), fakeTrack('audio')]);
  const mic = fakeStream([fakeTrack('audio')]);
  const env = {
    getDisplayMedia: async () => {
      if (denied) throw Object.assign(new Error('denied'), { name: 'NotAllowedError' });
      return screen;
    },
    getUserMedia: async () => mic,
    MediaRecorder: FakeRecorder,
    MediaStream: class { constructor(tracks) { this.tracks = tracks; } getTracks() { return this.tracks; } },
    now: () => now,
    setInterval: (fn) => { ticks.push(fn); return ticks.length; },
    clearInterval: () => {},
  };
  const rec = createScreenRecorder(env);
  const advance = (ms) => { now += ms; ticks.forEach((fn) => fn()); };
  return { rec, screen, mic, advance };
}

test('screen recordings use a webm type the browser supports, and the file is named for the chat', () => {
  assert.equal(screenMime(FakeRecorder), 'video/webm;codecs=vp8,opus');
  assert.equal(screenMime(undefined), '');
  const file = clipFile([new Blob(['x'])], 'video/webm;codecs=vp8,opus', 1700000000000);
  assert.equal(file.name, 'screen-1700000000000.webm');
  assert.equal(file.type, 'video/webm');
  assert.equal(clipFile([new Blob(['x'])], 'video/mp4', 1).name, 'screen-1.mp4');
  assert.ok(MAX_SCREEN_SEC >= 60 && MAX_SCREEN_SEC <= 600, 'long enough to show a problem, short enough for the 50MB chat limit');
});

test('start, pause, resume and send: the clip carries its duration and every track is released', async () => {
  const { rec, screen, mic, advance } = setup();
  await rec.start({ postUrl: '/support/messages', label: 'OMSKing Support' });
  assert.equal(rec.getState().status, 'recording');
  assert.equal(rec.getState().target.postUrl, '/support/messages');
  advance(4000);
  rec.pause();
  assert.equal(rec.getState().status, 'paused');
  advance(10000);
  rec.resume();
  advance(2000);
  assert.equal(Math.round(rec.getState().elapsed), 6, 'paused time does not count');

  const clip = await rec.finish();
  assert.equal(clip.durationSec, 6);
  assert.equal(clip.file.type, 'video/webm');
  assert.equal(clip.target.postUrl, '/support/messages');
  assert.equal(rec.getState().status, 'idle');
  assert.ok([...screen.getTracks(), ...mic.getTracks()].every((t) => t.stopped), 'camera-style indicators go away');
});

test('stopping from the browser bar keeps the clip for the chat to pick up once', async () => {
  const { rec, screen, advance } = setup();
  await rec.start({ postUrl: '/support/threads/t1/messages', label: 'Leheriya', thread: 't1' });
  advance(3000);
  screen.getVideoTracks()[0].listeners.ended();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(rec.getState().status, 'idle');
  assert.equal(rec.getState().kept.thread, 't1');
  assert.equal(rec.takeClip('/support/messages'), null, 'another chat does not get it');
  const clip = rec.takeClip('/support/threads/t1/messages');
  assert.equal(clip.durationSec, 3);
  assert.equal(rec.takeClip('/support/threads/t1/messages'), null);
});

test('a refused share leaves nothing running, and cancel throws the recording away', async () => {
  const denied = setup({ denied: true });
  await assert.rejects(() => denied.rec.start({ postUrl: '/x' }), { name: 'NotAllowedError' });
  assert.equal(denied.rec.getState().status, 'idle');

  const { rec, screen } = setup();
  await rec.start({ postUrl: '/x' });
  rec.cancel();
  assert.equal(rec.getState().status, 'idle');
  assert.equal(rec.takeClip('/x'), null);
  assert.ok(screen.getTracks().every((t) => t.stopped));
});

test('Record screen sits in the attach menu; the Report button gets Send recording, Pause and Stop', () => {
  const chat = read('../components/report/ChatPane.jsx');
  const button = read('../components/report/ReportButton.jsx');
  const inbox = read('../components/report/ReportChat.jsx');
  assert.match(chat, /Record screen/);
  assert.match(chat, /screenRecorder\.start\(/);
  assert.match(chat, /screenRecorder\.start\([\s\S]{0,200}onClose\?\.\(\)/, 'the report closes once recording starts');
  assert.match(chat, /claimClip\(screenRecorder, listUrl,/, 'a stopped clip comes back into the chat to send');
  assert.match(button, /Send recording/);
  assert.match(button, /aria-label=\{paused \? 'Resume recording' : 'Pause recording'\}/);
  assert.match(button, /aria-label="Stop recording"/);
  assert.match(button, /api\.post\(clip\.target\.postUrl/, 'sent through the same message upload as videos');
  assert.match(inbox, /initialThread/);
});

test('after Send recording succeeds the report reopens on that chat so the sender sees the clip', () => {
  const button = read('../components/report/ReportButton.jsx');
  const from = button.indexOf('api.post(clip.target.postUrl');
  const sent = button.slice(from, button.indexOf('} catch (err)', from));
  assert.match(sent, /toast\.success\(/);
  assert.match(sent, /setThread\(clip\.target\.thread \|\| null\)/, 'opens the subscriber chat it was recorded from');
  assert.match(sent, /setOpen\(true\)/, 'the report opens after the upload finishes');
  assert.doesNotMatch(sent, /setOpen\(false\)|close\(\)/, 'the sender closes it themselves');
});

test('a screenshot is one still of the page as a PNG, and the share stops straight away', async () => {
  const screen = fakeStream([fakeTrack('video')]);
  let asked = null;
  const file = await captureScreenshot({
    getDisplayMedia: async (constraints) => { asked = constraints; return screen; },
    grabFrame: async () => new Blob(['png-bytes'], { type: 'image/png' }),
    now: () => 1700000000000,
  });
  assert.equal(file.name, 'screenshot-1700000000000.png');
  assert.equal(file.type, 'image/png');
  assert.equal(asked.audio, false, 'no sound for a still');
  assert.ok(screen.getTracks().every((t) => t.stopped), 'the sharing indicator goes away');

  const broken = fakeStream([fakeTrack('video')]);
  await assert.rejects(() => captureScreenshot({
    getDisplayMedia: async () => broken,
    grabFrame: async () => { throw new Error('no frame'); },
    now: () => 1,
  }), /no frame/);
  assert.ok(broken.getTracks().every((t) => t.stopped), 'released even when the frame fails');

  await assert.rejects(() => captureScreenshot({
    getDisplayMedia: async () => { throw Object.assign(new Error('denied'), { name: 'NotAllowedError' }); },
    grabFrame: async () => null,
    now: () => 1,
  }), { name: 'NotAllowedError' });
});

test('photos and recordings from the header wait for whichever chat opens next', async () => {
  const { rec } = setup();
  const shot = new File(['x'], 'screenshot-1.png', { type: 'image/png' });
  rec.keepClip({ files: [shot], target: { postUrl: null, label: null, thread: null }, markup: true });
  assert.deepEqual(rec.getState().kept, { postUrl: null, label: null, thread: null });
  const clip = rec.takeClip('/support/threads/t9/messages');
  assert.equal(clip.files[0], shot);
  assert.equal(clip.markup, true);
  assert.equal(rec.takeClip('/support/threads/t9/messages'), null, 'only once');
});

test('screen recording, screenshot and photo picking live only inside the report, not in the top header', () => {
  const chat = read('../components/report/ChatPane.jsx');
  const button = read('../components/report/ReportButton.jsx');
  assert.doesNotMatch(chat, /accept="video\/\*"/);
  assert.doesNotMatch(chat, />\s*Video\s*</);
  assert.match(chat, /aria-label="Attach photo"/);
  for (const headerControl of [/aria-label="Record screen"/, /aria-label="Add photo"/, /Take screenshot/, /captureScreenshot/, /accept="image\/\*"/, /screenRecorder\.start\(/]) {
    assert.doesNotMatch(button, headerControl, `the header no longer has ${headerControl}`);
  }
  assert.match(chat, /Record screen/);
  assert.match(chat, /Photos/);
  assert.match(chat, /accept="image\/\*"/);
  assert.match(chat, /Take screenshot/);
  const shot = chat.slice(chat.indexOf('const takeScreenshot'), chat.indexOf('const startScreenRecording'));
  assert.match(shot, /captureScreenshot\(\)/);
  assert.match(shot, /visibility = 'hidden'/, 'the report steps aside so the screenshot shows the page');
  assert.match(shot, /finally[\s\S]*visibility = ''/, 'and always comes back');
  assert.match(shot, /setEditing\(/, 'screenshots open in the markup editor');
  assert.match(chat, /clip\.files/, 'photos kept for a chat are still staged in it');
});

test('a chat that mounts, unmounts and mounts again (React StrictMode) still gets the clip, exactly once', () => {
  const { rec } = setup();
  const shot = new File(['x'], 'screenshot-1.png', { type: 'image/png' });
  rec.keepClip({ files: [shot], target: { postUrl: '/support/messages' }, markup: true });
  const queue = [];
  const defer = (fn) => { queue.push(fn); return () => { queue.splice(queue.indexOf(fn), 1); }; };
  const got = [];

  const rehearsal = claimClip(rec, '/support/messages', (clip) => got.push(clip), defer);
  rehearsal();
  assert.equal(got.length, 0, 'nothing staged during the rehearsal');
  claimClip(rec, '/support/messages', (clip) => got.push(clip), defer);
  queue.splice(0).forEach((fn) => fn());
  assert.equal(got.length, 1);
  assert.equal(got[0].files[0], shot);
  assert.equal(rec.takeClip('/support/messages'), null, 'not handed out twice');
  assert.equal(claimClip(rec, '/support/messages', () => got.push('again'), defer)(), undefined);
  assert.equal(got.length, 1);
});
