const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes    = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const formRoutes    = require('./routes/forms');
const userRoutes    = require('./routes/users');
const aiRoutes      = require('./routes/ai');
const notifRoutes   = require('./routes/notifications');
const { initStorage } = require('./storage/supabaseAdapter');

const app  = express();
const PORT = process.env.PORT || 3000;

// Allow localhost for dev + any Vercel deployment URL for prod.
// Set CORS_ORIGIN env var to lock it down to your specific domain.
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',')
  : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    // In production allow same-origin requests (Vercel serves API + client on same domain)
    if (process.env.NODE_ENV === 'production') return cb(null, true);
    cb(new Error('CORS: origin not allowed'));
  }
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '../client')));

app.use('/api/auth',          authRoutes);
app.use('/api/requests',      requestRoutes);
app.use('/api/forms',         formRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/ai',            aiRoutes);
app.use('/api/notifications', notifRoutes);

app.get('/',            (_, res) => res.sendFile(path.join(__dirname, '../client/login.html')));
app.get('/register',    (_, res) => res.sendFile(path.join(__dirname, '../client/register.html')));
app.get('/dashboard',   (_, res) => res.sendFile(path.join(__dirname, '../client/dashboard.html')));
app.get('/form',        (_, res) => res.sendFile(path.join(__dirname, '../client/form.html')));
app.get('/ai-settings', (_, res) => res.sendFile(path.join(__dirname, '../client/ai-settings.html')));

initStorage();

// Global error handler — catches unhandled errors thrown by any async route handler
// Without this, Express 4.x leaves the response hanging instead of sending a 500
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[express] unhandled error:', err.message || err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: 'An unexpected server error occurred.' });
});

// Only start the HTTP server when run directly (not when imported by Vercel)
if (require.main === module) {
  app.listen(PORT, () => console.log(`Creative Hub running at http://localhost:${PORT}`));
}

module.exports = app;
