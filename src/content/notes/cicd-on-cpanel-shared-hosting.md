---
title: "CI/CD on cPanel shared hosting with GitHub Actions"
description: "How I deploy a Node.js API to cheap cPanel shared hosting on every push: build in GitHub Actions, rsync over SSH, restart through Passenger."
pubDatetime: 2026-10-07T12:00:00Z
tags:
  - github-actions
  - cpanel
  - nodejs
  - ci-cd
draft: false
---

One of my projects is a NestJS API that runs on ordinary cPanel shared hosting. There's no Docker and no Kubernetes, and the hosting company has no deploy API, so for a while "deploying" meant zipping `dist/`, uploading it through File Manager and clicking **Restart**. It turns out that all you need for real CI/CD on that kind of host is SSH access. Here's the setup I use now: every push to `main` builds, uploads, migrates the database and restarts the app.

## The idea

Most cPanel hosts run Node.js apps through **Phusion Passenger**, configured in the **Setup Node.js App** page. Three facts make automated deploys possible:

1. You can SSH into the account.
2. Each Node app gets its own **virtual environment** with the selected Node version, which you can activate over SSH.
3. Passenger reloads the app when the file `tmp/restart.txt` in the app root is touched.

So the pipeline is: **build in GitHub Actions → `rsync` the build over SSH → `npm ci` + migrations over SSH → `touch tmp/restart.txt`.**

I build in CI rather than on the server on purpose. Shared hosts have tight memory and CPU limits, and a TypeScript build is exactly the kind of job that gets killed halfway through.

## 1. Create the Node.js app in cPanel

In **Setup Node.js App → Create Application**, set:

- **Node.js version**: the same one you use in CI (I use 24).
- **Application root**: the folder the app lives in, e.g. `api.example.com`. Its full path is `/home/<cpanel-user>/api.example.com`.
- **Application URL**: the domain or subdomain.
- **Application startup file**: the built entry point, e.g. `dist/main.js`.

After saving, the top of the page shows a command like this:

```bash
source /home/<cpanel-user>/nodevenv/api.example.com/24/bin/activate && cd /home/<cpanel-user>/api.example.com
```

Write down both paths. The first one, without `/bin/activate`, is the venv path, and the second is the app path. The workflow needs both.

## 2. Create an SSH key for GitHub Actions

Generate a dedicated key **without a passphrase**. The SSH agent in Actions can't type one in:

```bash
ssh-keygen -t ed25519 -N "" -C "github-actions-deploy" -f cpanel_deploy
```

In cPanel, open **SSH Access → Manage SSH Keys → Import Key**, paste the contents of `cpanel_deploy.pub`, and then **Authorize** it. A key that is imported but not authorized is ignored, which cost me a few minutes.

Test it from your machine. Many shared hosts use a non-standard SSH port, and the port is listed in the cPanel sidebar or in your hosting welcome email:

```bash
ssh -i cpanel_deploy -p <port> <cpanel-user>@<host>
```

## 3. Add the GitHub secrets

The workflow reads everything host-specific from repository secrets, so nothing about the server ends up in git:

| Secret | Example |
| --- | --- |
| `CPANEL_SSH_KEY` | contents of the **private** key `cpanel_deploy` |
| `CPANEL_HOST` | `server123.example-host.com` |
| `CPANEL_SSH_PORT` | `22` or the host's custom port |
| `CPANEL_USER` | your cPanel username |
| `CPANEL_APP_PATH` | `/home/<cpanel-user>/api.example.com` |
| `CPANEL_NODE_VENV` | `/home/<cpanel-user>/nodevenv/api.example.com/24` (no `/bin`) |

With the GitHub CLI:

```bash
gh secret set CPANEL_SSH_KEY < cpanel_deploy
gh secret set CPANEL_HOST --body "server123.example-host.com"
gh secret set CPANEL_SSH_PORT --body "22"
gh secret set CPANEL_USER --body "<cpanel-user>"
gh secret set CPANEL_APP_PATH --body "/home/<cpanel-user>/api.example.com"
gh secret set CPANEL_NODE_VENV --body "/home/<cpanel-user>/nodevenv/api.example.com/24"
```

After that, delete the local private key or store it in your password manager.

Keep a copy of `CPANEL_APP_PATH` and `CPANEL_NODE_VENV` somewhere too. GitHub never shows a secret's value again, and months later you won't remember them. You can always look them up again in **Setup Node.js App**, though.

## 4. The workflow

```yaml file=".github/workflows/deploy.yml"
name: CI/CD

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version: "24"
          cache: "npm"

      - run: npm ci
      - run: npm run build

      - uses: actions/upload-artifact@v7
        with:
          name: build-output
          path: |
            dist
            package.json
            package-lock.json
          retention-days: 1

  deploy:
    needs: build
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/download-artifact@v8
        with:
          name: build-output

      - name: Install SSH key
        uses: webfactory/ssh-agent@v0.10.0
        with:
          ssh-private-key: ${{ secrets.CPANEL_SSH_KEY }}

      - name: Trust cPanel host key
        run: ssh-keyscan -p "${{ secrets.CPANEL_SSH_PORT }}" "${{ secrets.CPANEL_HOST }}" >> ~/.ssh/known_hosts

      - name: Upload build to cPanel
        run: |
          rsync -avz --delete \
            -e "ssh -p ${{ secrets.CPANEL_SSH_PORT }}" \
            dist package.json package-lock.json \
            "${{ secrets.CPANEL_USER }}@${{ secrets.CPANEL_HOST }}:${{ secrets.CPANEL_APP_PATH }}/"

      - name: Install prod deps, run migrations, restart app
        run: |
          ssh -p "${{ secrets.CPANEL_SSH_PORT }}" "${{ secrets.CPANEL_USER }}@${{ secrets.CPANEL_HOST }}" '
            set -e
            source "${{ secrets.CPANEL_NODE_VENV }}/bin/activate"
            cd "${{ secrets.CPANEL_APP_PATH }}"
            npm ci --omit=dev
            npx typeorm migration:run -d dist/data-access/data-source.js
            mkdir -p tmp
            touch tmp/restart.txt
          '
```

What each part does:

- **`build`** runs on pull requests too, so a PR that doesn't compile shows a red check before it's merged. It uploads only what the server needs: `dist/` and the two package files. No source code and no `node_modules` go to the server.
- **`deploy`** runs only for pushes to `main`. The `environment: production` line is optional, but it gives you a deployment history in the repo, and you can add a manual approval rule later.
- **`ssh-keyscan`** adds the server's host key to `known_hosts`, so the first `ssh` call doesn't stop and wait for a "yes" that nobody will type.
- **`source …/bin/activate`** puts the venv's `node` and `npm` on the `PATH`. Without it you get whatever (usually ancient) Node the server has by default, or no Node at all.
- **`npm ci --omit=dev`** installs only production dependencies, from the lockfile.
- **Migrations** are specific to my app (TypeORM). Remove the line if you don't need it, or replace it with your own tool.
- **`touch tmp/restart.txt`** tells Passenger to reload the app on the next request.

## 5. Environment variables: there are two places

This one surprised me the most. The **Environment variables** section of **Setup Node.js App** is applied **only to the process that Passenger starts**. A command you run over SSH, like the migration step above, doesn't get any of them. So the migration couldn't find the database credentials, even though the app itself worked fine.

The fix: put a `.env` file in the app root with the same values, and load it with `dotenv` in the code the SSH commands run (for me, the TypeORM data source):

```ts file="src/data-access/data-source.ts"
import "dotenv/config"; // used when the TypeORM CLI runs over SSH
import { DataSource } from "typeorm";

export default new DataSource({
  type: "mysql",
  host: process.env.DB_HOST,
  // ...
});
```

The `.env` file lives only on the server. It's not in git and not in the artifact, so the deploy never overwrites it. The downside: when credentials change, you have to update **both** the cPanel UI and `.env`.

## Gotchas

- **`restart.txt` reloads a running app, but it can't start a stopped one.** If the app shows **Stopped** in cPanel, the deploy goes through without errors and the site stays down until you click **Start**. I chose not to automate that. My host has no API tokens, and putting the cPanel password in CI wasn't worth it.
- **`rsync --delete` is safer than it looks here.** Because the sources are `dist` and two files, not the app folder itself, `--delete` only removes old files *inside* `dist/`. Your `.env`, `tmp/` and the venv's `node_modules` in the app root are left alone. If you change the command to sync a whole directory with a trailing slash, check this again.
- **The database host is probably `localhost`.** The host name you use from your own machine (something like `server123.example-host.com`) is for outside connections. The app runs on the same server as MySQL, so it should connect to `localhost`.
- **Use the same Node version in CI and in cPanel.** The build runs on one and the app runs on the other. If the versions differ, native modules and newer syntax can break only in production.
- **The same pattern works for frontends.** I deploy an Angular site to the same account this way. The build output is served by a tiny Express `app.js`, so it's just another Passenger app with its own `CPANEL_APP_PATH` and `CPANEL_NODE_VENV`.

## References

- [`webfactory/ssh-agent`](https://github.com/webfactory/ssh-agent)
- [cPanel docs: Application Manager / Setup Node.js App](https://docs.cpanel.net/knowledge-base/web-services/how-to-install-a-node.js-application/)
- [Passenger docs: restarting apps with `tmp/restart.txt`](https://www.phusionpassenger.com/library/admin/apache/restart_app.html)
- [GitHub docs: Using secrets in GitHub Actions](https://docs.github.com/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)
