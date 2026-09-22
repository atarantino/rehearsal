#!/usr/bin/env bash
# Configure this checkout using the repository-scoped key injected by Omnara.
set -euo pipefail
command -v ssh >/dev/null || { echo "Install openssh-client in the sandbox first" >&2; exit 1; }
: "${REHEARSAL_GITHUB_SSH_KEY:?Omnara must inject the rehearsal deploy-key secret}"
repo="${1:-$PWD}"
git -C "$repo" rev-parse --git-dir >/dev/null
case "$(git -C "$repo" remote get-url origin)" in
  https://github.com/atarantino/rehearsal|https://github.com/atarantino/rehearsal.git|git@github.com:atarantino/rehearsal.git) ;;
  *) echo 'Refusing to configure a different repository' >&2; exit 1 ;;
esac
umask 077
mkdir -p "$HOME/.ssh"
key_file="$HOME/.ssh/omnara_rehearsal"
hosts_file="$HOME/.ssh/omnara_rehearsal_known_hosts"
printf '%s\n' "$REHEARSAL_GITHUB_SSH_KEY" > "$key_file"
cat > "$hosts_file" <<'GITHUB_HOST_KEYS'
[ssh.github.com]:443 ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl
[ssh.github.com]:443 ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBEmKSENjQEezOmxkZMy7opKgwFB9nkt5YRrYMjNuG5N87uRgg6CLrbo5wAdT/y6v0mKV0U2w0WZ2YB/++Tpockg=
[ssh.github.com]:443 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQCj7ndNxQowgcQnjshcLrqPEiiphnt+VTTvDP6mHBL9j1aNUkY4Ue1gvwnGLVlOhGeYrnZaMgRK6+PKCUXaDbC7qtbW8gIkhL7aGCsOr/C56SJMy/BCZfxd1nWzAOxSDPgVsmerOBYfNqltV9/hWCqBywINIR+5dIg6JTJ72pcEpEjcYgXkE2YEFXV1JHnsKgbLWNlhScqb2UmyRkQyytRLtL+38TGxkxCflmO+5Z8CSSNY7GidjMIZ7Q4zMjA2n1nGrlTDkzwDCsw+wqFPGQA179cnfGWOWRVruj16z6XyvxvjJwbz0wQZ75XK5tKSb7FNyeIEs4TT4jk+S4dhPeAUC5y+bDYirYgM4GC7uEnztnZyaVWQ7B381AK4Qdrwt51ZqExKbQpTUNn+EjqoTwvqNj4kqx5QUCI0ThS/YkOxJCXmPUWZbhjpCg56i+2aB6CmK2JGhn57K5mj0MNdBXA4/WnwH6XoPWJzK5Nyu2zB3nAZp+S5hpQs+p1vN1/wsjk=
GITHUB_HOST_KEYS
chmod 600 "$key_file" "$hosts_file"
printf -v ssh_command 'ssh -i %q -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=%q -p 443' "$key_file" "$hosts_file"
git -C "$repo" config core.sshCommand "$ssh_command"
git -C "$repo" remote set-url --push origin ssh://git@ssh.github.com:443/atarantino/rehearsal.git
printf 'Git push authentication configured for rehearsal.\n'
