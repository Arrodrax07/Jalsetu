# JalSetu AI (जलसेतु)
> **"Fair Water. Stronger Communities."**  
> **Problem Statement ID:** PS 11 — Community Water-Supply Allocation and Complaint Intelligence  
> **Domain:** Community Services  
> **Team:** Ecoders

---

## 1. Project Overview

Water-stressed urban communities often experience severe water inequality: municipal tankers and piped supplies are frequently distributed based on vocal pressure or ad-hoc scheduling, leaving vulnerable and informal settlements critically underserved. Furthermore, citizen grievances, tanker tracking, and proof-of-delivery operate in disconnected silos.

**JalSetu AI** is a complete, civic-technology command center engineered to ensure **equitable, transparent, and resilient municipal water allocation**. The platform unifies demand aggregation, transparent AI priority scoring, automated complaint intelligence, dynamic fleet reallocation, route optimization, real-time GPS telemetry, and proof-of-delivery (POD) verification into an intuitive, zero-cost, self-contained prototype.

---

## 2. Key Features & Demonstrations

### 1. Command Center Dashboard
- **8 Live Civic KPIs:** Active Requests, Critical Shortfalls, Tankers Active, Communities Served, Underserved Wards, Pending Complaints, Mean Delivery Time, and Coverage Fairness Index.
- **Interactive Geospatial Map:** Custom Leaflet map with status markers (Blue: Normal, Orange: High Demand, Red: Critical/Pulsing, Green: Recently Served, Tanker Fleet Pins) with interactive popups.
- **Live Operations Stream:** Real-time progress bars and status badges for active municipal tankers.

### 2. Community Requests & AI Assessment
- Filterable and searchable requisition board.
- **`+ Create Water Request` Modal:** Allows filing community water requirements.
- **"Analyze Request with AI":** Evaluates population density, consecutive dry days, and demographic vulnerability to calculate a transparent **0–100 Priority Score** with plain-language civic justification.

### 3. Complaint Intelligence Hub
- Natural Language Processing (NLP) rule-based classifier that extracts:
  - **Category:** *No Water, Late Tanker, Insufficient Quantity, Poor Water Quality, Missed Delivery, Duplicate Request*
  - **Sentiment:** *Critical, Negative, Neutral*
  - **Duplicate Probability:** Identifies redundant tickets (e.g., 94% duplicate match) to prevent fleet misallocation.
  - **Multi-Ticket Clustering:** Flags repeated complaints from identical standposts within 48 hours.
  - **Actions:** One-click *Escalate*, *Assign Officer*, and *Mark Resolved*.

### 4. Demand & Vulnerability Analytics
- Interactive charts powered by Recharts:
  - *Daily Demand vs Allocated Supply* across wards
  - *Shortfall Rankings* isolating emergency areas
  - *Socioeconomic Vulnerability Distribution*
  - *Hourly Requisition Profile* with Time Filters (*Today, 7 Days, 30 Days*).

### 5. Fair Allocation AI Engine (Core Differentiator)
- **Multi-Stage Animated Pipeline:**
  `Analyzing demand...` ➔ `Checking vulnerability...` ➔ `Reviewing allocations...` ➔ `Calculating unmet need...` ➔ `Optimizing fairness...` ➔ `Plan Ready!`
- **Transparent Factor Weighting:**
  - Demand Severity: **35%**
  - Socioeconomic Vulnerability: **30%**
  - Unmet Need & Dry Days: **20%**
  - Historical Coverage Gap: **10%**
  - Impacted Population: **5%**
- **Measurable Equity Leap:** Demonstrates fairness balance jump from **62% (pre-AI)** to **84% (AI-optimized)**.
- **Approve Allocation:** Commits recommended quotas directly to active municipal dispatch queues.

### 6. Dynamic Reallocation Simulation
- **"Simulate Supply Disruption":** Simulates sudden breakdown of Tanker T-2045 (12,000 L deficit).
- **Automated AI Protection:** Instantly recalculates allocations city-wide, ensuring high-vulnerability informal zones (Shivaji Nagar, Dharavi) remain **100% protected** by absorbing reserves from lower-stress wards.

### 7. Fleet Route Optimizer
- Traveling Salesperson heuristic minimizing travel distance while honoring urgent deliveries.
- **Concrete Savings:**
  - Distance: **25.6 km ➔ 18.4 km** (**7.2 km / 28% saved**)
  - Travel Time: **63 min ➔ 47 min** (**16 min saved**)
  - Direct Fuel Savings: **₹310 per trip**
  - CO₂ Reduced: **4.8 kg**.

### 8. Live GPS Fleet Telemetry
- Real-time animated moving tanker markers traversing urban corridors.
- Detailed telemetry card displaying Speedometer (km/h), Water Load gauge (Litres), Driver profile, One-click Call trigger, and Geofence corridor compliance.

### 9. Proof-of-Delivery (POD) Verification & Discrepancy Detector
- Cryptographic Geofence validation (12m radius) and Field Officer digital sign-offs.
- **Variance Detection:** Highlights discrepancies such as Delivery `#DV-4022` where 12,000 L was allocated but only 7,000 L was delivered (**5,000 L shortage flagged for fraud investigation**).

### 10. Impact Analytics & Fairness Feedback Loop
- Projected metrics clearly labeled as *Illustrative Demo Metrics / Projected Impact*:
  - **-28%** Unmet water requests
  - **-22%** Fleet travel distance
  - **-35%** Duplicate complaints
  - **+31%** Improvement in coverage equality balance
- Before vs AI-Optimized Allocation bar chart.
- **Fairness Feedback Loop:** Visual 6-phase learning cycle (*Requests ➔ AI Allocation ➔ Delivery ➔ Service Data ➔ Fairness Check ➔ Next Allocation*).

### 11. Guided 11-Step "Pitch Demo" Tour
- A built-in presenter bar that takes hackathon judges through a 3–5 minute storyline:
  1. *Identify Underserved Community (Shivaji Nagar)*
  2. *Review Critical Request WR-1024*
  3. *AI Assessment & Priority Scoring*
  4. *Open Fair Allocation Engine*
  5. *Run AI Resource Allocation*
  6. *Explainable AI Breakdown & 62% ➔ 84% Balance*
  7. *Optimize Tanker Route (7.2 km saved)*
  8. *Dispatch Tanker T-2045*
  9. *Live GPS Telemetry & Tracking*
  10. *Proof-of-Delivery Verification (5,000 L Variance)*
  11. *Impact Analytics & Fairness Feedback Loop*.

---

## 3. Tech Stack

- **Frontend:** React 19 + TypeScript + Vite
- **Styling:** Tailwind CSS (Water-tech palette: Slate, Cyan, Emerald, Amber, Rose)
- **Icons:** Lucide React
- **Data Visualizations:** Recharts (Bar, Area, Line, Pie)
- **Mapping:** Leaflet & React-Leaflet + OpenStreetMap tiles with offline vector fallback
- **State & Data Store:** Centralized React context backed by browser `localStorage`
- **Zero-Dependency Guarantee:** Runs 100% locally without external paid APIs, credit cards, or cloud accounts.

---

## 4. How to Run the Prototype

### Prerequisites
- Node.js (v18+ or v22+)
- npm

### Launch Command
```bash
# 1. Clone repository / open project directory
cd "c:/VPP Project"

# 2. Install dependencies (if not already installed)
npm install

# 3. Start local development server
npm run dev
```

Open your browser at:
```
http://localhost:5173/
```

---

## 5. Demo Credentials & Quick Roles

Click any of the **One-Click Demo Roles** on the login page:
1. **Administrator (Commissioner):** Full command center access, allocation approvals, weight tuning.
2. **Field Officer (Ward M/East):** On-the-ground request logging and POD sign-off.
3. **Hackathon Pitch Evaluator:** Activates the guided 11-step walkthrough.

*(You can also use: `commissioner@jalsetu.gov.in` / any password)*

---

## 6. AI Priority Scoring Formula

The core priority score ($P \in [0, 100]$) is calculated as:

$$P = w_d \cdot S_{\text{demand}} + w_v \cdot S_{\text{vuln}} + w_u \cdot S_{\text{unmet}} + w_c \cdot S_{\text{gap}} + w_p \cdot S_{\text{pop}}$$

Where:
- $S_{\text{demand}} = \min(100, \frac{\text{Demand}}{80,000} \times 100)$
- $S_{\text{vuln}} = \text{Community Vulnerability Score } (0 - 100)$
- $S_{\text{unmet}} = \min(100, \frac{\text{Shortfall}}{\text{Daily Demand}} \times 100)$
- $S_{\text{gap}} = 100 - \text{Current Coverage } (\%)$
- $S_{\text{pop}} = \min(100, \frac{\text{Population}}{15,000} \times 100)$

Default weights ($w_d=0.35, w_v=0.30, w_u=0.20, w_c=0.10, w_p=0.05$) can be dynamically modified in the **Settings** page with instant live recalculation.

---

## 7. Future Scope & Production Roadmap

1. **IoT Ultrasonic Flow Sensors:** Direct hardware telemetry via LoRaWAN/NB-IoT flow meters on tanker discharge nozzles.
2. **Citizen WhatsApp Chatbot:** Ingesting water requests and grievances in Marathi and Hindi via open-source conversational bots.
3. **Aadhaar/OTP Citizen Verification:** Community biometric or SMS OTP confirmation upon tanker delivery.
4. **Predictive Monsoon Groundwater Modeling:** Integrating seasonal rainfall and reservoir capacity forecasts.
