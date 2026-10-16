@echo off
rem Inicia o Maestrinho a partir do codigo-fonte (duplo clique). Na primeira vez instala as dependencias.
setlocal
cd /d "%~dp0"
where node >nul 2>nul || (
  echo Node.js nao encontrado. Instale o Node.js 22.12 ou mais novo e tente de novo.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Instalando dependencias - primeira execucao, pode levar alguns minutos...
  call npm install || goto :erro
)
call npm start
exit /b %errorlevel%
:erro
echo Falha ao instalar as dependencias. Verifique o acesso ao registro npm.
pause
exit /b 1
