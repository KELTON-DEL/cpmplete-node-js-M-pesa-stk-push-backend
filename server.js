// IMPORT LIBRARIES
require('newrelic');
const express = require("express");
const axios = require("axios");
const mongoose = require('mongoose');
const cors = require("cors");
const Payment=require("./models/paymentModel")
require("dotenv").config();


const app = express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(cors());




mongoose.connect(process.env.dbUrl).then(()=>{

  console.log("database connected sucessfully");  
}).catch((error)=>{
  console.log(error.message)
})


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

let transactions={};//for temporary storage

// STK PUSH ENDPOINT
app.post("/api/v1/stk-push", async (req, res) => {
  
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

    const password =  Buffer.from(SHORTCODE + PASSKEY
      
      + timestamp).toString("base64");


const stkPayload = {
  // Must be the Online Store/HQ Shortcode linked to the Till (as a string)
  BusinessShortCode: String(SHORTCODE), 
  
  Password: password,
  Timestamp: timestamp,
  TransactionType: "CustomerBuyGoodsOnline",
  Amount: String(amount), 
  PartyA: String(phone),
  
  
  PartyB: String(till), 
  
  PhoneNumber: String(phone),
  CallBackURL: "https://kellcom-mpesa.onrender.com/api/v1/mpesa/callback",
  AccountReference: "TEST",
  TransactionDesc: "React STK Push",
};


    /*const stkPayload = {
      BusinessShortCode: SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phone,
      PartyB:till,
      PhoneNumber:phone ,
      CallBackURL: "https://kellcom-mpesa.onrender.com/api/v1/mpesa/callback",
      AccountReference: "TEST",
      TransactionDesc: "React STK Push",
    };
*/



    console.log("Sending STK Push:", stkPayload);

    const response = await axios.post(
      `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
      stkPayload,
      { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } }
    );


    // after STK request succeeds
const stkResponse = response.data;

const checkoutId = stkResponse.CheckoutRequestID;

// store transaction as pending
transactions[checkoutId] = {
  status: "PENDING",
  phone,
  amount
}; 

// send ID back to frontend
res.json({ CheckoutRequestID: checkoutId });


    console.log("STK Response:", response.data);
    //res.json(response.data);
  } catch (err) {
    console.error("STK Push Error:", err.response?.data || err.message);
    res.status(500).json(err.response?.data || { message: err.message });
  }
});


// CHECK PAYMENT STATUS
// CHECK PAYMENT STATUS ROUTE
app.get("/api/v1/payment-status/:id", (req, res) => {
  const checkoutId = req.params.id;
  const transaction = transactions[checkoutId];

  if (!transaction) {
    return res.status(200).json({
      status: "PENDING",
      message: "Waiting for user action..."
    });
  }

  res.json({
    status: transaction.status,
    phone: transaction.phone,
    amount: transaction.amount
  });
});

// TEST ROUTE
app.get("/", (req, res) => res.send("Daraja STK Push Backend Running"));


// Health-check endpoint to prevent Render cold starts
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'success',
        message: 'Server is up and running',
        timestamp: new Date().toISOString()
    });
});

app.listen(PORT,() => console.log(`Server running on http://localhost:${PORT}`));


// CALLBACK ROUTE


app.post("/api/v1/mpesa/callback", async (req, res) => {
  try {
    const callbackData = req.body;

    console.log(JSON.stringify(callbackData, null, 2));

    // GET CALLBACK OBJECT
    const stkCallback = callbackData.Body?.stkCallback;

    if (!stkCallback) {
      return res.status(400).json({ error: "Invalid callback structure" });
    }

    const checkoutId = stkCallback.CheckoutRequestID;
    const resultCode = stkCallback.ResultCode;

    // CHECK IF TRANSACTION EXISTS IN MEMORY / DB
    if (!transactions[checkoutId]) {
      transactions[checkoutId] = {};
    }

    // 1. SUCCESSFUL PAYMENT (ResultCode === 0)
    if (resultCode === 0) {
      transactions[checkoutId].status = "SUCCESS";
      console.log("✅ PAYMENT SUCCESS");

      // Extract metadata values safely
      const metadataItems = stkCallback.CallbackMetadata?.Item || [];
      
      const amount = metadataItems.find((item) => item.Name === "Amount")?.Value;
      const tranx_id = metadataItems.find((item) => item.Name === "MpesaReceiptNumber")?.Value;
      const phone = metadataItems.find((item) => item.Name === "PhoneNumber")?.Value;

      console.log({ phone, amount, tranx_id });

      // Save successful payment to MongoDB / Database
      const payment = new Payment({
        number: phone,
        amount: amount,
        tranx_id: tranx_id,
        checkoutId: checkoutId,
        status: "SUCCESS"
      });

      try {
        const savedData = await payment.save();
        console.log("Saved successfully:", savedData);
      } catch (dbError) {
        console.error("Database save error:", dbError.message);
      }
    } 
    // 2. FAILED / CANCELLED / TIMEOUT CASES (No CallbackMetadata provided by Safaricom)
    else {
      let statusString = "FAILED";

      if (resultCode === 1032) {
        statusString = "CANCELLED";
        console.log("❌ USER CANCELLED");
      } else if (resultCode === 1) {
        statusString = "LOW_BALANCE";
        console.log("❌ LOW AMOUNT");
      } else if (resultCode === 2001) {
        statusString = "WRONGPIN";
        console.log("❌ WRONG PIN ENTERED");
      } else if (resultCode === 1037) {
        statusString = "TIMEOUT";
        console.log("❌ TIMED OUT REQUEST");
      } else {
        console.log(`❌ PAYMENT FAILED WITH RESULT CODE: ${resultCode}`);
      }

      transactions[checkoutId].status = statusString;
    }

    // Always return HTTP 200 to Safaricom
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: "Accepted",
    });

  } catch (error) {
    console.log("CALLBACK ERROR:", error.message);

    return res.status(500).json({
      error: error.message,
    });
  }
});

/*
app.post("/api/v1/mpesa/callback", (req, res) => {

  try {

    const callbackData = req.body;

    console.log(
      JSON.stringify(callbackData, null, 2)
    );

    // GET CALLBACK OBJECT
    const stkCallback = callbackData.Body.stkCallback;

    // GET VALUES
    const checkoutId = stkCallback.CheckoutRequestID;

    const resultCode = stkCallback.ResultCode;


    // CHECK IF TRANSACTION EXISTS
    if (!transactions[checkoutId]) {

      transactions[checkoutId] = {};
    }
   
    // RESULTANT RESPONSE
  
    if (resultCode === 0) {

      transactions[checkoutId].status ="SUCCESS";

      console.log("✅ PAYMENT SUCCESS");
    }
     
    else if (resultCode === 1032) {

      transactions[checkoutId].status ="CANCELLED";  

      console.log("❌ USER CANCELLED");
    }

       else if (resultCode === 1) {

      transactions[checkoutId].status ="LOW_BALANCE";

      console.log("❌LOW AMOUNT");
    }

   else if (resultCode === 2001) {

      transactions[checkoutId].status ="WRONGPIN";

      console.log("❌ WRONG PIN ENTERED");
    }

       else if (resultCode === 1037) {

      transactions[checkoutId].status ="TIMEOUT";

      console.log("❌ TIMED OUT REQUEST");
    }


    // OTHER FAILURES
   
    else {

      transactions[checkoutId].status ="FAILED";
      console.log("❌ PAYMENT FAILED");
    }


    res.json({
      message: "Callback received",
    });

  } catch (error) {

    console.log("CALLBACK ERROR:",error.message );

    res.status(500).json({
      error: error.message,
    });
  }

   // phone=CallbackMetadata.Item[4].Value
    // amount=CallbackMetadata.Item[0].Value
    //tranx_id=CallbackMetadata.Item[1].Value

    //console.log({phone,amount,tranx_id})

    const payment=new Payment();

    payment.number=phone
      payment.amount=amount
        payment.tranx_id=tranx_id

        payment.save()
        .then((data)=>{
          console.log({message:"saved sucessfully",data})
        })
        .catch((error)=>{
          console.log(error.message)
        })

       

});
*/


/*
app.post("/callback",(req,res)=>{
  const callbackData=req.body;
  console.log(callbackData.Body);

  if(!callbackData.Body.stkCallback.CallbackMetadata){
      console.log(callbackData.Body);
      return res.send("ok");
  }

  //console.log(callbackData.Body. stkCallback.CallbackMetadata);


  
   phone=callbackData.Body. stkCallback.CallbackMetadata.Item[4].Value
    amount=callbackData.Body. stkCallback.CallbackMetadata.Item[0].Value
    tranx_id=callbackData.Body. stkCallback.CallbackMetadata.Item[1].Value

console.log({phone,amount,tranx_id})
  
  const payment=new Payment();

    payment.number=phone
      payment.amount=amount
        payment.tranx_id=tranx_id

        payment.save()
        .then((data)=>{
          console.log({message:"saved sucessfully",data})
        })
        .catch((error)=>{
          console.log(error.message)
        })

})

*/