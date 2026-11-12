# 🚀 PayPilot AI
### Intelligent Payments. Smarter Financial Workflows.

PayPilot AI is an AI-powered payment and invoice management platform designed to simplify financial workflows. It combines invoice management, transaction records, and an intelligent AI assistant in one modern workspace.

Built as a hackathon project, PayPilot AI explores how artificial intelligence can improve the way businesses manage and understand their payment workflows.

---

## ✨ Key Features

- 📊 **Finance Dashboard** – A centralized workspace with easy navigation.
- 📄 **Invoice Management** – Create, view, and manage invoice records.
- 💳 **Transaction History** – View payment records stored by the platform.
- 🤖 **AI Finance Assistant** – Ask questions about invoices and payment workflows using Groq AI.
- 🔐 **Security Features** – Backend security middleware and input validation.
- 🧪 **PayPal Sandbox Backend** – Payment order creation and capture endpoints for testing.
- 🗄️ **Database Management** – Store invoice and transaction records using SQLite.
- 🎨 **Modern Interface** – Responsive, dark-themed fintech dashboard.

## 🛠️ Technology Stack

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | SQLite |
| AI Integration | Groq API |
| Payment Integration | PayPal Sandbox |
| Security | Helmet, Express Rate Limit, Zod |

## 🏗️ Project Architecture

```text
PayPilot-AI/
│
├── public/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       └── app.js
│
├── database/
│   └── paypilot.db
│
├── server.js
├── package.json
├── package-lock.json
├── .gitignore
└── README.md
```

## ⚙️ Installation and Setup

### 1. Clone the repository

```bash
git clone https://github.com/kavinmoorthyk/PayPilot-AI.git
```

### 2. Open the project folder

```bash
cd PayPilot-AI
```

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

Create a `.env` file in the project root.

Add your own credentials:

```env
PORT=3000

GROQ_API_KEY=your_groq_api_key

PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
```

Never upload your `.env` file or API credentials to GitHub.

### 5. Start the application

```bash
npm run dev
```

### 6. Open the application

Visit:

```text
http://localhost:3000
```

## 🤖 AI Integration

PayPilot AI uses the Groq API to provide conversational assistance.

The AI assistant is designed to help users understand invoice management and payment workflows through natural-language questions.

## 💳 Payment Integration

The project includes PayPal Sandbox backend endpoints for creating and capturing payment orders.

Sandbox mode is intended for development and testing without real-money transactions. End-to-end payment functionality should be verified using Sandbox buyer and seller accounts before being presented as fully operational.

## 🔒 Security

- Environment variables for sensitive credentials.
- Helmet security middleware.
- API rate limiting.
- Input validation using Zod.
- Server-side payment verification logic.

## 🎯 Future Enhancements

- Complete end-to-end PayPal Sandbox checkout experience.
- Advanced financial analytics and reports.
- Automated invoice reminders.
- AI-powered financial insights.
- Improved transaction filtering and search.
- Cloud database integration.

## 🎥 Project Demonstration

**Demo Video:** https://youtu.be/MPkLDMClOVs

## 💡 Project Vision

Our vision is to make financial workflows simpler, smarter, and more accessible by combining payment technology with artificial intelligence.

## 👨‍💻 Developer

**GitHub:** [kavinmoorthyk](https://github.com/kavinmoorthyk)

**Project Repository:** [PayPilot AI](https://github.com/kavinmoorthyk/PayPilot-AI)

---

⭐ If you find this project interesting, consider giving the repository a star!

*Developed as a hackathon project.*