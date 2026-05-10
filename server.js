const express = require('express');
const path = require('path');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
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

// Admin configuration - password loaded from .env (not hardcoded)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// ========== DATABASE SETUP ==========
const db = new sqlite3.Database('./podcast.db');

// Create tables
db.serialize(() => {
    // Episodes table
    db.run(`
        CREATE TABLE IF NOT EXISTS episodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cover TEXT,
            title TEXT NOT NULL,
            author TEXT,
            description TEXT,
            link TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Blog posts table
    db.run(`
        CREATE TABLE IF NOT EXISTS blog_posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            image_url TEXT,
            content TEXT,
            date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    
    // Story submissions table
    db.run(`
        CREATE TABLE IF NOT EXISTS story_submissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL,
            category TEXT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

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
    db.all('SELECT * FROM episodes ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Add episode (admin only)
app.post('/api/episodes', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const { cover, title, author, description, link } = req.body;
    db.run(
        'INSERT INTO episodes (cover, title, author, description, link) VALUES (?, ?, ?, ?, ?)',
        [cover, title, author, description, link],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, success: true });
        }
    );
});

// Delete episode (admin only)
app.delete('/api/episodes/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    db.run('DELETE FROM episodes WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ deleted: this.changes, success: true });
    });
});

// ========== BLOG API ENDPOINTS ==========
// Get all blog posts (public)
app.get('/api/blog', (req, res) => {
    db.all('SELECT * FROM blog_posts ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Get single blog post (public)
app.get('/api/blog/:id', (req, res) => {
    db.get('SELECT * FROM blog_posts WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        if (!row) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(row);
    });
});

// Add blog post (admin only)
app.post('/api/blog', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    const { title, author, image_url, content, date } = req.body;
    db.run(
        'INSERT INTO blog_posts (title, author, image_url, content, date) VALUES (?, ?, ?, ?, ?)',
        [title, author, image_url, content, date],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, success: true });
        }
    );
});

// Delete blog post (admin only)
app.delete('/api/blog/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    db.run('DELETE FROM blog_posts WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ deleted: this.changes, success: true });
    });
});

// ========== STORY SUBMISSION API ENDPOINTS ==========
// Get all story submissions (admin only)
app.get('/api/stories', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    db.all('SELECT * FROM story_submissions ORDER BY created_at DESC', (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json(rows);
    });
});

// Submit a story (public)
app.post('/api/stories', (req, res) => {
    const { name, email, category, title, content, date } = req.body;
    db.run(
        'INSERT INTO story_submissions (name, email, category, title, content, date) VALUES (?, ?, ?, ?, ?, ?)',
        [name, email, category, title, content, date],
        function(err) {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }
            res.json({ id: this.lastID, success: true });
        }
    );
});

// Delete story submission (admin only)
app.delete('/api/stories/:id', (req, res) => {
    if (!req.session.isAdmin) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    
    db.run('DELETE FROM story_submissions WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({ deleted: this.changes, success: true });
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Serve static files from public folder
const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Main route - serve index.html from public folder
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`✅ Server is running!`);
    console.log(`📍 Access at: http://localhost:${PORT}`);
    console.log(`wELCOME KIDD!`)
    console.log(`=================================\n`);
});

module.exports = app;
