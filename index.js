require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("MongoDB Fail:", err));

// --- 1. Schemas ---
// User Schema (For Login)
const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    pin: { type: String, required: true } // Simple 4 digit PIN
});
const User = mongoose.model('User', UserSchema);

// Expense Schema (For Data)
const ExpenseSchema = new mongoose.Schema({
    userPhone: String,
    amount: Number,
    merchant: String,
    category: String,
    appName: String,
    date: { type: Date, default: Date.now }
});
const Expense = mongoose.model('Expense', ExpenseSchema);

// --- 2. Parser Logic (Same as before) ---
function parseNotification(text) {
    const msg = text.toLowerCase().replace(/,/g, ''); 
    const amountMatch = msg.match(/(?:rs\.?|inr|₹)\s*([\d.]+)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
    const merchantMatch = msg.match(/(?:paid to|sent to)\s+(.+?)(?:\s+(?:via|using|on|successful)|$)/);
    let merchant = merchantMatch ? merchantMatch[1].trim() : "Unknown";
    if (merchant.includes('@')) merchant = merchant.split('@')[0];
    return { amount, merchant };
}

function getCategory(merchant) {
    const m = merchant.toLowerCase();
    if (m.match(/swiggy|zomato|pizza|burger|tea|coffee/)) return 'Food';
    if (m.match(/uber|ola|rapido|petrol|shell|hpcl/)) return 'Travel';
    if (m.match(/jio|airtel|bescom|netflix|amazon|flipkart/)) return 'Bills/Shopping';
    return 'General';
}

// --- 3. Routes ---

// A. LOGIN / REGISTER
app.post('/api/auth/login', async (req, res) => {
    const { phone, pin } = req.body;
    const user = await User.findOne({ phone });
    
    if (!user) {
        // First time? Let's auto-register them (Simple logic for MVP)
        const newUser = await User.create({ phone, pin });
        return res.json({ success: true, user: newUser, message: "New account created!" });
    }

    if (user.pin === pin) {
        return res.json({ success: true, user, message: "Welcome back!" });
    } else {
        return res.status(401).json({ success: false, message: "Wrong PIN" });
    }
});

// B. SYNC DATA (MacroDroid)
app.post('/api/sync', async (req, res) => {
    const { user_phone, message, app_name, secret } = req.body;
    if (secret !== process.env.API_SECRET) return res.status(403).send("Invalid Secret");

    if (!message.toLowerCase().includes("paid") && !message.toLowerCase().includes("sent")) return res.send("Ignored");

    const { amount, merchant } = parseNotification(message);
    if (amount > 0) {
        await Expense.create({ userPhone: user_phone, amount, merchant, appName: app_name, category: getCategory(merchant) });
        return res.send("Saved");
    }
    res.send("No amount found");
});

// C. FETCH DATA (Frontend)
app.get('/api/expenses', async (req, res) => {
    const { phone } = req.query;
    const expenses = await Expense.find({ userPhone: phone }).sort({ date: -1 });
    res.json(expenses);
});

app.get('/ping', (req, res) => res.send('Pong')); 

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));