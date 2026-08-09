/* =========================================================
   FULL COMPLETE SCRIPT (SERVER + EMBEDDED FRONTEND)
   ========================================================= */

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-Memory Data Store
let users = [];
let deposits = [];
let withdrawals = [];
let gameHistory = [];

let currentPeriodId = 100001;
let timer = 60;
let lastResult = null;
let upcomingResult = null;
let currentBets = [];

// Game Timer Loop
setInterval(() => {
    timer--;

    // Determine upcoming result at 30s mark based on bet volume
    if (timer === 30) {
        let totalGreen = currentBets.filter(b => b.color === 'Green').reduce((sum, b) => sum + b.amount, 0);
        let totalRed = currentBets.filter(b => b.color === 'Red').reduce((sum, b) => sum + b.amount, 0);
        
        // System decides winner (opposite of majority bets to keep pool balance)
        upcomingResult = totalGreen > totalRed ? 'Red' : 'Green';
    }

    // Round Conclusion
    if (timer <= 0) {
        if (!upcomingResult) upcomingResult = Math.random() > 0.5 ? 'Green' : 'Red';

        lastResult = upcomingResult;
        gameHistory.unshift({ periodId: currentPeriodId, color: lastResult });
        if (gameHistory.length > 20) gameHistory.pop();

        // Process Winnings
        currentBets.forEach(bet => {
            const user = users.find(u => u.account === bet.userId);
            if (user && bet.color === lastResult) {
                user.balance += bet.amount * 1.98; // 2x minus 2% house fee
            }
        });

        // Reset for Next Round
        currentBets = [];
        currentPeriodId++;
        upcomingResult = null;
        timer = 60;
    }
}, 1000);


/* =========================================================
   API ENDPOINTS
   ========================================================= */

// User Register / Login
app.post('/api/auth/user', (req, res) => {
    const { account } = req.body;
    if (!account) return res.status(400).json({ message: 'Account ID required' });

    let user = users.find(u => u.account === account);
    if (!user) {
        user = { account, balance: 100.00 };
        users.push(user);
    }
    res.json({ message: 'Success', user });
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

// Get User Game State
app.get('/api/state/:userId', (req, res) => {
    const user = users.find(u => u.account === req.params.userId);
    if (!user) return res.status(404).json({ message: 'User not found' });

    res.json({
        timer,
        periodId: currentPeriodId,
        balance: user.balance,
        lastResult,
        history: gameHistory
    });
});

// Place Bet
app.post('/api/place-bet', (req, res) => {
    const { userId, color, amount } = req.body;
    const betAmt = parseFloat(amount);

    if (timer <= 10) return res.status(400).json({ message: 'Betting closed for this round!' });
    if (isNaN(betAmt) || betAmt <= 0) return res.status(400).json({ message: 'Invalid bet amount' });

    const user = users.find(u => u.account === userId);
    if (!user || user.balance < betAmt) return res.status(400).json({ message: 'Insufficient balance!' });

    user.balance -= betAmt;
    currentBets.push({ userId, color, amount: betAmt });

    res.json({ message: 'Bet placed successfully!', balance: user.balance });
});

// Deposit Request
app.post('/api/deposit', (req, res) => {
    const { userId, amount, utrNumber } = req.body;
    if (!amount || !utrNumber) return res.status(400).json({ message: 'Missing fields' });

    deposits.push({
        _id: Date.now().toString(),
        userId,
        amount: parseFloat(amount),
        utrNumber,
        status: 'PENDING'
    });

    res.json({ message: 'Deposit submitted for approval!' });
});

// Withdrawal Request
app.post('/api/withdraw', (req, res) => {
    const { userId, amount, upiId } = req.body;
    const witAmt = parseFloat(amount);

    const user = users.find(u => u.account === userId);
    if (!user || user.balance < witAmt) return res.status(400).json({ message: 'Insufficient balance!' });

    user.balance -= witAmt;
    withdrawals.push({
        _id: Date.now().toString(),
        userId,
        amount: witAmt,
        upiId,
        status: 'PENDING'
    });

    res.json({ message: 'Withdrawal submitted!', newBalance: user.balance });
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

// Admin Actions
app.post('/api/admin/deposit-action', (req, res) => {
    const { id, action } = req.body;
    const deposit = deposits.find(d => d._id === id);
    if (!deposit || deposit.status !== 'PENDING') return res.status(400).json({ message: 'Invalid request' });

    deposit.status = action;
    if (action === 'APPROVE') {
        const user = users.find(u => u.account === deposit.userId);
        if (user) user.balance += deposit.amount;
    }
    res.json({ message: `Deposit ${action.toLowerCase()}d` });
});

app.post('/api/admin/withdraw-action', (req, res) => {
    const { id, action } = req.body;
    const withdraw = withdrawals.find(w => w._id === id);
    if (!withdraw || withdraw.status !== 'PENDING') return res.status(400).json({ message: 'Invalid request' });

    withdraw.status = action;
    if (action === 'REJECT') {
        const user = users.find(u => u.account === withdraw.userId);
        if (user) user.balance += withdraw.amount;
    }
    res.json({ message: `Withdrawal ${action.toLowerCase()}d` });
});


/* =========================================================
   FRONTEND HTML & CLIENT JS SERVING
   ========================================================= */

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Color Prediction Game</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
        body { background-color: #0f172a; color: #f8fafc; display: flex; justify-content: center; min-height: 100vh; padding: 20px; }
        .container { width: 100%; max-width: 450px; background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        h2, h3 { text-align: center; margin-bottom: 15px; color: #38bdf8; }
        input, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; border: none; font-size: 16px; }
        input { background: #334155; color: #fff; outline: none; }
        button { cursor: pointer; font-weight: bold; background: #0284c7; color: white; transition: 0.2s; }
        button:hover { background: #0369a1; }
        .btn-green { background: #16a34a; } .btn-green:hover { background: #15803d; }
        .btn-red { background: #dc2626; } .btn-red:hover { background: #b91c1c; }
        .flex { display: flex; gap: 10px; }
        .card { background: #334155; padding: 15px; border-radius: 8px; margin-bottom: 15px; text-align: center; }
        .timer { font-size: 32px; font-weight: bold; color: #facc15; }
        .history-grid { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
        .history-item { width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; }
        .bg-Green { background: #16a34a; } .bg-Red { background: #dc2626; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
        th, td { border: 1px solid #475569; padding: 8px; text-align: center; }
        th { background: #334155; }
        .winner-banner { padding: 10px; text-align: center; font-weight: bold; border-radius: 6px; margin-bottom: 10px; }
    </style>
</head>
<body>

<div class="container">
    <!-- AUTH SECTION -->
    <div id="authSection">
        <h2>Welcome Game Portal</h2>
        <input type="text" id="userUid" placeholder="Enter Account / Phone ID">
        <button onclick="loginUser()">Player Login</button>
        <hr style="margin: 15px 0; border-color: #475569;">
        <input type="text" id="adminUser" placeholder="Admin Username">
        <input type="password" id="adminPass" placeholder="Admin Password">
        <button onclick="adminLogin()" style="background: #475569;">Admin Portal</button>
        <p id="authMsg" style="color: #f87171; text-align: center; margin-top: 10px;"></p>
    </div>

    <!-- GAME SECTION -->
    <div id="gameSection" style="display: none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span>ID: <b id="displayUid"></b></span>
            <button onclick="logout()" style="width:auto; padding:5px 10px; background:#e11d48;">Logout</button>
        </div>

        <div class="card">
            <div>Available Balance</div>
            <h1 style="color:#4ade80;">₹<span id="balance">0.00</span></h1>
            <div class="flex" style="margin-top: 10px;">
                <button onclick="showTabSection('depositSection')">Deposit</button>
                <button onclick="showTabSection('withdrawSection')" style="background:#475569;">Withdraw</button>
            </div>
        </div>

        <!-- DEPOSIT TAB -->
        <div id="depositSection" class="card" style="display:none;">
            <h3>Submit Deposit</h3>
            <input type="number" id="depAmount" placeholder="Amount (₹)">
            <input type="text" id="utrNumber" placeholder="12-Digit UTR / Ref Number">
            <button onclick="submitDeposit()" class="btn-green">Submit Request</button>
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline;">Close</button>
            <p id="depMsg"></p>
        </div>

        <!-- WITHDRAW TAB -->
        <div id="withdrawSection" class="card" style="display:none;">
            <h3>Request Withdrawal</h3>
            <input type="number" id="witAmount" placeholder="Amount (₹)">
            <input type="text" id="witUpi" placeholder="UPI ID (e.g. user@upi)">
            <button onclick="submitWithdraw()" class="btn-green">Request Pay-out</button>
            <button onclick="hideTabSections()" style="background:transparent; text-decoration:underline;">Close</button>
            <p id="witMsg"></p>
        </div>

        <div id="winnerDisplay" class="winner-banner" style="display:none;"></div>

        <div class="card">
            <div>Period: <b id="periodId">------</b></div>
            <div class="timer" id="timer">60</div>
            <div style="margin-top: 10px;" class="flex">
                <button onclick="placeBet('Green')" class="btn-green">Bet Green (2x)</button>
                <button onclick="placeBet('Red')" class="btn-red">Bet Red (2x)</button>
            </div>
            <input type="number" id="betAmount" placeholder="Bet Amount (₹)" value="10" style="margin-top: 10px;">
            <p id="gameMsg" style="margin-top: 5px;"></p>
        </div>

        <div class="card">
            <h3>Recent Results</h3>
            <div class="history-grid" id="history"></div>
        </div>
    </div>

    <!-- ADMIN SECTION -->
    <div id="adminSection" style="display: none;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <h3>Admin Management</h3>
            <button onclick="logout()" style="width:auto; padding:5px 10px; background:#e11d48;">Logout</button>
        </div>

        <div class="card">
            <div>System Engine Control</div>
            <div id="adminNextResult" style="font-size: 18px; font-weight: bold; margin-top: 5px;"></div>
        </div>

        <div class="card">
            <h3>Pending Deposits</h3>
            <table>
                <thead><tr><th>User</th><th>Amt</th><th>UTR</th><th>Action</th></tr></thead>
                <tbody id="adminDepositTable"></tbody>
            </table>
        </div>

        <div class="card">
            <h3>Pending Withdrawals</h3>
            <table>
                <thead><tr><th>User</th><th>Amt</th><th>UPI</th><th>Action</th></tr></thead>
                <tbody id="adminWithdrawTable"></tbody>
            </table>
        </div>

        <div class="card">
            <h3>Users (<span id="totalUsersCount">0</span>)</h3>
            <table>
                <thead><tr><th>User</th><th>Balance</th></tr></thead>
                <tbody id="adminUsersTable"></tbody>
            </table>
        </div>
    </div>
</div>

<script>
let currentUserId = localStorage.getItem('game_uid');
let isAdmin = localStorage.getItem('is_admin') === 'true';
let timerInterval = null;

if (isAdmin) {
    showAdminDashboard();
} else if (currentUserId) {
    showDashboard();
}

async function loginUser() {
    const account = document.getElementById('userUid').value.trim();
    if (!account) return;

    try {
        const res = await fetch('/api/auth/user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account })
        });
        const data = await res.json();
        if (res.ok) {
            currentUserId = data.user.account;
            localStorage.setItem('game_uid', currentUserId);
            showDashboard();
        }
    } catch (err) {
        document.getElementById('authMsg').innerText = "Server connection error!";
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
        document.getElementById('authMsg').innerText = "Server connection error!";
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
    document.getElementById('depositSection').style.display = 'none';
    document.getElementById('withdrawSection').style.display = 'none';
    document.getElementById(sectionId).style.display = 'block';
}

function hideTabSections() {
    document.getElementById('depositSection').style.display = 'none';
    document.getElementById('withdrawSection').style.display = 'none';
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

        const winnerBanner = document.getElementById('winnerDisplay');
        if (data.lastResult) {
            winnerBanner.style.display = 'block';
            winnerBanner.className = \`winner-banner bg-\${data.lastResult}\`;
            winnerBanner.innerText = \`Last Result: \${data.lastResult}\`;
        } else {
            winnerBanner.style.display = 'none';
        }

        const historyContainer = document.getElementById('history');
        historyContainer.innerHTML = data.history.map(item => \`
            <div class="history-item bg-\${item.color}" title="Period: \${item.periodId}">
                \${item.color === 'Green' ? 'G' : 'R'}
            </div>
        \`).join('');

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
            resultBox.innerText = \`Waiting for 30s mark... (Timer: \${data.timer}s)\`;
            resultBox.style.color = '#facc15';
        }

        document.getElementById('totalUsersCount').innerText = data.users.length;
        document.getElementById('adminUsersTable').innerHTML = data.users.map(u => \`
            <tr>
                <td>\${u.account}</td>
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
                    <button onclick="handleDepositAction('\${d._id}', 'APPROVE')" style="padding:4px; background:#16a34a; font-size:12px; width:auto; display:inline-block;">Approve</button>
                    <button onclick="handleDepositAction('\${d._id}', 'REJECT')" style="padding:4px; background:#dc2626; font-size:12px; width:auto; display:inline-block;">Reject</button>
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
                    <button onclick="handleWithdrawAction('\${w._id}', 'APPROVE')" style="padding:4px; background:#16a34a; font-size:12px; width:auto; display:inline-block;">Approve</button>
                    <button onclick="handleWithdrawAction('\${w._id}', 'REJECT')" style="padding:4px; background:#dc2626; font-size:12px; width:auto; display:inline-block;">Reject</button>
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
   SERVER INITIALIZATION
   ========================================================= */

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
