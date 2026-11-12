@echo off
rem Serves this folder at http://localhost:5500, the same way Vercel serves it.
rem Opening index.html directly (file://) does not work: browsers block the
rem web fonts and the Three.js modules on file:// pages.
cd /d "%~dp0"
start "" http://localhost:5500
npx --yes serve@14.2.4 -l 5500 .
