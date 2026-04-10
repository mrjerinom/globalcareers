const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'changeme_in_production';
const DB_FILE = path.join(__dirname, 'db.json');

// ── MIDDLEWARE ──
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── SIMPLE JSON DATABASE (no external library needed) ──
function readDB() {
  if (!fs.existsSync(DB_FILE)) {
    const defaultData = {
      jobs: [],
      applicants: [],
      admins: [{ id: 1, username: 'admin', password: bcrypt.hashSync('admin123', 10) }]
    };
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultData, null, 2));
    console.log('✅ Database created (db.json)');
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

// ── AUTH MIDDLEWARE ──
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── HELPERS ──
function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(x => x.id)) + 1;
}
function now() {
  return new Date().toISOString();
}

// ═══════════════════════════════════
//  PUBLIC ROUTES
// ═══════════════════════════════════

// GET /api/jobs
app.get('/api/jobs', (req, res) => {
  const db = readDB();
  let jobs = db.jobs.filter(j => j.is_active);
  if (req.query.destination) jobs = jobs.filter(j => j.destination === req.query.destination);
  if (req.query.industry)    jobs = jobs.filter(j => j.industry    === req.query.industry);
  jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ success: true, count: jobs.length, jobs });
});

// GET /api/jobs/:id
app.get('/api/jobs/:id', (req, res) => {
  const db = readDB();
  const job = db.jobs.find(j => j.id === +req.params.id && j.is_active);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ success: true, job });
});

// POST /api/apply
app.post('/api/apply', (req, res) => {
  const { name, phone, email, city, destination, industry, message } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'Name and phone are required' });
  const db = readDB();
  const applicant = {
    id: nextId(db.applicants),
    name, phone,
    email:       email       || null,
    city:        city        || null,
    destination: destination || null,
    industry:    industry    || null,
    message:     message     || null,
    status:      'new',
    created_at:  now()
  };
  db.applicants.push(applicant);
  writeDB(db);
  res.status(201).json({ success: true, id: applicant.id, message: 'Application submitted!' });
});

// ═══════════════════════════════════
//  ADMIN AUTH
// ═══════════════════════════════════

// POST /api/admin/login
app.post('/api/admin/login', (req, res) => {
  const db = readDB();
  const { username, password } = req.body;
  const admin = db.admins.find(a => a.username === username);
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ success: true, token, username: admin.username });
});

// ═══════════════════════════════════
//  ADMIN PROTECTED ROUTES
// ═══════════════════════════════════

// GET /api/admin/jobs
app.get('/api/admin/jobs', requireAuth, (req, res) => {
  const db = readDB();
  const jobs = [...db.jobs].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ success: true, count: jobs.length, jobs });
});

// POST /api/admin/jobs
app.post('/api/admin/jobs', requireAuth, (req, res) => {
  const { title, company, location, destination, salary, industry, description, openings, experience } = req.body;
  if (!title || !company || !location) return res.status(400).json({ error: 'Title, company, and location are required' });
  const db = readDB();
  const job = {
    id:          nextId(db.jobs),
    title, company, location,
    destination: destination || 'africa',
    salary:      salary      || null,
    industry:    industry    || null,
    description: description || null,
    openings:    openings    || 1,
    experience:  experience  || null,
    is_active:   1,
    created_at:  now()
  };
  db.jobs.push(job);
  writeDB(db);
  res.status(201).json({ success: true, job });
});

// DELETE /api/admin/jobs/:id
app.delete('/api/admin/jobs/:id', requireAuth, (req, res) => {
  const db = readDB();
  const job = db.jobs.find(j => j.id === +req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  job.is_active = 0;
  writeDB(db);
  res.json({ success: true, message: 'Job removed' });
});

// GET /api/admin/applicants
app.get('/api/admin/applicants', requireAuth, (req, res) => {
  const db = readDB();
  let applicants = [...db.applicants];
  if (req.query.status) applicants = applicants.filter(a => a.status === req.query.status);
  applicants.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json({ success: true, count: applicants.length, applicants });
});

// PATCH /api/admin/applicants/:id/status
app.patch('/api/admin/applicants/:id/status', requireAuth, (req, res) => {
  const { status } = req.body;
  const valid = ['new', 'contacted', 'placed', 'rejected'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const db = readDB();
  const applicant = db.applicants.find(a => a.id === +req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Applicant not found' });
  applicant.status = status;
  writeDB(db);
  res.json({ success: true, message: `Status updated to "${status}"` });
});

// GET /api/admin/stats
app.get('/api/admin/stats', requireAuth, (req, res) => {
  const db = readDB();
  res.json({
    success: true,
    stats: {
      totalJobs:       db.jobs.filter(j => j.is_active).length,
      totalApplicants: db.applicants.length,
      newApplicants:   db.applicants.filter(a => a.status === 'new').length,
      placed:          db.applicants.filter(a => a.status === 'placed').length
    }
  });
});

// ── START ──
readDB(); // init db.json if it doesn't exist
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`👤 Admin login: admin / admin123`);
});