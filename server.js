const express = require('express');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session configuration for Vercel (in-memory, but works per function instance)
app.use(session({
    secret: process.env.SESSION_SECRET || 'podinthebox-super-secret-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// Admin configuration
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// ========== DATA STORAGE (JSON file-based, works on Vercel) ==========
const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize data structure
let data = {
    episodes: [],
    blog_posts: [],
    story_submissions: []
};

// Load data from file if exists
function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const rawData = fs.readFileSync(DATA_FILE, 'utf8');
            data = JSON.parse(rawData);
            console.log('Data loaded successfully');
        } else {
            // Add sample data
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
            saveData();
        }
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Save data to file
function saveData() {
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('Data saved successfully');
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Helper to get next ID
function getNextId(items) {
    return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
}

// Load data on startup
loadData();

// ========== AUTHENTICATION ==========
app.post('/api/admin/authenticate', (req, res) => {
    const { password } = req.body;
    
    if (password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.json({ success: true, message: 'Logged in!' });
    } else {
        res.json({ success: false, message: 'My apologize, you\'re not the admin.' });
    }
});

app.get('/api/admin/check', (req, res) => {
    res.json({ isAuthenticated: req.session.isAdmin || false });
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.json({ success: true });
    });
});

// ========== EPISODE API ENDPOINTS ==========
// Get all episodes (public)
app.get('/api/episodes', (req, res) => {
    res.json(data.episodes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

// Add episode (admin only)
app.post('/api/episodes', (req, res) => {
    if (!req.session.isAdmin) {
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
    saveData();
    res.json({ id: newEpisode.id, success: true });
});

// Delete episode (admin only)
app.delete('/api/episodes/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const id = parseInt(req.params.id);
    const initialLength = data.episodes.length;
    data.episodes = data.episodes.filter(ep => ep.id !== id);
    
    if (data.episodes.length < initialLength) {
        saveData();
        res.json({ deleted: 1, success: true });
    } else {
        res.json({ deleted: 0, success: false });
    }
});

// ========== BLOG API ENDPOINTS ==========
// Get all blog posts (public)
app.get('/api/blog', (req, res) => {
    res.json(data.blog_posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

// Get single blog post (public)
app.get('/api/blog/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const post = data.blog_posts.find(p => p.id === id);
    if (!post) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(post);
});

// Add blog post (admin only)
app.post('/api/blog', (req, res) => {
    if (!req.session.isAdmin) {
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
    saveData();
    res.json({ id: newPost.id, success: true });
});

// Delete blog post (admin only)
app.delete('/api/blog/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const id = parseInt(req.params.id);
    const initialLength = data.blog_posts.length;
    data.blog_posts = data.blog_posts.filter(post => post.id !== id);
    
    if (data.blog_posts.length < initialLength) {
        saveData();
        res.json({ deleted: 1, success: true });
    } else {
        res.json({ deleted: 0, success: false });
    }
});

// ========== STORY SUBMISSION API ENDPOINTS ==========
// Get all story submissions (admin only)
app.get('/api/stories', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    res.json(data.story_submissions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

// Submit a story (public)
app.post('/api/stories', (req, res) => {
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
    saveData();
    res.json({ id: newStory.id, success: true });
});

// Delete story submission (admin only)
app.delete('/api/stories/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const id = parseInt(req.params.id);
    const initialLength = data.story_submissions.length;
    data.story_submissions = data.story_submissions.filter(story => story.id !== id);
    
    if (data.story_submissions.length < initialLength) {
        saveData();
        res.json({ deleted: 1, success: true });
    } else {
        res.json({ deleted: 0, success: false });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files from public folder
app.use(express.static(path.join(__dirname, 'public')));

// All other routes serve index.html (for SPA routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ========== IMPORTANT: NO app.listen() for Vercel ==========
// Export the app for Vercel serverless functions
module.exports = app;
