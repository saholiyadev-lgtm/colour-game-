/* =========================================================
   FULL COLOR PREDICTION GAME SERVER (Node.js + Express + MongoDB)
   ========================================================= */

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Render માટે bcryptjs વાપરેલ છે
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// 1. DATABASE CONNECTION
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/colorgame';
mongoose.connect(MONGO_URI)
    .then(() => console.log('MongoDB Connected Successfully'))
    .catch(err => console.error('MongoDB Connection Error:', err));

// 2. MONGOOSE SCHEMAS & MODELS
const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 100.00 }
});

const depositSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    utrNumber: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVE', 'REJECT'], default: 'PENDING' },
    date: { type: Date, default: Date.now }
});

const withdrawSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    upiId: { type: String, required: true },
    status: { type: String, enum: ['PENDING', 'APPROVE', 'REJECT'], default: 'PENDING' },
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Deposit = mongoose.model('Deposit', depositSchema);
const Withdraw = mongoose.model('Withdraw', withdrawSchema);

// In-Memory Game State
let gameHistory = [];
let currentPeriodId = 100001;
let timer = 60;
let lastResult = null;
let upcomingResult = null;
let currentBets = [];

// 3. GAME TIMER ENGINE (60 Secs Loop)
setInterval(async () => {
    timer--;

    if (timer === 30) {
        let totalGreen = currentBets.filter(b => b.color === 'Green').reduce((sum, b) => sum + b.amount, 0);
        let totalRed = currentBets.filter(b => b.color === 'Red').reduce((sum, b) => sum + b.amount, 0);
        upcomingResult = totalGreen > totalRed ? 'Red' : 'Green';
    }

    if (timer <= 0) {
        if (!upcomingResult) upcomingResult = Math.random() > 0.5 ? 'Green' : 'Red';

        lastResult = upcomingResult;
        gameHistory.unshift({ periodId: currentPeriodId, color: lastResult });
        if (gameHistory.length > 20) gameHistory.pop();

        // Distribute Winnings
        for (let bet of currentBets) {
            if (bet.color === lastResult) {
                const winAmount = bet.amount * 1.98;
                await User.findOneAndUpdate(
                    { username: bet.userId },
                    { $inc: { balance: winAmount } }
                );
            }
        }

        currentBets = [];
        currentPeriodId++;
        upcomingResult = null;
        timer = 60;
    }
}, 1000);

/* =========================================================
   AUTHENTICATION APIS
   ========================================================= */

// Register User
app.post('/api/auth/register', async (req, res) => {
    try {
        const username = req.body.username ? req.body.username.trim() : '';
        const password = req.body.password ? req.body.password.trim() : '';

        if (!username || !password) {
            return res.status(400).json({ message: 'Username and Password required!' });
        }

        const existingUser = await User.findOne({ username });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists!' });
        }

        // Hash Password before saving
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ username, password: hashedPassword, balance: 100.00 });
        await newUser.save();

        res.json({ message: 'Account registered successfully! Please login.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error during registration.' });
    }
});

// Login User
app.post('/api/auth/login', async (req, res) => {
    try {
        const username = req.body.username ? req.body.username.trim() : '';
        const password = req.body.password ? req.body.password.trim() : '';

        const user = await User.findOne({ username });
        if (!user) {
            return res.status(401).json({ message: 'Invalid Username or Password!' });
        }

        // Compare Plain Password with Hashed Password in DB
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid Username or Password!' });
        }

        res.json({ message: 'Login successful!', username: user.username });
    } catch (err) {
        res.status(500).json({ message: 'Server error during login.' });
    }
});

// Admin Login
app.post('/api/auth/admin', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === 'admin123') {
        res.json({ message: 'Admin authenticated' });
    } else {
        res.status(401).json({ message: 'Invalid Admin Credentials' });
    }
});

/* =========================================================
   USER & GAMEPLAY APIS
   ========================================================= */

// Get User State & Transaction History
app.get('/api/state/:userId', async (req, res) => {
    try {
        const userId = req.params.userId;
        const user = await User.findOne({ username: userId });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const userDeposits = await Deposit.find({ userId }).sort({ date: -1 });
        const userWithdrawals = await Withdraw.find({ userId }).sort({ date: -1 });

        res.json({
            timer,
            periodId: currentPeriodId,
            balance: user.balance,
            lastResult,
            history: gameHistory,
            deposits: userDeposits,
            withdrawals: userWithdrawals
        });
    } catch (err) {
        res.status(500).json({ message: 'Error fetching state' });
    }
});

// Place Bet
app.post('/api/place-bet', async (req, res) => {
    const { userId, color, amount } = req.body;
    const betAmt = parseFloat(amount);

    if (timer <= 10) return res.status(400).json({ message: 'Betting closed for this round!' });
    if (isNaN(betAmt) || betAmt <= 0) return res.status(400).json({ message: 'Invalid bet amount' });

    const user = await User.findOne({ username: userId });
    if (!user || user.balance < betAmt) return res.status(400).json({ message: 'Insufficient balance!' });

    user.balance -= betAmt;
    await user.save();

    currentBets.push({ userId, color, amount: betAmt });
    res.json({ message: 'Bet placed successfully!', balance: user.balance });
});

// Submit Deposit
app.post('/api/deposit', async (req, res) => {
    const { userId, amount, utrNumber } = req.body;
    const depAmount = parseFloat(amount);

    if (!depAmount || !utrNumber || depAmount <= 0) {
        return res.status(400).json({ message: 'Invalid Deposit Details!' });
    }

    const newDeposit = new Deposit({ userId, amount: depAmount, utrNumber });
    await newDeposit.save();

    res.json({ message: 'Deposit request submitted successfully!' });
});

// Submit Withdrawal
app.post('/api/withdraw', async (req, res) => {
    const { userId, amount, upiId } = req.body;
    const witAmt = parseFloat(amount);

    if (isNaN(witAmt) || witAmt <= 0 || !upiId) {
        return res.status(400).json({ message: 'Invalid Withdrawal Details!' });
    }

    const user = await User.findOne({ username: userId });
    if (!user || user.balance < witAmt) {
        return res.status(400).json({ message: 'Insufficient balance!' });
    }

    user.balance -= witAmt;
    await user.save();

    const newWithdrawal = new Withdraw({ userId, amount: witAmt, upiId });
    await newWithdrawal.save();

    res.json({ message: 'Withdrawal requested successfully!', newBalance: user.balance });
});

/* =========================================================
   ADMIN APIS
   ========================================================= */

app.get('/api/admin/data', async (req, res) => {
    const users = await User.find({}, 'username balance');
    const deposits = await Deposit.find({ status: 'PENDING' });
    const withdrawals = await Withdraw.find({ status: 'PENDING' });

    res.json({ users, deposits, withdrawals, upcomingResult, timer });
});

app.post('/api/admin/deposit-action', async (req, res) => {
    const { id, action } = req.body;
    const deposit = await Deposit.findById(id);

    if (!deposit || deposit.status !== 'PENDING') {
        return res.status(400).json({ message: 'Invalid request' });
    }

    deposit.status = action;
    await deposit.save();

    if (action === 'APPROVE') {
        await User.findOneAndUpdate(
            { username: deposit.userId },
            { $inc: { balance: deposit.amount } }
        );
    }

    res.json({ message: `Deposit ${action.toLowerCase()}d successfully!` });
});

app.post('/api/admin/withdraw-action', async (req, res) => {
    const { id, action } = req.body;
    const withdraw = await Withdraw.findById(id);

    if (!withdraw || withdraw.status !== 'PENDING') {
        return res.status(400).json({ message: 'Invalid request' });
    }

    withdraw.status = action;
    await withdraw.save();

    if (action === 'REJECT') {
        await User.findOneAndUpdate(
            { username: withdraw.userId },
            { $inc: { balance: withdraw.amount } }
        );
    }

    res.json({ message: `Withdrawal ${action.toLowerCase()}d successfully!` });
});

/* =========================================================
   FRONTEND USER INTERFACE
   ========================================================= */

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Color Prediction Game Portal</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
        body { background-color: #0f172a; color: #f8fafc; display: flex; justify-content: center; min-height: 100vh; padding: 15px; }
        .container { width: 100%; max-width: 480px; background: #1e293b; padding: 20px; border-radius: 12px; }
        h2, h3 { text-align: center; margin-bottom: 15px; color: #38bdf8; }
        input, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; border: none; font-size: 15px; }
        input { background: #334155; color: #fff; outline: none; }
        button { cursor: pointer; font-weight: bold; background: #0284c7; color: white; }
        .btn-green { background: #16a34a; } .btn-red { background: #dc2626; }
        .flex { display: flex; gap: 10px; }
        .card { background: #334155; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .timer { font-size: 32px; font-weight: bold; color: #facc15; text-align: center; }
        .history-grid { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
        .history-item { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; }
        .bg-Green { background: #16a34a; } .bg-Red { background: #dc2626; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
        th, td { border: 1px solid #475569; padding: 6px; text-align: center; }
        .badge { padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 11px; }
        .badge-PENDING { background: #eab308; color: #000; }
        .badge-APPROVE { background: #22c55e; color: #fff; }
        .badge-REJECT { background: #ef4444; color: #fff; }
        .tabs { display: flex; border-bottom: 2px solid #475569; margin-bottom: 15px; }
        .tab-btn { flex: 1; background: transparent; color: #94a3b8; padding: 10px; border-radius: 0; }
        .tab-btn.active { color: #38bdf8; border-bottom: 3px solid #38bdf8; background: #334155; }
    </style>
</head>
<body>

<div class="container">

    <div id="authSection">
        <h2>Gaming Portal</h2>
        <div class="tabs">
            <button class="tab-btn active" id="tabLoginBtn" onclick="switchAuthTab('login')">Login</button>
            <button class="tab-btn" id="tabRegBtn" onclick="switchAuthTab('register')">Register</button>
            <button class="tab-btn" id="tabAdminBtn" onclick="switchAuthTab('admin')">Admin</button>
        </div>

        <div id="loginForm">
            <input type="text" id="loginUser" placeholder="Username / Phone">
            <input type="password" id="loginPass" placeholder="Password">
            <button onclick="loginUser()">Login</button>
        </div>

        <div id="registerForm" style="display: none;">
            <input type="text" id="regUser" placeholder="Choose Username / Phone">
            <input type="password" id="regPass" placeholder="Set Password">
            <button onclick="registerUser()" class="btn-green">Register New Account</button>
        </div>

        <div id="adminForm" style="display: none;">
            <input type="text" id="adminUser" placeholder="Admin Username">
            <input type="password" id="adminPass" placeholder="Admin Password">
            <button onclick="adminLogin()" style="background: #475569;">Admin Login</button>
        </div>

        <p id="authMsg" style="color: #f87171; text-align: center; margin-top: 10px; font-weight: bold;"></p>
    </div>

    <div id="gameSection" style="display: none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span>User: <b id="displayUid" style="color:#38bdf8;"></b></span>
            <button onclick="logout()" style="width:auto; padding:5px 12px; background:#e11d48;">Logout</button>
        </div>

        <div class="card" style="text-align: center;">
            <div>Available Balance</div>
            <h1 style="color:#4ade80;">₹<span id="balance">0.00</span></h1>
            <div class="flex" style="margin-top: 10px;">
                <button onclick="showTabSection('depositSection')" class="btn-green">Deposit</button>
                <button onclick="showTabSection('withdrawSection')" style="background:#0284c7;">Withdraw</button>
                <button onclick="showTabSection('historySection')" style="background:#475569;">History</button>
            </div>
        </div>

        <div id="depositSection" class="card" style="display:none;">
            <h3>Deposit Money</h3>
            <input type="number" id="depAmount" placeholder="Amount (₹)">
            <input type="text" id="utrNumber" placeholder="12-Digit UTR Number">
            <button onclick="submitDeposit()" class="btn-green">Submit Deposit Request</button>
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline;">Close</button>
            <p id="depMsg" style="text-align:center; margin-top:5px;"></p>
        </div>

        <div id="withdrawSection" class="card" style="display:none;">
            <h3>Request Withdrawal</h3>
            <input type="number" id="witAmount" placeholder="Amount (₹)">
            <input type="text" id="witUpi" placeholder="UPI ID (e.g. name@upi)">
            <button onclick="submitWithdraw()" class="btn-green">Request Pay-out</button>
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline;">Close</button>
            <p id="witMsg" style="text-align:center; margin-top:5px;"></p>
        </div>

        <div id="historySection" class="card" style="display:none;">
            <h3>Deposit & Withdraw History</h3>
            <div style="max-height: 200px; overflow-y: auto;">
                <h4 style="margin-top:5px; color:#38bdf8;">Deposits</h4>
                <table>
                    <thead><tr><th>Amount</th><th>UTR</th><th>Status</th></tr></thead>
                    <tbody id="userDepHistory"></tbody>
                </table>
                <h4 style="margin-top:10px; color:#38bdf8;">Withdrawals</h4>
                <table>
                    <thead><tr><th>Amount</th><th>UPI ID</th><th>Status</th></tr></thead>
                    <tbody id="userWitHistory"></tbody>
                </table>
            </div>
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline; margin-top:8px;">Close</button>
        </div>

        <div class="card">
            <div style="text-align:center;">Period ID: <b id="periodId" style="color:#facc15;">------</b></div>
            <div class="timer" id="timer">60</div>
            <div style="margin-top: 10px;" class="flex">
                <button onclick="placeBet('Green')" class="btn-green">Bet Green (2x)</button>
                <button onclick="placeBet('Red')" class="btn-red">Bet Red (2x)</button>
            </div>
            <input type="number" id="betAmount" placeholder="Bet Amount (₹)" value="10" style="margin-top: 10px;">
            <p id="gameMsg" style="margin-top: 5px; text-align:center;"></p>
        </div>

        <div class="card">
            <h3>Recent Round Results</h3>
            <div class="history-grid" id="history"></div>
        </div>
    </div>

    <div id="adminSection" style="display: none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3>Admin Panel</h3>
            <button onclick="logout()" style="width:auto; padding:5px 10px; background:#e11d48;">Logout</button>
        </div>

        <div class="card">
            <h3>Pending Deposit Approval</h3>
            <table>
                <thead><tr><th>User</th><th>Amt</th><th>UTR</th><th>Action</th></tr></thead>
                <tbody id="adminDepositTable"></tbody>
            </table>
        </div>

        <div class="card">
            <h3>Pending Withdrawal Approval</h3>
            <table>
                <thead><tr><th>User</th><th>Amt</th><th>UPI ID</th><th>Action</th></tr></thead>
                <tbody id="adminWithdrawTable"></tbody>
            </table>
        </div>

        <div class="card">
            <h3>Registered Users</h3>
            <table>
                <thead><tr><th>Username</th><th>Balance</th></tr></thead>
                <tbody id="adminUsersTable"></tbody>
            </table>
        </div>
    </div>

</div>

<script>
let currentUserId = localStorage.getItem('game_uid');
let isAdmin = localStorage.getItem('is_admin') === 'true';
let timerInterval = null;

if (isAdmin) showAdminDashboard();
else if (currentUserId) showDashboard();

function switchAuthTab(tab) {
    document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
    document.getElementById('adminForm').style.display = tab === 'admin' ? 'block' : 'none';

    document.getElementById('tabLoginBtn').className = 'tab-btn ' + (tab === 'login' ? 'active' : '');
    document.getElementById('tabRegBtn').className = 'tab-btn ' + (tab === 'register' ? 'active' : '');
    document.getElementById('tabAdminBtn').className = 'tab-btn ' + (tab === 'admin' ? 'active' : '');
    document.getElementById('authMsg').innerText = '';
}

async function registerUser() {
    const username = document.getElementById('regUser').value.trim();
    const password = document.getElementById('regPass').value.trim();

    const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    document.getElementById('authMsg').innerText = data.message;
    if (res.ok) setTimeout(() => switchAuthTab('login'), 1200);
}

async function loginUser() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
        currentUserId = data.username;
        localStorage.setItem('game_uid', currentUserId);
        showDashboard();
    } else {
        document.getElementById('authMsg').innerText = data.message;
    }
}

async function adminLogin() {
    const username = document.getElementById('adminUser').value.trim();
    const password = document.getElementById('adminPass').value.trim();

    const res = await fetch('/api/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
        isAdmin = true;
        localStorage.setItem('is_admin', 'true');
        showAdminDashboard();
    } else {
        document.getElementById('authMsg').innerText = data.message;
    }
}

function logout() {
    localStorage.removeItem('game_uid');
    localStorage.removeItem('is_admin');
    currentUserId = null;
    isAdmin = false;
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('adminSection').style.display = 'none';
    document.getElementById('gameSection').style.display = 'none';
    document.getElementById('authSection').style.display = 'block';
}

function showDashboard() {
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('adminSection').style.display = 'none';
    document.getElementById('gameSection').style.display = 'block';
    document.getElementById('displayUid').innerText = currentUserId;

    fetchGameState();
    if (!timerInterval) timerInterval = setInterval(fetchGameState, 1000);
}

function showAdminDashboard() {
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('gameSection').style.display = 'none';
    document.getElementById('adminSection').style.display = 'block';

    fetchAdminData();
    if (!timerInterval) timerInterval = setInterval(fetchAdminData, 2000);
}

function showTabSection(id) {
    hideTabSections();
    document.getElementById(id).style.display = 'block';
}

function hideTabSections() {
    document.getElementById('depositSection').style.display = 'none';
    document.getElementById('withdrawSection').style.display = 'none';
    document.getElementById('historySection').style.display = 'none';
}

async function fetchGameState() {
    if (!currentUserId) return;
    const res = await fetch('/api/state/' + currentUserId);
    if (!res.ok) { if (res.status === 404) logout(); return; }
    const data = await res.json();

    document.getElementById('timer').innerText = data.timer;
    document.getElementById('periodId').innerText = data.periodId;
    document.getElementById('balance').innerText = data.balance.toFixed(2);

    document.getElementById('history').innerHTML = data.history.map(item => \`
        <div class="history-item bg-\${item.color}">\${item.color === 'Green' ? 'G' : 'R'}</div>
    \`).join('');

    document.getElementById('userDepHistory').innerHTML = data.deposits.map(d => \`
        <tr><td>₹\${d.amount}</td><td>\${d.utrNumber}</td><td><span class="badge badge-\${d.status}">\${d.status}</span></td></tr>
    \`).join('') || '<tr><td colspan="3">No deposits</td></tr>';

    document.getElementById('userWitHistory').innerHTML = data.withdrawals.map(w => \`
        <tr><td>₹\${w.amount}</td><td>\${w.upiId}</td><td><span class="badge badge-\${w.status}">\${w.status}</span></td></tr>
    \`).join('') || '<tr><td colspan="3">No withdrawals</td></tr>';
}

async function placeBet(color) {
    const amount = document.getElementById('betAmount').value;
    const res = await fetch('/api/place-bet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, color, amount })
    });
    const data = await res.json();
    document.getElementById('gameMsg').innerText = data.message;
}

async function submitDeposit() {
    const amount = document.getElementById('depAmount').value;
    const utrNumber = document.getElementById('utrNumber').value.trim();
    const res = await fetch('/api/deposit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, amount, utrNumber })
    });
    const data = await res.json();
    document.getElementById('depMsg').innerText = data.message;
}

async function submitWithdraw() {
    const amount = document.getElementById('witAmount').value;
    const upiId = document.getElementById('witUpi').value.trim();
    const res = await fetch('/api/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: currentUserId, amount, upiId })
    });
    const data = await res.json();
    document.getElementById('witMsg').innerText = data.message;
}

async function fetchAdminData() {
    if (!isAdmin) return;
    const res = await fetch('/api/admin/data');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('adminUsersTable').innerHTML = data.users.map(u => \`
        <tr><td>\${u.username}</td><td>₹\${u.balance.toFixed(2)}</td></tr>
    \`).join('');

    document.getElementById('adminDepositTable').innerHTML = data.deposits.map(d => \`
        <tr>
            <td>\${d.userId}</td><td>₹\${d.amount}</td><td>\${d.utrNumber}</td>
            <td>
                <button onclick="handleDepositAction('\${d._id}', 'APPROVE')" style="padding:4px; background:#16a34a; width:auto;">Approve</button>
                <button onclick="handleDepositAction('\${d._id}', 'REJECT')" style="padding:4px; background:#dc2626; width:auto;">Reject</button>
            </td>
        </tr>
    \`).join('') || '<tr><td colspan="4">No pending deposits</td></tr>';

    document.getElementById('adminWithdrawTable').innerHTML = data.withdrawals.map(w => \`
        <tr>
            <td>\${w.userId}</td><td>₹\${w.amount}</td><td>\${w.upiId}</td>
            <td>
                <button onclick="handleWithdrawAction('\${w._id}', 'APPROVE')" style="padding:4px; background:#16a34a; width:auto;">Approve</button>
                <button onclick="handleWithdrawAction('\${w._id}', 'REJECT')" style="padding:4px; background:#dc2626; width:auto;">Reject</button>
            </td>
        </tr>
    \`).join('') || '<tr><td colspan="4">No pending withdrawals</td></tr>';
}

async function handleDepositAction(id, action) {
    await fetch('/api/admin/deposit-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action })
    });
    fetchAdminData();
}

async function handleWithdrawAction(id, action) {
    await fetch('/api/admin/withdraw-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action })
    });
    fetchAdminData();
}
</script>

</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
