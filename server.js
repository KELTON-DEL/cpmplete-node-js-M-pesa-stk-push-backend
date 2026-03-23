// IMPORT LIBRARIES
const express = require("express");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// ENV VARIABLES
const PORT = process.env.PORT || 5000;
const BASE_URL = process.env.BASE_URL; // Sandbox or Production
const CONSUMER_KEY = process.env.CONSUMER_KEY;
const CONSUMER_SECRET = process.env.CONSUMER_SECRET;
const SHORTCODE = process.env.SHORTCODE;
const PASSKEY = process.env.PASSKEY;
const CALLBACK_URL = process.env.CALLBACK_URL;
const till=6730963

// GENERATE ACCESS TOKEN
async function generateToken() {
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString("base64");
  try {
    const response = await axios.get(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    return response.data.access_token;
    
  } catch (err) {
    console.error("Token Error:", err.response?.data || err.message);
    return null;
  }
}

// STK PUSH ENDPOINT
app.post("/stk", async (req, res) => {
  
  const { phone, amount } = req.body;

  if (!phone || !amount) return res.status(400).json({ message: "Phone and amount required" });

  try {
    const token = await generateToken();
    if (!token) return res.status(500).json({ message: "Failed to generate token" });

    const date = new Date();
    const timestamp =
      date.getFullYear() +
      ("0" + (date.getMonth() + 1)).slice(-2) +
      ("0" + date.getDate()).slice(-2) +
      ("0" + date.getHours()).slice(-2) +
      ("0" + date.getMinutes()).slice(-2) +
      ("0" + date.getSeconds()).slice(-2);

    const password =  Buffer.from(SHORTCODE + PASSKEY + timestamp).toString("base64");

    const stkPayload = {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phone,
      PartyB:till,
      PhoneNumber:phone ,
      CallBackURL: CALLBACK_URL,
      AccountReference: "TEST",
      TransactionDesc: "React STK Push",
    };

    console.log("Sending STK Push:", stkPayload);

    const response = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      stkPayload,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );

    console.log("STK Response:", response.data);
    res.json(response.data);
  } catch (err) {
    console.error("STK Push Error:", err.response?.data || err.message);
    res.status(500).json(err.response?.data || { message: err.message });
  }
});

// CALLBACK ROUTE
app.post("/callback", (req, res) => {
  console.log("Daraja Callback Received:", req.body);
  console.log("Headers:", req.headers);
  res.sendStatus(200);
});

// TEST ROUTE
app.get("/", (req, res) => res.send("Daraja STK Push Backend Running"));

app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));