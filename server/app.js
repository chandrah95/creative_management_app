const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes    = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const formRoutes    = require('./routes/forms');
const userRoutes    = require('./routes/users');
const { initStorage } = require('./storage/localAdapter');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.use('/api/auth',     authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/forms',    formRoutes);
app.use('/api/users',    userRoutes);

app.get('/',          (_, res) => res.sendFile(path.join(__dirname, '../client/login.html')));
app.get('/register',  (_, res) => res.sendFile(path.join(__dirname, '../client/register.html')));
app.get('/dashboard', (_, res) => res.sendFile(path.join(__dirname, '../client/dashboard.html')));
app.get('/form',      (_, res) => res.sendFile(path.join(__dirname, '../client/form.html')));

initStorage();

app.listen(PORT, () => console.log(`Creative Hub running at http://localhost:${PORT}`));
