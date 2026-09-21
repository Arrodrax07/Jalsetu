@echo off
title JalSetu AI - Hackathon Prototype Runner
echo ========================================================
echo          JalSetu AI - Fair Water. Stronger Communities.
echo          Team: Ecoders ^| Problem Statement: PS 11
echo ========================================================
echo.
echo Starting JalSetu AI command center server at http://localhost:5173/ ...
echo.
timeout /t 2 /nobreak >nul
start http://localhost:5173/
call npm run dev
pause
