const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { authenticate } = require('../middleware/authenticate');
const projects = require('../../config/projects');

router.use(authenticate);

router.get('/projects', (req, res) => {
  res.json({ success: true, data: projects });
});

router.get('/:projectId', (req, res) => {
  const configPath = path.join(__dirname, '../../config/forms', `${req.params.projectId}.json`);
  if (!fs.existsSync(configPath)) {
    return res.status(404).json({ success: false, error: 'Form config not found' });
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  res.json({ success: true, data: config });
});

module.exports = router;
