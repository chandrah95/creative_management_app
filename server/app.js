const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const formRoutes = require('./routes/forms');
const { initStorage } = require('./storage/localAdapter');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/forms', formRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/login.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dashboard.html'));
});

app.get('/form', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/form.html'));
});

initStorage();

app.listen(PORT, () => {
  console.log(`Creative Request Platform running at http://localhost:${PORT}`);
});
