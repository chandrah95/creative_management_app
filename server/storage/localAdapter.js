const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const REQUESTS_FILE = path.join(DATA_DIR, 'requests.json');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function initStorage() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(USERS_FILE)) {
    const hash = bcrypt.hashSync('Admin123!', 10);
    writeJson(USERS_FILE, [
      { id: uuidv4(), email: 'admin@company.com', password: hash, name: 'Admin', role: 'admin' }
    ]);
    console.log('Default admin created: admin@company.com / Admin123!');
  }

  if (!fs.existsSync(REQUESTS_FILE)) {
    writeJson(REQUESTS_FILE, []);
  }
}

// Users
function findUserByEmail(email) {
  const users = readJson(USERS_FILE);
  return users.find(u => u.email === email) || null;
}

// Requests
function getAllRequests(filters = {}) {
  let requests = readJson(REQUESTS_FILE);
  if (filters.project) requests = requests.filter(r => r.project === filters.project);
  if (filters.status) requests = requests.filter(r => r.status === filters.status);
  return requests.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
}

function getRequestById(id) {
  return readJson(REQUESTS_FILE).find(r => r.id === id) || null;
}

function createRequest(data) {
  const requests = readJson(REQUESTS_FILE);
  const newRequest = { id: uuidv4(), status: 'pending', submittedAt: new Date().toISOString(), ...data };
  requests.push(newRequest);
  writeJson(REQUESTS_FILE, requests);
  return newRequest;
}

function updateRequest(id, updates) {
  const requests = readJson(REQUESTS_FILE);
  const idx = requests.findIndex(r => r.id === id);
  if (idx === -1) return null;
  requests[idx] = { ...requests[idx], ...updates, updatedAt: new Date().toISOString() };
  writeJson(REQUESTS_FILE, requests);
  return requests[idx];
}

module.exports = { initStorage, findUserByEmail, getAllRequests, getRequestById, createRequest, updateRequest };
