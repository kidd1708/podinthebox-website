const express = require('express');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();

// ========== MIDDLEWARE ==========
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ========== ADMIN CONFIG ==========
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('WARNING: ADMIN_PASSWORD not set in .env file!');
}

// Generate a secure random token
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// FIX #1: Store token in Blob so it survives Vercel cold starts.
// Token is re-validated against what's stored in Blob on each request.
const TOKEN_BLOB_KEY = 'podinthebox_auth_token.json';
const DATA_BLOB_KEY = 'podinthebox_data.json';

// ========== BLOB HELPERS ==========
const USE_BLOB = !!process.env.BLOB_READ_WRITE_TOKEN;

// FIX #2 & #3: Use addRandomSuffix: false so blobs are truly overwritten,
// and use 'public' access so plain fetch() works without extra auth headers.
async function putBlob(key, obj) {
    if (!USE_BLOB) return true;
    try {
        const { put } = await import('@vercel/blob');
        await put(key, JSON.stringify(obj), {
            access: 'public',
            contentType: 'application/json',
            addRandomSuffix: false
        });
        return true;
    } catch (err) {
        console.error(`Error writing blob [${key}]:`, err);
        return false;
    }
}

async function getBlob(key) {
    if (!USE_BLOB) return null;
    try {
        const { list } = await import('@vercel/blob');
        const { blobs } = await list({ prefix: key });
        // Find exact match (list() is prefix-based)
        const match = blobs.find(b => b.pathname === key);
        if (!match) return null;
        const response = await fetch(match.url);
        if (!response.ok) return null;
        return await response.json();
    } catch (err) {
        console.error(`Error reading blob [${key}]:`, err);
        return null;
    }
}

// ========== AUTH TOKEN HELPERS (persisted in Blob) ==========
async function saveToken(token, expiry) {
    await putBlob(TOKEN_BLOB_KEY, { token, expiry });
}

async function getStoredToken() {
    return await getBlob(TOKEN_BLOB_KEY);
}

async function clearToken() {
    await putBlob(TOKEN_BLOB_KEY, { token: null, expiry: null });
}

// ========== DATA STORAGE ==========
let data = {
    episodes: [],
    blog_posts: [],
    story_submissions: []
};

const DEFAULT_DATA = {
    episodes: [
        {
            id: 1,
            cover: "https://picsum.photos/id/100/400/200",
            title: "Welcome to Pod in the Box",
            author: "Pod Host",
            description: "Our first episode! Welcome to the podcast.",
            link: "https://open.spotify.com/",
            created_at: new Date().toISOString()
        }
    ],
    blog_posts: [
        {
            id: 1,
            title: "Welcome to Our Blog",
            author: "Admin",
            image_url: "https://picsum.photos/id/101/400/200",
            content: "<p>Welcome to the Pod in the Box blog! Stay tuned for amazing content.</p>",
            date: new Date().toLocaleDateString(),
            created_at: new Date().toISOString()
        }
    ],
    story_submissions: []
};

async function initData() {
    if (USE_BLOB) {
        const blobData = await getBlob(DATA_BLOB_KEY);
        if (blobData) {
            data = blobData;
            console.log('Data loaded from Blob');
            return;
        }
    }
    data = JSON.parse(JSON.stringify(DEFAULT_DATA)); // deep clone
    console.log('Data initialized with defaults');
}

// FIX #6: Track initialization separately from success, so a failed
// init will retry on the next request rather than silently using empty data.
let dataInitialized = false;

function getNextId(items) {
    return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
}

// Middleware: ensure data is loaded before handling any request
async function ensureDataLoaded(req, res, next) {
    try {
        if (!dataInitialized) {
            await initData();
            dataInitialized = true; // only set true after successful init
        } else if (USE_BLOB) {
            // Refresh on every request so all serverless instances stay in sync
            const blobData = await getBlob(DATA_BLOB_KEY);
            if (blobData) data = blobData;
        }
    } catch (err) {
        console.error('Failed to load data:', err);
        // Don't set dataInitialized = true so we retry next request
        return res.status(500).json({ error: 'Data store unavailable' });
    }
    next();
}

app.use(ensureDataLoaded);

// ========== AUTH MIDDLEWARE ==========
// FIX #1: Validate token against Blob-persisted value, not in-memory variable.
async function isAdmin(req) {
    const token = req.headers['x-admin-token'];
    if (!token) return false;
    const stored = await getStoredToken();
    if (!stored || !stored.token) return false;
    return token === stored.token && Date.now() < stored.expiry;
}

// ========== RATE LIMITER (FIX #5: protect story submissions) ==========
const rateLimitMap = new Map();

function rateLimit(maxRequests, windowMs) {
    return (req, res, next) => {
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const now = Date.now();
        const entry = rateLimitMap.get(ip) || { count: 0, start: now };

        if (now - entry.start > windowMs) {
            entry.count = 1;
            entry.start = now;
        } else {
            entry.count += 1;
        }

        rateLimitMap.set(ip, entry);

        if (entry.count > maxRequests) {
            return res.status(429).json({ error: 'Too many requests. Please try again later.' });
        }
        next();
    };
}

// ========== INPUT VALIDATION HELPERS (FIX #4) ==========
function requireFields(fields, body) {
    const missing = fields.filter(f => !body[f] || String(body[f]).trim() === '');
    return missing.length > 0 ? `Missing required fields: ${missing.join(', ')}` : null;
}

// ========== AUTHENTICATION ROUTES ==========
app.post('/api/admin/authenticate', (req, res) => {
    const { password } = req.body;

    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ success: false, message: 'Admin password not configured.' });
    }

    // FIX #8: Use constant-time comparison to prevent timing attacks
    const passwordBuffer = Buffer.from(password || '');
    const adminBuffer = Buffer.from(ADMIN_PASSWORD);
    const match = passwordBuffer.length === adminBuffer.length &&
        crypto.timingSafeEqual(passwordBuffer, adminBuffer);

    if (match) {
        const token = generateToken();
        const expiry = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
        saveToken(token, expiry); // async, fire-and-forget is fine here
        return res.json({ success: true, message: 'Logged in!', token });
    } else {
        return res.status(401).json({ success: false, message: 'Incorrect password.' });
    }
});

app.post('/api/admin/logout', async (req, res) => {
    await clearToken();
    res.json({ success: true });
});

app.get('/api/admin/check', async (req, res) => {
    const authenticated = await isAdmin(req);
    res.json({ isAuthenticated: authenticated });
});

// ========== EPISODES ==========
app.get('/api/episodes', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json([...data.episodes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/episodes', async (req, res) => {
    if (!await isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    // FIX #4: Validate required fields
    const validationError = requireFields(['title', 'description', 'link'], req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const { cover, title, author, description, link } = req.body;
    const newEpisode = {
        id: getNextId(data.episodes),
        cover: cover || "https://picsum.photos/id/100/400/200",
        title: title.trim(),
        author: (author || "Anonymous Host").trim(),
        description: description.trim(),
        link: link.trim(),
        created_at: new Date().toISOString()
    };

    data.episodes.push(newEpisode);

    if (await putBlob(DATA_BLOB_KEY, data)) {
        res.json({ id: newEpisode.id, success: true });
    } else {
        data.episodes.pop(); // rollback
        res.status(500).json({ error: 'Failed to save data' });
    }
});

app.delete('/api/episodes/:id', async (req, res) => {
    if (!await isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const before = data.episodes.length;
    data.episodes = data.episodes.filter(ep => ep.id !== id);

    if (data.episodes.length < before) {
        await putBlob(DATA_BLOB_KEY, data);
        res.json({ deleted: 1, success: true });
    } else {
        res.status(404).json({ deleted: 0, success: false, error: 'Episode not found' });
    }
});

// ========== BLOG ==========
app.get('/api/blog', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json([...data.blog_posts].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.get('/api/blog/:id', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });
    const post = data.blog_posts.find(p => p.id === id);
    if (!post) return res.status(404).json({ error: 'Not found' });
    res.json(post);
});

app.post('/api/blog', async (req, res) => {
    if (!await isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    // FIX #4: Validate required fields
    const validationError = requireFields(['title', 'content'], req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const { title, author, image_url, content, date } = req.body;
    const newPost = {
        id: getNextId(data.blog_posts),
        title: title.trim(),
        author: (author || "Anonymous Author").trim(),
        image_url: image_url || null,
        content,
        date: date || new Date().toLocaleDateString(),
        created_at: new Date().toISOString()
    };

    data.blog_posts.push(newPost);

    if (await putBlob(DATA_BLOB_KEY, data)) {
        res.json({ id: newPost.id, success: true });
    } else {
        data.blog_posts.pop(); // rollback
        res.status(500).json({ error: 'Failed to save data' });
    }
});

app.delete('/api/blog/:id', async (req, res) => {
    if (!await isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID format' });

    const before = data.blog_posts.length;
    data.blog_posts = data.blog_posts.filter(post => post.id !== id);

    if (data.blog_posts.length < before) {
        await putBlob(DATA_BLOB_KEY, data);
        res.json({ deleted: 1, success: true, message: 'Post deleted successfully' });
    } else {
        res.status(404).json({ deleted: 0, success: false, error: 'Post not found' });
    }
});

// ========== STORY SUBMISSIONS ==========
// FIX #5: Rate limit story submissions — max 5 per 10 minutes per IP
app.post('/api/stories', rateLimit(5, 10 * 60 * 1000), async (req, res) => {
    // FIX #4: Validate required fields
    const validationError = requireFields(['name', 'title', 'content'], req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    const { name, email, category, title, content, date } = req.body;
    const newStory = {
        id: getNextId(data.story_submissions),
        name: name.trim(),
        email: (email || '').trim(),
        category: (category || "Other").trim(),
        title: title.trim(),
        content,
        date: date || new Date().toLocaleString(),
        created_at: new Date().toISOString()
    };

    data.story_submissions.push(newStory);
    await putBlob(DATA_BLOB_KEY, data);
    res.json({ id: newStory.id, success: true });
});

app.get('/api/stories', async (req, res) => {
    if (!await isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json([...data.story_submissions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.delete('/api/stories/:id', async (req, res) => {
    if (!await isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid ID' });

    const before = data.story_submissions.length;
    data.story_submissions = data.story_submissions.filter(s => s.id !== id);

    if (data.story_submissions.length < before) {
        await putBlob(DATA_BLOB_KEY, data);
        res.json({ deleted: 1, success: true });
    } else {
        res.status(404).json({ deleted: 0, success: false, error: 'Story not found' });
    }
});

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString(), blobEnabled: USE_BLOB });
});

// FIX #7: Remove the wildcard catch-all — on Vercel, static files and
// SPA routing are handled by vercel.json rewrites, not by server.js.
// Keeping it only for local development.
if (process.env.NODE_ENV !== 'production') {
    app.use(express.static(path.join(__dirname, 'public')));
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
}

module.exports = app;
