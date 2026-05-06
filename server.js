const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session configuration for Vercel (using MongoDB or memory store)
// Note: For production, use a proper session store like MongoDB, Redis, or PostgreSQL
app.use(session({
    secret: process.env.SESSION_SECRET || 'podinthebox-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    },
    store: process.env.MONGODB_URI ? MongoStore.create({
        mongoUrl: process.env.MONGODB_URI
    }) : undefined
}));

// Authentication middleware
function isAuthenticated(req, res, next) {
    if (req.session.isAdmin) {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized' });
    }
}

// Admin authentication endpoint
app.post('/api/admin/authenticate', (req, res) => {
    const { password } = req.body;
    
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    if (!adminPassword) {
        console.error('❌ ADMIN_PASSWORD not set in environment variables');
        return res.status(500).json({ success: false, message: 'Server configuration error' });
    }
    
    if (password === adminPassword) {
        req.session.isAdmin = true;
        console.log('✅ Admin logged in successfully');
        res.json({ success: true });
    } else {
        console.log('❌ Failed login attempt');
        res.json({ success: false, message: "My apologize, you're not the admin." });
    }
});

// Admin logout endpoint
app.post('/api/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.status(500).json({ success: false });
        }
        res.json({ success: true });
    });
});

// Check if admin is authenticated
app.get('/api/admin/check', (req, res) => {
    res.json({ isAuthenticated: req.session.isAdmin || false });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// Serve the main HTML file for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// Export for Vercel
module.exports = app;
