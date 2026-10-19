@echo off
REM SCC Builder - remove o worker do Agendador de Tarefas
REM EXECUTE COMO ADMINISTRADOR

net session >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Execute como Administrador.
    pause
    exit /b 1
)

schtasks /query /tn "SCC Builder Worker" >nul 2>&1
if errorlevel 1 (
    echo A tarefa "SCC Builder Worker" nao esta registrada.
) else (
    schtasks /delete /tn "SCC Builder Worker" /f
    echo Worker removido do Agendador de Tarefas.
)

echo.
pause
