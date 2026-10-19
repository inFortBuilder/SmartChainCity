@echo off
REM ════════════════════════════════════════════════════════════════════
REM  SCC Builder - instalacao completa em um comando
REM
REM  1. npm install
REM  2. configuracao (chaves, .env, storage, banco)
REM  3. build de producao
REM  4. validacao
REM
REM  Nao precisa de admin. Para registrar o worker no Agendador,
REM  rode depois bin\windows\worker-instalar.bat como administrador.
REM ════════════════════════════════════════════════════════════════════

setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo.
echo ==========================================================
echo    SCC Builder - instalacao
echo    %CD%
echo ==========================================================

REM ---------- Pre-requisitos ----------------------------------------
set FALTA=0

where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERRO] Node.js nao encontrado no PATH.
    echo        Baixe em https://nodejs.org e reinstale marcando
    echo        "Add to PATH".
    set FALTA=1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERRO] npm nao encontrado no PATH.
    set FALTA=1
)

REM PHP pode nao estar no PATH: tentamos localizar no WAMP.
set PHPBIN=
for %%P in (php.exe) do set PHPBIN=%%~$PATH:P

if "%PHPBIN%"=="" (
    for /d %%D in ("C:\wamp64\bin\php\php*") do (
        if exist "%%D\php.exe" set PHPBIN=%%D\php.exe
    )
)

if "%PHPBIN%"=="" (
    echo.
    echo [ERRO] php.exe nao encontrado.
    echo        Adicione C:\wamp64\bin\php\php8.x.x ao PATH,
    echo        ou passe o caminho: instalar.bat "C:\caminho\php.exe"
    set FALTA=1
)

if not "%~1"=="" set PHPBIN=%~1

if "%FALTA%"=="1" (
    echo.
    pause
    exit /b 1
)

echo.
echo PHP:  %PHPBIN%
for /f "delims=" %%V in ('node --version') do echo Node: %%V

REM ---------- 1. Dependencias ---------------------------------------
echo.
echo ----------------------------------------------------------
echo  1/4  Instalando dependencias (pode levar 1-2 minutos)
echo ----------------------------------------------------------
call npm install --no-audit --no-fund
if errorlevel 1 (
    echo.
    echo [ERRO] npm install falhou.
    pause
    exit /b 1
)

REM ---------- 2. Configuracao ---------------------------------------
echo.
echo ----------------------------------------------------------
echo  2/4  Configurando (chaves, .env, storage, banco)
echo ----------------------------------------------------------
"%PHPBIN%" bin\instalar.php %2 %3 %4
set CONFIGOK=%errorlevel%

REM ---------- 3. Build ----------------------------------------------
echo.
echo ----------------------------------------------------------
echo  3/4  Gerando o build de producao
echo ----------------------------------------------------------
call npm run build
if errorlevel 1 (
    echo.
    echo [ERRO] O build falhou.
    pause
    exit /b 1
)

REM ---------- 4. Validacao ------------------------------------------
echo.
echo ----------------------------------------------------------
echo  4/4  Validando a instalacao
echo ----------------------------------------------------------
"%PHPBIN%" bin\validar.php
set VALIDOU=%errorlevel%

echo.
echo ==========================================================
if "%VALIDOU%"=="0" (
    echo    PRONTO - o sistema esta no ar
    echo ==========================================================
    echo.
    echo    Editor:  http://localhost/scc-builder/
    echo    Health:  http://localhost/scc-builder/api/health.php
    echo.
    echo    Falta so uma coisa, como ADMINISTRADOR:
    echo      bin\windows\worker-instalar.bat
    echo.
    echo    Sem o worker, arquivos acima de 16 MB ficam na fila
    echo    sem serem processados.
) else (
    echo    HOUVE PENDENCIAS
    echo ==========================================================
    echo.
    echo    Veja as mensagens acima. As causas mais comuns:
    echo      - Apache parado: ligue o WAMP ^(icone verde^)
    echo      - Extensao pdo_sqlite desativada no php.ini
    echo      - upload_max_filesize baixo no php.ini
    echo.
    echo    Depois de corrigir, rode: validar.bat
)
echo.
pause
exit /b %VALIDOU%
