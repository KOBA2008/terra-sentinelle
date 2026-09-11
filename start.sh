#!/usr/bin/env bash
# Terra Sentinelle — demarrage complet (backend + frontend + navigateur)
# Usage :  ./start.sh            demarre tout
#          ./start.sh --reset    remet les donnees de demo a zero puis demarre
#          ./start.sh --no-open  demarre sans ouvrir le navigateur
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACK="$ROOT/backend"; FRONT="$ROOT/frontend"
RESET=0; OPEN=1
for a in "$@"; do
  case "$a" in
    --reset)   RESET=1 ;;
    --no-open) OPEN=0 ;;
    -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
  esac
done

v(){ printf '\033[0;32m%s\033[0m\n' "$*"; }
w(){ printf '\033[0;33m%s\033[0m\n' "$*"; }
e(){ printf '\033[0;31m%s\033[0m\n' "$*"; }

free_port(){
  local p="$1" pids
  pids=$(ss -lptn "sport = :$p" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | sort -u)
  [ -n "$pids" ] && { kill $pids 2>/dev/null; sleep 1; w "  port $p libere"; }
}

# --- controles prealables -------------------------------------------------
[ -x "$BACK/.venv/bin/uvicorn" ] || { e "Environnement Python absent."; \
  e "  cd $BACK && python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt"; exit 1; }
[ -d "$FRONT/node_modules" ] || { w "Dependances frontend absentes, installation..."; \
  (cd "$FRONT" && npm install) || { e "npm install a echoue"; exit 1; }; }

echo; v "Terra Sentinelle — demarrage"
free_port 8000; free_port 5173

# --- donnees de demonstration --------------------------------------------
if [ "$RESET" = 1 ] || [ ! -f "$BACK/data/region.json" ]; then
  w "Generation des donnees de demonstration (33 communes)..."
  (cd "$BACK" && ./.venv/bin/python seed.py) || { e "seed.py a echoue"; exit 1; }
fi

# --- backend --------------------------------------------------------------
mkdir -p "$ROOT/.logs"
(cd "$BACK" && setsid ./.venv/bin/uvicorn main:app --port 8000 < /dev/null > "$ROOT/.logs/backend.log" 2>&1 & echo $! > "$ROOT/.logs/backend.pid") ; exec 3>&- 2>/dev/null || true
for i in $(seq 1 30); do
  curl -s -o /dev/null -m 1 http://localhost:8000/api/region 2>/dev/null && break
  sleep 0.5
done
if curl -s -o /dev/null -m 2 http://localhost:8000/api/region 2>/dev/null; then
  N=$(curl -s -m 3 http://localhost:8000/api/communes | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))' 2>/dev/null)
  P=$(curl -s -m 3 "http://localhost:8000/api/friction?status=pending" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)["features"]))' 2>/dev/null)
  v "  backend   http://localhost:8000   ($N communes, $P detections en attente)"
else
  e "  backend n'a pas demarre — voir $ROOT/.logs/backend.log"; exit 1
fi

# --- frontend -------------------------------------------------------------
(cd "$FRONT" && setsid npm run dev -- --port 5173 < /dev/null > "$ROOT/.logs/frontend.log" 2>&1 & echo $! > "$ROOT/.logs/frontend.pid")
for i in $(seq 1 40); do
  curl -s -o /dev/null -m 1 http://localhost:5173/ 2>/dev/null && break
  sleep 0.5
done
if curl -s -o /dev/null -m 2 http://localhost:5173/ 2>/dev/null; then
  v "  frontend  http://localhost:5173"
else
  e "  frontend n'a pas demarre — voir $ROOT/.logs/frontend.log"; exit 1
fi

[ "$OPEN" = 1 ] && (nohup xdg-open "http://localhost:5173" >/dev/null 2>&1 &) && sleep 1

echo; v "Pret."
echo "  Arreter :  ./stop.sh      Journaux : .logs/"
echo
