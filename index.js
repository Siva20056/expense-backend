require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

// --- Database Connection ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.error("MongoDB Fail:", err));

// --- Schema ---
const ExpenseSchema = new mongoose.Schema({
    userPhone: String,
    amount: Number,
    merchant: String,
    category: String,
    appName: String,
    date: { type: Date, default: Date.now }
});
const Expense = mongoose.model('Expense', ExpenseSchema);

// --- Parser Logic ---
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

// --- Routes ---
app.get('/', (req, res) => res.send('Expense API Live'));
app.get('/ping', (req, res) => res.send('Pong')); // Keep-Alive Route

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

app.get('/api/expenses', async (req, res) => {
    const { phone } = req.query;
    const expenses = await Expense.find({ userPhone: phone }).sort({ date: -1 });
    res.json(expenses);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));