
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import Database from "better-sqlite3";
import Groq from "groq-sdk";
import { z } from "zod";
import { randomUUID } from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import multer from "multer";

// --------------------------------------------------
// 1. INITIAL CONFIGURATION
// --------------------------------------------------

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const isProduction = process.env.NODE_ENV === "production";

// --------------------------------------------------
// 2. GROQ AI CONFIGURATION
// --------------------------------------------------

const groq = process.env.GROQ_API_KEY
    ? new Groq({
        apiKey: process.env.GROQ_API_KEY
    })
    : null;

const GROQ_MODEL = "openai/gpt-oss-20b";

const PAYPAL_BASE_URL =
    process.env.PAYPAL_BASE_URL ||
    "https://api-m.sandbox.paypal.com";

const PAYPAL_CLIENT_ID = process.env.PAYPAL_CLIENT_ID;
const PAYPAL_CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;

async function getPayPalAccessToken() {
    if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        throw new Error("PayPal Sandbox credentials are not configured.");
    }

    const credentials = Buffer.from(
        `${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`
    ).toString("base64");

    const response = await fetch(
        `${PAYPAL_BASE_URL}/v1/oauth2/token`,
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "grant_type=client_credentials"
        }
    );

    const data = await response.json();

    if (!response.ok || !data.access_token) {
        console.error("PayPal authentication error:", data);
        throw new Error("PayPal Sandbox authentication failed.");
    }

    return data.access_token;
}



// --------------------------------------------------
// 3. SQLITE DATABASE CONFIGURATION
// --------------------------------------------------

const databaseDirectory = path.join(__dirname, "database");

if (!fs.existsSync(databaseDirectory)) {
    fs.mkdirSync(databaseDirectory, { recursive: true });
}

const databasePath = path.join(
    databaseDirectory,
    "paypilot.db"
);

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Create invoices table
db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        customer TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0),
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'PENDING',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

// Create transactions table
db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        paypal_order_id TEXT UNIQUE,
        paypal_capture_id TEXT UNIQUE,
        description TEXT NOT NULL,
        amount REAL NOT NULL CHECK(amount > 0),
        currency TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`);

// --------------------------------------------------
// RECEIPT UPLOAD CONFIGURATION
// --------------------------------------------------

const receiptDirectory = path.join(
    __dirname,
    "uploads",
    "receipts"
);

if (!fs.existsSync(receiptDirectory)) {
    fs.mkdirSync(receiptDirectory, { recursive: true });
}

// Add receipt columns to existing databases safely
const invoiceColumns = db.prepare(
    "PRAGMA table_info(invoices)"
).all();

const existingColumnNames = invoiceColumns.map(
    column => column.name
);

const receiptColumns = [
    ["receipt_filename", "TEXT"],
    ["receipt_original_name", "TEXT"],
    ["receipt_mime_type", "TEXT"],
    ["receipt_uploaded_at", "TEXT"]
];

for (const [columnName, columnType] of receiptColumns) {
    if (!existingColumnNames.includes(columnName)) {
        db.exec(
            `ALTER TABLE invoices ADD COLUMN ${columnName} ${columnType}`
        );
    }
}

const receiptStorage = multer.diskStorage({
    destination: (req, file, callback) => {
        callback(null, receiptDirectory);
    },

    filename: (req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();

        callback(
            null,
            `${randomUUID()}${extension}`
        );
    }
});

const receiptUpload = multer({
    storage: receiptStorage,

    limits: {
        fileSize: 5 * 1024 * 1024
    },

    fileFilter: (req, file, callback) => {
        const allowedTypes = [
            "application/pdf",
            "image/jpeg",
            "image/png"
        ];

        if (!allowedTypes.includes(file.mimetype)) {
            return callback(
                new Error("Only PDF, JPG and PNG receipts are allowed.")
            );
        }

        callback(null, true);
    }
});


console.log("SQLite database connected successfully.");

// --------------------------------------------------
// 4. SECURITY MIDDLEWARE
// --------------------------------------------------

app.disable("x-powered-by");

app.use(helmet());

app.use(express.json({
    limit: "1mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "1mb"
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Please try again later."
    }
});

app.use("/api", apiLimiter);

// --------------------------------------------------
// 5. VALIDATION SCHEMAS
// --------------------------------------------------

const invoiceSchema = z.object({
    customer: z.string()
        .trim()
        .min(1)
        .max(100),

    description: z.string()
        .trim()
        .min(1)
        .max(200),

    amount: z.coerce.number()
        .positive()
        .max(10000),

    currency: z.literal("USD").default("USD")
});

const aiChatSchema = z.object({
    message: z.string()
        .trim()
        .min(1)
        .max(4000)
});

// --------------------------------------------------
// 6. HEALTH CHECK
// --------------------------------------------------

app.get("/api/health", (req, res) => {
    try {
        db.prepare("SELECT 1").get();

        res.status(200).json({
            success: true,
            application: "PayPilot AI",
            status: "Online",
            database: "Connected",
            aiProvider: groq ? "Groq" : "Not configured",
            paymentMode: "PayPal Sandbox only"
        });

    } catch (error) {
        console.error("Health check error:", error);

        res.status(503).json({
            success: false,
            application: "PayPilot AI",
            status: "Unavailable",
            database: "Disconnected"
        });
    }
});

// --------------------------------------------------
// 7. CREATE INVOICE
// --------------------------------------------------

app.post("/api/invoices", (req, res) => {
    try {
        const validation = invoiceSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid invoice information.",
                errors: validation.error.issues
            });
        }

        const {
            customer,
            description,
            amount,
            currency
        } = validation.data;

        const invoiceId = `INV-${randomUUID()}`;

        const insertInvoice = db.prepare(`
            INSERT INTO invoices (
                id,
                customer,
                description,
                amount,
                currency,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `);

        insertInvoice.run(
            invoiceId,
            customer,
            description,
            amount,
            currency,
            "PENDING"
        );

        const invoice = db.prepare(`
            SELECT *
            FROM invoices
            WHERE id = ?
        `).get(invoiceId);

        return res.status(201).json({
            success: true,
            message: "Invoice created successfully.",
            invoice
        });

    } catch (error) {
        console.error("Create invoice error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to create invoice."
        });
    }
});

// --------------------------------------------------
// 8. GET ALL INVOICES
// --------------------------------------------------

app.get("/api/invoices", (req, res) => {
    try {
        const invoices = db.prepare(`
            SELECT *
            FROM invoices
            ORDER BY created_at DESC
        `).all();

        return res.status(200).json({
            success: true,
            count: invoices.length,
            invoices
        });

    } catch (error) {
        console.error("Get invoices error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve invoices."
        });
    }
});
// --------------------------------------------------
// PAYPAL: CREATE SANDBOX ORDER
// --------------------------------------------------

app.post("/api/paypal/create-order", async (req, res) => {
    try {
        const invoiceId = req.body.invoiceId;

        if (typeof invoiceId !== "string" || !invoiceId.trim()) {
            return res.status(400).json({
                success: false,
                message: "A valid invoice ID is required."
            });
        }

        const invoice = db.prepare(`
            SELECT * FROM invoices WHERE id = ?
        `).get(invoiceId);

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found."
            });
        }

        if (invoice.status !== "PENDING") {
            return res.status(409).json({
                success: false,
                message: "Only pending invoices can be paid."
            });
        }

        if (invoice.currency !== "USD") {
            return res.status(400).json({
                success: false,
                message: "Only USD invoices are supported."
            });
        }

        const accessToken = await getPayPalAccessToken();

        const paypalResponse = await fetch(
            `${PAYPAL_BASE_URL}/v2/checkout/orders`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "PayPal-Request-Id": randomUUID()
                },
                body: JSON.stringify({
                    intent: "CAPTURE",
                    purchase_units: [
                        {
                            custom_id: invoice.id,
                            invoice_id: invoice.id,
                            description: invoice.description,
                            amount: {
                                currency_code: invoice.currency,
                                value: Number(invoice.amount).toFixed(2)
                            }
                        }
                    ]
                })
            }
        );

        const order = await paypalResponse.json();

        if (!paypalResponse.ok || !order.id) {
            console.error("PayPal create order error:", order);

            return res.status(502).json({
                success: false,
                message: "PayPal could not create the Sandbox order."
            });
        }

        return res.status(201).json({
            success: true,
            orderID: order.id,
            status: order.status
        });

    } catch (error) {
        console.error("PayPal create order error:", error);

        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
});


// --------------------------------------------------
// PAYPAL: CAPTURE SANDBOX PAYMENT
// --------------------------------------------------

app.post("/api/paypal/capture-order", async (req, res) => {
    try {
        const { orderID, invoiceId } = req.body;

        if (
            typeof orderID !== "string" ||
            !orderID.trim() ||
            typeof invoiceId !== "string" ||
            !invoiceId.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Order ID and invoice ID are required."
            });
        }

        const invoice = db.prepare(`
            SELECT * FROM invoices WHERE id = ?
        `).get(invoiceId);

        if (!invoice) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found."
            });
        }

        if (invoice.status !== "PENDING") {
            return res.status(409).json({
                success: false,
                message: "This invoice is not pending payment."
            });
        }

        const accessToken = await getPayPalAccessToken();

        // Verify the order belongs to this invoice.
        const orderResponse = await fetch(
            `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderID)}`,
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            }
        );

        const orderDetails = await orderResponse.json();

        if (!orderResponse.ok) {
            console.error("PayPal order verification error:", orderDetails);

            return res.status(400).json({
                success: false,
                message: "Unable to verify the PayPal order."
            });
        }

        const purchaseUnit = orderDetails.purchase_units?.[0];
        const orderAmount = purchaseUnit?.amount;

        if (
            orderDetails.intent !== "CAPTURE" ||
            purchaseUnit?.custom_id !== invoice.id ||
            orderAmount?.currency_code !== invoice.currency ||
            Number(orderAmount?.value) !== Number(invoice.amount)
        ) {
            return res.status(400).json({
                success: false,
                message: "The PayPal order does not match this invoice."
            });
        }

        // Capture the approved order.
        const captureResponse = await fetch(
            `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                    "PayPal-Request-Id": randomUUID()
                },
                body: JSON.stringify({})
            }
        );

        const captureData = await captureResponse.json();

        if (
            !captureResponse.ok ||
            captureData.status !== "COMPLETED"
        ) {
            console.error("PayPal capture error:", captureData);

            return res.status(400).json({
                success: false,
                message: "PayPal payment was not completed.",
                paypalStatus: captureData.status || "UNKNOWN"
            });
        }

        const capture = captureData.purchase_units
            ?.flatMap(unit => unit.payments?.captures || [])
            .find(item => item.status === "COMPLETED");

        if (
            !capture?.id ||
            capture.amount?.currency_code !== invoice.currency ||
            Number(capture.amount?.value) !== Number(invoice.amount)
        ) {
            return res.status(400).json({
                success: false,
                message: "PayPal capture details could not be verified."
            });
        }

        // Save transaction and update invoice together.
        const savePayment = db.transaction(() => {
            db.prepare(`
                INSERT INTO transactions (
                    id,
                    paypal_order_id,
                    paypal_capture_id,
                    description,
                    amount,
                    currency,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
                randomUUID(),
                orderID,
                capture.id,
                invoice.description,
                invoice.amount,
                invoice.currency,
                "COMPLETED"
            );

            db.prepare(`
                UPDATE invoices
                SET status = 'PAID'
                WHERE id = ? AND status = 'PENDING'
            `).run(invoice.id);
        });

        savePayment();

        return res.status(200).json({
            success: true,
            message: "PayPal Sandbox payment completed successfully.",
            orderID,
            captureID: capture.id,
            status: "COMPLETED"
        });

    } catch (error) {
        console.error("PayPal capture error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to complete or record the PayPal payment."
        });
    }
});

// --------------------------------------------------
// 9. GROQ AI CHAT ENDPOINT
// --------------------------------------------------

// UPDATE INVOICE STATUS
const invoiceStatusSchema = z.object({
    status: z.enum(["PENDING", "PAID", "CANCELLED"])
});

app.patch("/api/invoices/:id/status", (req, res) => {
    try {
        const validation = invoiceStatusSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                success: false,
                message: "Invalid invoice status."
            });
        }

        const invoiceId = req.params.id;
        const { status } = validation.data;
        if (status === "PAID") {
    return res.status(400).json({
        success: false,
        message: "Please upload a payment receipt to mark this invoice as PAID."
    });
}

        const result = db.prepare(`
            UPDATE invoices
            SET status = ?
            WHERE id = ?
        `).run(status, invoiceId);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found."
            });
        }

        const invoice = db.prepare(`
            SELECT * FROM invoices WHERE id = ?
        `).get(invoiceId);

        return res.json({
            success: true,
            message: "Invoice status updated successfully.",
            invoice
        });

    } catch (error) {
        console.error("Invoice status update error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to update invoice status."
        });
    }
});

// --------------------------------------------------
// UPLOAD PAYMENT RECEIPT
// --------------------------------------------------

app.post(
    "/api/invoices/:id/receipt",
    (req, res, next) => {
        receiptUpload.single("receipt")(req, res, (error) => {
            if (error) {
                return res.status(400).json({
                    success: false,
                    message: error.code === "LIMIT_FILE_SIZE"
                        ? "Receipt must be smaller than 5 MB."
                        : error.message
                });
            }

            next();
        });
    },
    (req, res) => {
        let uploadedFile = req.file;

        try {
            if (!uploadedFile) {
                return res.status(400).json({
                    success: false,
                    message: "Please select a receipt file."
                });
            }

            const invoiceId = req.params.id;

            const invoice = db.prepare(`
                SELECT * FROM invoices WHERE id = ?
            `).get(invoiceId);

            if (!invoice) {
                fs.unlinkSync(uploadedFile.path);

                return res.status(404).json({
                    success: false,
                    message: "Invoice not found."
                });
            }

            if (invoice.status === "PAID") {
                fs.unlinkSync(uploadedFile.path);

                return res.status(409).json({
                    success: false,
                    message: "This invoice is already marked as PAID."
                });
            }

            const updateInvoice = db.prepare(`
                UPDATE invoices
                SET
                    status = 'PAID',
                    receipt_filename = ?,
                    receipt_original_name = ?,
                    receipt_mime_type = ?,
                    receipt_uploaded_at = CURRENT_TIMESTAMP
                WHERE id = ?
            `);

            updateInvoice.run(
                uploadedFile.filename,
                uploadedFile.originalname,
                uploadedFile.mimetype,
                invoiceId
            );

            const updatedInvoice = db.prepare(`
                SELECT * FROM invoices WHERE id = ?
            `).get(invoiceId);

            return res.status(200).json({
                success: true,
                message: "Receipt uploaded and invoice marked as PAID.",
                invoice: updatedInvoice
            });

        } catch (error) {
            console.error("Receipt upload error:", error);

            if (uploadedFile && fs.existsSync(uploadedFile.path)) {
                fs.unlinkSync(uploadedFile.path);
            }

            return res.status(500).json({
                success: false,
                message: "Unable to save payment receipt."
            });
        }
    }
);

// --------------------------------------------------
// VIEW PAYMENT RECEIPT
// --------------------------------------------------

app.get("/api/invoices/:id/receipt", (req, res) => {
    try {
        const invoice = db.prepare(`
            SELECT receipt_filename, receipt_mime_type
            FROM invoices
            WHERE id = ?
        `).get(req.params.id);

        if (!invoice || !invoice.receipt_filename) {
            return res.status(404).json({
                success: false,
                message: "Receipt not found."
            });
        }

        const receiptPath = path.join(
            receiptDirectory,
            path.basename(invoice.receipt_filename)
        );

        if (!fs.existsSync(receiptPath)) {
            return res.status(404).json({
                success: false,
                message: "Receipt file is missing."
            });
        }

        res.setHeader(
            "Content-Type",
            invoice.receipt_mime_type
        );

        res.setHeader(
            "Content-Disposition",
            `inline; filename="${path.basename(invoice.receipt_filename)}"`
        );

        return res.sendFile(receiptPath);

    } catch (error) {
        console.error("View receipt error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to open receipt."
        });
    }
});


// DELETE INVOICE
app.delete("/api/invoices/:id", (req, res) => {
    try {
        const result = db.prepare(`
            DELETE FROM invoices
            WHERE id = ?
        `).run(req.params.id);

        if (result.changes === 0) {
            return res.status(404).json({
                success: false,
                message: "Invoice not found."
            });
        }

        return res.json({
            success: true,
            message: "Invoice deleted successfully."
        });

    } catch (error) {
        console.error("Invoice deletion error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to delete invoice."
        });
    }
});


app.post("/api/ai/chat", async (req, res) => {
    try {
        // Validate message
        const validation = aiChatSchema.safeParse(req.body);

        if (!validation.success) {
            return res.status(400).json({
                success: false,
                assistant: "PayPilot AI",
                message: "Please enter a valid message."
            });
        }

        // Check Groq configuration
        if (!groq) {
            return res.status(503).json({
                success: false,
                assistant: "PayPilot AI",
                message: "Groq API key is missing. Configure GROQ_API_KEY in your .env file."
            });
        }

        const userMessage = validation.data.message;

        // Read application statistics
        const invoiceStats = db.prepare(`
            SELECT
                COUNT(*) AS total,
                COALESCE(SUM(amount), 0) AS totalAmount
            FROM invoices
        `).get();

        const transactionStats = db.prepare(`
            SELECT COUNT(*) AS total
            FROM transactions
        `).get();

        // PayPilot AI system instructions
        const systemPrompt = `
You are PayPilot AI, the intelligent assistant
inside the PayPilot AI payment management platform.

YOUR RESPONSIBILITIES:

1. Explain payment concepts.
2. Help users understand invoices.
3. Explain transaction management.
4. Explain PayPal Sandbox payment workflows.
5. Help users understand payment security.
6. Give useful business payment suggestions.
7. Explain how PayPilot AI works.
8. Help users troubleshoot payment-related problems.

APPLICATION INFORMATION:

Total invoices: ${invoiceStats.total}
Invoice value: ${invoiceStats.totalAmount} USD
Total recorded transactions: ${transactionStats.total}

IMPORTANT RULES:

- Be professional, friendly and helpful.
- Use simple language.
- Keep answers clear and organized.
- Never claim that a payment was completed unless the backend confirms it.
- Never invent invoice or transaction records.
- Never request passwords, API keys or payment secrets.
- PayPal integration is intended for Sandbox testing.
- Do not claim that unfinished features are implemented.
- If you do not know an answer, be honest.

You are PayPilot AI.
`;

        // Request response from Groq
        const completion = await groq.chat.completions.create({
            model: GROQ_MODEL,

            messages: [
                {
                    role: "system",
                    content: systemPrompt
                },
                {
                    role: "user",
                    content: userMessage
                }
            ],

            max_completion_tokens: 700
        });

        const assistantMessage =
            completion.choices?.[0]?.message?.content;

        if (
            typeof assistantMessage !== "string" ||
            !assistantMessage.trim()
        ) {
            return res.status(502).json({
                success: false,
                assistant: "PayPilot AI",
                message: "The AI returned an empty response. Please try again."
            });
        }

        // Successful response
        return res.status(200).json({
            success: true,
            assistant: "PayPilot AI",
            message: assistantMessage,
            provider: "Groq",
            model: GROQ_MODEL
        });

    } catch (error) {
        console.error("Groq AI error:", error);

        const status = error.status || error.statusCode;

        if (status === 401) {
            return res.status(401).json({
                success: false,
                assistant: "PayPilot AI",
                message: "Groq authentication failed. Check your API key."
            });
        }

        if (status === 403) {
            return res.status(403).json({
                success: false,
                assistant: "PayPilot AI",
                message: "Groq denied this API request. Check your account access."
            });
        }

        if (status === 404) {
            return res.status(502).json({
                success: false,
                assistant: "PayPilot AI",
                message: "The selected Groq model was not found."
            });
        }

        if (status === 429) {
            return res.status(429).json({
                success: false,
                assistant: "PayPilot AI",
                message: "Groq usage limit reached. Please wait and try again."
            });
        }

        if (status >= 500) {
            return res.status(503).json({
                success: false,
                assistant: "PayPilot AI",
                message: "Groq is temporarily unavailable. Please try again later."
            });
        }

        return res.status(500).json({
            success: false,
            assistant: "PayPilot AI",
            message: "An unexpected error occurred while contacting Groq."
        });
    }
});

// --------------------------------------------------
// 10. SERVE FRONTEND FILES
// --------------------------------------------------

app.use(express.static(
    path.join(__dirname, "public")
));


// --------------------------------------------------
// GET ALL TRANSACTIONS
// --------------------------------------------------

app.get("/api/transactions", (req, res) => {
    try {
        const transactions = db.prepare(`
            SELECT
                id,
                paypal_order_id,
                paypal_capture_id,
                description,
                amount,
                currency,
                status,
                created_at
            FROM transactions
            ORDER BY created_at DESC
        `).all();

        return res.status(200).json({
            success: true,
            count: transactions.length,
            transactions
        });

    } catch (error) {
        console.error("Get transactions error:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve transactions."
        });
    }
});


// --------------------------------------------------
// 11. API NOT FOUND HANDLER
// --------------------------------------------------

app.use("/api", (req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found."
    });
});

// --------------------------------------------------
// 12. GLOBAL ERROR HANDLER
// --------------------------------------------------

app.use((error, req, res, next) => {
    console.error("Server error:", error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(error.status || 500).json({
        success: false,
        message: "An unexpected server error occurred."
    });
});

// --------------------------------------------------
// 13. START SERVER
// --------------------------------------------------

const server = app.listen(PORT, () => {
    console.log("-------------------------------------");
    console.log("       PAYPILOT AI SERVER");
    console.log("-------------------------------------");
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`Database: Connected`);
    console.log(`AI Provider: ${groq ? "Groq" : "Not configured"}`);
    console.log(`AI Model: ${GROQ_MODEL}`);
    console.log("Payment Mode: PayPal Sandbox only");
    console.log("-------------------------------------");
});

// --------------------------------------------------
// 14. GRACEFUL SHUTDOWN
// --------------------------------------------------

function shutdown(signal) {
    console.log(`${signal} received. Shutting down...`);

    server.close(() => {
        try {
            db.close();
            console.log("Database connection closed.");
            process.exit(0);
        } catch (error) {
            console.error("Shutdown error:", error);
            process.exit(1);
        }
    });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
