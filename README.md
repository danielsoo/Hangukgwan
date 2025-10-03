# Hangukgwan

🇰🇷 **Hangukgwan** is a bilingual restaurant web application that delivers authentic Korean dining experiences.  
It supports multiple languages (Korean, English, Simplified Chinese, Traditional Chinese) and provides information for two store locations.  

The project is built using **React + TypeScript** (frontend), **Node.js (Express)** (backend), and **MongoDB Atlas** (database).  

---

## 🚀 Features
- Multi-language support (i18n: Korean, English, Simplified Chinese, Traditional Chinese)
- Responsive UI (mobile and desktop friendly)
- Store information and Google Maps integration
- Menu management
- Unified background and header design across all pages
- User authentication and login system

---

## 🏪 Store Information

```text
📍 Main Store:
No. 32, Lane 135, Xianzhengjiu Rd., Zhubei City, Hsinchu County
⏰ Hours: Tue–Sun 11:00–14:00, 17:00–21:00 (Closed on Mondays)

📍 Branch Store (Corporate Only):
No. 7, Taiyuan 1st St., Zhubei City, Hsinchu County
⏰ Hours: Accessible only for employees of nearby office complexes (e.g., Samsung, TSMC)

---

## 🛠 Tech Stack
- **Frontend:** React (TypeScript), TailwindCSS, i18n
- **Backend:** Node.js (Express)
- **Database:** MongoDB Atlas
- **Other:** Google Maps API, JWT Authentication

---

## 📂 Project Structure
```bash
Hangukgwan/
├── backend/ # Express server
│ ├── server.js
│ ├── config/
│ └── routes/
├── frontend/ # React client
│ ├── src/
│ └── public/
├── .gitignore
├── README.md
└── package.json
```


---

## ⚙️ Installation

### 1. Clone Repository
```bash
git clone https://github.com/USERNAME/Hangukgwan.git
cd Hangukgwan

cd backend
npm install
node server.js   # Runs on http://localhost:5000

cd frontend
npm install
npm start   # Runs on http://localhost:3000

MONGO_URI=your_mongodb_connection
JWT_SECRET=your_secret_key
GOOGLE_MAPS_API_KEY=your_api_key
```
---

## 📜 License
This project is licensed under the [MIT License](LICENSE).
