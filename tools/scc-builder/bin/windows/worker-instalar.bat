@echo off
REM ════════════════════════════════════════════════════════════════════
REM  SCC Builder - registra o worker da fila no Agendador de Tarefas
REM
REM  O worker processa os jobs enfileirados (arquivos acima de 16 MB).
REM  Sem ele, uploads grandes ficam presos em "queued" para sempre.
REM
REM  EXECUTE COMO ADMINISTRADOR (botao direito > Executar como admin)
REM ════════════════════════════════════════════════════════════════════

setlocal EnableDelayedExpansion
cd /d "%~dp0..\.."
set PROJETO=%CD%

echo.
echo ================================================
echo   SCC Builder - worker da fila
echo ================================================
echo.
echo Projeto: %PROJETO%

REM --- Verifica privilegio de administrador -------------------------
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERRO] Este script precisa ser executado como Administrador.
    echo        Clique com o botao direito e escolha "Executar como administrador".
    echo.
    pause
    exit /b 1
)

REM --- Localiza o PHP ------------------------------------------------
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
    echo        Informe o caminho manualmente:
    echo        worker-instalar.bat "C:\wamp64\bin\php\php8.1.0\php.exe"
    echo.
    pause
    exit /b 1
)

if not "%~1"=="" set PHPBIN=%~1

echo PHP:     %PHPBIN%
echo.

REM --- Remove a tarefa anterior, se existir --------------------------
schtasks /query /tn "SCC Builder Worker" >nul 2>&1
if not errorlevel 1 (
    echo Removendo registro anterior...
    schtasks /delete /tn "SCC Builder Worker" /f >nul
)

REM --- Cria a tarefa: roda a cada 1 minuto ---------------------------
REM  --once faz o worker esvaziar a fila e sair, em vez de ficar
REM  residente. Combina melhor com o agendador: se travar, o proximo
REM  ciclo se recupera sozinho.
schtasks /create ^
    /tn "SCC Builder Worker" ^
    /tr "\"%PHPBIN%\" \"%PROJETO%\bin\worker.php\" --once --max-jobs=20" ^
    /sc minute ^
    /mo 1 ^
    /ru "SYSTEM" ^
    /rl HIGHEST ^
    /f

if errorlevel 1 (
    echo.
    echo [ERRO] Falha ao registrar a tarefa.
    pause
    exit /b 1
)

echo.
echo ================================================
echo   Worker registrado com sucesso
echo ================================================
echo.
echo   Nome:       SCC Builder Worker
echo   Frequencia: a cada 1 minuto
echo   Comando:    php bin\worker.php --once --max-jobs=20
echo.
echo   Verificar:  schtasks /query /tn "SCC Builder Worker"
echo   Rodar ja:   schtasks /run   /tn "SCC Builder Worker"
echo   Remover:    bin\windows\worker-remover.bat
echo.
echo   Logs em:    storage\logs\
echo.

REM --- Dispara uma execucao imediata para validar --------------------
echo Executando uma vez para validar...
"%PHPBIN%" "%PROJETO%\bin\worker.php" --once

echo.
pause
exit /b 0
