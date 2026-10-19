@echo off
REM SCC Builder - situacao do worker e da fila

cd /d "%~dp0..\.."

echo.
echo === Tarefa agendada ===
schtasks /query /tn "SCC Builder Worker" /v /fo list 2>nul | findstr /i "TaskName Status Next Last Result"
if errorlevel 1 echo   Nao registrada. Rode bin\windows\worker-instalar.bat como admin.

echo.
echo === Fila ===
where php >nul 2>&1
if errorlevel 1 (
    echo   php nao esta no PATH.
) else (
    php -r "require 'api/config.php'; $p=SccBuilder\Api\Database::pdo(); foreach($p->query('SELECT status, COUNT(*) c FROM jobs GROUP BY status') as $r){ echo '  '.str_pad($r['status'],12).$r['c'].PHP_EOL; }" 2>nul
    if errorlevel 1 echo   Nao foi possivel ler o banco.
)

echo.
echo === Ultimas linhas do log ===
for /f "delims=" %%F in ('dir /b /o-d "storage\logs\api-*.jsonl" 2^>nul') do (
    powershell -NoProfile -Command "Get-Content 'storage\logs\%%F' -Tail 5"
    goto :fim
)
echo   Nenhum log ainda.

:fim
echo.
pause
