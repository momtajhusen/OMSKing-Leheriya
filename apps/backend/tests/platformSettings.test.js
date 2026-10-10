process.env.NODE_ENV = 'test';
process.env.GMAIL_USER = 'env-box@example.com';
process.env.GMAIL_APP_PASSWORD = 'env-pass';

const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { savePlatformSettings, getPlatformSettings } = require('../src/services/platformSettings.service');
const { platformMailbox, sendMail } = require('../src/lib/mailer');
const { stopChannelScheduler } = require('../src/services/channelScheduler.service');
const nodemailer = require('nodemailer');

let memory;
const sent = [];
const original = nodemailer.createTransport;

test.before(async () => {
  memory = await MongoMemoryServer.create();
  await mongoose.connect(memory.getUri());
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      sent.push(message);
      return { messageId: 'm' };
    },
  });
});

test.after(async () => {
  stopChannelScheduler();
  nodemailer.createTransport = original;
  await mongoose.disconnect();
  if (memory) await memory.stop();
});

test('platform admin mailbox replaces the env Gmail for client OTP', async () => {
  const envBox = await platformMailbox();
  assert.equal(envBox.user, 'env-box@example.com');
  assert.equal(envBox.source, 'env');

  const saved = await savePlatformSettings({
    gmailUser: 'panel-box@example.com',
    gmailAppPassword: 'panel-pass',
    fromName: 'OMSKing',
    emailBrand: 'OMSKing Platform',
    trialDays: 21,
    orderPullMinutes: 20,
    publicAppUrl: 'https://omsking.example.com',
  });
  assert.equal(saved.after.mailSource, 'panel');
  assert.equal(saved.after.activeGmail, 'panel-box@example.com');
  assert.equal(JSON.stringify(saved.after).includes('panel-pass'), false);

  const box = await platformMailbox();
  assert.equal(box.user, 'panel-box@example.com');
  sent.length = 0;
  await sendMail({ to: 'seller@example.com', subject: 'code', text: 'hi', html: '<p>{{omsBrand}}</p>' });
  assert.match(sent[0].from, /OMSKing/);
  assert.match(sent[0].from, /panel-box@example.com/);
  assert.match(sent[0].html, /OMSKing Platform/);
  assert.equal(sent[0].html.includes('{{omsBrand}}'), false);

  const view = await getPlatformSettings();
  assert.equal(view.trialDays, 21);
  assert.equal(view.orderPullMinutes, 20);
  assert.equal(view.publicAppUrl, 'https://omsking.example.com');
  stopChannelScheduler();
});
