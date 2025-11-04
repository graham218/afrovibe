const nodemailer = require('nodemailer');
const crypto = require('crypto');
const {
  EMAIL_OTP_LEN, OTP_HASH_SECRET,
} = require('./constants');

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'no-reply@example.com';

let mailer = null;
if (SMTP_HOST) {
  mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
}

function makeOtp(len = EMAIL_OTP_LEN) {
  let code = '';
  while (code.length < len) code += Math.floor(Math.random() * 10);
  return code.slice(0, len);
}

function hashOtp(otp) {
  return crypto.createHmac('sha256', OTP_HASH_SECRET).update(String(otp)).digest('hex');
}

async function sendEmail(to, subject, html) {
  if (!mailer) {
    console.log(`[DEV EMAIL] to=${to}\nSubject: ${subject}\n${html}`);
    return true;
  }
  try { await mailer.sendMail({ from: SMTP_FROM, to, subject, html }); return true; }
  catch (e) { console.error('email send err', e); return false; }
}

module.exports = { mailer, sendEmail, makeOtp, hashOtp };
