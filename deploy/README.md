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

Set `APP_PORT` to the port the organizers' reverse proxy forwards to.

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

## Day-to-day

| Task             | How                                                       |
| ---------------- | --------------------------------------------------------- |
| Deploy           | Merge a PR into `main`                                    |
| Redeploy         | Actions → Deploy → Run workflow                           |
| Logs             | `docker compose -p viscon logs -f app`                    |
| Roll back        | Revert the commit on `main` (migrations are not undone)   |
| Database shell   | `docker compose -p viscon exec db psql -U stride stride`  |
