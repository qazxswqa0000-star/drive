const { TelegramClient } = require('telegram');
const { StoreSession } = require('telegram/sessions');
const input = require('input');

const api_id = 37870860;
const api_hash = '39a88ec1c82340ef84acbf76d605a6f6';
const storeSession = new StoreSession('my_telegram_web_session');

async function main() {
    console.log('টেলিগ্রাম ক্লায়েন্টের সাথে সংযোগ স্থাপন করা হচ্ছে...');
    const client = new TelegramClient(storeSession, api_id, api_hash, {
        connectionRetries: 5,
    });

    await client.start({
        phoneNumber: async () => await input.text('আপনার টেলিগ্রাম ফোন নম্বর দিন (যেমন +8801...): '),
        password: async () => await input.text('টু-স্টেপ ভেরিফিকেশন পাসওয়ার্ড দিন (যদি থাকে, না থাকলে এন্টার চাপুন): '),
        phoneCode: async () => await input.text('টেলিগ্রাম অ্যাপে আসা লগইন কোডটি দিন: '),
        onError: (err) => console.log(err),
    });

    console.log('সফলভাবে লগইন হয়েছে!');

    // আপনার বড় ফাইলের সঠিক পাথ ও নাম এখানে দিন (যেমন: C:/Users/PC/Videos/video.mp4)
    const filePath = 'C:/path/to/your/large-file.mp4'; 
    
    console.log('বড় ফাইলটি Saved Messages-এ আপলোড হচ্ছে...');
    
    await client.sendFile('me', {
        file: filePath,
        workers: 4,
        progressCallback: (progress) => {
            console.log(`আপলোড অগ্রগতি: ${(progress * 100).toFixed(2)}%`);
        },
    });

    console.log('ফাইল সফলভাবে আপনার Saved Messages-এ আপলোড হয়ে গেছে!');
}

main();