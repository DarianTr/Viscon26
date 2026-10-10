# Deployment

```
PR / push ──► CI (GitHub-hosted): lint · typecheck · build · docker build
merge to main ──► Deploy (self-hosted runner on the VM): docker compose up --build --wait
```

The VM runs a GitHub Actions runner that polls GitHub over outbound HTTPS, so
no firewall ports need to be opened. Run the steps below on the VM once.

## 1. Docker

Check `docker compose version` works. If it doesn't, install Docker Engine with
the compose plugin. Then let the `viscon` user use Docker:

```sh
sudo usermod -aG docker viscon   # log out and back in afterwards
```

## 2. Server config

```sh
curl -fsSL https://raw.githubusercontent.com/DarianTr/Viscon26/main/deploy/viscon.env.example \
  -o /home/viscon/viscon.env   # or copy it over by hand
chmod 600 /home/viscon/viscon.env
nano /home/viscon/viscon.env  # set POSTGRES_PASSWORD (openssl rand -hex 24) and APP_PORT
```

Set `APP_PORT` to the port the organizers' reverse proxy forwards to: `8080`
by default (team page → Access Details → Edit Network Configuration). The
template app already listens there, so stop it first:

```sh
cd ~/template && docker compose down
```

Set `DEMO_USER_EMAIL` to your own X-User-Id (e.g. `jdoe@ethz.ch`), and
`DEMO_USER_HANDLE` / `DEMO_USER_NAME` to yours, to log in as the seeded admin.
The seed only runs on an empty database, so this applies on the first deploy
(or after wiping the volume). Everyone else gets the signup page on their first visit.

Login comes from the proxy's `X-User-Id` header, which anyone could forge if
they reached the app directly. So **don't** `ufw allow` the app port, keep
access control on one of the login modes, and never set `DEV_USER_ID` here.

> `POSTGRES_PASSWORD` only takes effect when the database is first created.
> To change it later, either change it inside Postgres too or wipe the volume
> (`docker compose -p viscon down -v`, which **deletes all data**).

## 3. Self-hosted runner

On GitHub, go to **Settings → Actions → Runners → New self-hosted runner →
Linux x64**. Run the download and `./config.sh …` commands it shows, as the
`viscon` user in `~/actions-runner`, accepting the defaults. Then install it
as a service so it survives reboots:

```sh
cd ~/actions-runner
sudo ./svc.sh install viscon
sudo ./svc.sh start
```

The runner should show up as **Idle** on the Runners page.

## 4. Lock down GitHub settings

- **Settings → Branches → Add rule for `main`**: require a pull request and
  require the `check` and `docker` status checks to pass.
- **Settings → Actions → General → Fork pull request workflows**: require
  approval for all outside collaborators. A self-hosted runner executes
  whatever a workflow tells it to, so only `deploy.yml` should ever use
  `runs-on: self-hosted`, and it must never run on `pull_request`.

## 5. First deploy

Merge to `main`, or start it by hand from **Actions → Deploy → Run workflow**.
Check it worked:

```sh
docker compose -p viscon ps
curl localhost:3000/api/health   # use your APP_PORT
```

## 6. Calendar subscriptions

The app's normal address is behind the organizers' login, and calendar apps
(Apple, Google, Outlook) can't log in. So the feed is also served on the VM's
direct address, `https://14-direct.viscon-hackathon.ch`, by the `direct`
service (Caddy) — only `/api/calendar/*`; everything else there redirects to
`APP_ORIGIN`. Add the calendar block from `viscon.env.example` to
`/home/viscon/viscon.env`, make sure ports 80 and 443 on the VM are reachable
from the internet (Caddy needs them for the Let's Encrypt certificate), and
redeploy. Opening the ports for Caddy is safe (unlike `APP_PORT`): it only
passes `/api/calendar/*` through.

```sh
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

If the organizers' team page has a firewall / network configuration for the
direct address, allow 80 and 443 there too. Check it (from outside the VM):

```sh
docker compose -p viscon logs direct   # "certificate obtained successfully"
curl -I https://14-direct.viscon-hackathon.ch/api/calendar/x.ics   # 404 from the app
```

Links made before this change point at the login-protected address: open
Settings → Calendar subscription again and subscribe with the new link.

## Day-to-day

| Task             | How                                                       |
| ---------------- | --------------------------------------------------------- |
| Deploy           | Merge a PR into `main`                                    |
| Redeploy         | Actions → Deploy → Run workflow                           |
| Logs             | `docker compose -p viscon logs -f app`                    |
| Roll back        | Revert the commit on `main` (migrations are not undone)   |
| Database shell   | `docker compose -p viscon exec db psql -U stride stride`  |
