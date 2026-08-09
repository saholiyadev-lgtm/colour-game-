const express = require('express');
const mongoose = require('mongoose');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// --- MONGODB CONNECTION STRING ---
const MONGO_URI = process.env.MONGO_URI || "mongodb+srv://saholiyadev_db_user:5lsYUCQZwIQ5Z3Ud@colourproject.v3jpnyq.mongodb.net/colorgame?retryWrites=true&w=majority";

mongoose.connect(MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log("MongoDB Database Connected Successfully!"))
  .catch(err => console.error("MongoDB Connection Error:", err));

// --- MONGOOSE SCHEMAS & MODELS ---
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0.00 }
});

const TransactionSchema = new mongoose.Schema({
    type: { type: String, enum: ['DEPOSIT', 'WITHDRAWAL'] },
    userId: { type: String, required: true },
    amount: { type: Number, required: true },
    utrNumber: { type: String, default: '' },
    upiId: { type: String, default: '' },
    status: { type: String, default: 'PENDING' },
    date: { type: Date, default: Date.now }
});

const GameHistorySchema = new mongoose.Schema({
    periodId: String,
    color: String,
    date: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const GameHistory = mongoose.model('GameHistory', GameHistorySchema);

// --- ADMIN CREDENTIALS ---
const ADMIN_CREDENTIALS = {
    username: "admin",
    password: "admin123"
};

// --- GAME STATE ENGINE ---
let gameState = {
    timer: 60,
    periodId: Date.now().toString().slice(-8),
    lastResult: null,
    activeBets: []
};

setInterval(async () => {
    gameState.timer--;

    if (gameState.timer <= 0) {
        const colors = ['Red', 'Green'];
        const resultColor = colors[Math.floor(Math.random() * colors.length)];
        
        gameState.lastResult = resultColor;

        await GameHistory.create({
            periodId: gameState.periodId,
            color: resultColor
        });

        for (const bet of gameState.activeBets) {
            if (bet.color.toLowerCase() === resultColor.toLowerCase()) {
                const winAmount = bet.amount * 1.9;
                await User.findOneAndUpdate(
                    { userId: bet.userId },
                    { $inc: { balance: winAmount } }
                );
            }
        }

        gameState.activeBets = [];
        gameState.timer = 60;
        gameState.periodId = Date.now().toString().slice(-8);
    }
}, 1000);

// --- PLAYER APIS ---

app.post('/api/register', async (req, res) => {
    const { password } = req.body;
    if (!password || password.length < 4) {
        return res.status(400).json({ message: "Password minimum 4 digits no hovo joie!" });
    }

    const userId = "UID-" + Math.floor(10000 + Math.random() * 90000);
    try {
        const newUser = await User.create({ userId, password, balance: 0.00 });
        res.json({ message: "Registration Successful!", userId: newUser.userId });
    } catch (err) {
        res.status(500).json({ message: "Registration error, try again!" });
    }
});

app.post('/api/login', async (req, res) => {
    const { userId, password } = req.body;
    const user = await User.findOne({ userId });

    if (!user || user.password !== password) {
        return res.status(401).json({ message: "Invalid User ID or Password!" });
    }
    res.json({ message: "Login Successful!", userId: user.userId });
});

app.post('/api/deposit', async (req, res) => {
    const { userId, utrNumber, amount } = req.body;
    
    const utrRegex = /^\d{12}$/;
    if (!utrRegex.test(utrNumber)) {
        return res.status(400).json({ message: "Invalid UTR! Exact 12 digits numeric hovo joie." });
    }

    const existingUTR = await Transaction.findOne({ utrNumber });
    if (existingUTR) {
        return res.status(400).json({ message: "Aa UTR number pehle thi submit thaelo chhe!" });
    }

    const depositAmt = parseFloat(amount);
    if (isNaN(depositAmt) || depositAmt < 10) {
        return res.status(400).json({ message: "Minimum deposit ₹10 chhe." });
    }

    await Transaction.create({
        type: 'DEPOSIT',
        userId,
        utrNumber,
        amount: depositAmt,
        status: 'PENDING'
    });

    res.json({ message: "Deposit request submitted! Admin approval pachi wallet ma add thashe." });
});

app.post('/api/withdraw', async (req, res) => {
    const { userId, amount, upiId } = req.body;
    const user = await User.findOne({ userId });

    if (!user) return res.status(404).json({ message: "User not found!" });

    const withdrawAmt = parseFloat(amount);
    if (isNaN(withdrawAmt) || withdrawAmt <= 0 || withdrawAmt > user.balance) {
        return res.status(400).json({ message: "Invalid Amount or Insufficient Balance!" });
    }

    if (!upiId || !upiId.includes('@')) {
        return res.status(400).json({ message: "Valid UPI ID nakho!" });
    }

    user.balance -= withdrawAmt;
    await user.save();

    await Transaction.create({
        type: 'WITHDRAWAL',
        userId,
        upiId,
        amount: withdrawAmt,
        status: 'PENDING'
    });

    res.json({ message: "Withdrawal request submitted!", newBalance: user.balance });
});

app.get('/api/state/:userId', async (req, res) => {
    const user = await User.findOne({ userId: req.params.userId });
    if (!user) return res.status(404).json({ message: "User not found" });

    const history = await GameHistory.find().sort({ date: -1 }).limit(15);

    res.json({
        timer: gameState.timer,
        periodId: gameState.periodId,
        lastResult: gameState.lastResult,
        history,
        balance: user.balance
    });
});

app.post('/api/place-bet', async (req, res) => {
    const { userId, color, amount } = req.body;
    const user = await User.findOne({ userId });

    if (!user) return res.status(404).json({ message: "User not found!" });
    if (gameState.timer <= 10) return res.status(400).json({ message: "Round Freeze! Bet place nai thai." });

    const betAmount = parseFloat(amount);
    if (isNaN(betAmount) || betAmount > user.balance || betAmount <= 0) {
        return res.status(400).json({ message: "Insufficient Balance!" });
    }

    user.balance -= betAmount;
    await user.save();

    gameState.activeBets.push({ userId, color, amount: betAmount });
    res.json({ message: "Bet Placed Successfully!", balance: user.balance });
});

// --- ADMIN APIS ---

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        return res.json({ message: "Admin Login Successful!" });
    }
    res.status(401).json({ message: "Invalid Admin Credentials!" });
});

app.get('/api/admin/data', async (req, res) => {
    const usersList = await User.find({}, 'userId balance');
    const deposits = await Transaction.find({ type: 'DEPOSIT' }).sort({ date: -1 });
    const withdrawals = await Transaction.find({ type: 'WITHDRAWAL' }).sort({ date: -1 });

    res.json({ usersList, deposits, withdrawals });
});

app.post('/api/admin/deposit-action', async (req, res) => {
    const { id, action } = req.body;
    const tx = await Transaction.findById(id);

    if (!tx || tx.status !== 'PENDING') return res.status(400).json({ message: "Invalid Transaction" });

    if (action === 'APPROVE') {
        await User.findOneAndUpdate({ userId: tx.userId }, { $inc: { balance: tx.amount } });
        tx.status = 'APPROVED';
    } else {
        tx.status = 'REJECTED';
    }

    await tx.save();
    res.json({ message: `Deposit ${action}D!` });
});

app.post('/api/admin/withdraw-action', async (req, res) => {
    const { id, action } = req.body;
    const tx = await Transaction.findById(id);

    if (!tx || tx.status !== 'PENDING') return res.status(400).json({ message: "Invalid Transaction" });

    if (action === 'REJECT') {
        await User.findOneAndUpdate({ userId: tx.userId }, { $inc: { balance: tx.amount } });
        tx.status = 'REJECTED';
    } else {
        tx.status = 'APPROVED';
    }

    await tx.save();
    res.json({ message: `Withdrawal ${action}D!` });
});

// --- FRONTEND ROUTE ---
app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="gu">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Color Game - MongoDB Integrated</title>
        <style>
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; }
            body { background-color: #0f172a; color: #f8fafc; padding: 15px; }
            .container { max-width: 450px; margin: 0 auto; }
            .card { background: #1e293b; padding: 20px; border-radius: 12px; margin-bottom: 15px; border: 1px solid #334155; }
            h2, h3 { color: #38bdf8; text-align: center; margin-bottom: 12px; }
            input { width: 100%; padding: 10px; margin: 6px 0; border-radius: 6px; border: 1px solid #475569; background: #0f172a; color: white; }
            button { width: 100%; padding: 10px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; margin-top: 5px; }
            .btn-primary { background: #0284c7; color: white; }
            .btn-green { background: #16a34a; color: white; width: 48%; }
            .btn-red { background: #dc2626; color: white; width: 48%; }
            .flex-group { display: flex; justify-content: space-between; gap: 10px; }
            .timer-box { font-size: 2.2rem; font-weight: bold; color: #facc15; text-align: center; }
            .balance-box { font-size: 1.1rem; text-align: center; color: #4ade80; margin-bottom: 8px; }
            .tab-group { display: flex; gap: 5px; margin-bottom: 10px; }
            .tab-btn { background: #334155; color: #94a3b8; font-size: 0.85rem; padding: 8px; }
            .tab-btn.active { background: #0284c7; color: white; }
            .history-grid { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 8px; }
            .history-item { width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.75rem; font-weight: bold; color: white; }
            .bg-Red { background: #dc2626; }
            .bg-Green { background: #16a34a; }
            .hidden { display: none; }
            .msg { margin-top: 8px; font-size: 0.85rem; text-align: center; }
            
            .qr-box { text-align: center; background: #ffffff; padding: 12px; border-radius: 8px; margin: 10px 0; }
            .qr-box img { width: 220px; height: 220px; object-fit: contain; border-radius: 6px; }

            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.8rem; }
            th, td { border: 1px solid #334155; padding: 6px; text-align: left; }
            th { background: #0f172a; }
        </style>
    </head>
    <body>
        <div class="container">
            
            <!-- AUTH -->
            <div id="authSection" class="card">
                <h2>Game Login</h2>
                <div class="tab-group">
                    <button class="tab-btn active" id="tabLogin" onclick="toggleAuth('login')">Player</button>
                    <button class="tab-btn" id="tabReg" onclick="toggleAuth('reg')">Register</button>
                    <button class="tab-btn" id="tabAdmin" onclick="toggleAuth('admin')">Admin</button>
                </div>

                <div id="loginForm">
                    <input type="text" id="loginUid" placeholder="User ID (e.g. UID-12345)">
                    <input type="password" id="loginPass" placeholder="Password">
                    <button class="btn-primary" onclick="login()">Login</button>
                </div>

                <div id="regForm" class="hidden">
                    <input type="password" id="regPass" placeholder="Set Password">
                    <button class="btn-primary" onclick="register()">Create Account</button>
                </div>

                <div id="adminLoginForm" class="hidden">
                    <input type="text" id="adminUser" placeholder="Admin Username">
                    <input type="password" id="adminPass" placeholder="Admin Password">
                    <button class="btn-primary" style="background:#7c3aed;" onclick="adminLogin()">Admin Login</button>
                </div>

                <p id="authMsg" class="msg"></p>
            </div>

            <!-- PLAYER INTERFACE -->
            <div id="gameSection" class="hidden">
                <div class="card">
                    <div style="display: flex; justify-content: space-between; font-size: 0.85rem;">
                        <span>ID: <b id="displayUid" style="color: #38bdf8;">-</b></span>
                        <a href="#" onclick="logout()" style="color: #f87171;">Logout</a>
                    </div>
                    <div class="balance-box" style="margin-top: 8px;">Wallet: ₹<span id="balance">0.00</span></div>
                    <div class="flex-group">
                        <button class="btn-primary" style="background:#059669;" onclick="showTab('depositSection')">Deposit</button>
                        <button class="btn-primary" style="background:#d97706;" onclick="showTab('withdrawSection')">Withdraw</button>
                    </div>
                </div>

                <div class="card">
                    <div style="text-align: center; color: #94a3b8; font-size: 0.8rem;">Period: <span id="periodId">-</span></div>
                    <div class="timer-box" id="timer">60</div>
                    <input type="number" id="betAmount" placeholder="Amount" value="100">
                    <div class="flex-group">
                        <button class="btn-green" onclick="placeBet('green')">GREEN (1.9x)</button>
                        <button class="btn-red" onclick="placeBet('red')">RED (1.9x)</button>
                    </div>
                    <p id="gameMsg" class="msg"></p>
                </div>

                <!-- DEPOSIT WITH CUSTOM SCANNER -->
                <div id="depositSection" class="card hidden">
                    <h3>Deposit Funds</h3>
                    <div class="qr-box">
                        <img src="https://i.ibb.co/3s3B4fJ/1000063151.jpg" alt="Deposit UPI QR Code">
                        <p style="color: #0f172a; font-size: 0.75rem; font-weight: bold; margin-top: 5px;">Scan & Pay with Any UPI App</p>
                    </div>
                    <input type="number" id="depAmount" placeholder="Amount Paid">
                    <input type="text" id="utrNumber" maxlength="12" placeholder="12-Digit UTR Number">
                    <button class="btn-primary" onclick="submitDeposit()">Submit UTR</button>
                    <button style="background:transparent; color:#94a3b8;" onclick="hideTabs()">Back</button>
                    <p id="depMsg" class="msg"></p>
                </div>

                <!-- WITHDRAWAL -->
                <div id="withdrawSection" class="card hidden">
                    <h3>Withdraw Funds</h3>
                    <input type="number" id="witAmount" placeholder="Amount">
                    <input type="text" id="witUpi" placeholder="UPI ID">
                    <button class="btn-primary" style="background:#d97706;" onclick="submitWithdraw()">Request Withdrawal</button>
                    <button style="background:transparent; color:#94a3b8;" onclick="hideTabs()">Back</button>
                    <p id="witMsg" class="msg"></p>
                </div>

                <div class="card">
                    <h3>History</h3>
                    <div class="history-grid" id="history"></div>
                </div>
            </div>

            <!-- ADMIN INTERFACE -->
            <div id="adminSection" class="card hidden">
                <h2>Admin Control Panel</h2>
                <button style="background: #dc2626; margin-bottom: 15px;" onclick="logout()">Logout Admin</button>

                <h3>Deposits</h3>
                <div style="overflow-x:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Amt</th>
                                <th>UTR</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody id="adminDepositTable"></tbody>
                    </table>
                </div>

                <h3 style="margin-top: 20px;">Withdrawals</h3>
                <div style="overflow-x:auto;">
                    <table>
                        <thead>
                            <tr>
                                <th>User</th>
                                <th>Amt</th>
                                <th>UPI</th>
                                <th>Status</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody id="adminWithdrawTable"></tbody>
                    </table>
                </div>
            </div>

        </div>

        <script>
            let currentUserId = localStorage.getItem('game_uid') || null;
            let isAdmin = localStorage.getItem('is_admin') === 'true';

            if (isAdmin) showAdminDashboard();
            else if (currentUserId) showDashboard();

            function toggleAuth(type) {
                document.getElementById('loginForm').classList.add('hidden');
                document.getElementById('regForm').classList.add('hidden');
                document.getElementById('adminLoginForm').classList.add('hidden');
                document.getElementById('tabLogin').classList.remove('active');
                document.getElementById('tabReg').classList.remove('active');
                document.getElementById('tabAdmin').classList.remove('active');

                if (type === 'login') {
                    document.getElementById('loginForm').classList.remove('hidden');
                    document.getElementById('tabLogin').classList.add('active');
                } else if (type === 'reg') {
                    document.getElementById('regForm').classList.remove('hidden');
                    document.getElementById('tabReg').classList.add('active');
                } else {
                    document.getElementById('adminLoginForm').classList.remove('hidden');
                    document.getElementById('tabAdmin').classList.add('active');
                }
            }

            async function register() {
                const password = document.getElementById('regPass').value;
                const res = await fetch('/api/register', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ password })
                });
                const data = await res.json();
                if (res.ok) {
                    alert('Generated User ID: ' + data.userId);
                    currentUserId = data.userId;
                    localStorage.setItem('game_uid', currentUserId);
                    showDashboard();
                } else { document.getElementById('authMsg').innerText = data.message; }
            }

            async function login() {
                const userId = document.getElementById('loginUid').value;
                const password = document.getElementById('loginPass').value;
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ userId, password })
                });
                const data = await res.json();
                if (res.ok) {
                    currentUserId = userId;
                    localStorage.setItem('game_uid', currentUserId);
                    showDashboard();
                } else { document.getElementById('authMsg').innerText = data.message; }
            }

            async function adminLogin() {
                const username = document.getElementById('adminUser').value;
                const password = document.getElementById('adminPass').value;
                const res = await fetch('/api/admin/login', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();
                if (res.ok) {
                    localStorage.setItem('is_admin', 'true');
                    showAdminDashboard();
                } else { document.getElementById('authMsg').innerText = data.message; }
            }

            function logout() {
                localStorage.clear();
                location.reload();
            }

            function showDashboard() {
                document.getElementById('authSection').classList.add('hidden');
                document.getElementById('gameSection').classList.remove('hidden');
                document.getElementById('displayUid').innerText = currentUserId;
                setInterval(fetchState, 1000);
            }

            function showAdminDashboard() {
                document.getElementById('authSection').classList.add('hidden');
                document.getElementById('gameSection').classList.add('hidden');
                document.getElementById('adminSection').classList.remove('hidden');
                fetchAdminData();
                setInterval(fetchAdminData, 3000);
            }

            async function fetchState() {
                if (!currentUserId) return;
                const res = await fetch('/api/state/' + currentUserId);
                if (!res.ok) return;
                const data = await res.json();
                document.getElementById('timer').innerText = data.timer;
                document.getElementById('periodId').innerText = data.periodId;
                document.getElementById('balance').innerText = data.balance.toFixed(2);
                document.getElementById('history').innerHTML = data.history.map(i => 
                    \`<div class="history-item bg-\${i.color}">\${i.color[0]}</div>\`
                ).join('');
            }

            async function fetchAdminData() {
                const res = await fetch('/api/admin/data');
                const data = await res.json();

                document.getElementById('adminDepositTable').innerHTML = data.deposits.map(d => \`
                    <tr>
                        <td>\${d.userId}</td>
                        <td>₹\${d.amount}</td>
                        <td>\${d.utrNumber}</td>
                        <td><b>\${d.status}</b></td>
                        <td>
                            \${d.status === 'PENDING' ? \`
                                <button style="background:#16a34a; padding:4px;" onclick="actionDeposit('\${d._id}', 'APPROVE')">Approve</button>
                                <button style="background:#dc2626; padding:4px;" onclick="actionDeposit('\${d._id}', 'REJECT')">Reject</button>
                            \` : '-'}
                        </td>
                    </tr>
                \`).join('');

                document.getElementById('adminWithdrawTable').innerHTML = data.withdrawals.map(w => \`
                    <tr>
                        <td>\${w.userId}</td>
                        <td>₹\${w.amount}</td>
                        <td>\${w.upiId}</td>
                        <td><b>\${w.status}</b></td>
                        <td>
                            \${w.status === 'PENDING' ? \`
                                <button style="background:#16a34a; padding:4px;" onclick="actionWithdraw('\${w._id}', 'APPROVE')">Approve</button>
                                <button style="background:#dc2626; padding:4px;" onclick="actionWithdraw('\${w._id}', 'REJECT')">Reject</button>
                            \` : '-'}
                        </td>
                    </tr>
                \`).join('');
            }

            async function actionDeposit(id, action) {
                await fetch('/api/admin/deposit-action', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id, action })
                });
                fetchAdminData();
            }

            async function actionWithdraw(id, action) {
                await fetch('/api/admin/withdraw-action', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id, action })
                });
                fetchAdminData();
            }

            async function placeBet(color) {
                const amount = document.getElementById('betAmount').value;
                const res = await fetch('/api/place-bet', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ userId: currentUserId, color, amount })
                });
                const data = await res.json();
                const msg = document.getElementById('gameMsg');
                msg.innerText = data.message;
                msg.style.color = res.ok ? '#4ade80' : '#f87171';
            }

            async function submitDeposit() {
                const amount = document.getElementById('depAmount').value;
                const utrNumber = document.getElementById('utrNumber').value;
                const res = await fetch('/api/deposit', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ userId: currentUserId, utrNumber, amount })
                });
                const data = await res.json();
                const msg = document.getElementById('depMsg');
                msg.innerText = data.message;
                msg.style.color = res.ok ? '#4ade80' : '#f87171';
            }

            async function submitWithdraw() {
                const amount = document.getElementById('witAmount').value;
                const upiId = document.getElementById('witUpi').value;
                const res = await fetch('/api/withdraw', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ userId: currentUserId, amount, upiId })
                });
                const data = await res.json();
                const msg = document.getElementById('witMsg');
                msg.innerText = data.message;
                msg.style.color = res.ok ? '#4ade80' : '#f87171';
            }

            function showTab(id) { hideTabs(); document.getElementById(id).classList.remove('hidden'); }
            function hideTabs() {
                document.getElementById('depositSection').classList.add('hidden');
                document.getElementById('withdrawSection').classList.add('hidden');
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));