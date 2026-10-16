#!/bin/sh
# Inicia o Maestrinho a partir do codigo-fonte. Na primeira vez instala as dependencias.
set -e
cd "$(dirname "$0")"
command -v node >/dev/null 2>&1 || { echo "Node.js 22.12+ nao encontrado."; exit 1; }
[ -d node_modules ] || npm install
exec npm start
