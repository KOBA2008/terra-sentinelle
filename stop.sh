#!/usr/bin/env bash
# Terra Sentinelle — arret des deux serveurs
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for p in 8000 5173 4173; do
  pids=$(ss -lptn "sport = :$p" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
  if [ -n "$pids" ]; then kill $pids 2>/dev/null; echo "  port $p arrete"; else echo "  port $p deja libre"; fi
done
rm -f "$ROOT/.logs/"*.pid 2>/dev/null
