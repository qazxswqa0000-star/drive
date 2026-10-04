const { TelegramClient } = require('telegram');
const { StoreSession } = require('telegram/sessions');
const input = require('input');

const api_id = 37870860;
const api_hash = '39a88ec1c82340ef84acbf76d605a6f6';
const storeSession = new StoreSession('my_telegram_web_session');

async function login() {
    const client = new TelegramClient(storeSession, api_id, api_hash, { connectionRetries: 5 });
    await client.start({
        phoneNumber: async () => await input.text('আপনার টেলিগ্রাম ফোন নম্বর দিন (যেমন +8801...): '),
        password: async () => await input.text('টু-স্টেপ ভেরিফিকেশন পাসওয়ার্ড দিন (যদি থাকে, না থাকলে এন্টার চাপুন): '),
        phoneCode: async () => await input.text('টেলিগ্রাম অ্যাপে আসা লগইন কোডটি দিন: '),
        onError: (err) => console.log(err),
    });
    await client.disconnect();
    console.log('সফলভাবে টেলিগ্রাম সেশন সেভ হয়ে গেছে! এখন npm start চালান।');
}

login().catch((error) => {
    console.error('Telegram login failed:', error);
    process.exitCode = 1;
});