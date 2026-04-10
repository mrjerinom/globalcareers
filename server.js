const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'changeme_in_production';

// ── MIDDLEWARE ──
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── DATABASE SETUP ──
const adapter = new JSONFile('db.json');
const defaultData = {
  jobs: [],
  applicants: [],
  admins: [
    {
      id: 1,
      username: 'admin',
      password: bcrypt.hashSync('admin123', 10)
    }
  ]
};

const db = new Low(adapter, defaultData);

async function initDB() {
  await db.read();
  db.data.jobs = db.data.jobs || [];
  db.data.applicants = db.data.applicants || [];
  db.data.admins = db.data.admins || defaultData.admins;
  await db.write();
  console.log('✅ Database ready');
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
// PUBLIC ROUTES
// ═══════════════════════════════════

// GET jobs
app.get('/api/jobs', async (req, res) => {
  await db.read();
  let jobs = db.data.jobs.filter(j => j.is_active);

  if (req.query.destination) jobs = jobs.filter(j => j.destination === req.query.destination);
  if (req.query.industry) jobs = jobs.filter(j => j.industry === req.query.industry);

  jobs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({ success: true, jobs });
});

// GET single job
app.get('/api/jobs/:id', async (req, res) => {
  await db.read();
  const job = db.data.jobs.find(j => j.id === +req.params.id && j.is_active);

  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.json({ success: true, job });
});

// APPLY
app.post('/api/apply', async (req, res) => {
  const { name, phone, email, city, destination, industry, message } = req.body;

  if (!name || !phone)
    return res.status(400).json({ error: 'Name and phone required' });

  await db.read();

  const applicant = {
    id: nextId(db.data.applicants),
    name,
    phone,
    email: email || null,
    city: city || null,
    destination: destination || null,
    industry: industry || null,
    message: message || null,
    status: 'new',
    created_at: now()
  };

  db.data.applicants.push(applicant);
  await db.write();

  res.json({ success: true, message: 'Application submitted' });
});

// ═══════════════════════════════════
// ADMIN LOGIN
// ═══════════════════════════════════

app.post('/api/admin/login', async (req, res) => {
  await db.read();
  const { username, password } = req.body;

  const admin = db.data.admins.find(a => a.username === username);

  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign({ id: admin.id }, JWT_SECRET, { expiresIn: '8h' });

  res.json({ success: true, token });
});

// ═══════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════

// GET jobs
app.get('/api/admin/jobs', requireAuth, async (req, res) => {
  await db.read();
  res.json({ jobs: db.data.jobs });
});

// CREATE job
app.post('/api/admin/jobs', requireAuth, async (req, res) => {
  const { title, company, location } = req.body;

  if (!title || !company || !location)
    return res.status(400).json({ error: 'Missing fields' });

  await db.read();

  const job = {
    id: nextId(db.data.jobs),
    ...req.body,
    is_active: 1,
    created_at: now()
  };

  db.data.jobs.push(job);
  await db.write();

  res.json({ success: true });
});

// DELETE job
app.delete('/api/admin/jobs/:id', requireAuth, async (req, res) => {
  await db.read();

  const job = db.data.jobs.find(j => j.id === +req.params.id);

  if (!job) return res.status(404).json({ error: 'Not found' });

  job.is_active = 0;
  await db.write();

  res.json({ success: true });
});

// GET applicants
app.get('/api/admin/applicants', requireAuth, async (req, res) => {
  await db.read();
  res.json({ applicants: db.data.applicants });
});

// ✅ FIXED ROUTE (THIS WAS YOUR BUG)
app.patch('/api/admin/applicants/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;

  await db.read();

  const applicant = db.data.applicants.find(a => a.id === +req.params.id);

  if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

  applicant.status = status;

  await db.write();

  res.json({ success: true });
});

// STATS
app.get('/api/admin/stats', requireAuth, async (req, res) => {
  await db.read();

  res.json({
    totalJobs: db.data.jobs.length,
    totalApplicants: db.data.applicants.length
  });
});

// ── START SERVER ──
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
});