require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// --- 1. Database Connection ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("MongoDB Fail:", err));

// --- 2. Schemas ---

// User Schema (For Login)
const UserSchema = new mongoose.Schema({
    phone: { type: String, required: true, unique: true },
    pin: { type: String, required: true } 
});
const User = mongoose.model('User', UserSchema);

// Expense Schema (For Data)
const ExpenseSchema = new mongoose.Schema({
    userPhone: String,
    amount: Number,
    merchant: String,
    category: String,
    appName: String, // Will show "VM-HDFC", "AD-ICICI" etc.
    originalMessage: String,
    date: { type: Date, default: Date.now }
});
const Expense = mongoose.model('Expense', ExpenseSchema);

// --- 3. Helper Functions ---

// Smart SMS Parser
function parseSMS(text) {
    const msg = text.toLowerCase().replace(/,/g, ''); 
    
    // A. Find Amount (Matches "rs 500", "INR 500", "₹500")
    // It looks for the currency symbol followed by digits
    const amountMatch = msg.match(/(?:rs\.?|inr|₹)\s*([\d.]+)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

    // B. Find Merchant (The logic specifically for Bank SMS)
    // Standard Format: "Debited ... to ZOMATO on..." OR "Spent ... at STARBUCKS..."
    // Logic: Capture text after "to/at/in/on" and stop before "via/on/ref/avl"
    let merchant = "Unknown";
    const merchantMatch = msg.match(/(?:to|at|in|spent on)\s+([a-z0-9\s\&\-\.]+?)(?:\s+(?:on|via|using|ref|bal|txn|avl|from)|$)/);
    
    if (merchantMatch) {
        merchant = merchantMatch[1].trim();
    }

    // Cleanup: Remove common banking junk words if they got caught
    merchant = merchant.replace('upi', '').replace('pos', '').replace('imps', '').trim();
    if (merchant.includes('@')) merchant = merchant.split('@')[0]; // Remove UPI IDs

    return { amount, merchant };
}

// Categorizer
function getCategory(merchant) {
    const m = merchant.toLowerCase();
    if (m.match(/swiggy|zomato|pizza|burger|tea|coffee|kfc|mcdonalds/)) return 'Food';
    if (m.match(/uber|ola|rapido|petrol|shell|hpcl|bpcl|pump|fuel/)) return 'Travel';
    if (m.match(/jio|airtel|vi|bescom|netflix|hotstar|spotify|act/)) return 'Bills';
    if (m.match(/amazon|flipkart|myntra|zudio|trends|rel/)) return 'Shopping';
    return 'General';
}

// --- 4. API Routes ---

// Keep-Alive Route (For UptimeRobot)
app.get('/ping', (req, res) => res.send('Pong')); 
app.get('/', (req, res) => res.send('Expense Tracker Backend is Live!'));

// A. LOGIN / REGISTER
app.post('/api/auth/login', async (req, res) => {
    const { phone, pin } = req.body;
    
    if (!phone || !pin) return res.status(400).json({success: false, message: "Missing fields"});

    const user = await User.findOne({ phone });
    
    if (!user) {
        // Auto-Register new user
        const newUser = await User.create({ phone, pin });
        return res.json({ success: true, user: newUser, message: "Account created!" });
    }

    if (user.pin === pin) {
        return res.json({ success: true, user, message: "Login successful" });
    } else {
        return res.status(401).json({ success: false, message: "Wrong PIN" });
    }
});

// B. SYNC DATA (Called by MacroDroid)
app.post('/api/sync', async (req, res) => {
    const { user_phone, message, app_name, secret } = req.body;

    // Security Check
    if (secret !== process.env.API_SECRET) return res.status(403).send("Invalid Secret");

    const lowerMsg = message.toLowerCase();

    // FILTER 1: Ignore Income (Credits)
    if (lowerMsg.includes("credited") || lowerMsg.includes("received") || lowerMsg.includes("paid you")) {
        return res.send("Ignored: Income transaction");
    }

    // FILTER 2: Must be an Outgoing Transaction
    if (!lowerMsg.includes("debited") && !lowerMsg.includes("spent") && !lowerMsg.includes("paid") && !lowerMsg.includes("sent")) {
        return res.send("Ignored: Not a transaction");
    }

    // Parse the SMS
    const { amount, merchant } = parseSMS(message);

    if (amount > 0) {
        await Expense.create({
            userPhone: user_phone,
            amount,
            merchant: merchant.toUpperCase(),
            appName: app_name,
            category: getCategory(merchant),
            originalMessage: message
        });
        console.log(`Saved ₹${amount} at ${merchant} for ${user_phone}`);
        return res.send("Saved");
    }
    res.send("No amount found");
});

// C. FETCH DATA (Called by Frontend)
app.get('/api/expenses', async (req, res) => {
    const { phone } = req.query;
    if (!phone) return res.status(400).send("Phone required");

    const expenses = await Expense.find({ userPhone: phone }).sort({ date: -1 });
    res.json(expenses);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));