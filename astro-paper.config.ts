import { defineAstroPaperConfig } from "./src/types/config";

export default defineAstroPaperConfig({
  site: {
    url: "https://srdjan-drca.github.io/",
    title: "Software Dots",
    description: "Short notes on what I've learned building software.",
    author: "Srdjan Drca",
    profile: "https://github.com/srdjan-drca",
    ogImage: "default-og.jpg",
    lang: "en",
    timezone: "Europe/Belgrade",
    dir: "ltr",
  },
  posts: {
    perPage: 10,
    perIndex: 6,
    scheduledPostMargin: 15 * 60 * 1000,
  },
  features: {
    lightAndDarkMode: true,
    dynamicOgImage: true,
    showArchives: true,
    showBackButton: true,
    editPost: {
      enabled: false,
    },
    search: "pagefind",
  },
  socials: [
    { name: "github",   url: "https://github.com/srdjan-drca" },
    { name: "linkedin", url: "https://www.linkedin.com/in/srdjan-drca/" },
  ],
  shareLinks: [],
});
