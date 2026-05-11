const express = require('express');
const path = require('path');
const session = require('express-session');
const fs = require('fs');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'podinthebox-super-secret-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('WARNING: ADMIN_PASSWORD not set in .env file!');
}

// ========== DATA STORAGE WITH BETTER FILE HANDLING ==========
const DATA_FILE = path.join(__dirname, 'data.json');

// Helper to ensure data.json exists and is valid
function ensureDataFile() {
    if (!fs.existsSync(DATA_FILE)) {
        const initialData = {
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
        fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2));
        return initialData;
    }
    
    try {
        const rawData = fs.readFileSync(DATA_FILE, 'utf8');
        return JSON.parse(rawData);
    } catch (error) {
        console.error('Error reading data file:', error);
        return null;
    }
}

let data = ensureDataFile();

function saveData() {
    try {
        // Create backup before saving
        if (fs.existsSync(DATA_FILE)) {
            fs.copyFileSync(DATA_FILE, DATA_FILE + '.backup');
        }
        fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
        console.log('Data saved successfully at', new Date().toISOString());
        return true;
    } catch (error) {
        console.error('Error saving data:', error);
        // Try to restore from backup
        if (fs.existsSync(DATA_FILE + '.backup')) {
            const backupData = fs.readFileSync(DATA_FILE + '.backup', 'utf8');
            data = JSON.parse(backupData);
        }
        return false;
    }
}

function getNextId(items) {
    return items.length > 0 ? Math.max(...items.map(i => i.id)) + 1 : 1;
}

// Reload data on each request to ensure freshness (for serverless)
function refreshData() {
    if (fs.existsSync(DATA_FILE)) {
        try {
            const rawData = fs.readFileSync(DATA_FILE, 'utf8');
            data = JSON.parse(rawData);
        } catch (error) {
            console.error('Error refreshing data:', error);
        }
    }
}

// ========== AUTHENTICATION ==========
app.post('/api/admin/authenticate', (req, res) => {
    const { password } = req.body;
    
    if (!ADMIN_PASSWORD) {
        res.json({ success: false, message: 'Admin password not configured.' });
        return;
    }
    
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

// ========== EPISODE API ENDPOINTS WITH CACHE HEADERS ==========
app.get('/api/episodes', (req, res) => {
    // Refresh data from file
    refreshData();
    
    // Add cache-control headers to prevent caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    
    res.json(data.episodes.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/episodes', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    refreshData(); // Get latest data
    
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
    
    if (saveData()) {
        res.json({ id: newEpisode.id, success: true });
    } else {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

app.delete('/api/episodes/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    refreshData(); // Get latest data
    
    const id = parseInt(req.params.id);
    const initialLength = data.episodes.length;
    data.episodes = data.episodes.filter(ep => ep.id !== id);
    
    if (data.episodes.length < initialLength) {
        if (saveData()) {
            res.json({ deleted: 1, success: true });
        } else {
            res.status(500).json({ error: 'Failed to save deletion' });
        }
    } else {
        res.status(404).json({ deleted: 0, success: false, error: 'Episode not found' });
    }
});

// ========== BLOG API ENDPOINTS WITH CACHE HEADERS ==========
app.get('/api/blog', (req, res) => {
    // Refresh data from file
    refreshData();
    
    // CRITICAL: These headers prevent browsers from caching the response
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    
    console.log(`Sending ${data.blog_posts.length} blog posts at ${new Date().toISOString()}`);
    res.json(data.blog_posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.get('/api/blog/:id', (req, res) => {
    refreshData();
    
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    
    const id = parseInt(req.params.id);
    const post = data.blog_posts.find(p => p.id === id);
    if (!post) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(post);
});

app.post('/api/blog', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    refreshData(); // Get latest data
    
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
    
    if (saveData()) {
        console.log(`Blog post added: ${title} (ID: ${newPost.id})`);
        res.json({ id: newPost.id, success: true });
    } else {
        res.status(500).json({ error: 'Failed to save data' });
    }
});

// FIXED Delete blog post with proper data persistence
app.delete('/api/blog/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    // IMPORTANT: Refresh data from file first
    refreshData();
    
    const id = parseInt(req.params.id);
    
    if (isNaN(id)) {
        res.status(400).json({ error: 'Invalid ID format' });
        return;
    }
    
    console.log(`Attempting to delete blog post ID: ${id}`);
    console.log(`Current posts before delete:`, data.blog_posts.map(p => ({ id: p.id, title: p.title })));
    
    // Find the post to delete
    const postToDelete = data.blog_posts.find(post => post.id === id);
    if (!postToDelete) {
        console.log(`Post with ID ${id} not found`);
        res.status(404).json({ deleted: 0, success: false, error: 'Post not found' });
        return;
    }
    
    // Remove the post
    const initialLength = data.blog_posts.length;
    data.blog_posts = data.blog_posts.filter(post => post.id !== id);
    
    if (data.blog_posts.length < initialLength) {
        // Save the changes to disk
        const saved = saveData();
        
        if (saved) {
            console.log(`Successfully deleted post "${postToDelete.title}" (ID: ${id})`);
            console.log(`Remaining posts: ${data.blog_posts.length}`);
            
            // Verify the deletion was saved
            const verifyData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            const stillExists = verifyData.blog_posts.find(p => p.id === id);
            
            if (!stillExists) {
                console.log('Deletion verified in data.json');
                res.json({ deleted: 1, success: true, message: 'Post deleted successfully' });
            } else {
                console.error('Deletion was not saved to file!');
                res.status(500).json({ error: 'Deletion not persisted to storage' });
            }
        } else {
            console.error('Failed to save data after deletion');
            res.status(500).json({ error: 'Failed to save deletion to storage' });
        }
    } else {
        console.log(`Post with ID ${id} not found during filter operation`);
        res.status(404).json({ deleted: 0, success: false, error: 'Post not found' });
    }
});

// ========== STORY SUBMISSION API ENDPOINTS ==========
app.get('/api/stories', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    refreshData();
    
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(data.story_submissions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
});

app.post('/api/stories', (req, res) => {
    refreshData();
    
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

app.delete('/api/stories/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    refreshData();
    
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

// Debug endpoint to check data.json content (admin only)
app.get('/api/admin/debug/data', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    refreshData();
    res.json({
        blogCount: data.blog_posts.length,
        episodesCount: data.episodes.length,
        storiesCount: data.story_submissions.length,
        blogPosts: data.blog_posts.map(p => ({ id: p.id, title: p.title })),
        fileExists: fs.existsSync(DATA_FILE),
        fileSize: fs.existsSync(DATA_FILE) ? fs.statSync(DATA_FILE).size : 0
    });
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
