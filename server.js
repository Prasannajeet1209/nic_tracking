// server.js
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const app = express();

const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Session configuration
app.use(session({
    secret: 'prasannajeet',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Set to true if using HTTPS
}));

// Serve login page
app.get("/", (req, res) => {   
    res.sendFile(path.join(__dirname, "index.html"));  
});

// Middleware to check for user session  
const checkSession = (req, res, next) => {   
    if (!req.session.user || !req.session.login) {   
        res.redirect("/");   
    } else {   
        next();  
    }  
};
// Database connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'pdj@1234', 
    database: 'nic_location_tracker'
});


// Connect to database
db.connect((err) => {
    if (err) {
        console.error('Database connection failed: ' + err.stack);
        return;
    }
    console.log('Connected to MYSQL Database');
});

// API Routes

// User registration
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    
    const query = 'INSERT INTO users (username, password) VALUES (?, ?)';
    db.query(query, [username, password], (err, result) => {
        if (err) {
            if (err.code === 'ER_DUP_ENTRY') {
                return res.status(400).json({ error: 'Username already exists' });
            }
            return res.status(500).json({ error: 'Registration failed' });
        }
        res.json({ message: 'User registered successfully', userId: result.insertId });
    });
});

// User login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    const query = 'SELECT * FROM users WHERE username = ? AND password = ?';
    db.query(query, [username, password], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Login failed' });
        }
        if (results.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const user = results[0];
        
        // Set session
        req.session.user = user;
        req.session.login = true;
        
        res.json({ 
            message: 'Login successful', 
            userId: user.id, 
            username: user.username,
            isAdmin: user.is_admin 
        });
    });
});

// User logout
app.post('/api/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Logout failed' });
        }
        res.json({ message: 'Logout successful' });
    });
});

// Dashboard route (protected)
app.get('/dashboard', checkSession, (req, res) => {
    res.sendFile(path.join(__dirname, "/public/dashboard.html"));
});

// Start tracking (protected)
app.post('/api/start-tracking', checkSession, (req, res) => {
    const userId = req.session.user.id;
    
    const query = 'INSERT INTO tracking_sessions (user_id) VALUES (?)';
    db.query(query, [userId], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to start tracking' });
        }
        res.json({ message: 'Tracking started', sessionId: result.insertId });
    });
});

// Stop tracking (protected)
app.post('/api/stop-tracking', checkSession, (req, res) => {
    const userId = req.session.user.id;
    
    const query = 'UPDATE tracking_sessions SET end_time = NOW(), is_active = FALSE WHERE user_id = ? AND is_active = TRUE';
    db.query(query, [userId], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to stop tracking' });
        }
        res.json({ message: 'Tracking stopped' });
    });
});

// Save location (protected)
app.post('/api/save-location', checkSession, (req, res) => {
    const { latitude, longitude } = req.body;
    const userId = req.session.user.id;
    
    // Get active session
    const sessionQuery = 'SELECT id FROM tracking_sessions WHERE user_id = ? AND is_active = TRUE ORDER BY id DESC LIMIT 1';
    db.query(sessionQuery, [userId], (err, sessions) => {
        if (err || sessions.length === 0) {
            return res.status(500).json({ error: 'No active session' });
        }
        
        const sessionId = sessions[0].id;
        const locationQuery = 'INSERT INTO location_points (session_id, latitude, longitude) VALUES (?, ?, ?)';
        db.query(locationQuery, [sessionId, latitude, longitude], (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Failed to save location' });
            }
            res.json({ message: 'Location saved' });
        });
    });
});

// Get all users (admin only)
app.get('/api/users', checkSession, (req, res) => {
    if (!req.session.user.is_admin) {
        return res.status(403).json({ error: 'Admin access required' });
    }
    
    const query = 'SELECT id, username FROM users WHERE is_admin = FALSE';
    db.query(query, (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to get users' });
        }
        res.json(results);
    });
});

// Get user tracking data
app.get('/api/user-tracking/:userId', (req, res) => {
    const { userId } = req.params;
    
    const query = `
        SELECT 
            ts.id as session_id,
            ts.start_time,
            ts.end_time,
            lp.latitude,
            lp.longitude,
            lp.timestamp
        FROM tracking_sessions ts
        LEFT JOIN location_points lp ON ts.id = lp.session_id
        WHERE ts.user_id = ? AND ts.end_time IS NOT NULL
        ORDER BY ts.start_time DESC, lp.timestamp ASC
    `;
    
    db.query(query, [userId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to get tracking data' });
        }
        
        // Group by session
        const sessions = {};
        results.forEach(row => {
            if (!sessions[row.session_id]) {
                sessions[row.session_id] = {
                    sessionId: row.session_id,
                    startTime: row.start_time,
                    endTime: row.end_time,
                    locations: []
                };
            }
            if (row.latitude && row.longitude) {
                sessions[row.session_id].locations.push({
                    lat: parseFloat(row.latitude),
                    lng: parseFloat(row.longitude),
                    timestamp: row.timestamp
                });
            }
        });
        
        res.json(Object.values(sessions));
    });
});

// Check tracking status
app.get('/api/tracking-status/:userId', (req, res) => {
    const { userId } = req.params;
    
    const query = 'SELECT * FROM tracking_sessions WHERE user_id = ? AND is_active = TRUE';
    db.query(query, [userId], (err, results) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to check status' });
        }
        res.json({ isTracking: results.length > 0 });
    });
});

app.listen(3000, () => {
  console.log("Server Started on http://localhost:3000");
});