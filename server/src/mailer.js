import nodemailer from 'nodemailer';
import { config, isMailEnabled } from './config.js';

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined
    });
  }
  return transporter;
}

export async function sendPasswordResetMail(to, resetUrl) {
  if (!isMailEnabled) throw new Error('메일 발송이 설정되지 않았습니다.');
  await getTransporter().sendMail({
    from: config.smtp.from,
    to,
    subject: '[DailyDash] 비밀번호 재설정 안내',
    text: [
      'DailyDash 비밀번호 재설정 요청을 받았습니다.',
      '',
      '아래 링크를 열어 새 비밀번호를 설정해 주세요. (1시간 동안 유효)',
      resetUrl,
      '',
      '본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.'
    ].join('\n')
  });
}
