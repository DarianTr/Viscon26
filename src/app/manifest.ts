import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Braina — grow your brain by using it",
    short_name: "Braina",
    description: "Study plans, a focus timer and a social feed for studying.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f5ec",
    theme_color: "#bb3925",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
