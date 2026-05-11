const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Admin configuration - Simple token-based auth
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('WARNING: ADMIN_PASSWORD not set in .env file!');
}

// Simple in-memory token store (resets on each function call - fine for Vercel)
let adminToken = null;
let tokenExpiry = null;

function generateToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

// ========== DATA STORAGE (Using Vercel KV) ==========
let data = {
    episodes: [],
    blog_posts: [],
    story_submissions: []
};

// Check if we're using Vercel KV or in-memory storage
const USE_KV = process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;

// KV helper functions
async function getDataFromKV() {
    if (!USE_KV) return null;
    
    try {
        const response = await fetch(`${process.env.KV_REST_API_URL}/get/podinthebox_data`, {
            headers: {
                'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`
            }
        });
        
        if (response.ok) {
            const json = await response.json();
            return json.result ? JSON.parse(json.result) : null;
        }
    } catch (error) {
        console.error('Error reading from KV:', error);
    }
    return null;
}

async function saveDataToKV(dataObj) {
    if (!USE_KV) return true;
    
    try {
        const response = await fetch(`${process.env.KV_REST_API_URL}/set/podinthebox_data`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.KV_REST_API_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                'podinthebox_data': JSON.stringify(dataObj)
            })
        });
        
        if (!response.ok) {
            console.error('Error saving to KV:', response.status);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error saving to KV:', error);
        return false;
    }
}

// Initialize data
async function initData() {
    if (USE_KV) {
        const kvData = await getDataFromKV();
        if (kvData) {
            data = kvData;
            console.log('Data loaded from KV');
            return;
        }
    }
    
    // Use initial data if KV is empty or not available
    data = {
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
    
    console.log('Data initialized with defaults');
}

// Call init when server starts (only for first request or cold start)
let dataInitialized = false;

function getNextId(items) {
    return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
}

// Middleware to refresh data and init if needed
async function ensureDataLoaded(req, res, next) {
    if (!dataInitialized) {
        await initData();
        dataInitialized = true;
    }
    
    // Refresh data from KV on each request
    if (USE_KV) {
        const kvData = await getDataFromKV();
        if (kvData) {
            data = kvData;
        }
    }
    
    next();
}

app.use(ensureDataLoaded);

// Middleware to check admin authentication
function isAdmin(req) {
    const token = req.headers['x-admin-token'];
    return token && token === adminToken && tokenExpiry && Date.now() < tokenExpiry;
}

// ========== AUTHENTICATION (No Sessions!) ==========
app.post('/api/admin/authenticate', (req, res) => {
    const { password } = req.body;
    
    if (!ADMIN_PASSWORD) {
        res.json({ success: false, message: 'Admin password not configured.' });
        return;
    }
    
    if (password === ADMIN_PASSWORD) {
        // Generate new token (valid for 24 hours)
        adminToken = generateToken();
        tokenExpiry = Date.now() + (24 * 60 * 60 * 1000);
        
        res.json({ 
            success: true, 
            message: 'Logged in!',
            token: adminToken
        });
    } else {
        res.json({ success: false, message: 'My apologize, you\'re not the admin.' });
    }
});

app.post('/api/admin/logout', (req, res) => {
    adminToken = null;
    tokenExpiry = null;
    res.json({ success: true });
});

app.get('/api/admin/check', (req, res) => {
    const authenticated = isAdmin(req);
    res.json({ isAuthenticated: authenticated });
});

// ========== EPISODE API ENDPOINTS ==========
app.get('/api/episodes', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.json(data.episodes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/episodes', async (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const { cover, title, author, description, link } = req.body;
    const newEpisode = {
        id: getNextId(data.episodes),
        cover: cover || "https://picsum.photos/id/100/400/200",
        title,
        author: author || "Anonymous Host",
        description,
        link,
        created_at: new Date().toISOString()
    };
    
    data.episodes.push(newEpisode);
    
    if (await saveDataToKV(data)) {
        res.json({ id: newEpisode.id, success: true });
    } else {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

app.delete('/api/episodes/:id', async (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const id = parseInt(req.params.id);
    const initialLength = data.episodes.length;
    data.episodes = data.episodes.filter(ep => ep.id !== id);
    
    if (data.episodes.length < initialLength) {
        await saveDataToKV(data);
        res.json({ deleted: 1, success: true });
    } else {
        res.status(404).json({ deleted: 0, success: false, error: 'Episode not found' });
    }
});

// ========== BLOG API ENDPOINTS ==========
app.get('/api/blog', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    res.json(data.blog_posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.get('/api/blog/:id', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    const id = parseInt(req.params.id);
    const post = data.blog_posts.find(p => p.id === id);
    if (!post) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(post);
});

app.post('/api/blog', async (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const { title, author, image_url, content, date } = req.body;
    const newPost = {
        id: getNextId(data.blog_posts),
        title,
        author: author || "Anonymous Author",
        image_url: image_url || null,
        content,
        date: date || new Date().toLocaleDateString(),
        created_at: new Date().toISOString()
    };
    
    data.blog_posts.push(newPost);
    
    if (await saveDataToKV(data)) {
        res.json({ id: newPost.id, success: true });
    } else {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

app.delete('/api/blog/:id', async (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID format' });
        return;
    }
    
    const initialLength = data.blog_posts.length;
    data.blog_posts = data.blog_posts.filter(post => post.id !== id);
    
    if (data.blog_posts.length < initialLength) {
        await saveDataToKV(data);
        res.json({ deleted: 1, success: true, message: 'Post deleted successfully' });
    } else {
        res.status(404).json({ deleted: 0, success: false, error: 'Post not found' });
    }
});

// ========== STORY SUBMISSION API ENDPOINTS ==========
app.get('/api/stories', (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(data.story_submissions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/stories', async (req, res) => {
    const { name, email, category, title, content, date } = req.body;
    const newStory = {
        id: getNextId(data.story_submissions),
        name,
        email,
        category: category || "Other",
        title,
        content,
        date: date || new Date().toLocaleString(),
        created_at: new Date().toISOString()
    };
    
    data.story_submissions.push(newStory);
    await saveDataToKV(data);
    res.json({ id: newStory.id, success: true });
});

app.delete('/api/stories/:id', async (req, res) => {
    if (!isAdmin(req)) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const id = parseInt(req.params.id);
    const initialLength = data.story_submissions.length;
    data.story_submissions = data.story_submissions.filter(story => story.id !== id);
    
    if (data.story_submissions.length < initialLength) {
        await saveDataToKV(data);
        res.json({ deleted: 1, success: true });
    } else {
        res.json({ deleted: 0, success: false });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// All other routes serve index.html
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;
