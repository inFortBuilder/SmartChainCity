@echo off
REM SCC Builder - validacao completa no Windows/WAMP
REM Uso: validar.bat  (na pasta do projeto)

setlocal
cd /d "%~dp0"

echo.
echo =========================================
echo   SCC Builder - validacao da instalacao
echo =========================================
echo.

REM 1) Servidor: PHP, storage, banco, Node, pipeline, endpoints
where php >nul 2>&1
if errorlevel 1 (
    echo [ERRO] "php" nao esta no PATH.
    echo        Adicione C:\wamp64\bin\php\php8.1.0 ao PATH do sistema,
    echo        ou rode com o caminho completo:
    echo        "C:\wamp64\bin\php\php8.1.0\php.exe" bin\validar.php
    echo.
    pause
    exit /b 1
)

php bin\validar.php %*
set VALIDACAO=%errorlevel%

REM 2) Frontend: lint, testes unitarios e build
where npm >nul 2>&1
if errorlevel 1 (
    echo.
    echo [AVISO] "npm" nao esta no PATH - pulando lint/testes/build.
    goto :fim
)

echo.
echo --- Lint ---
call npm run lint
if errorlevel 1 set VALIDACAO=1

echo.
echo --- Testes unitarios ---
call npm test
if errorlevel 1 set VALIDACAO=1

echo.
echo --- Build de producao ---
call npm run build
if errorlevel 1 set VALIDACAO=1

:fim
echo.
if "%VALIDACAO%"=="0" (
    echo =========================================
    echo   TUDO OK
    echo   Proximo passo: docs\VALIDACAO.md parte 5
    echo   ^(validacao manual no browser^)
    echo =========================================
) else (
    echo =========================================
    echo   HOUVE FALHAS - veja as mensagens acima
    echo =========================================
)
echo.
pause
exit /b %VALIDACAO%
