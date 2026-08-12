const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

app.use(express.json());

// -------------------------------------------------------------------
// DATABASE SETUP
// -------------------------------------------------------------------
const db = new sqlite3.Database('./game.db', (err) => {
  if (err) console.error('Database connection error:', err);
  else console.log('Connected to SQLite database.');
});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    mobile TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'player'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS wallets (
    user_id INTEGER PRIMARY KEY,
    balance REAL DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS rounds (
    period_id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'open',
    result TEXT DEFAULT NULL,
    start_time INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    period_id TEXT,
    color TEXT,
    amount REAL,
    status TEXT DEFAULT 'pending'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    utr_number TEXT,
    status TEXT DEFAULT 'pending'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    amount REAL,
    upi_id TEXT,
    status TEXT DEFAULT 'pending'
  )`);
});

// -------------------------------------------------------------------
// GAME ENGINE & TIMER (60 Second Loop)
// -------------------------------------------------------------------
let currentRound = {
  periodId: generatePeriodId(),
  startTime: Date.now(),
  status: 'open'
};

function generatePeriodId() {
  const d = new Date();
  const dateStr = d.toISOString().slice(0,10).replace(/-/g, '');
  return `${dateStr}${Math.floor(Date.now() / 1000)}`;
}

db.run(`INSERT OR IGNORE INTO rounds (period_id, status, start_time) VALUES (?, 'open', ?)`, 
  [currentRound.periodId, currentRound.startTime]);

setInterval(() => {
  const elapsed = Math.floor((Date.now() - currentRound.startTime) / 1000);
  
  if (elapsed >= 50 && currentRound.status === 'open') {
    currentRound.status = 'closed';
    db.run(`UPDATE rounds SET status = 'closed' WHERE period_id = ?`, [currentRound.periodId]);
  }

  if (elapsed >= 60) {
    const colors = ['GREEN', 'RED'];
    const winningColor = colors[Math.floor(Math.random() * colors.length)];
    const activePeriod = currentRound.periodId;

    db.run(`UPDATE rounds SET status = 'completed', result = ? WHERE period_id = ?`, 
      [winningColor, activePeriod], () => {
        
        db.all(`SELECT * FROM bets WHERE period_id = ? AND status = 'pending'`, [activePeriod], (err, bets) => {
          if (!err && bets) {
            bets.forEach(bet => {
              if (bet.color === winningColor) {
                const winAmount = bet.amount * 2;
                db.run(`UPDATE bets SET status = 'WON' WHERE id = ?`, [bet.id]);
                db.run(`UPDATE wallets SET balance = balance + ? WHERE user_id = ?`, [winAmount, bet.user_id]);
              } else {
                db.run(`UPDATE bets SET status = 'LOST' WHERE id = ?`, [bet.id]);
              }
            });
          }
        });

        currentRound = {
          periodId: generatePeriodId(),
          startTime: Date.now(),
          status: 'open'
        };
        db.run(`INSERT INTO rounds (period_id, status, start_time) VALUES (?, 'open', ?)`, 
          [currentRound.periodId, currentRound.startTime]);
      });
  }
}, 1000);

// -------------------------------------------------------------------
// AUTHENTICATION MIDDLEWARE
// -------------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// -------------------------------------------------------------------
// API ENDPOINTS
// -------------------------------------------------------------------

// Register
app.post('/api/auth/register', async (req, res) => {
  const { name, mobile, password } = req.body;
  if (!name || !mobile || !password) return res.status(400).json({ error: 'All fields are required' });

  const hashedPassword = await bcrypt.hash(password, 10);
  db.get(`SELECT COUNT(*) as count FROM users`, [], (err, row) => {
    const role = (row && row.count === 0) ? 'admin' : 'player';

    db.run(`INSERT INTO users (name, mobile, password, role) VALUES (?, ?, ?, ?)`,
      [name, mobile, hashedPassword, role], function(err) {
        if (err) return res.status(400).json({ error: 'Mobile number already registered' });
        
        const userId = this.lastID;
        db.run(`INSERT INTO wallets (user_id, balance) VALUES (?, 0)`, [userId]);
        
        const token = jwt.sign({ id: userId, mobile, role }, JWT_SECRET);
        res.json({ token, user: { id: userId, name, mobile, role } });
      });
  });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { mobile, password } = req.body;
  db.get(`SELECT * FROM users WHERE mobile = ?`, [mobile], async (err, user) => {
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ error: 'Invalid mobile or password' });
    }
    const token = jwt.sign({ id: user.id, mobile: user.mobile, role: user.role }, JWT_SECRET);
    res.json({ token, user: { id: user.id, name: user.name, mobile: user.mobile, role: user.role } });
  });
});

// Current User Info
app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get(`SELECT id, name, mobile, role FROM users WHERE id = ?`, [req.user.id], (err, user) => {
    res.json({ user });
  });
});

// Balance Check
app.get('/api/balance', authenticateToken, (req, res) => {
  db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [req.user.id], (err, row) => {
    res.json({ balance: row ? row.balance : 0 });
  });
});

// Current Round State
app.get('/api/round', (req, res) => {
  const elapsed = Math.floor((Date.now() - currentRound.startTime) / 1000);
  res.json({
    periodId: currentRound.periodId,
    status: currentRound.status,
    elapsedSec: elapsed
  });
});

// Place Bet
app.post('/api/bet', authenticateToken, (req, res) => {
  const { color, amount } = req.body;
  const numAmount = parseFloat(amount);

  if (currentRound.status !== 'open') return res.status(400).json({ error: 'Betting is closed for this round' });
  if (!['GREEN', 'RED'].includes(color)) return res.status(400).json({ error: 'Invalid color choice' });
  if (isNaN(numAmount) || numAmount <= 0) return res.status(400).json({ error: 'Invalid bet amount' });

  db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [req.user.id], (err, wallet) => {
    if (!wallet || wallet.balance < numAmount) return res.status(400).json({ error: 'Insufficient balance' });

    db.run(`UPDATE wallets SET balance = balance - ? WHERE user_id = ?`, [numAmount, req.user.id], () => {
      db.run(`INSERT INTO bets (user_id, period_id, color, amount) VALUES (?, ?, ?, ?)`,
        [req.user.id, currentRound.periodId, color, numAmount], () => {
          res.json({ message: 'Bet placed successfully' });
        });
    });
  });
});

// Recent Game Results
app.get('/api/results', (req, res) => {
  db.all(`SELECT period_id, result FROM rounds WHERE status = 'completed' ORDER BY start_time DESC LIMIT 10`, [], (err, rows) => {
    res.json({ results: rows || [] });
  });
});

// My Bets History
app.get('/api/my-bets', authenticateToken, (req, res) => {
  db.all(`SELECT period_id, color, amount, status FROM bets WHERE user_id = ? ORDER BY id DESC LIMIT 10`, [req.user.id], (err, rows) => {
    res.json({ bets: rows || [] });
  });
});

// Deposit Request
app.post('/api/deposit', authenticateToken, (req, res) => {
  const { amount, utr } = req.body;
  if (!amount || !utr) return res.status(400).json({ error: 'Amount and UTR are required' });

  db.run(`INSERT INTO deposits (user_id, amount, utr_number) VALUES (?, ?, ?)`,
    [req.user.id, parseFloat(amount), utr], () => {
      res.json({ message: 'Deposit request submitted' });
    });
});

// Withdraw Request
app.post('/api/withdraw', authenticateToken, (req, res) => {
  const { amount, upiId } = req.body;
  const numAmount = parseFloat(amount);

  if (!numAmount || !upiId) return res.status(400).json({ error: 'Amount and UPI ID are required' });

  db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [req.user.id], (err, wallet) => {
    if (!wallet || wallet.balance < numAmount) return res.status(400).json({ error: 'Insufficient balance' });

    db.run(`UPDATE wallets SET balance = balance - ? WHERE user_id = ?`, [numAmount, req.user.id], () => {
      db.run(`INSERT INTO withdrawals (user_id, amount, upi_id) VALUES (?, ?, ?)`,
        [req.user.id, numAmount, upiId], () => {
          res.json({ message: 'Withdrawal request submitted' });
        });
    });
  });
});

// -------------------------------------------------------------------
// ADMIN ENDPOINTS
// -------------------------------------------------------------------
app.get('/api/admin/all', authenticateToken, requireAdmin, (req, res) => {
  db.all(`SELECT d.id, u.name, u.mobile, d.amount, d.utr_number, d.status FROM deposits d JOIN users u ON d.user_id = u.id WHERE d.status = 'pending'`, [], (err, deposits) => {
    db.all(`SELECT w.id, u.name, u.mobile, w.amount, w.upi_id, w.status FROM withdrawals w JOIN users u ON w.user_id = u.id WHERE w.status = 'pending'`, [], (err2, withdrawals) => {
      db.all(`SELECT u.id, u.name, u.mobile, u.role, w.balance FROM users u LEFT JOIN wallets w ON u.id = w.user_id`, [], (err3, users) => {
        res.json({ pendingDeposits: deposits || [], pendingWithdrawals: withdrawals || [], users: users || [] });
      });
    });
  });
});

app.post('/api/admin/deposit-action', authenticateToken, requireAdmin, (req, res) => {
  const { id, action } = req.body;
  db.get(`SELECT * FROM deposits WHERE id = ? AND status = 'pending'`, [id], (err, dep) => {
    if (!dep) return res.status(400).json({ error: 'Invalid or already processed deposit' });

    if (action === 'approve') {
      db.run(`UPDATE deposits SET status = 'approved' WHERE id = ?`, [id]);
      db.run(`UPDATE wallets SET balance = balance + ? WHERE user_id = ?`, [dep.amount, dep.user_id]);
      res.json({ message: 'Deposit approved' });
    } else {
      db.run(`UPDATE deposits SET status = 'rejected' WHERE id = ?`, [id]);
      res.json({ message: 'Deposit rejected' });
    }
  });
});

app.post('/api/admin/withdraw-action', authenticateToken, requireAdmin, (req, res) => {
  const { id, action } = req.body;
  db.get(`SELECT * FROM withdrawals WHERE id = ? AND status = 'pending'`, [id], (err, wit) => {
    if (!wit) return res.status(400).json({ error: 'Invalid or already processed withdrawal' });

    if (action === 'approve') {
      db.run(`UPDATE withdrawals SET status = 'approved' WHERE id = ?`, [id]);
      res.json({ message: 'Withdrawal approved' });
    } else {
      db.run(`UPDATE withdrawals SET status = 'rejected' WHERE id = ?`, [id]);
      db.run(`UPDATE wallets SET balance = balance + ? WHERE user_id = ?`, [wit.amount, wit.user_id]);
      res.json({ message: 'Withdrawal rejected and refunded' });
    }
  });
});

// -------------------------------------------------------------------
// HTML FRONTEND RENDERING (Embedded)
// -------------------------------------------------------------------

// User Game View
app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Colour Prediction Game</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: sans-serif; }
    body { background-color: #0f172a; color: #f8fafc; padding: 1rem; max-width: 500px; margin: 0 auto; }
    .card { background: #1e293b; border-radius: 8px; padding: 1rem; margin-bottom: 1rem; border: 1px solid #334155; }
    h2, h3 { margin-bottom: 0.5rem; text-align: center; }
    input { width: 100%; padding: 0.6rem; margin: 0.4rem 0; border-radius: 4px; border: 1px solid #475569; background: #0f172a; color: white; }
    button { width: 100%; padding: 0.7rem; margin-top: 0.5rem; border-radius: 4px; border: none; font-weight: bold; cursor: pointer; }
    .btn-primary { background: #2563eb; color: white; }
    .btn-green { background: #16a34a; color: white; font-size: 1.2rem; }
    .btn-red { background: #dc2626; color: white; font-size: 1.2rem; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .hidden { display: none; }
    .timer { font-size: 2rem; text-align: center; font-weight: bold; color: #f59e0b; margin: 0.5rem 0; }
    .flex-between { display: flex; justify-content: space-between; align-items: center; }
    .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); display: flex; justify-content: center; align-items: center; }
    .modal-content { background: #1e293b; padding: 1.5rem; border-radius: 8px; width: 90%; max-width: 400px; }
    .badge { padding: 0.2rem 0.5rem; border-radius: 4px; font-size: 0.8rem; text-transform: uppercase; }
    .bg-GREEN { background: #16a34a; color: white; }
    .bg-RED { background: #dc2626; color: white; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { padding: 0.5rem; text-align: center; border-bottom: 1px solid #334155; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div id="auth-section">
    <div class="card">
      <h2 id="auth-title">Login</h2>
      <input type="text" id="auth-name" placeholder="Full Name" class="hidden">
      <input type="text" id="auth-mobile" placeholder="Mobile Number (10 digits)">
      <input type="password" id="auth-password" placeholder="Password">
      <button id="auth-btn" class="btn-primary" onclick="handleAuth()">Login</button>
      <p style="text-align: center; margin-top: 0.8rem; font-size: 0.9rem; cursor: pointer; color: #60a5fa;" onclick="toggleAuthMode()">
        <span id="auth-toggle-text">Need an account? Register</span>
      </p>
    </div>
  </div>

  <div id="game-section" class="hidden">
    <div class="card flex-between">
      <div>
        <h3 id="user-name" style="text-align: left;">User</h3>
        <p style="font-size: 0.8rem; color: #94a3b8;" id="user-mobile"></p>
        <a id="admin-link" href="/admin" class="hidden" style="color: #f59e0b; font-size: 0.8rem;">Go to Admin Panel</a>
      </div>
      <div style="text-align: right;">
        <div style="font-size: 0.8rem; color: #94a3b8;">Balance</div>
        <div style="font-size: 1.2rem; font-weight: bold; color: #4ade80;">₹<span id="user-balance">0</span></div>
        <button onclick="logout()" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background: #475569; margin-top: 0.2rem;">Logout</button>
      </div>
    </div>

    <div class="grid-2" style="margin-bottom: 1rem;">
      <button class="btn-primary" onclick="openModal('deposit-modal')">Deposit</button>
      <button class="btn-primary" style="background: #0284c7;" onclick="openModal('withdraw-modal')">Withdraw</button>
    </div>

    <div class="card">
      <div class="flex-between">
        <span>Period: <strong id="round-period">-</strong></span>
        <span id="round-status" class="badge" style="background: #475569;">OPEN</span>
      </div>
      <div class="timer" id="round-timer">00:00</div>
      <div class="grid-2">
        <button class="btn-green" onclick="openBetModal('GREEN')">GREEN (2x)</button>
        <button class="btn-red" onclick="openBetModal('RED')">RED (2x)</button>
      </div>
    </div>

    <div class="card">
      <h3>Recent Results</h3>
      <table>
        <thead><tr><th>Period</th><th>Result</th></tr></thead>
        <tbody id="results-table"></tbody>
      </table>
    </div>

    <div class="card">
      <h3>My Bets</h3>
      <table>
        <thead><tr><th>Period</th><th>Color</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody id="bets-table"></tbody>
      </table>
    </div>
  </div>

  <div id="bet-modal" class="modal hidden">
    <div class="modal-content">
      <h3>Place Bet on <span id="modal-color"></span></h3>
      <input type="number" id="bet-amount" placeholder="Amount (Min 10)">
      <div class="grid-2">
        <button class="btn-primary" onclick="placeBet()">Confirm Bet</button>
        <button style="background: #475569; color: white;" onclick="closeModal('bet-modal')">Cancel</button>
      </div>
    </div>
  </div>

  <div id="deposit-modal" class="modal hidden">
    <div class="modal-content">
      <h3>Deposit Funds</h3>
      <input type="number" id="deposit-amount" placeholder="Amount (Min ₹10)">
      <input type="text" id="deposit-utr" placeholder="UTR / Transaction Ref Number">
      <div class="grid-2">
        <button class="btn-primary" onclick="submitDeposit()">Submit Deposit</button>
        <button style="background: #475569; color: white;" onclick="closeModal('deposit-modal')">Cancel</button>
      </div>
    </div>
  </div>

  <div id="withdraw-modal" class="modal hidden">
    <div class="modal-content">
      <h3>Withdraw Funds</h3>
      <input type="number" id="withdraw-amount" placeholder="Amount">
      <input type="text" id="withdraw-upi" placeholder="UPI ID (e.g. name@upi)">
      <div class="grid-2">
        <button class="btn-primary" onclick="submitWithdraw()">Request Withdrawal</button>
        <button style="background: #475569; color: white;" onclick="closeModal('withdraw-modal')">Cancel</button>
      </div>
    </div>
  </div>

  <script>
    let isRegister = false;
    let selectedColor = null;
    let pollInterval = null;

    function getToken() { return localStorage.getItem("cp_token"); }

    async function apiCall(endpoint, method = "GET", body = null) {
      const headers = { "Content-Type": "application/json" };
      const token = getToken();
      if (token) headers["Authorization"] = \`Bearer \${token}\`;
      const res = await fetch(\`/api\${endpoint}\`, { method, headers, body: body ? JSON.stringify(body) : null });
      return res.json();
    }

    function toggleAuthMode() {
      isRegister = !isRegister;
      document.getElementById("auth-title").innerText = isRegister ? "Register" : "Login";
      document.getElementById("auth-btn").innerText = isRegister ? "Register" : "Login";
      document.getElementById("auth-toggle-text").innerText = isRegister ? "Already have an account? Login" : "Need an account? Register";
      document.getElementById("auth-name").classList.toggle("hidden", !isRegister);
    }

    async function handleAuth() {
      const mobile = document.getElementById("auth-mobile").value;
      const password = document.getElementById("auth-password").value;
      const name = document.getElementById("auth-name").value;
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const payload = isRegister ? { name, mobile, password } : { mobile, password };

      const data = await apiCall(endpoint, "POST", payload);
      if (data.error) return alert(data.error);

      localStorage.setItem("cp_token", data.token);
      initApp();
    }

    function logout() {
      localStorage.removeItem("cp_token");
      clearInterval(pollInterval);
      document.getElementById("auth-section").classList.remove("hidden");
      document.getElementById("game-section").classList.add("hidden");
    }

    async function initApp() {
      const token = getToken();
      if (!token) return;

      const me = await apiCall("/auth/me");
      if (!me.user) return logout();

      document.getElementById("auth-section").classList.add("hidden");
      document.getElementById("game-section").classList.remove("hidden");
      document.getElementById("user-name").innerText = me.user.name;
      document.getElementById("user-mobile").innerText = me.user.mobile;
      if (me.user.role === "admin") document.getElementById("admin-link").classList.remove("hidden");

      refreshUserData();
      pollRound();
      pollInterval = setInterval(pollRound, 2000);
    }

    async function refreshUserData() {
      const wallet = await apiCall("/balance");
      if (wallet.balance !== undefined) document.getElementById("user-balance").innerText = wallet.balance;

      const bets = await apiCall("/my-bets");
      if (bets.bets) {
        document.getElementById("bets-table").innerHTML = bets.bets.map(b => \`
          <tr>
            <td>\${b.period_id}</td>
            <td><span class="badge bg-\${b.color}">\${b.color}</span></td>
            <td>₹\${b.amount}</td>
            <td>\${b.status}</td>
          </tr>
        \`).join('');
      }
    }

    async function pollRound() {
      const round = await apiCall("/round");
      if (round.error) return;

      document.getElementById("round-period").innerText = round.periodId;
      document.getElementById("round-status").innerText = round.status.toUpperCase();
      document.getElementById("round-status").className = \`badge \${round.status === 'open' ? 'bg-GREEN' : 'bg-RED'}\`;

      const remaining = Math.max(0, 60 - round.elapsedSec);
      const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
      const secs = String(remaining % 60).padStart(2, '0');
      document.getElementById("round-timer").innerText = \`\${mins}:\${secs}\`;

      const results = await apiCall("/results");
      if (results.results) {
        document.getElementById("results-table").innerHTML = results.results.map(r => \`
          <tr>
            <td>\${r.period_id}</td>
            <td><span class="badge bg-\${r.result}">\${r.result}</span></td>
          </tr>
        \`).join('');
      }

      refreshUserData();
    }

    function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
    function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

    function openBetModal(color) {
      selectedColor = color;
      document.getElementById("modal-color").innerText = color;
      openModal("bet-modal");
    }

    async function placeBet() {
      const amount = document.getElementById("bet-amount").value;
      const res = await apiCall("/bet", "POST", { color: selectedColor, amount });
      if (res.error) return alert(res.error);
      closeModal("bet-modal");
      refreshUserData();
    }

    async function submitDeposit() {
      const amount = document.getElementById("deposit-amount").value;
      const utr = document.getElementById("deposit-utr").value;
      const res = await apiCall("/deposit", "POST", { amount, utr });
      if (res.error) return alert(res.error);
      alert("Deposit request submitted!");
      closeModal("deposit-modal");
    }

    async function submitWithdraw() {
      const amount = document.getElementById("withdraw-amount").value;
      const upiId = document.getElementById("withdraw-upi").value;
      const res = await apiCall("/withdraw", "POST", { amount, upiId });
      if (res.error) return alert(res.error);
      alert("Withdrawal request submitted!");
      closeModal("withdraw-modal");
      refreshUserData();
    }

    if (getToken()) initApp();
  </script>
</body>
</html>`);
});

// Admin View
app.get('/admin', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Dashboard — Colour Prediction</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: sans-serif; }
    body { background-color: #0f172a; color: #f8fafc; padding: 1.5rem; max-width: 900px; margin: 0 auto; }
    .card { background: #1e293b; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; border: 1px solid #334155; }
    h2 { margin-bottom: 1rem; color: #f59e0b; }
    table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
    th, td { padding: 0.6rem; text-align: left; border-bottom: 1px solid #334155; font-size: 0.9rem; }
    button { padding: 0.3rem 0.6rem; border-radius: 4px; border: none; font-weight: bold; cursor: pointer; margin-right: 0.3rem; }
    .btn-approve { background: #16a34a; color: white; }
    .btn-reject { background: #dc2626; color: white; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    a { color: #60a5fa; text-decoration: none; }
  </style>
</head>
<body>
  <div class="header">
    <h1>Admin Panel</h1>
    <a href="/">← Back to Game</a>
  </div>

  <div class="card">
    <h2>Pending Deposits</h2>
    <table>
      <thead><tr><th>ID</th><th>User</th><th>Mobile</th><th>Amount</th><th>UTR</th><th>Action</th></tr></thead>
      <tbody id="deposits-table"></tbody>
    </table>
  </div>

  <div class="card">
    <h2>Pending Withdrawals</h2>
    <table>
      <thead><tr><th>ID</th><th>User</th><th>Mobile</th><th>Amount</th><th>UPI ID</th><th>Action</th></tr></thead>
      <tbody id="withdrawals-table"></tbody>
    </table>
  </div>

  <div class="card">
    <h2>Registered Users</h2>
    <table>
      <thead><tr><th>ID</th><th>Name</th><th>Mobile</th><th>Role</th><th>Balance</th></tr></thead>
      <tbody id="users-table"></tbody>
    </table>
  </div>

  <script>
    function getToken() { return localStorage.getItem("cp_token"); }

    async function apiCall(endpoint, method = "GET", body = null) {
      const headers = { "Content-Type": "application/json" };
      const token = getToken();
      if (token) headers["Authorization"] = \`Bearer \${token}\`;
      const res = await fetch(\`/api\${endpoint}\`, { method, headers, body: body ? JSON.stringify(body) : null });
      return res.json();
    }

    async function loadAdminData() {
      const data = await apiCall("/admin/all");
      if (data.error) {
        alert(data.error);
        window.location.href = "/";
        return;
      }

      document.getElementById("deposits-table").innerHTML = data.pendingDeposits.length ? data.pendingDeposits.map(d => \`
        <tr>
          <td>\${d.id}</td>
          <td>\${d.name}</td>
          <td>\${d.mobile}</td>
          <td>₹\${d.amount}</td>
          <td><code>\${d.utr_number}</code></td>
          <td>
            <button class="btn-approve" onclick="handleDeposit(\${d.id}, 'approve')">Approve</button>
            <button class="btn-reject" onclick="handleDeposit(\${d.id}, 'reject')">Reject</button>
          </td>
        </tr>
      \`).join('') : '<tr><td colspan="6" style="text-align:center;">No pending deposits</td></tr>';

      document.getElementById("withdrawals-table").innerHTML = data.pendingWithdrawals.length ? data.pendingWithdrawals.map(w => \`
        <tr>
          <td>\${w.id}</td>
          <td>\${w.name}</td>
          <td>\${w.mobile}</td>
          <td>₹\${w.amount}</td>
          <td><code>\${w.upi_id}</code></td>
          <td>
            <button class="btn-approve" onclick="handleWithdraw(\${w.id}, 'approve')">Approve</button>
            <button class="btn-reject" onclick="handleWithdraw(\${w.id}, 'reject')">Reject</button>
          </td>
        </tr>
      \`).join('') : '<tr><td colspan="6" style="text-align:center;">No pending withdrawals</td></tr>';

      document.getElementById("users-table").innerHTML = data.users.map(u => \`
        <tr>
          <td>\${u.id}</td>
          <td>\${u.name}</td>
          <td>\${u.mobile}</td>
          <td><strong>\${u.role}</strong></td>
          <td>₹\${u.balance || 0}</td>
        </tr>
      \`).join('');
    }

    async function handleDeposit(id, action) {
      const res = await apiCall("/admin/deposit-action", "POST", { id, action });
      if (res.error) return alert(res.error);
      loadAdminData();
    }

    async function handleWithdraw(id, action) {
      const res = await apiCall("/admin/withdraw-action", "POST", { id, action });
      if (res.error) return alert(res.error);
      loadAdminData();
    }

    loadAdminData();
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
