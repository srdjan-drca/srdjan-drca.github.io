---
title: "Hosting an Astro site on GitHub Pages for free"
description: "The exact steps I used to put this blog online: an Astro site, one GitHub Actions workflow, and the one Pages setting that tripped me up."
pubDatetime: 2026-10-07T11:00:00Z
tags:
  - astro
  - github-pages
  - github-actions
draft: false
---

This blog is an [Astro](https://astro.build/) site hosted on GitHub Pages. It costs nothing, there's no server to maintain, and publishing a note means `git push`. Here's the whole setup.

## 1. Decide: user site or project site

GitHub Pages gives you two kinds of sites:

| | User site | Project site |
| --- | --- | --- |
| Repo name | exactly `<username>.github.io` | anything, e.g. `my-blog` |
| URL | `https://<username>.github.io/` | `https://<username>.github.io/my-blog/` |
| Limit | one per account | as many as you want |

I went with a user site because the URL is cleaner and there's no base path to configure.

## 2. Create the Astro site

```bash
npm create astro@latest
# or start from a theme, e.g. the one this blog uses:
npm create astro@latest -- --template satnaing/astro-paper
```

Commit the lockfile (`package-lock.json`). The deploy action uses it to work out which package manager to run.

## 3. Tell Astro its public URL

Astro needs the final URL to generate correct links, the sitemap and the RSS feed:

```js file="astro.config.mjs"
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://<username>.github.io",
  // Project site only: the repo name becomes the base path
  // base: "/my-blog",
});
```

For a project site, also set `base`. Every internal link then needs that prefix, which is the main reason I avoided it.

## 4. Add the deploy workflow

Astro maintains an official action, [`withastro/action`](https://github.com/withastro/action), that installs dependencies, runs the build and uploads the result as a Pages artifact. `actions/deploy-pages` then publishes it:

```yaml file=".github/workflows/deploy.yml"
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch: # allows a manual "Run workflow" button

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: withastro/action@v6
        with:
          node-version: 24
          package-manager: npm

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

The `pages: write` and `id-token: write` permissions are what allow the deploy job to publish. Leave them out and the deploy fails.

## 5. Push and switch Pages to GitHub Actions

Create the repo and push. With the [GitHub CLI](https://cli.github.com/) that's one command run from the project folder:

```bash
gh repo create <username>/<username>.github.io --public --source . --remote origin --push
```

Then open **Settings → Pages** in the repo and set **Source** to **GitHub Actions**.

**This is the step that tripped me up.** A repo named `<username>.github.io` gets Pages turned on automatically, using the old **"Deploy from a branch"** mode, which runs Jekyll over your raw source files. Your workflow and that built-in Jekyll build then both run on every push. Switching the source to *GitHub Actions* fixes it. From the CLI:

```bash
gh api -X PUT repos/<username>/<username>.github.io/pages -f build_type=workflow
```

## 6. Check it

The **Actions** tab shows the run. Once `build` and `deploy` are green, the site is live, usually within a minute or two of the push. After that, every push to `main` redeploys automatically.

## Gotchas

- **The repo must be public** for Pages on a free GitHub plan.
- **Build scripts run on Linux in CI.** A script that works on your Windows machine may not work on the Linux runner, and the reverse is also true. Shell commands like `cp -r` work on the runner but fail under `npm run` on Windows. A small `node -e "…"` one-liner works on both.
- **A custom domain can come later.** Add it under *Settings → Pages → Custom domain*, update `site` in the Astro config, and nothing else changes.

## References

- [Astro docs: Deploy to GitHub Pages](https://docs.astro.build/en/guides/deploy/github/)
- [GitHub docs: Configuring a publishing source for Pages](https://docs.github.com/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
