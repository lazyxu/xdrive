#!/bin/sh
# DSM executes this CGI as the installed package user. Never elevate or
# expose the Agent's localhost bearer outside its 0700 config directory.
set -eu
umask 077

case "${GATEWAY_INTERFACE:-}" in CGI/*) ;; *) exit 1 ;; esac
case "${HTTPS:-}" in on|ON|1) ;; *) exit 1 ;; esac
case "${REQUEST_METHOD:-}" in GET|POST) ;; *) exit 1 ;; esac
[ -n "${REMOTE_ADDR:-}" ] && [ -n "${HTTP_COOKIE:-}" ] || exit 1

# Resolve DSM's /webman/3rdparty/xdrivenas symlink. No request parameter
# can select a binary, credential directory, account or local Root.
ui="$(CDPATH= cd -P "$(dirname "$0")" && pwd -P)" || exit 1
target="$(readlink -f /var/packages/xdrivenas/target)" || exit 1
[ "$ui" = "$target/ui" ] || exit 1
[ -x "$target/bin/xd" ] || exit 1

HOME=/var/packages/xdrivenas/home
XDG_CONFIG_HOME="$HOME/.config"
XDG_CACHE_HOME=/var/packages/xdrivenas/var/cache
XD_DISABLE_SECRET_SERVICE=1
export HOME XDG_CONFIG_HOME XDG_CACHE_HOME XD_DISABLE_SECRET_SERVICE
exec "$target/bin/xd" backup synology-ui cgi
