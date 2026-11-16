#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

CURRENT_STEP="preflight"
VERCEL_CMD=()
VERCEL_SCOPE_ARGS=()

on_error() {
  local exit_code=$?
  trap - ERR
  printf '[deploy] Falló el paso %s, línea %s (código %s). Revisa el mensaje anterior y la configuración local.\n' \
    "$CURRENT_STEP" "${BASH_LINENO[0]:-?}" "$exit_code" >&2
  exit "$exit_code"
}

cleanup() {
  local exit_code=$?
  trap - EXIT

  if [[ -d .deploy.lock ]]; then
    if ! rm -f .deploy.lock/backend-url; then
      printf '[deploy] No se pudo borrar .deploy.lock/backend-url.\n' >&2
      exit_code=1
    fi
    if ! rmdir .deploy.lock; then
      printf '[deploy] No se pudo liberar el bloqueo .deploy.lock.\n' >&2
      exit_code=1
    fi
  fi

  exit "$exit_code"
}

fail() {
  local exit_code="$1"
  shift
  printf '[deploy] Falló el paso %s (código %s): %s\n' \
    "$CURRENT_STEP" "$exit_code" "$*" >&2
  exit "$exit_code"
}

load_environment() {
  if [[ ! -f .env.deploy ]]; then
    fail 10 'Falta .env.deploy. Cópialo desde .env.deploy.example y complétalo localmente.'
  fi

  set -a
  # shellcheck disable=SC1091
  source ./.env.deploy
  set +a
}

preflight() {
  load_environment

  local missing=()
  local variable
  local required_variables=(
    RENDER_API_KEY
    RENDER_OWNER_ID
    RENDER_SERVICE_NAME
    GITHUB_REPO_URL
    GITHUB_BRANCH
    DATABASE_URL
    MIGRATION_DATABASE_URL
    BACKEND_URL
    FRONTEND_URL
    VERCEL_TOKEN
    VERCEL_PROJECT
  )

  for variable in "${required_variables[@]}"; do
    if [[ -z "${!variable:-}" ]]; then
      missing+=("$variable")
    fi
  done

  if [[ -n "${BACKEND_URL:-}" && ! "$BACKEND_URL" =~ ^https:// ]]; then
    printf 'BACKEND_URL debe empezar por https://.\n' >&2
    missing+=(BACKEND_URL)
  fi
  if [[ -n "${FRONTEND_URL:-}" && ! "$FRONTEND_URL" =~ ^https:// ]]; then
    printf 'FRONTEND_URL debe empezar por https://.\n' >&2
    missing+=(FRONTEND_URL)
  fi
  if [[ -n "${DATABASE_URL:-}" && ! "$DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
    printf 'DATABASE_URL debe ser una conexión PostgreSQL.\n' >&2
    missing+=(DATABASE_URL)
  fi
  if [[ -n "${MIGRATION_DATABASE_URL:-}" && ! "$MIGRATION_DATABASE_URL" =~ ^postgres(ql)?:// ]]; then
    printf 'MIGRATION_DATABASE_URL debe ser una conexión PostgreSQL.\n' >&2
    missing+=(MIGRATION_DATABASE_URL)
  fi

  if ! command -v node >/dev/null 2>&1; then
    missing+=(node)
  else
    local node_version node_major node_minor
    node_version="$(node -p 'process.versions.node')"
    IFS=. read -r node_major node_minor _ <<<"$node_version"
    if ((node_major != 22 || node_minor < 12)); then
      printf 'Se requiere Node.js 22.12 o posterior dentro de Node 22; detectado %s.\n' \
        "$node_version" >&2
      missing+=("Node.js 22.12+")
    fi
    if [[ -n "${BACKEND_URL:-}" && -n "${FRONTEND_URL:-}" ]] && \
      ! node -e '
        for (const key of ["BACKEND_URL", "FRONTEND_URL"]) {
          const url = new URL(process.env[key]);
          if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash) {
            process.exitCode = 1;
          }
        }
      '; then
      printf 'BACKEND_URL y FRONTEND_URL deben ser orígenes HTTPS sin rutas.\n' >&2
      missing+=("URLs HTTPS válidas")
    fi
  fi

  for variable in npm curl; do
    if ! command -v "$variable" >/dev/null 2>&1; then
      missing+=("$variable")
    fi
  done

  if command -v vercel >/dev/null 2>&1; then
    VERCEL_CMD=(vercel)
  elif command -v npx >/dev/null 2>&1; then
    VERCEL_CMD=(npx --yes vercel@latest)
  else
    missing+=("vercel o npx")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    printf 'Faltan o deben corregirse estos datos/herramientas:\n' >&2
    printf '  - %s\n' "${missing[@]}" >&2
    fail 10 'Corrige .env.deploy o instala las herramientas indicadas.'
  fi

  if ! curl --help all >/dev/null 2>&1; then
    fail 10 'curl no pudo mostrar su ayuda; revisa la instalación.'
  fi

  if ! "${VERCEL_CMD[@]}" --help >/dev/null; then
    fail 10 'No se pudo ejecutar Vercel CLI. Comprueba tu conexión y vuelve a intentarlo.'
  fi

  BACKEND_URL="${BACKEND_URL%/}"
  FRONTEND_URL="${FRONTEND_URL%/}"
  if [[ -n "${VERCEL_SCOPE:-}" ]]; then
    VERCEL_SCOPE_ARGS=(--scope "$VERCEL_SCOPE")
  fi

  printf '[1/6] Preflight correcto.\n'
}

build_local() {
  printf '[2/6] Instalando y compilando backend y frontend...\n'
  npm --prefix backend ci || fail 20 'Falló la instalación de dependencias del backend.'
  npm --prefix frontend ci || fail 20 'Falló la instalación de dependencias del frontend.'
  npm --prefix backend run build || fail 20 'Falló la compilación del backend.'
  VITE_API_URL="$BACKEND_URL" npm --prefix frontend run build || \
    fail 20 'Falló la compilación del frontend.'
}

run_migrations() {
  printf '[3/6] Aplicando migraciones en Neon...\n'
  npm --prefix backend run migrate || fail 30 'Fallaron las migraciones de Neon; revisa la URL directa y el estado de la base.'
}

deploy_backend() {
  printf '[4/6] Desplegando backend en Render...\n'
  if node scripts/render-deploy.mjs; then
    :
  else
    local exit_code=$?
    if ((exit_code == 41)); then
      fail 41 'El backend no pasó /health o el rollback no quedó sano. Revisa Render.'
    fi
    fail 40 'Falló el despliegue del backend en Render. Revisa el token, el workspace y el servicio.'
  fi

  if [[ ! -s .deploy.lock/backend-url ]]; then
    fail 40 'Render no proporcionó la URL pública del backend.'
  fi
  BACKEND_URL="$(<.deploy.lock/backend-url)"
  export BACKEND_URL
}

deploy_frontend() {
  printf '[5/6] Publicando frontend en Vercel...\n'
  if (
    cd frontend
    "${VERCEL_CMD[@]}" link --yes --project "$VERCEL_PROJECT" \
      --token "$VERCEL_TOKEN" "${VERCEL_SCOPE_ARGS[@]}" || exit 1
    "${VERCEL_CMD[@]}" deploy --prod --yes --project "$VERCEL_PROJECT" \
      --token "$VERCEL_TOKEN" "${VERCEL_SCOPE_ARGS[@]}" \
      --build-env "VITE_API_URL=$BACKEND_URL"
  ); then
    :
  else
    fail 50 'Falló la publicación del frontend en Vercel. Revisa el token, el proyecto y el dominio.'
  fi
}

verify_deployment() {
  printf '[6/6] Verificando backend, frontend, CORS y tipos...\n'

  local attempt body health_ok=false
  for ((attempt = 1; attempt <= 12; attempt += 1)); do
    if body="$(curl -fsS --max-time 10 "$BACKEND_URL/health")" && \
      [[ "$body" == *'"status":"ok"'* && "$body" == *'"db":"up"'* ]]; then
      health_ok=true
      break
    fi
    sleep 5
  done
  if [[ "$health_ok" != true ]]; then
    fail 60 "El endpoint $BACKEND_URL/health no respondió correctamente."
  fi

  local page
  if ! page="$(curl -fsS --max-time 15 "$FRONTEND_URL")" || \
    [[ "${page,,}" != *'<!doctype html'* ]]; then
    fail 60 "La página pública no devolvió HTML en $FRONTEND_URL."
  fi

  local headers
  if ! headers="$(curl -fsSI --max-time 10 -X OPTIONS \
    -H "Origin: $FRONTEND_URL" \
    -H 'Access-Control-Request-Method: GET' \
    "$BACKEND_URL/api/equipment")" || \
    ! grep -Fqi "access-control-allow-origin: $FRONTEND_URL" <<<"$headers"; then
    fail 60 'El preflight CORS no autorizó el frontend configurado.'
  fi

  local types
  if ! types="$(curl -fsS --max-time 10 "$BACKEND_URL/api/equipment-types")" || \
    [[ "$types" != *'camion'* || "$types" != *'excavadora'* || "$types" != *'perforadora'* ]]; then
    fail 60 'El API no devolvió los tres tipos de equipo esperados.'
  fi

  printf '[6/6] Verificación completa.\nBackend: %s\nFrontend: %s\n' \
    "$BACKEND_URL" "$FRONTEND_URL"
}

main() {
  if [[ "${1:-}" == "--check" ]]; then
    if [[ $# -ne 1 ]]; then
      fail 2 'Uso: ./deploy.sh [--check]'
    fi
    preflight
    return 0
  fi

  if [[ $# -ne 0 ]]; then
    fail 2 'Uso: ./deploy.sh [--check]'
  fi

  CURRENT_STEP='1/6 preflight'
  preflight

  if ! mkdir .deploy.lock 2>/dev/null; then
    fail 11 'Ya hay un despliegue en curso: existe .deploy.lock.'
  fi
  trap cleanup EXIT

  CURRENT_STEP='2/6 build local'
  build_local
  CURRENT_STEP='3/6 migraciones'
  run_migrations
  CURRENT_STEP='4/6 backend Render'
  deploy_backend
  CURRENT_STEP='5/6 frontend Vercel'
  deploy_frontend
  CURRENT_STEP='6/6 verificación final'
  verify_deployment
}

trap on_error ERR
main "$@"
