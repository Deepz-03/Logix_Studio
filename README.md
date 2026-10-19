# KMap Studio

A beginner-friendly EOC-1 mini-project: interactive Karnaugh-map visualization, Boolean simplification, group explanations, and a half-adder/full-adder lab.

## Requirements
- Python 3.10 or newer
- VS Code

## Setup (Windows)
1. Open this folder in VS Code.
2. Open Terminal → New Terminal.
3. Create a virtual environment:
   ```powershell
   py -m venv .venv
   ```
4. Activate it:
   ```powershell
   .\.venv\Scripts\Activate.ps1
   ```
   If PowerShell blocks activation, use Command Prompt in VS Code and run:
   ```bat
   .venv\Scripts\activate.bat
   ```
5. Install dependencies:
   ```powershell
   python -m pip install -r requirements.txt
   ```
6. Start the app:
   ```powershell
   python app.py
   ```
7. Open the app in your browser:
   - **Local URL**: `http://127.0.0.1:5000`
   - **Live Public Website Link**: A live Cloudflare/Render public URL (e.g. `https://statements-response-greene-ozone.trycloudflare.com`)

## Deploying to Cloud (Permanent Public Website)
This project is configured with `requirements.txt`, `Procfile`, `render.yaml`, and `vercel.json`:
- **Render.com**: Push to GitHub, create a new Web Service on [Render](https://render.com), choose Python, and set Start Command: `gunicorn app:app`.
- **Vercel**: Run `vercel` or link your GitHub repo on [Vercel](https://vercel.com).

## Features
- 2-, 3-, and 4-variable K-maps
- Minterm selection
- Quine–McCluskey-style implicant generation and minimum-cover selection
- Color-coded groups and product-term explanations
- Sum-of-products expression
- Half-adder and full-adder output lab

## Notes
- This is a learning/demo project, not a formally verified logic-design tool.
- The circuit panel is a conceptual gate plan, not a full schematic editor.
- The UI uses Google Fonts when internet access is available; system fonts are used as fallback.
