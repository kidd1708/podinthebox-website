const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const session = require('express-session');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'podinthebox-secret-key-2026',
    resave: false,
    saveUninitialized: true,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000
    }
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
        console.error('❌ ADMIN_PASSWORD not set in .env file');
        return res.status(500).json({ success: false, message: 'Server configuration error' });
    }
    
    if (password === adminPassword) {
        req.session.isAdmin = true;
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ success: false, message: 'Session error' });
            }
            console.log('✅ Admin logged in successfully');
            res.json({ success: true });
        });
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
        uptime: process.uptime()
    });
});

// Serve the main HTML file for all other routes
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// Start server for local development
if (require.main === module) {
    const server = app.listen(PORT, () => {
        console.log(`✅ POD IN THE BOX server running on http://localhost:${PORT}`);
        console.log(`🔒 Admin password is hidden in .env file`);
        console.log(`📊 Health check: http://localhost:${PORT}/health`);
    });
    
    process.on('SIGINT', () => {
        console.log('Shutting down gracefully...');
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
    
    process.on('SIGTERM', () => {
        console.log('Received SIGTERM, shutting down...');
        server.close(() => {
            console.log('Server closed');
            process.exit(0);
        });
    });
}

// Export for Vercel
module.exports = app;
