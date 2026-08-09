/* =========================================================
   FULL COMPLETE COLOR PREDICTION GAME SERVER (Node.js/Express)
   ========================================================= */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-Memory Database
let users = [];       // { username, password, balance }
let deposits = [];    // { _id, userId, amount, utrNumber, status, date }
let withdrawals = []; // { _id, userId, amount, upiId, status, date }
let gameHistory = []; // { periodId, color }

let currentPeriodId = 100001;
let timer = 60;
let lastResult = null;
let upcomingResult = null;
let currentBets = [];

// Game Timer Engine (60 Seconds Cycle)
setInterval(() => {
    timer--;

    // Determine upcoming result at 30s mark based on bet volume
    if (timer === 30) {
        let totalGreen = currentBets.filter(b => b.color === 'Green').reduce((sum, b) => sum + b.amount, 0);
        let totalRed = currentBets.filter(b => b.color === 'Red').reduce((sum, b) => sum + b.amount, 0);
        
        // Anti-loss algorithm: selects color with lower total bet amount
        upcomingResult = totalGreen > totalRed ? 'Red' : 'Green';
    }

    // Round Conclusion
    if (timer <= 0) {
        if (!upcomingResult) upcomingResult = Math.random() > 0.5 ? 'Green' : 'Red';

        lastResult = upcomingResult;
        gameHistory.unshift({ periodId: currentPeriodId, color: lastResult });
        if (gameHistory.length > 20) gameHistory.pop();

        // Distribute Winnings
        currentBets.forEach(bet => {
            const user = users.find(u => u.username === bet.userId);
            if (user && bet.color === lastResult) {
                user.balance += bet.amount * 1.98; // 2x payout minus 2% fee
            }
        });

        // Reset Round State
        currentBets = [];
        currentPeriodId++;
        upcomingResult = null;
        timer = 60;
    }
}, 1000);


/* =========================================================
   BACKEND API ENDPOINTS
   ========================================================= */

// Register New User
app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ message: 'Username and Password are required!' });
    }

    const existingUser = users.find(u => u.username === username);
    if (existingUser) {
        return res.status(400).json({ message: 'Username already taken! Please login.' });
    }

    const newUser = { username, password, balance: 100.00 }; // Bonus ₹100 on signup
    users.push(newUser);
    res.json({ message: 'Account registered successfully! Please login.', user: newUser });
});

// Login User
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    const user = users.find(u => u.username === username && u.password === password);

    if (!user) {
        return res.status(401).json({ message: 'Invalid Username or Password!' });
    }
    res.json({ message: 'Login successful!', username: user.username });
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

// Get User State & Transaction History
app.get('/api/state/:userId', (req, res) => {
    const userId = req.params.userId;
    const user = users.find(u => u.username === userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const userDeposits = deposits.filter(d => d.userId === userId);
    const userWithdrawals = withdrawals.filter(w => w.userId === userId);

    res.json({
        timer,
        periodId: currentPeriodId,
        balance: user.balance,
        lastResult,
        history: gameHistory,
        deposits: userDeposits,
        withdrawals: userWithdrawals
    });
});

// Place Bet
app.post('/api/place-bet', (req, res) => {
    const { userId, color, amount } = req.body;
    const betAmt = parseFloat(amount);

    if (timer <= 10) return res.status(400).json({ message: 'Betting closed for this round!' });
    if (isNaN(betAmt) || betAmt <= 0) return res.status(400).json({ message: 'Invalid bet amount' });

    const user = users.find(u => u.username === userId);
    if (!user || user.balance < betAmt) return res.status(400).json({ message: 'Insufficient balance!' });

    user.balance -= betAmt;
    currentBets.push({ userId, color, amount: betAmt });

    res.json({ message: 'Bet placed successfully!', balance: user.balance });
});

// Submit Deposit Request
app.post('/api/deposit', (req, res) => {
    const { userId, amount, utrNumber } = req.body;
    if (!amount || !utrNumber) return res.status(400).json({ message: 'Missing fields!' });

    const depAmount = parseFloat(amount);
    if (isNaN(depAmount) || depAmount <= 0) return res.status(400).json({ message: 'Invalid amount!' });

    deposits.push({
        _id: Date.now().toString(),
        userId,
        amount: depAmount,
        utrNumber,
        status: 'PENDING',
        date: new Date().toLocaleTimeString()
    });

    res.json({ message: 'Deposit request submitted successfully!' });
});

// Submit Withdrawal Request
app.post('/api/withdraw', (req, res) => {
    const { userId, amount, upiId } = req.body;
    const witAmt = parseFloat(amount);

    if (isNaN(witAmt) || witAmt <= 0) return res.status(400).json({ message: 'Invalid amount!' });

    const user = users.find(u => u.username === userId);
    if (!user || user.balance < witAmt) return res.status(400).json({ message: 'Insufficient balance!' });

    user.balance -= witAmt;
    withdrawals.push({
        _id: Date.now().toString(),
        userId,
        amount: witAmt,
        upiId,
        status: 'PENDING',
        date: new Date().toLocaleTimeString()
    });

    res.json({ message: 'Withdrawal requested successfully!', newBalance: user.balance });
});

// Admin Data
app.get('/api/admin/data', (req, res) => {
    res.json({
        users,
        deposits,
        withdrawals,
        upcomingResult,
        timer
    });
});

// Admin Deposit Action (Approve / Reject)
app.post('/api/admin/deposit-action', (req, res) => {
    const { id, action } = req.body;
    const deposit = deposits.find(d => d._id === id);
    if (!deposit || deposit.status !== 'PENDING') return res.status(400).json({ message: 'Invalid request' });

    deposit.status = action;
    if (action === 'APPROVE') {
        const user = users.find(u => u.username === deposit.userId);
        if (user) user.balance += deposit.amount;
    }
    res.json({ message: `Deposit ${action.toLowerCase()}d successfully!` });
});

// Admin Withdraw Action (Approve / Reject)
app.post('/api/admin/withdraw-action', (req, res) => {
    const { id, action } = req.body;
    const withdraw = withdrawals.find(w => w._id === id);
    if (!withdraw || withdraw.status !== 'PENDING') return res.status(400).json({ message: 'Invalid request' });

    withdraw.status = action;
    if (action === 'REJECT') {
        // Refund back to user balance on reject
        const user = users.find(u => u.username === withdraw.userId);
        if (user) user.balance += withdraw.amount;
    }
    res.json({ message: `Withdrawal ${action.toLowerCase()}d successfully!` });
});


/* =========================================================
   FRONTEND USER INTERFACE (HTML + CSS + JavaScript)
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
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background-color: #0f172a; color: #f8fafc; display: flex; justify-content: center; min-height: 100vh; padding: 15px; }
        .container { width: 100%; max-width: 480px; background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        h2, h3 { text-align: center; margin-bottom: 15px; color: #38bdf8; }
        input, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; border: none; font-size: 15px; }
        input { background: #334155; color: #fff; outline: none; }
        button { cursor: pointer; font-weight: bold; background: #0284c7; color: white; transition: 0.2s; }
        button:hover { background: #0369a1; }
        .btn-green { background: #16a34a; } .btn-green:hover { background: #15803d; }
        .btn-red { background: #dc2626; } .btn-red:hover { background: #b91c1c; }
        .flex { display: flex; gap: 10px; }
        .card { background: #334155; padding: 15px; border-radius: 8px; margin-bottom: 15px; }
        .timer { font-size: 32px; font-weight: bold; color: #facc15; text-align: center; }
        .history-grid { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
        .history-item { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; }
        .bg-Green { background: #16a34a; } .bg-Red { background: #dc2626; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
        th, td { border: 1px solid #475569; padding: 6px; text-align: center; }
        th { background: #1e293b; }
        .badge { padding: 3px 6px; border-radius: 4px; font-weight: bold; font-size: 11px; }
        .badge-PENDING { background: #eab308; color: #000; }
        .badge-APPROVE { background: #22c55e; color: #fff; }
        .badge-REJECT { background: #ef4444; color: #fff; }
        .winner-banner { padding: 10px; text-align: center; font-weight: bold; border-radius: 6px; margin-bottom: 10px; }
        .tabs { display: flex; border-bottom: 2px solid #475569; margin-bottom: 15px; }
        .tab-btn { flex: 1; background: transparent; color: #94a3b8; padding: 10px; border-radius: 0; margin: 0; }
        .tab-btn.active { color: #38bdf8; border-bottom: 3px solid #38bdf8; background: #334155; }
    </style>
</head>
<body>

<div class="container">

    <!-- AUTHENTICATION SECTION (Register / Login) -->
    <div id="authSection">
        <h2>Gaming Portal</h2>
        
        <div class="tabs">
            <button class="tab-btn active" id="tabLoginBtn" onclick="switchAuthTab('login')">Login</button>
            <button class="tab-btn" id="tabRegBtn" onclick="switchAuthTab('register')">Register</button>
            <button class="tab-btn" id="tabAdminBtn" onclick="switchAuthTab('admin')">Admin</button>
        </div>

        <!-- LOGIN FORM -->
        <div id="loginForm">
            <input type="text" id="loginUser" placeholder="Enter Username / Phone">
            <input type="password" id="loginPass" placeholder="Enter Password">
            <button onclick="loginUser()">Login to Game</button>
        </div>

        <!-- REGISTER FORM -->
        <div id="registerForm" style="display: none;">
            <input type="text" id="regUser" placeholder="Choose Username / Phone">
            <input type="password" id="regPass" placeholder="Set Password">
            <button onclick="registerUser()" class="btn-green">Create New Account</button>
        </div>

        <!-- ADMIN FORM -->
        <div id="adminForm" style="display: none;">
            <input type="text" id="adminUser" placeholder="Admin Username">
            <input type="password" id="adminPass" placeholder="Admin Password">
            <button onclick="adminLogin()" style="background: #475569;">Admin Portal Login</button>
        </div>

        <p id="authMsg" style="color: #f87171; text-align: center; margin-top: 10px; font-weight: bold;"></p>
    </div>


    <!-- GAME DASHBOARD SECTION -->
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

        <!-- DEPOSIT SECTION -->
        <div id="depositSection" class="card" style="display:none;">
            <h3>Deposit Money</h3>
            <p style="font-size:12px; color:#cbd5e1; text-align:center; margin-bottom:5px;">Pay via UPI & Enter UTR Ref Number</p>
            <input type="number" id="depAmount" placeholder="Amount (₹)">
            <input type="text" id="utrNumber" placeholder="12-Digit UTR / Ref Number">
            <button onclick="submitDeposit()" class="btn-green">Submit Deposit Request</button>
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline;">Close</button>
            <p id="depMsg" style="text-align:center; margin-top:5px;"></p>
        </div>

        <!-- WITHDRAW SECTION -->
        <div id="withdrawSection" class="card" style="display:none;">
            <h3>Request Withdrawal</h3>
            <input type="number" id="witAmount" placeholder="Amount (₹)">
            <input type="text" id="witUpi" placeholder="Enter UPI ID (e.g. name@upi)">
            <button onclick="submitWithdraw()" class="btn-green">Request Pay-out</button>
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline;">Close</button>
            <p id="witMsg" style="text-align:center; margin-top:5px;"></p>
        </div>

        <!-- USER TRANSACTION HISTORY TAB -->
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
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline; margin-top:8px;">Close History</button>
        </div>

        <div id="winnerDisplay" class="winner-banner" style="display:none;"></div>

        <!-- GAME AREA -->
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

        <!-- GAME RESULTS HISTORY -->
        <div class="card">
            <h3>Recent Round Results</h3>
            <div class="history-grid" id="history"></div>
        </div>
    </div>


    <!-- ADMIN DASHBOARD SECTION -->
    <div id="adminSection" style="display: none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3>Admin Panel</h3>
            <button onclick="logout()" style="width:auto; padding:5px 10px; background:#e11d48;">Logout</button>
        </div>

        <div class="card" style="text-align: center;">
            <div>Game Engine Status</div>
            <div id="adminNextResult" style="font-size: 16px; font-weight: bold; margin-top: 5px;"></div>
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
            <h3>Registered Users (<span id="totalUsersCount">0</span>)</h3>
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

// Initial Auto Login Check
if (isAdmin) {
    showAdminDashboard();
} else if (currentUserId) {
    showDashboard();
}

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

    try {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await res.json();
        const msg = document.getElementById('authMsg');
        msg.innerText = data.message;
        msg.style.color = res.ok ? '#4ade80' : '#f87171';

        if (res.ok) {
            setTimeout(() => switchAuthTab('login'), 1500);
        }
    } catch (err) {
        document.getElementById('authMsg').innerText = "Server error!";
    }
}

async function loginUser() {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value.trim();

    try {
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
    } catch (err) {
        document.getElementById('authMsg').innerText = "Server error!";
    }
}

async function adminLogin() {
    const username = document.getElementById('adminUser').value.trim();
    const password = document.getElementById('adminPass').value.trim();

    try {
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
    } catch (err) {
        document.getElementById('authMsg').innerText = "Server error!";
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
    if (!timerInterval) {
        timerInterval = setInterval(fetchGameState, 1000);
    }
}

function showAdminDashboard() {
    document.getElementById('authSection').style.display = 'none';
    document.getElementById('gameSection').style.display = 'none';
    document.getElementById('adminSection').style.display = 'block';

    fetchAdminData();
    if (!timerInterval) {
        timerInterval = setInterval(fetchAdminData, 2000);
    }
}

function showTabSection(sectionId) {
    hideTabSections();
    document.getElementById(sectionId).style.display = 'block';
}

function hideTabSections() {
    document.getElementById('depositSection').style.display = 'none';
    document.getElementById('withdrawSection').style.display = 'none';
    document.getElementById('historySection').style.display = 'none';
}

async function fetchGameState() {
    if (!currentUserId) return;

    try {
        const res = await fetch(\`/api/state/\${currentUserId}\`);
        if (!res.ok) {
            if (res.status === 404) logout();
            return;
        }

        const data = await res.json();

        document.getElementById('timer').innerText = data.timer;
        document.getElementById('periodId').innerText = data.periodId;
        document.getElementById('balance').innerText = data.balance.toFixed(2);

        // Winner Banner Display
        const winnerBanner = document.getElementById('winnerDisplay');
        if (data.lastResult) {
            winnerBanner.style.display = 'block';
            winnerBanner.className = \`winner-banner bg-\${data.lastResult}\`;
            winnerBanner.innerText = \`Last Result: \${data.lastResult}\`;
        } else {
            winnerBanner.style.display = 'none';
        }

        // Render Recent History
        const historyContainer = document.getElementById('history');
        historyContainer.innerHTML = data.history.map(item => \`
            <div class="history-item bg-\${item.color}" title="Period: \${item.periodId}">
                \${item.color === 'Green' ? 'G' : 'R'}
            </div>
        \`).join('');

        // Render User Deposit History
        document.getElementById('userDepHistory').innerHTML = data.deposits.map(d => \`
            <tr>
                <td>₹\${d.amount}</td>
                <td>\${d.utrNumber}</td>
                <td><span class="badge badge-\${d.status}">\${d.status}</span></td>
            </tr>
        \`).join('') || '<tr><td colspan="3">No deposits yet</td></tr>';

        // Render User Withdrawal History
        document.getElementById('userWitHistory').innerHTML = data.withdrawals.map(w => \`
            <tr>
                <td>₹\${w.amount}</td>
                <td>\${w.upiId}</td>
                <td><span class="badge badge-\${w.status}">\${w.status}</span></td>
            </tr>
        \`).join('') || '<tr><td colspan="3">No withdrawals yet</td></tr>';

    } catch (err) {
        console.error("Error fetching state:", err);
    }
}

async function placeBet(color) {
    const amount = document.getElementById('betAmount').value;
    const msgElem = document.getElementById('gameMsg');

    try {
        const res = await fetch('/api/place-bet', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, color, amount })
        });

        const data = await res.json();
        msgElem.innerText = data.message;
        msgElem.style.color = res.ok ? '#4ade80' : '#f87171';

        if (res.ok) {
            document.getElementById('balance').innerText = data.balance.toFixed(2);
        }
    } catch (err) {
        msgElem.innerText = "Error placing bet!";
        msgElem.style.color = '#f87171';
    }
}

async function submitDeposit() {
    const amount = document.getElementById('depAmount').value;
    const utrNumber = document.getElementById('utrNumber').value.trim();
    const msgElem = document.getElementById('depMsg');

    try {
        const res = await fetch('/api/deposit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, amount, utrNumber })
        });

        const data = await res.json();
        msgElem.innerText = data.message;
        msgElem.style.color = res.ok ? '#4ade80' : '#f87171';

        if (res.ok) {
            document.getElementById('depAmount').value = '';
            document.getElementById('utrNumber').value = '';
        }
    } catch (err) {
        msgElem.innerText = "Error submitting deposit!";
        msgElem.style.color = '#f87171';
    }
}

async function submitWithdraw() {
    const amount = document.getElementById('witAmount').value;
    const upiId = document.getElementById('witUpi').value.trim();
    const msgElem = document.getElementById('witMsg');

    try {
        const res = await fetch('/api/withdraw', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, amount, upiId })
        });

        const data = await res.json();
        msgElem.innerText = data.message;
        msgElem.style.color = res.ok ? '#4ade80' : '#f87171';

        if (res.ok) {
            document.getElementById('witAmount').value = '';
            document.getElementById('witUpi').value = '';
            document.getElementById('balance').innerText = data.newBalance.toFixed(2);
        }
    } catch (err) {
        msgElem.innerText = "Error submitting withdrawal!";
        msgElem.style.color = '#f87171';
    }
}

async function fetchAdminData() {
    if (!isAdmin) return;

    try {
        const res = await fetch('/api/admin/data');
        if (!res.ok) return;

        const data = await res.json();

        const resultBox = document.getElementById('adminNextResult');
        if (data.upcomingResult) {
            resultBox.innerText = \`Upcoming Result: \${data.upcomingResult} (Timer: \${data.timer}s)\`;
            resultBox.style.color = data.upcomingResult === 'Green' ? '#4ade80' : '#f87171';
        } else {
            resultBox.innerText = \`Calculating Result... (Timer: \${data.timer}s)\`;
            resultBox.style.color = '#facc15';
        }

        document.getElementById('totalUsersCount').innerText = data.users.length;
        document.getElementById('adminUsersTable').innerHTML = data.users.map(u => \`
            <tr>
                <td>\${u.username}</td>
                <td>₹\${u.balance.toFixed(2)}</td>
            </tr>
        \`).join('');

        const pendingDeposits = data.deposits.filter(d => d.status === 'PENDING');
        document.getElementById('adminDepositTable').innerHTML = pendingDeposits.map(d => \`
            <tr>
                <td>\${d.userId}</td>
                <td>₹\${d.amount}</td>
                <td>\${d.utrNumber}</td>
                <td>
                    <button onclick="handleDepositAction('\${d._id}', 'APPROVE')" style="padding:4px 8px; background:#16a34a; font-size:12px; width:auto; display:inline-block;">Approve</button>
                    <button onclick="handleDepositAction('\${d._id}', 'REJECT')" style="padding:4px 8px; background:#dc2626; font-size:12px; width:auto; display:inline-block;">Reject</button>
                </td>
            </tr>
        \`).join('') || '<tr><td colspan="4" style="text-align:center;">No pending deposits</td></tr>';

        const pendingWithdrawals = data.withdrawals.filter(w => w.status === 'PENDING');
        document.getElementById('adminWithdrawTable').innerHTML = pendingWithdrawals.map(w => \`
            <tr>
                <td>\${w.userId}</td>
                <td>₹\${w.amount}</td>
                <td>\${w.upiId}</td>
                <td>
                    <button onclick="handleWithdrawAction('\${w._id}', 'APPROVE')" style="padding:4px 8px; background:#16a34a; font-size:12px; width:auto; display:inline-block;">Approve</button>
                    <button onclick="handleWithdrawAction('\${w._id}', 'REJECT')" style="padding:4px 8px; background:#dc2626; font-size:12px; width:auto; display:inline-block;">Reject</button>
                </td>
            </tr>
        \`).join('') || '<tr><td colspan="4" style="text-align:center;">No pending withdrawals</td></tr>';

    } catch (err) {
        console.error("Error fetching admin data:", err);
    }
}

async function handleDepositAction(id, action) {
    try {
        await fetch('/api/admin/deposit-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, action })
        });
        fetchAdminData();
    } catch (err) {
        alert("Action failed!");
    }
}

async function handleWithdrawAction(id, action) {
    try {
        await fetch('/api/admin/withdraw-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, action })
        });
        fetchAdminData();
    } catch (err) {
        alert("Action failed!");
    }
}
</script>

</body>
</html>
    `);
});

/* =========================================================
   SERVER START
   ========================================================= */

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
