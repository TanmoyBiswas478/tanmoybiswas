@echo off
rem local server on :5500 (file:// blocks the fonts and three.js modules)
cd /d "%~dp0"
start "" http://localhost:5500
npx --yes serve@14.2.4 -l 5500 .
