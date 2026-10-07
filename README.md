# Software Dots

Short notes on what I've learned building software. Live at **https://srdjan-drca.github.io/**.

Built with [Astro](https://astro.build/) and the [AstroPaper](https://github.com/satnaing/astro-paper) theme, and deployed to GitHub Pages by GitHub Actions on every push to `main`.

## Writing a note

1. Copy `src/content/notes/_template.md` to `src/content/notes/<slug>.md`. The file name becomes the URL `/notes/<slug>/`.
2. Fill in the front matter (`title`, `description`, `pubDatetime`, `tags`).
3. Keep `draft: true` while writing. Drafts are visible in `npm run dev` but never published.
4. Set `draft: false`, commit and push. The site rebuilds automatically.

## Commands

| Command           | What it does                                       |
| ----------------- | -------------------------------------------------- |
| `npm install`     | Install dependencies                               |
| `npm run dev`     | Local dev server at http://localhost:4321          |
| `npm run build`   | Type-check, build to `dist/`, build search index   |
| `npm run preview` | Serve the production build locally                 |

## Where things live

- `astro-paper.config.ts`: site title, author, socials and feature switches
- `src/content/notes/`: the notes
- `src/content/pages/about.md`: the About page
- `.github/workflows/deploy.yml`: the GitHub Pages deployment
