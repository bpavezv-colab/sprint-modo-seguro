@echo off
chcp 65001 >nul
title Sprint - Ficha de Ingreso
cd /d "%~dp0"

echo.
echo   ==========================================
echo     Sprint - Ficha de Ingreso
echo   ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   Falta Node.js. Se abrira la pagina para instalarlo: elige la version LTS.
  echo   Despues vuelve a abrir este archivo.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   Instalando lo necesario por primera vez, puede tardar un minuto...
  call npm install --no-fund --no-audit
  if errorlevel 1 goto error
)

if not exist ".env" if exist ".env.example" copy ".env.example" ".env" >nul

echo   Preparando la pagina...
call npm run build
if errorlevel 1 goto error

rem Si quedo abierto un servidor de Sprint anterior en el puerto 3000, se cierra.
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $_.OwningProcess); if ($p.CommandLine -match 'server\.mjs') { Stop-Process -Id $p.ProcessId -Force } }"

rem Abre el navegador unos segundos despues, cuando el servidor ya esta listo.
start "" /min cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:3000"

echo.
echo   Sprint esta corriendo en http://localhost:3000
echo   Para apagarlo, cierra esta ventana.
echo.
call npm start
pause
exit /b 0

:error
echo.
echo   Algo fallo. Revisa el mensaje de arriba o avisa a quien mantiene el proyecto.
pause
exit /b 1
