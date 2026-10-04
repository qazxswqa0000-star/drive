const express = require('express');
const fileUpload = require('express-fileupload');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { TelegramClient } = require('telegram');
const { StoreSession } = require('telegram/sessions');

const app = express();
const PORT = 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const TEMP_DIR = path.join(UPLOAD_DIR, '.tmp');

fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    useTempFiles: true,
    tempFileDir: TEMP_DIR,
    createParentPath: true,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }
}));

// Multi-user tracking object
const activeUsers = {};

// Cookie theke User ID ber kora ba notun toiri kora
function getUserId(req, res) {
    let cookieHeader = req.headers.cookie || '';
    let userId = null;
    let cookies = cookieHeader.split(';').map(c => c.trim().split('='));
    let userCookie = cookies.find(c => c[0] === 'td_user_id');
    
    if (userCookie && userCookie[1]) {
        userId = userCookie[1];
    } else {
        userId = randomUUID();
        res.setHeader('Set-Cookie', `td_user_id=${userId}; Path=/; HttpOnly`);
    }
    return userId;
}

// Security Middleware: Login na thakle login page-e pathiye dibe
app.use((req, res, next) => {
    const publicPaths = ['/login.html', '/api/login', '/verify.html', '/api/verify'];
    if (publicPaths.includes(req.path) || req.path.endsWith('.html') && req.path !== '/index.html') {
        return next();
    }
    
    const userId = getUserId(req, res);
    if (!activeUsers[userId] || !activeUsers[userId].clientReady) {
        if (req.path.startsWith('/api/')) {
            return res.status(401).json({ success: false, message: 'Please login to access files.' });
        }
        return res.redirect('/login.html');
    }
    next();
});

// User-er index file path
function getIndexPath(phone) {
    const safePhone = phone.replace(/\D/g, '');
    return path.join(UPLOAD_DIR, `.index_${safePhone}.json`);
}

function readIndex(phone) {
    const p = getIndexPath(phone);
    if (!fs.existsSync(p)) return [];
    return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeIndex(phone, index) {
    const p = getIndexPath(phone);
    const temp = `${p}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(index, null, 2));
    fs.renameSync(temp, p);
}

// Step 1: Login Data Received
app.post('/api/login', (req, res) => {
    const { api_id, api_hash, phone_number } = req.body;
    if (!api_id || !api_hash || !phone_number) {
        return res.status(400).send('API ID, API Hash ebong Phone Number dite hobe!');
    }

    const userId = getUserId(req, res);
    const safePhone = phone_number.replace(/\D/g, '');
    
    // Ekhane path.join bad diye shudhu namti dewa holo jate error na ase
    const sessionName = `session_${safePhone}`;
    const storeSession = new StoreSession(sessionName);
    const client = new TelegramClient(storeSession, Number(api_id.trim()), api_hash.trim(), { connectionRetries: 5 });

    activeUsers[userId] = {
        client: client,
        resolvers: {},
        phone: safePhone
    };

    activeUsers[userId].clientReady = client.start({
        phoneNumber: async () => phone_number.trim(),
        phoneCode: async () => new Promise(resolve => { activeUsers[userId].resolvers.phoneCode = resolve; }),
        password: async () => new Promise(resolve => { activeUsers[userId].resolvers.password = resolve; }),
        onError: (err) => console.log(`[${safePhone}] Login Error:`, err),
    });

    res.redirect('/verify.html');
});

// Step 2: Verify OTP
// Step 2: Verify OTP
app.post('/api/verify', async (req, res) => {
    const userId = getUserId(req, res);
    const user = activeUsers[userId];
    
    if (!user) return res.status(400).send('Session haraye geche. Abar /login.html theke try korun.');

    const { phone_code, password } = req.body;
    
    if (user.resolvers.phoneCode) user.resolvers.phoneCode(phone_code.trim());
    if (user.resolvers.password) user.resolvers.password(password ? password.trim() : '');

    try {
        await user.clientReady;
        if (!user.client.connected) {
            await user.client.connect();
        }
        console.log(`User successfully connected!`);
        res.redirect('/');
    } catch (err) {
        console.error('Verification failed:', err);
        delete activeUsers[userId];
        res.status(500).send('Login failed or code incorrect. Go back and try again.');
    }
});

async function requireTelegramClient(req, res) {
    const userId = getUserId(req, res);
    const user = activeUsers[userId];
    if (!user || !user.client) {
        res.status(401).json({ success: false, message: 'Please login again.' });
        return null;
    }
    try { 
        if (!user.client.connected) {
            await user.client.connect();
        }
        return user.client;
    } 
    catch (error) {
        console.error('Client Connection Error:', error);
        res.status(503).json({ success: false, message: 'Session error. Please login again.' });
        return null;
    }
}
function safeFileName(name) {
    return path.basename(name || 'file').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
}

function getMediaInfo(message) {
    const media = message.media;
    if (!media) return null;
    if (media.className === 'MessageMediaDocument' && media.document) {
        const doc = media.document;
        const attr = doc.attributes || [];
        const fileAttr = attr.find(a => a.className === 'DocumentAttributeFilename');
        const vidAttr = attr.find(a => a.className === 'DocumentAttributeVideo');
        const audAttr = attr.find(a => a.className === 'DocumentAttributeAudio');
        const fallback = vidAttr ? `Video_${message.id}` : audAttr ? `Audio_${message.id}` : `File_${message.id}`;
        
        return {
            name: safeFileName(fileAttr && fileAttr.fileName ? fileAttr.fileName : fallback),
            size: Number(doc.size) || 0,
            type: vidAttr ? (doc.mimeType && doc.mimeType.startsWith('video/') ? doc.mimeType : 'video/mp4') :
                  audAttr ? (doc.mimeType && doc.mimeType.startsWith('audio/') ? doc.mimeType : 'audio/mpeg') :
                  doc.mimeType || 'application/octet-stream'
        };
    }
    if (media.className === 'MessageMediaPhoto' && media.photo) {
        const sizes = media.photo.sizes || [];
        return { name: `Photo_${message.id}.jpg`, size: Number((sizes[sizes.length - 1] || {}).size) || 0, type: 'image/jpeg' };
    }
    return null;
}

function apiFile(message, info, index) {
    return {
        file_id: `tg-${message.id}`, name: info.name, size: info.size, type: info.type,
        date: message.date ? new Date(message.date * 1000).toISOString() : new Date().toISOString(),
        message_id: message.id, stored: index.some(item => item.messageId === message.id)
    };
}

function setFileHeaders(res, name, type, download) {
    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
}

function sendLocalFile(res, localFile, download) {
    const filePath = path.resolve(UPLOAD_DIR, localFile.storageName);
    if (!filePath.startsWith(`${UPLOAD_DIR}${path.sep}`) || !fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'The saved file is not available on this server.' });
    }
    setFileHeaders(res, localFile.name, localFile.type, download);
    res.sendFile(filePath);
}

app.get('/api/files', async (req, res) => {
    try {
        const user = activeUsers[getUserId(req, res)];
        const telegramClient = await requireTelegramClient(req, res);
        if (!telegramClient) return;

        const offsetId = req.query.offsetId === undefined ? 0 : Number(req.query.offsetId);
        const messages = await telegramClient.getMessages('me', { limit: 100, offsetId });
        const index = readIndex(user.phone);
        const files = messages.map(msg => {
            const info = getMediaInfo(msg);
            return info ? apiFile(msg, info, index) : null;
        }).filter(Boolean);

        if (offsetId === 0) {
            index.filter(item => !item.messageId).forEach(item => files.push({ file_id: `local-${item.id}`, name: item.name, size: item.size, type: item.type, date: item.date, stored: true }));
        }
        res.json({ success: true, files, nextOffsetId: messages.length === 100 ? messages[messages.length - 1].id : null });
    } catch (error) {
        res.status(500).json({ success: false, message: `ফাইল লোড করা যায়নি: ${error.message}` });
    }
});

app.post('/upload', async (req, res) => {
    let localFile;
    try {
        const user = activeUsers[getUserId(req, res)];
        const telegramClient = await requireTelegramClient(req, res);
        if (!telegramClient) return;
        if (!req.files || !req.files.file) return res.status(400).json({ success: false, message: 'কোনো ফাইল পাওয়া যায়নি!' });

        const uploadedFile = req.files.file;
        const id = randomUUID();
        const name = safeFileName(uploadedFile.name);
        const storageName = path.join(id, name);
        const filePath = path.join(UPLOAD_DIR, storageName);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        await uploadedFile.mv(filePath);

        localFile = { id, storageName, name, size: uploadedFile.size, type: uploadedFile.mimetype || 'application/octet-stream', date: new Date().toISOString(), messageId: null };
        const index = readIndex(user.phone);
        index.unshift(localFile);
        writeIndex(user.phone, index);

        const sentMessage = await telegramClient.sendFile('me', { file: filePath, fileName: name, workers: 1 });
        const message = Array.isArray(sentMessage) ? sentMessage[0] : sentMessage;
        
        if (!message || !message.id) throw new Error('Failed to get message ID from Telegram');

        localFile.messageId = message.id;
        writeIndex(user.phone, index);
        return res.json({ success: true, message: 'ফাইল আপলোড হয়েছে।' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message, savedLocally: Boolean(localFile) });
    }
});

app.get('/api/files/:fileId/content', async (req, res) => {
    const download = req.query.download === '1';
    try {
        const user = activeUsers[getUserId(req, res)];
        if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });
        
        const index = readIndex(user.phone);
        const localId = /^local-([0-9a-f-]{36})$/i.exec(req.params.fileId);
        if (localId) {
            const localFile = index.find(item => item.id === localId[1]);
            return localFile ? sendLocalFile(res, localFile, download) : res.status(404).json({ success: false, message: 'File not found.' });
        }

        const telegramId = /^tg-(\d+)$/.exec(req.params.fileId);
        if (!telegramId) return res.status(400).json({ success: false, message: 'Invalid file ID.' });

        const telegramClient = await requireTelegramClient(req, res);
        if (!telegramClient) return;

        const messageId = Number(telegramId[1]);
        const storedFile = index.find(item => item.messageId === messageId);
        if (storedFile) return sendLocalFile(res, storedFile, download);

        const [message] = await telegramClient.getMessages('me', { ids: [messageId] });
        const info = message && getMediaInfo(message);
        if (!message || !info) return res.status(404).json({ success: false, message: 'Telegram file not found.' });

        const tempPath = path.join(TEMP_DIR, `${randomUUID()}-${info.name}`);
        await telegramClient.downloadMedia(message, { outputFile: tempPath, workers: 1 });
        setFileHeaders(res, info.name, info.type, download);
        res.sendFile(tempPath, error => {
            fs.rm(tempPath, { force: true }, () => {});
            if (error && !res.headersSent) res.status(error.statusCode || 500).json({ success: false, message: 'ফাইল পাঠানো যায়নি।' });
        });
    } catch (error) {
        if (!res.headersSent) res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/', (req, res) => {
    const userId = getUserId(req, res);
    if (!activeUsers[userId] || !activeUsers[userId].clientReady) {
        return res.redirect('/login.html');
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/verify.html', (req, res) => res.sendFile(path.join(__dirname, 'verify.html')));

app.listen(PORT, '127.0.0.1', () => {
    console.log(`সার্ভার চালু আছে: http://localhost:${PORT}`);
});