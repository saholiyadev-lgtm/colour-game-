const express = require('express');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

/* =========================================================
   MONGODB CONNECTION
   ========================================================= */

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error("ERROR: MONGO_URI environment variable is missing!");
} else {
    mongoose.connect(MONGO_URI)
        .then(() => {
            console.log("MongoDB Database Connected Successfully!");
        })
        .catch((err) => {
            console.error("MongoDB Connection Error:", err);
        });
}

/* =========================================================
   SCHEMAS
   ========================================================= */

const UserSchema = new mongoose.Schema({
    account: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    password: {
        type: String,
        required: true
    },

    balance: {
        type: Number,
        default: 0.00
    }
});

const TransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['DEPOSIT', 'WITHDRAWAL']
    },

    userId: {
        type: String,
        required: true
    },

    amount: {
        type: Number,
        required: true
    },

    utrNumber: {
        type: String,
        default: ''
    },

    upiId: {
        type: String,
        default: ''
    },

    status: {
        type: String,
        default: 'PENDING'
    },

    date: {
        type: Date,
        default: Date.now
    }
});

const GameHistorySchema = new mongoose.Schema({
    periodId: String,

    color: String,

    date: {
        type: Date,
        default: Date.now
    }
});

const User = mongoose.model('User', UserSchema);
const Transaction = mongoose.model('Transaction', TransactionSchema);
const GameHistory = mongoose.model('GameHistory', GameHistorySchema);


/* =========================================================
   ADMIN CREDENTIALS
   ========================================================= */

const ADMIN_CREDENTIALS = {
    username: "admin",
    password: "admin123"
};


/* =========================================================
   GAME STATE
   ========================================================= */

let gameState = {
    timer: 60,
    periodId: Date.now().toString().slice(-8),
    lastResult: null,
    upcomingResult: null,
    activeBets: []
};


/* =========================================================
   GAME ENGINE
   ========================================================= */

setInterval(async () => {

    try {

        gameState.timer--;

        /*
         * Decide upcoming result at 30 seconds.
         */

        if (gameState.timer === 30) {

            let greenTotal = 0;
            let redTotal = 0;

            gameState.activeBets.forEach((bet) => {

                if (bet.color.toLowerCase() === 'green') {
                    greenTotal += bet.amount;
                }

                if (bet.color.toLowerCase() === 'red') {
                    redTotal += bet.amount;
                }

            });

            let resultColor = 'Green';

            const totalPlayers = gameState.activeBets.length;

            if (totalPlayers === 1 || totalPlayers === 2) {

                const playerBetColor =
                    gameState.activeBets[0].color.toLowerCase();

                const oppositeColor =
                    playerBetColor === 'green'
                        ? 'Red'
                        : 'Green';

                const isWin = Math.random() < 0.3;

                resultColor = isWin
                    ? (playerBetColor === 'green' ? 'Green' : 'Red')
                    : oppositeColor;

            } else if (totalPlayers > 2) {

                if (greenTotal > redTotal) {

                    resultColor = 'Red';

                } else if (redTotal > greenTotal) {

                    resultColor = 'Green';

                } else {

                    resultColor =
                        Math.random() > 0.5
                            ? 'Green'
                            : 'Red';
                }

            } else {

                resultColor =
                    Math.random() > 0.5
                        ? 'Green'
                        : 'Red';
            }

            gameState.upcomingResult = resultColor;
        }


        /*
         * Round finished.
         */

        if (gameState.timer <= 0) {

            const resultColor =
                gameState.upcomingResult ||
                (Math.random() > 0.5 ? 'Green' : 'Red');

            gameState.lastResult = resultColor;

            await GameHistory.create({
                periodId: gameState.periodId,
                color: resultColor
            });


            /*
             * Pay winning bets.
             */

            for (const bet of gameState.activeBets) {

                if (
                    bet.color.toLowerCase() ===
                    resultColor.toLowerCase()
                ) {

                    const winAmount = bet.amount * 1.9;

                    await User.findOneAndUpdate(
                        {
                            account: bet.userId
                        },
                        {
                            $inc: {
                                balance: winAmount
                            }
                        }
                    );
                }
            }


            /*
             * Start new round.
             */

            gameState.activeBets = [];

            gameState.timer = 60;

            gameState.upcomingResult = null;

            gameState.periodId =
                Date.now().toString().slice(-8);
        }

    } catch (err) {

        console.error("Game Engine Error:", err);
    }

}, 1000);


/* =========================================================
   REGISTER
   ========================================================= */

app.post('/api/register', async (req, res) => {

    const { account, password } = req.body;

    if (!account || account.length < 5) {

        return res.status(400).json({
            message: "Mobile Number athva Email nakho!"
        });
    }

    if (!password || password.length < 4) {

        return res.status(400).json({
            message: "Password minimum 4 characters no joie!"
        });
    }

    try {

        const existingUser =
            await User.findOne({ account });

        if (existingUser) {

            return res.status(400).json({
                message: "Account pehle thi registered chhe!"
            });
        }

        const newUser = await User.create({
            account,
            password,
            balance: 0.00
        });

        res.json({
            message: "Registration Successful!",
            userId: newUser.account
        });

    } catch (err) {

        console.error("Register Error:", err);

        res.status(500).json({
            message: "Database connection error!"
        });
    }
});


/* =========================================================
   LOGIN
   ========================================================= */

app.post('/api/login', async (req, res) => {

    try {

        const { account, password } = req.body;

        const user =
            await User.findOne({ account });

        if (!user || user.password !== password) {

            return res.status(401).json({
                message: "Invalid Details!"
            });
        }

        res.json({
            message: "Login Successful!",
            userId: user.account
        });

    } catch (err) {

        console.error("Login Error:", err);

        res.status(500).json({
            message: "Server error!"
        });
    }
});


/* =========================================================
   DEPOSIT
   ========================================================= */

app.post('/api/deposit', async (req, res) => {

    try {

        const {
            userId,
            utrNumber,
            amount
        } = req.body;

        const utrRegex = /^\d{12}$/;

        if (!utrRegex.test(utrNumber)) {

            return res.status(400).json({
                message: "Exact 12 digits UTR number nakho."
            });
        }

        const existingUTR =
            await Transaction.findOne({ utrNumber });

        if (existingUTR) {

            return res.status(400).json({
                message: "Aa UTR number used thai gayo chhe!"
            });
        }

        const depositAmt =
            parseFloat(amount);

        if (
            isNaN(depositAmt) ||
            depositAmt < 10
        ) {

            return res.status(400).json({
                message: "Minimum deposit ₹10 chhe."
            });
        }

        await Transaction.create({
            type: 'DEPOSIT',
            userId,
            utrNumber,
            amount: depositAmt,
            status: 'PENDING'
        });

        res.json({
            message:
                "Deposit request submitted! Admin approval pachi balance add thashe."
        });

    } catch (err) {

        console.error("Deposit Error:", err);

        res.status(500).json({
            message: "Server error!"
        });
    }
});


/* =========================================================
   WITHDRAW
   ========================================================= */

app.post('/api/withdraw', async (req, res) => {

    try {

        const {
            userId,
            amount,
            upiId
        } = req.body;

        const user =
            await User.findOne({
                account: userId
            });

        if (!user) {

            return res.status(404).json({
                message: "User not found!"
            });
        }

        const withdrawAmt =
            parseFloat(amount);

        if (
            isNaN(withdrawAmt) ||
            withdrawAmt <= 0 ||
            withdrawAmt > user.balance
        ) {

            return res.status(400).json({
                message: "Insufficient Balance!"
            });
        }

        if (
            !upiId ||
            !upiId.includes('@')
        ) {

            return res.status(400).json({
                message: "Valid UPI ID nakho!"
            });
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

        res.json({
            message: "Withdrawal request submitted!",
            newBalance: user.balance
        });

    } catch (err) {

        console.error("Withdraw Error:", err);

        res.status(500).json({
            message: "Server error!"
        });
    }
});


/* =========================================================
   GAME STATE
   ========================================================= */

app.get('/api/state/:userId', async (req, res) => {

    try {

        const user =
            await User.findOne({
                account: req.params.userId
            });

        if (!user) {

            return res.status(404).json({
                message: "User not found"
            });
        }

        const history =
            await GameHistory
                .find()
                .sort({ date: -1 })
                .limit(15);

        res.json({

            timer: gameState.timer,

            periodId: gameState.periodId,

            lastResult: gameState.lastResult,

            history,

            balance: user.balance

        });

    } catch (err) {

        console.error("State Error:", err);

        res.status(500).json({
            message: "Server error"
        });
    }
});


/* =========================================================
   PLACE BET
   ========================================================= */

app.post('/api/place-bet', async (req, res) => {

    try {

        const {
            userId,
            color,
            amount
        } = req.body;

        const user =
            await User.findOne({
                account: userId
            });

        if (!user) {

            return res.status(404).json({
                message: "User not found!"
            });
        }

        if (gameState.timer <= 30) {

            return res.status(400).json({
                message:
                    "Round Freeze! Bet nai thai (30s remaining)."
            });
        }

        const betAmount =
            parseFloat(amount);

        if (
            isNaN(betAmount) ||
            betAmount > user.balance ||
            betAmount <= 0
        ) {

            return res.status(400).json({
                message: "Insufficient Balance!"
            });
        }

        if (
            color !== 'green' &&
            color !== 'red'
        ) {

            return res.status(400).json({
                message: "Invalid color!"
            });
        }

        user.balance -= betAmount;

        await user.save();

        gameState.activeBets.push({
            userId,
            color,
            amount: betAmount
        });

        res.json({
            message: "Bet Placed Successfully!",
            balance: user.balance
        });

    } catch (err) {

        console.error("Bet Error:", err);

        res.status(500).json({
            message: "Server error!"
        });
    }
});


/* =========================================================
   ADMIN LOGIN
   ========================================================= */

app.post('/api/admin/login', (req, res) => {

    const {
        username,
        password
    } = req.body;

    if (
        username === ADMIN_CREDENTIALS.username &&
        password === ADMIN_CREDENTIALS.password
    ) {

        return res.json({
            message: "Admin Logged In!"
        });
    }

    res.status(401).json({
        message: "Invalid Admin Credentials!"
    });
});


/* =========================================================
   ADMIN DATA
   ========================================================= */

app.get('/api/admin/data', async (req, res) => {

    try {

        const users =
            await User.find(
                {},
                'account balance'
            );

        const deposits =
            await Transaction
                .find({
                    type: 'DEPOSIT'
                })
                .sort({
                    date: -1
                });

        const withdrawals =
            await Transaction
                .find({
                    type: 'WITHDRAWAL'
                })
                .sort({
                    date: -1
                });

        res.json({

            users,

            deposits,

            withdrawals,

            upcomingResult:
                gameState.upcomingResult,

            timer:
                gameState.timer

        });

    } catch (err) {

        console.error("Admin Data Error:", err);

        res.status(500).json({
            message: "Server error!"
        });
    }
});


/* =========================================================
   ADMIN DEPOSIT ACTION
   ========================================================= */

app.post('/api/admin/deposit-action', async (req, res) => {

    try {

        const {
            id,
            action
        } = req.body;

        const tx =
            await Transaction.findById(id);

        if (
            !tx ||
            tx.status !== 'PENDING'
        ) {

            return res.status(400).json({
                message: "Invalid Transaction"
            });
        }

        if (action === 'APPROVE') {

            await User.findOneAndUpdate(
                {
                    account: tx.userId
                },
                {
                    $inc: {
                        balance: tx.amount
                    }
                }
            );

            tx.status = 'APPROVED';

        } else if (action === 'REJECT') {

            tx.status = 'REJECTED';

        } else {

            return res.status(400).json({
                message: "Invalid action"
            });
        }

        await tx.save();

        res.json({
            message:
                "Deposit Action Completed!"
        });

    } catch (err) {

        console.error(
            "Deposit Action Error:",
            err
        );

        res.status(500).json({
            message: "Server error!"
        });
    }
});


/* =========================================================
   ADMIN WITHDRAW ACTION
   ========================================================= */

app.post('/api/admin/withdraw-action', async (req, res) => {

    try {

        const {
            id,
            action
        } = req.body;

        const tx =
            await Transaction.findById(id);

        if (
            !tx ||
            tx.status !== 'PENDING'
        ) {

            return res.status(400).json({
                message: "Invalid Transaction"
            });
        }

        if (action === 'REJECT') {

            await User.findOneAndUpdate(
                {
                    account: tx.userId
                },
                {
                    $inc: {
                        balance: tx.amount
                    }
                }
            );

            tx.status = 'REJECTED';

        } else if (action === 'APPROVE') {

            tx.status = 'APPROVED';

        } else {

            return res.status(400).json({
                message: "Invalid action"
            });
        }

        await tx.save();

        res.json({
            message:
                "Withdrawal Action Completed!"
        });

    } catch (err) {

        console.error(
            "Withdraw Action Error:",
            err
        );

        res.status(500).json({
            message: "Server error!"
        });
    }
});


/* =========================================================
   FRONTEND
   ========================================================= */

app.get('/', (req, res) => {

    res.setHeader(
        'Cache-Control',
        'no-cache, no-store, must-revalidate'
    );

    res.send(`<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta name="viewport"
      content="width=device-width, initial-scale=1.0">

<title>Color Game Portal</title>

<style>

* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    font-family: sans-serif;
}

body {
    background-color: #0f172a;
    color: #f8fafc;
    padding: 15px;
}

.container {
    max-width: 450px;
    margin: 0 auto;
}

.card {
    background: #1e293b;
    padding: 20px;
    border-radius: 12px;
    margin-bottom: 15px;
    border: 1px solid #334155;
}

h2,
h3 {
    color: #38bdf8;
    text-align: center;
    margin-bottom: 12px;
}

input {
    width: 100%;
    padding: 12px;
    margin: 8px 0;
    border-radius: 6px;
    border: 1px solid #475569;
    background: #0f172a;
    color: white;
    font-size: 16px;
}

button {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 6px;
    font-weight: bold;
    cursor: pointer;
    margin-top: 5px;
    font-size: 15px;
}

.btn-primary {
    background: #0284c7;
    color: white;
}

.btn-green {
    background: #16a34a;
    color: white;
    width: 48%;
}

.btn-red {
    background: #dc2626;
    color: white;
    width: 48%;
}

.flex-group {
    display: flex;
    justify-content: space-between;
    gap: 10px;
}

.timer-box {
    font-size: 2.2rem;
    font-weight: bold;
    color: #facc15;
    text-align: center;
}

.balance-box {
    font-size: 1.1rem;
    text-align: center;
    color: #4ade80;
    margin-bottom: 8px;
}

.tab-container {
    display: flex;
    background: #0f172a;
    border-radius: 8px;
    padding: 4px;
    margin-bottom: 15px;
    gap: 5px;
}

.tab-btn {
    flex: 1;
    padding: 10px;
    cursor: pointer;
    color: #94a3b8;
    font-weight: bold;
    font-size: 14px;
    border-radius: 6px;
    background: transparent;
    border: none;
    margin: 0;
}

.tab-btn.active {
    background: #0284c7;
    color: #ffffff;
}

.history-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin-top: 8px;
}

.history-item {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75rem;
    font-weight: bold;
    color: white;
}

.bg-Red {
    background: #dc2626;
}

.bg-Green {
    background: #16a34a;
}

.msg {
    margin-top: 8px;
    font-size: 0.85rem;
    text-align: center;
}

.winner-banner {
    padding: 10px;
    border-radius: 8px;
    text-align: center;
    font-weight: bold;
    margin-bottom: 10px;
    color: white;
}

.qr-box {
    text-align: center;
    background: #ffffff;
    padding: 12px;
    border-radius: 8px;
    margin: 10px 0;
}

.qr-box img {
    width: 200px;
    height: 200px;
    object-fit: contain;
}

table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
    font-size: 0.8rem;
}

th,
td {
    border: 1px solid #334155;
    padding: 6px;
    text-align: left;
}

th {
    background: #0f172a;
}

</style>

</head>

<body>

<div class="container">


<!-- =====================================================
     AUTH
     ===================================================== -->

<div id="authSection" class="card">

<h2>Game Portal</h2>

<div class="tab-container">

<button
    type="button"
    class="tab-btn active"
    id="tabLogin"
    onclick="switchTab('login')">
    Player Login
</button>

<button
    type="button"
    class="tab-btn"
    id="tabReg"
    onclick="switchTab('reg')">
    Register
</button>

<button
    type="button"
    class="tab-btn"
    id="tabAdmin"
    onclick="switchTab('admin')">
    Admin
</button>

</div>


<!-- LOGIN -->

<div id="loginForm">

<input
    type="text"
    id="loginAccount"
    placeholder="Mobile Number or Email">

<input
    type="password"
    id="loginPass"
    placeholder="Password">

<button
    type="button"
    onclick="login()"
    class="btn-primary">
    Login
</button>

</div>


<!-- REGISTER -->

<div id="regForm" style="display:none;">

<input
    type="text"
    id="regAccount"
    placeholder="Mobile Number or Email">

<input
    type="password"
    id="regPass"
    placeholder="Set Password">

<button
    type="button"
    onclick="register()"
    class="btn-primary">
    Create Account
</button>

</div>


<!-- ADMIN LOGIN -->

<div id="adminLoginForm" style="display:none;">

<input
    type="text"
    id="adminUser"
    placeholder="Admin Username">

<input
    type="password"
    id="adminPass"
    placeholder="Admin Password">

<button
    type="button"
    onclick="adminLogin()"
    class="btn-primary"
    style="background:#7c3aed;">
    Admin Login
</button>

</div>

<p id="authMsg" class="msg"></p>

</div>


<!-- =====================================================
     PLAYER DASHBOARD
     ===================================================== -->

<div id="gameSection" style="display:none;">

<div class="card">

<div style="
display:flex;
justify-content:space-between;
font-size:0.85rem;
">

<span>
User:
<b id="displayUid"
   style="color:#38bdf8;">
-
</b>
</span>

<a
href="#"
onclick="logout(); return false;"
style="color:#f87171;">
Logout
</a>

</div>

<div
class="balance-box"
style="margin-top:8px;">
Wallet: ₹<span id="balance">0.00</span>
</div>

<div class="flex-group">

<button
type="button"
onclick="showTabSection('depositSection')"
class="btn-primary"
style="background:#059669;">
Deposit
</button>

<button
type="button"
onclick="showTabSection('withdrawSection')"
class="btn-primary"
style="background:#d97706;">
Withdraw
</button>

</div>

</div>


<div
id="winnerDisplay"
class="winner-banner"
style="display:none;">
</div>


<div class="card">

<div style="
text-align:center;
color:#94a3b8;
font-size:0.8rem;">

Period:
<span id="periodId">-</span>

</div>

<div
class="timer-box"
id="timer">
60
</div>

<input
type="number"
id="betAmount"
placeholder="Amount"
value="100">

<div class="flex-group">

<button
type="button"
onclick="placeBet('green')"
class="btn-green">
GREEN (1.9x)
</button>

<button
type="button"
onclick="placeBet('red')"
class="btn-red">
RED (1.9x)
</button>

</div>

<p id="gameMsg" class="msg"></p>

</div>


<!-- DEPOSIT -->

<div
id="depositSection"
class="card"
style="display:none;">

<h3>Deposit Funds</h3>

<div class="qr-box">

<img
src="https://i.ibb.co/3s3B4fJ/1000063151.jpg"
alt="Deposit UPI QR Code">

</div>

<input
type="number"
id="depAmount"
placeholder="Amount Paid">

<input
type="text"
id="utrNumber"
maxlength="12"
placeholder="12-Digit UTR Number">

<button
type="button"
onclick="submitDeposit()"
class="btn-primary">
Submit UTR
</button>

<button
type="button"
onclick="hideTabSections()"
style="background:transparent;color:#94a3b8;">
Back
</button>

<p id="depMsg" class="msg"></p>

</div>


<!-- WITHDRAW -->

<div
id="withdrawSection"
class="card"
style="display:none;">

<h3>Withdraw Funds</h3>

<input
type="number"
id="witAmount"
placeholder="Amount">

<input
type="text"
id="witUpi"
placeholder="UPI ID">

<button
type="button"
onclick="submitWithdraw()"
class="btn-primary"
style="background:#d97706;">
Request Withdrawal
</button>

<button
type="button"
onclick="hideTabSections()"
style="background:transparent;color:#94a3b8;">
Back
</button>

<p id="witMsg" class="msg"></p>

</div>


<!-- HISTORY -->

<div class="card">

<h3>History</h3>

<div
class="history-grid"
id="history">
</div>

</div>

</div>


<!-- =====================================================
     ADMIN DASHBOARD
     ===================================================== -->

<div
id="adminSection"
class="card"
style="display:none;">

<h2>Admin Control Panel</h2>

<div
id="adminNextResult"
style="
padding:10px;
font-weight:bold;
border-radius:8px;
text-align:center;
margin-bottom:15px;
background:#334155;
color:#facc15;">
Waiting for 30s mark...
</div>

<button
type="button"
onclick="logout()"
style="
background:#dc2626;
margin-bottom:15px;">
Logout
</button>

<p style="margin-bottom:10px;">
Total Registered Users:
<b
id="totalUsersCount"
style="color:#38bdf8;">
0
</b>
</p>


<h3>Registered Users</h3>

<div
style="
overflow-x:auto;
max-height:150px;
margin-bottom:15px;">

<table>

<thead>

<tr>
<th>User Account</th>
<th>Balance</th>
</tr>

</thead>

<tbody id="adminUsersTable"></tbody>

</table>

</div>


<h3>Pending Deposits</h3>

<div
style="
overflow-x:auto;
margin-bottom:15px;">

<table>

<thead>

<tr>
<th>User</th>
<th>Amt</th>
<th>UTR</th>
<th>Action</th>
</tr>

</thead>

<tbody id="adminDepositTable"></tbody>

</table>

</div>


<h3>Pending Withdrawals</h3>

<div style="overflow-x:auto;">

<table>

<thead>

<tr>
<th>User</th>
<th>Amt</th>
<th>UPI</th>
<th>Action</th>
</tr>

</thead>

<tbody id="adminWithdrawTable"></tbody>

</table>

</div>

</div>

</div>


<script>

/* =====================================================
   FRONTEND STATE
   ===================================================== */

let currentUserId =
    localStorage.getItem('game_uid') || null;

let isAdmin =
    localStorage.getItem('is_admin') === 'true';

let timerInterval = null;


/* =====================================================
   INITIAL LOAD
   ===================================================== */

if (isAdmin) {

    showAdminDashboard();

} else if (currentUserId) {

    showDashboard();

}


/* =====================================================
   TAB SWITCH
   ===================================================== */

function switchTab(type) {

    const loginForm =
        document.getElementById('loginForm');

    const regForm =
        document.getElementById('regForm');

    const adminLoginForm =
        document.getElementById('adminLoginForm');

    const tabLogin =
        document.getElementById('tabLogin');

    const tabReg =
        document.getElementById('tabReg');

    const tabAdmin =
        document.getElementById('tabAdmin');


    loginForm.style.display = 'none';

    regForm.style.display = 'none';

    adminLoginForm.style.display = 'none';


    tabLogin.classList.remove('active');

    tabReg.classList.remove('active');

    tabAdmin.classList.remove('active');


    if (type === 'login') {

        loginForm.style.display = 'block';

        tabLogin.classList.add('active');

    }

    else if (type === 'reg') {

        regForm.style.display = 'block';

        tabReg.classList.add('active');

    }

    else if (type === 'admin') {

        adminLoginForm.style.display = 'block';

        tabAdmin.classList.add('active');

    }
}


/* =====================================================
   REGISTER
   ===================================================== */

async function register() {

    const account =
        document.getElementById('regAccount').value.trim();

    const password =
        document.getElementById('regPass').value;


    try {

        const res =
            await fetch('/api/register', {

                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                body: JSON.stringify({
                    account,
                    password
                })

            });


        const data =
            await res.json();


        if (res.ok) {

            currentUserId = data.userId;

            localStorage.setItem(
                'game_uid',
                currentUserId
            );

            showDashboard();

        } else {

            document.getElementById(
                'authMsg'
            ).innerText = data.message;
        }

    } catch (err) {

        document.getElementById(
            'authMsg'
        ).innerText =
            "Server connection error!";
    }
}


/* =====================================================
   LOGIN
   ===================================================== */

async function login() {

    const account =
        document.getElementById(
            'loginAccount'
        ).value.trim();

    const password =
        document.getElementById(
            'loginPass'
        ).value;


    try {

        const res =
            await fetch('/api/login', {

                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                body: JSON.stringify({
                    account,
                    password
                })

            });


        const data =
            await res.json();


        if (res.ok) {

            currentUserId = data.userId;

            localStorage.setItem(
                'game_uid',
                currentUserId
            );

            showDashboard();

        } else {

            document.getElementById(
                'authMsg'
            ).innerText =
                data.message;
        }

    } catch (err) {

        document.getElementById(
            'authMsg'
        ).innerText =
            "Server connection error!";
    }
}


/* =====================================================
   ADMIN LOGIN
   ===================================================== */

async function adminLogin() {

    const username =
        document.getElementById(
            'adminUser'
        ).value.trim();

    const password =
        document.getElementById(
            'adminPass'
        ).value;


    try {

        const res =
            await fetch('/api/admin/login', {

                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                body: JSON.stringify({
                    username,
                    password
                })

            });


        const data =
            await res.json();


        if (res.ok) {

            localStorage.setItem(
                'is_admin',
                'true'
            );

            isAdmin = true;

            showAdminDashboard();

        } else {

            document.getElementById(
                'authMsg'
            ).innerText =
                data.message ||
                "Invalid Admin Credentials!";
        }

    } catch (err) {

        document.getElementById(
            'authMsg'
        ).innerText =
            "Server connection error!";
    }
}


/* =====================================================
   LOGOUT
   ===================================================== */

function logout() {

    localStorage.removeItem('game_uid');

    localStorage.removeItem('is_admin');

    currentUserId = null;

    isAdmin = false;

    location.reload();
}


/* =====================================================
   PLAYER DASHBOARD
   ===================================================== */

function showDashboard() {

    document.getElementById(
        'authSection'
    ).style.display = 'none';

    document.getElementById(
        'gameSection'
    ).style.display = 'block';

    document.getElementById(
        'adminSection'
    ).style.display = 'none';


    document.getElementById(
        'displayUid'
    ).innerText = currentUserId;


    fetchState();


    if (!timerInterval) {

        timerInterval =
            setInterval(
                fetchState,
                1000
            );
    }
}


/* =====================================================
   ADMIN DASHBOARD
   ===================================================== */

function showAdminDashboard() {

    document.getElementById(
        'authSection'
    ).style.display = 'none';

    document.getElementById(
        'gameSection'
    ).style.display = 'none';

    document.getElementById(
        'adminSection'
    ).style.display = 'block';


    fetchAdminData();

    setInterval(
        fetchAdminData,
        1000
    );
}


/* =====================================================
   FETCH GAME STATE
   ===================================================== */

async function fetchState() {

    if (!currentUserId) return;


    try {

        const res =
            await fetch(
                '/api/state/' +
                encodeURIComponent(
                    currentUserId
                )
            );


        if (!res.ok) return;


        const data =
            await res.json();


        document.getElementById(
            'timer'
        ).innerText =
            data.timer;


        document.getElementById(
            'periodId'
        ).innerText =
            data.periodId;


        document.getElementById(
            'balance'
        ).innerText =
            Number(data.balance)
                .toFixed(2);


        const banner =
            document.getElementById(
                'winnerDisplay'
            );


        if (data.lastResult) {

            banner.style.display =
                'block';

            banner.innerText =
                "LAST WINNER: " +
                data.lastResult.toUpperCase();


            banner.style.background =
                data.lastResult === 'Red'
                    ? '#dc2626'
                    : '#16a34a';

        } else {

            banner.style.display =
                'none';
        }


        document.getElementById(
            'history'
        ).innerHTML =
            data.history.map((item) => {

                return `
                    <div class="history-item bg-${item.color}">
                        ${item.color[0]}
                    </div>
                `;

            }).join('');


    } catch (e) {

        console.error(
            "Fetch State Error:",
            e
        );
    }
}


/* =====================================================
   PLACE BET
   ===================================================== */

async function placeBet(color) {

    const amount =
        document.getElementById(
            'betAmount'
        ).value;


    try {

        const res =
            await fetch(
                '/api/place-bet',
                {

                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify({

                        userId:
                            currentUserId,

                        color,

                        amount

                    })

                }
            );


        const data =
            await res.json();


        const msg =
            document.getElementById(
                'gameMsg'
            );


        msg.innerText =
            data.message;


        msg.style.color =
            res.ok
                ? '#4ade80'
                : '#f87171';


        if (res.ok) {

            fetchState();
        }


    } catch (err) {

        document.getElementById(
            'gameMsg'
        ).innerText =
            "Server connection error!";
    }
}


/* =====================================================
   DEPOSIT
   ===================================================== */

async function submitDeposit() {

    const amount =
        document.getElementById(
            'depAmount'
        ).value;

    const utrNumber =
        document.getElementById(
            'utrNumber'
        ).value.trim();


    try {

        const res =
            await fetch(
                '/api/deposit',
                {

                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify({

                        userId:
                            currentUserId,

                        utrNumber,

                        amount

                    })

                }
            );


        const data =
            await res.json();


        const msg =
            document.getElementById(
                'depMsg'
            );


        msg.innerText =
            data.message;


        msg.style.color =
            res.ok
                ? '#4ade80'
                : '#f87171';


    } catch (err) {

        document.getElementById(
            'depMsg'
        ).innerText =
            "Server connection error!";
    }
}


/* =====================================================
   WITHDRAW
   ===================================================== */

async function submitWithdraw() {

    const amount =
        document.getElementById(
            'witAmount'
        ).value;

    const upiId =
        document.getElementById(
            'witUpi'
        ).value.trim();


    try {

        const res =
            await fetch(
                '/api/withdraw',
                {

                    method: 'POST',

                    headers: {
                        'Content-Type':
                            'application/json'
                    },

                    body: JSON.stringify({

                        userId:
                            currentUserId,

                        amount,

                        upiId

                    })

                }
            );


        const data =
            await res.json();


        const msg =
            document.getElementById(
                'witMsg'
            );


        msg.innerText =
            data.message;


        msg.style.color =
            res.ok
                ? '#4ade80'
                : '#f87171';


        if (res.ok) {

            fetchState();
        }


    } catch (err) {

        document.getElementById(
            'witMsg'
        ).innerText =
            "Server connection error!";
    }
}


/* =====================================================
   ADMIN DATA
   ===================================================== */

async function fetchAdminData() {

    try {

        const res =
            await fetch(
                '/api/admin/data'
            );


        if (!res.ok) return;


        const data =
            await res.json();


        const resultBox =
            document.getElementById(
                'adminNextResult'
            );


        if (resultBox) {

            if (
                data.timer <= 30 &&
                data.upcomingResult
            ) {

                resultBox.innerText =
                    'NEXT RESULT (30s ADVANCE): ' +
                    data.upcomingResult.toUpperCase();


                resultBox.style.background =
                    data.upcomingResult === 'Red'
                        ? '#dc2626'
                        : '#16a34a';


                resultBox.style.color =
                    '#ffffff';

            } else {

                resultBox.innerText =
                    'Timer: ' +
                    data.timer +
                    's | Lock Result in 30s...';


                resultBox.style.background =
                    '#334155';

                resultBox.style.color =
                    '#facc15';
            }
        }


        document.getElementById(
            'totalUsersCount'
        ).innerText =
            data.users.length;


        document.getElementById(
            'adminUsersTable'
        ).innerHTML =
            data.users.map((u) => {

                return `
                    <tr>
                        <td>${escapeHtml(u.account)}</td>
                        <td>₹${Number(u.balance).toFixed(2)}</td>
                    </tr>
                `;

            }).join('');


        document.getElementById(
            'adminDepositTable'
        ).innerHTML =
            data.deposits.map((d) => {

                const action =
                    d.status === 'PENDING'
                        ? `
                            <button
                                style="background:#16a34a;padding:4px;"
                                onclick="actionDeposit('${d._id}','APPROVE')">
                                Approve
                            </button>

                            <button
                                style="background:#dc2626;padding:4px;"
                                onclick="actionDeposit('${d._id}','REJECT')">
                                Reject
                            </button>
                          `
                        : escapeHtml(d.status);


                return `
                    <tr>
                        <td>${escapeHtml(d.userId)}</td>
                        <td>₹${Number(d.amount).toFixed(2)}</td>
                        <td>${escapeHtml(d.utrNumber)}</td>
                        <td>${action}</td>
                    </tr>
                `;

            }).join('');


        document.getElementById(
            'adminWithdrawTable'
        ).innerHTML =
            data.withdrawals.map((w) => {

                const action =
                    w.status === 'PENDING'
                        ? `
                            <button
                                style="background:#16a34a;padding:4px;"
                                onclick="actionWithdraw('${w._id}','APPROVE')">
                                Approve
                            </button>

                            <button
                                style="background:#dc2626;padding:4px;"
                                onclick="actionWithdraw('${w._id}','REJECT')">
                                Reject
                            </button>
                          `
                        : escapeHtml(w.status);


                return `
                    <tr>
                        <td>${escapeHtml(w.userId)}</td>
                        <td>₹${Number(w.amount).toFixed(2)}</td>
                        <td>${escapeHtml(w.upiId)}</td>
                        <td>${action}</td>
                    </tr>
                `;

            }).join('');


    } catch (e) {

        console.error(
            "Admin Data Error:",
            e
        );
    }
}


/* =====================================================
   ADMIN DEPOSIT ACTION
   ===================================================== */

async function actionDeposit(id, action) {

    try {

        await fetch(
            '/api/admin/deposit-action',
            {

                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                body: JSON.stringify({
                    id,
                    action
                })

            }
        );


        fetchAdminData();


    } catch (err) {

        console.error(err);
    }
}


/* =====================================================
   ADMIN WITHDRAW ACTION
   ===================================================== */

async function actionWithdraw(id, action) {

    try {

        await fetch(
            '/api/admin/withdraw-action',
            {

                method: 'POST',

                headers: {
                    'Content-Type':
                        'application/json'
                },

                body: JSON.stringify({
                    id,
                    action
                })

            }
        );


        fetchAdminData();


    } catch (err) {

        console.error(err);
    }
}


/* =====================================================
   TAB SECTIONS
   ===================================================== */

function showTabSection(id) {

    hideTabSections();

    document.getElementById(
        id
    ).style.display = 'block';
}


function hideTabSections() {

    document.getElementById(
        'depositSection'
    ).style.display = 'none';

    document.getElementById(
        'withdrawSection'
    ).style.display = 'none';
}


/* =====================================================
   HTML ESCAPE
   ===================================================== */

function escapeHtml(value) {

    if (value === null ||
        value === undefined) {
        return '';
    }

    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

</script>

</body>

</html>`);

});


/* =========================================================
   SERVER
   ========================================================= */

app.listen(PORT, () => {

    console.log(
        'Server running on port ' + PORT
    );

});
